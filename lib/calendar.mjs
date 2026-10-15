import { googleApi } from './google.mjs';

const positive = ['thanks', 'thank you', 'great', 'excellent', 'appreciate', 'pleased', 'resolved', 'success', 'helpful', 'looking forward'];
const negative = ['issue', 'delay', 'frustrated', 'concern', 'escalation', 'unhappy', 'late', 'risk', 'difficult', 'problem', 'complaint', 'urgent', 'failure', 'blocked', 'disappointed'];

function sentiment(text) {
  const s = String(text || '').toLowerCase();
  const pos = positive.reduce((n, word) => n + (s.includes(word) ? 1 : 0), 0);
  const neg = negative.reduce((n, word) => n + (s.includes(word) ? 1 : 0), 0);
  const score = pos - neg;
  return { score, label: score <= -2 ? 'Strained' : score >= 2 ? 'Positive' : 'Neutral', method: 'Local phrase-based estimate' };
}

function partsAt(date, timeZone) {
  const out = {};
  for (const p of new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', weekday:'short', hourCycle:'h23' }).formatToParts(date)) if (p.type !== 'literal') out[p.type] = p.value;
  return out;
}

function localTime(day, hour, minute, timeZone) {
  const [y,m,d] = day.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d, hour, minute);
  let guess = target;
  for (let i=0;i<3;i++) {
    const p = partsAt(new Date(guess), timeZone);
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    guess += target - represented;
  }
  return new Date(guess);
}

function makeBreaks(events, timeZone) {
  const days = new Map();
  for (const event of events) {
    if (!event.start?.dateTime || !event.end?.dateTime) continue;
    const day = partsAt(new Date(event.start.dateTime), timeZone);
    if (day.weekday === 'Sat' || day.weekday === 'Sun') continue;
    const key = `${day.year}-${day.month}-${day.day}`;
    if (!days.has(key)) days.set(key, []);
    days.get(key).push({ start:new Date(event.start.dateTime), end:new Date(event.end.dateTime) });
  }
  const proposals=[];
  for (const [day, meetings] of days) {
    meetings.sort((a,b)=>a.start-b.start);
    for (let i=1;i<meetings.length;i++) {
      const prev=meetings[i-1], next=meetings[i];
      const gap=(next.start-prev.end)/60000;
      if (gap < 25) continue;
      const start=new Date(prev.end.getTime()+5*60000);
      const end=new Date(start.getTime()+20*60000);
      if (end > next.start) continue;
      const local=partsAt(start,timeZone);
      proposals.push({ key:`${day}-${i}`, start:start.toISOString(), end:end.toISOString(), timeZone, label:`${local.weekday} · ${local.hour}:${local.minute} · 20 min`, title:'Recovery break · proposed by PYTHIA', reason:`A 20-minute recovery gap between ${prev.end.toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZone})} and the next meeting.` });
      break;
    }
  }
  return proposals;
}

export async function analyzeCalendar({ days=5, lookback=30, timeZone:requestedZone='UTC' }={}) {
  const calendar=await googleApi('/calendar/v3/calendars/primary?fields=timeZone,summary');
  const timeZone=calendar.timeZone || requestedZone || 'UTC';
  const now=new Date(), end=new Date(now.getTime()+days*86400000);
  const params=new URLSearchParams({ timeMin:now.toISOString(), timeMax:end.toISOString(), singleEvents:'true', orderBy:'startTime', maxResults:'250', fields:'items(id,summary,description,start,end,attendees(email,displayName,responseStatus),organizer(email,displayName),location)' });
  const calendarData=await googleApi(`/calendar/v3/calendars/primary/events?${params}`);
  const events=(calendarData.items||[]).filter(e=>e.start?.dateTime&&e.end?.dateTime).map(e=>({...e,summary:e.summary||'(Untitled event)'}));
  const tokenEmail=(await import('./google.mjs')).readGoogleToken;
  const stored=await tokenEmail();
  const external=new Set(events.flatMap(e=>(e.attendees||[]).map(a=>a.email).filter(email=>email&&email.toLowerCase()!==String(stored?.email||'').toLowerCase())));
  const contextByEmail=new Map();
  for (const email of [...external].slice(0,12)) {
    const q=`newer_than:${lookback}d {from:${email} to:${email}}`;
    const list=await googleApi(`/gmail/v1/users/me/messages?${new URLSearchParams({q,maxResults:'5'})}`);
    const messages=[];
    for (const item of (list.messages||[]).slice(0,5)) {
      const metadata=new URLSearchParams({format:'metadata'});
      for (const header of ['Subject','From','Date']) metadata.append('metadataHeaders',header);
      const m=await googleApi(`/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?${metadata}`);
      const headers=Object.fromEntries((m.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
      const text=`${headers.subject||''} ${m.snippet||''}`;
      messages.push({subject:headers.subject||'(No subject)',from:headers.from||'',date:headers.date||'',snippet:String(m.snippet||'').slice(0,240),sentiment:sentiment(text)});
    }
    contextByEmail.set(email,messages);
  }
  const enriched=events.map(event=>{
    const contacts=(event.attendees||[]).map(a=>a.email).filter(email=>contextByEmail.has(email));
    const emails=[...new Map(contacts.flatMap(email=>contextByEmail.get(email)||[]).map(m=>[`${m.from}|${m.date}|${m.subject}`,m])).values()].slice(0,3);
    const scores=emails.map(m=>m.sentiment.score), avg=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0;
    const tone=avg<=-1?'Strained':avg>=1?'Positive':'Neutral';
    const start=new Date(event.start.dateTime), finish=new Date(event.end.dateTime);
    const duration=(finish-start)/60000;
    let strain=(duration>=60?2:duration>=45?1:0)+(event.attendees?.length>=6?1:0)+(emails.length&&avg<=-1?3:0);
    if (/escalat|complain|renewal|negotia|incident|overdue|risk/i.test(event.summary)) strain++;
    strain=Math.min(10,Math.max(1,strain+3));
    return { id:event.id, title:event.summary, start:event.start, end:event.end, attendees:(event.attendees||[]).map(a=>({name:a.displayName||a.email,email:a.email})), durationMinutes:Math.round(duration), strain, sentiment:tone, emailCount:emails.length, emailContext:emails.map(({subject,from,date,snippet,sentiment:sent})=>({subject,from,date,snippet,sentiment:sent.label})), reason:emails.length?`${tone.toLowerCase()} tone in ${emails.length} recent related email${emails.length===1?'':'s'}`:'No matching recent email context found' };
  }).sort((a,b)=>new Date(a.start.dateTime)-new Date(b.start.dateTime));
  const proposals=makeBreaks(events,timeZone);
  const strained=events.filter((e,i)=>enriched[i]?.sentiment==='Strained').length;
  return { source:'Google Calendar + Gmail', timeZone, calendarName:calendar.summary||'Primary calendar', range:{start:now.toISOString(),end:end.toISOString(),days}, meetingCount:events.length, emailCount:[...contextByEmail.values()].reduce((n,ms)=>n+ms.length,0), strainedMeetings:strained, events:enriched, proposals, steps:[
    {title:'Read your Google Calendar',detail:`${events.length} meetings found over the next ${days} days.`},
    {title:'Review related Gmail context',detail:`Checked ${[...contextByEmail.values()].reduce((n,ms)=>n+ms.length,0)} recent message snippets from meeting participants. Message bodies are not retained.`},
    {title:'Estimate meeting strain',detail:`Scored duration, density, attendee count, and available email tone. Sentiment is a local phrase-based estimate.`},
    {title:'Find recovery gaps',detail:`Found ${proposals.length} usable recovery gap${proposals.length===1?'':'s'} in your working day.`}
  ]};
}

export function makeDemoCalendar() {
  const base=new Date();
  const monday=new Date(base); monday.setDate(base.getDate()+((8-base.getDay())%7)); monday.setHours(9,0,0,0);
  const event=(day,h1,m1,dur,title,sentimentLabel,context)=>{const s=new Date(monday);s.setDate(monday.getDate()+day);s.setHours(h1,m1,0,0);const e=new Date(s.getTime()+dur*60000);return{id:`demo-${day}-${h1}-${title}`,title,start:{dateTime:s.toISOString()},end:{dateTime:e.toISOString()},durationMinutes:dur,strain:sentimentLabel==='Strained'?8:sentimentLabel==='Positive'?3:5,sentiment:sentimentLabel,emailCount:context?1:0,emailContext:context?[{subject:`Re: ${title}`,from:'client@example.test',date:s.toISOString(),snippet:context,sentiment:sentimentLabel}]:[],reason:context?`${sentimentLabel.toLowerCase()} tone in a seeded related message`:'No related seeded email context'} };
  const events=[event(0,9,0,50,'Initech weekly sync','Strained','The migration delay is a serious concern. Please confirm a recovery plan before the escalation.'),event(0,10,0,45,'Globex renewal preparation','Positive','Thanks for the draft. The renewal plan looks good and the client is pleased.'),event(1,9,0,60,'Client escalation review','Strained','We are frustrated by the missed date and need a clear owner for the issue.'),event(1,10,0,50,'Umbrella QBR','Positive','Great discussion and excellent progress. Appreciate the team’s quick response.'),event(2,11,0,45,'Project delivery standup','Neutral','Reviewing this week’s delivery status and open actions.')];
  const proposals=makeBreaks(events,'Europe/Prague');
  return {source:'Seeded mockup data',timeZone:'Europe/Prague',calendarName:'Demo calendar',range:{days:5},meetingCount:events.length,emailCount:4,strainedMeetings:2,events,proposals,steps:[{title:'Read the demo calendar',detail:`${events.length} seeded meetings found over the next five days.`},{title:'Review seeded Gmail context',detail:'4 sample message snippets from meeting participants.'},{title:'Estimate meeting strain',detail:'Scored duration, density, attendee count, and seeded email tone.'},{title:'Find recovery gaps',detail:`Found ${proposals.length} recovery gaps in the seeded calendar.`}]};
}
