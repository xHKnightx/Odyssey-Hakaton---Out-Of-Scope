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

const WEEKDAY_INDEX={Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7};
const clockMinutes=value=>{const [h,m]=String(value||'').split(':').map(Number);return Number.isInteger(h)&&Number.isInteger(m)&&h>=0&&h<=23&&m>=0&&m<60?h*60+m:null};
const BREAK_STYLES={
  breathe:{title:'A little breathing room',reason:'A small pause to breathe. No incense or life-changing revelation required.'},
  quiet:{title:'Quiet reset',reason:'A screen-free moment to let your attention land somewhere softer.'},
  coffee:{title:'Coffee or tea, pending',reason:'A little drink break. Your inbox can wait while the kettle does its thing.'},
  stretch:{title:'Uncurl from keyboard shape',reason:'A gentle stretch for shoulders that have been attending meetings too.'},
  fresh_air:{title:'Fresh-air intermission',reason:'A short walk or window break for a change of scenery.'},
  surprise:{title:'A small reset (surprise me)',reason:'A short pause. Choose whatever sounds kind to you when the reminder arrives.'}
};

export function normalizeBreakPreferences(raw={}) {
  const durationMinutes=Number(raw.durationMinutes||10),windowStart=String(raw.windowStart||'09:00'),windowEnd=String(raw.windowEnd||'17:00'),activity=String(raw.activity||'surprise');
  const start=clockMinutes(windowStart),end=clockMinutes(windowEnd);
  const weekdays=[...new Set((Array.isArray(raw.weekdays)?raw.weekdays:[1,2,3,4,5]).map(Number).filter(day=>Number.isInteger(day)&&day>=1&&day<=5))].sort();
  if(![5,10,15].includes(durationMinutes))throw new Error('Choose a break length of 5, 10, or 15 minutes.');
  if(!Object.hasOwn(BREAK_STYLES,activity))throw new Error('Choose a break style from the list.');
  if(start===null||end===null||end-start<60)throw new Error('Choose a valid working window that is at least one hour long.');
  if(!weekdays.length)throw new Error('Choose at least one weekday.');
  return {durationMinutes,activity,windowStart,windowEnd,weekdays,bufferMinutes:Math.min(15,Math.max(0,Math.floor(Number(raw.bufferMinutes)||5))),maxPerDay:Math.min(3,Math.max(1,Math.floor(Number(raw.maxPerDay)||1))),invitationsPerWeek:[1,2,3,5].includes(Number(raw.invitationsPerWeek))?Number(raw.invitationsPerWeek):3};
}

export function makeRecoverySlots(events,{timeZone='UTC',preferences:rawPreferences={},rangeStart=null,days=7}={}) {
  const preferences=normalizeBreakPreferences(rawPreferences),daySlots=new Map();
  const now=rangeStart?new Date(rangeStart):null;
  const nowParts=now&&!Number.isNaN(now.getTime())?partsAt(now,timeZone):null;
  const nowDay=nowParts?`${nowParts.year}-${nowParts.month}-${nowParts.day}`:null;
  if(now&&!Number.isNaN(now.getTime())){
    const parts=nowParts,firstDay=nowDay;
    for(let offset=0;offset<Math.min(90,Math.max(1,Number(days)||7));offset++){
      const day=addLocalDays(firstDay,offset),date=new Date(`${day}T00:00:00Z`),weekday=date.getUTCDay()||7;
      if(preferences.weekdays.includes(weekday))daySlots.set(day,{weekday,busy:[]});
    }
  }
  for(const event of events){
    if(!event.start?.dateTime||!event.end?.dateTime)continue;
    const day=partsAt(new Date(event.start.dateTime),timeZone),weekday=WEEKDAY_INDEX[day.weekday];
    if(!weekday||!preferences.weekdays.includes(weekday))continue;
    const key=`${day.year}-${day.month}-${day.day}`;
    if(!daySlots.has(key))daySlots.set(key,{weekday,busy:[]});
    daySlots.get(key).busy.push({start:new Date(event.start.dateTime),end:new Date(event.end.dateTime)});
  }
  const proposals=[],windowStart=clockMinutes(preferences.windowStart),windowEnd=clockMinutes(preferences.windowEnd),step=30;
  for(const [day,{weekday,busy}] of [...daySlots.entries()].sort(([a],[b])=>a.localeCompare(b))){
    const dayOpen=localTime(day,Math.floor(windowStart/60),windowStart%60,timeZone),close=localTime(day,Math.floor(windowEnd/60),windowEnd%60,timeZone);
    const open=nowDay===day?new Date(Math.max(dayOpen,now)):dayOpen;
    const intervals=busy.map(item=>({start:new Date(Math.max(open,item.start)),end:new Date(Math.min(close,item.end))})).filter(item=>item.end>item.start).sort((a,b)=>a.start-b.start);
    const merged=[];
    for(const interval of intervals){const last=merged.at(-1);if(last&&interval.start<=last.end)last.end=new Date(Math.max(last.end,interval.end));else merged.push({...interval})}
    const free=[];let cursor=open;
    for(const interval of merged){if(interval.start>cursor)free.push({start:cursor,end:interval.start});if(interval.end>cursor)cursor=interval.end}
    if(cursor<close)free.push({start:cursor,end:close});
    let added=0;
    for(const segment of free){
      const earliest=new Date(segment.start.getTime()+preferences.bufferMinutes*60000),latest=new Date(segment.end.getTime()-preferences.bufferMinutes*60000-preferences.durationMinutes*60000);
      let start=new Date(Math.ceil(earliest.getTime()/(step*60000))*step*60000);
      if(start<earliest)start=new Date(start.getTime()+step*60000);
      while(start<=latest&&added<preferences.maxPerDay&&proposals.length<60){
        const end=new Date(start.getTime()+preferences.durationMinutes*60000),local=partsAt(start,timeZone),label=`${local.weekday} ${local.hour}:${local.minute} · ${preferences.durationMinutes} min`;
        const choices=Object.keys(BREAK_STYLES).filter(key=>key!=='surprise'),resolvedActivity=preferences.activity==='surprise'?choices[(new Date(`${day}T00:00:00Z`).getUTCDate()+weekday)%choices.length]:preferences.activity,style=BREAK_STYLES[resolvedActivity];
        proposals.push({key:`${day}-${start.toISOString()}`,day,weekday,label,start:start.toISOString(),end:end.toISOString(),timeZone,durationMinutes:preferences.durationMinutes,activity:resolvedActivity,title:style.title,reason:`${style.reason} (${preferences.durationMinutes} minutes)`});
        added++;start=new Date(start.getTime()+step*60000);
      }
      if(added>=preferences.maxPerDay||proposals.length>=60)break;
    }
  }
  return proposals;
}

function addLocalDays(day,amount){const date=new Date(`${day}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10)}

export function hasCalendarConflict(events,{start,end,timeZone='UTC',occurrences=1}={}) {
  const startDate=new Date(start),endDate=new Date(end),duration=endDate-startDate;
  if(!Number.isFinite(duration)||duration<=0)return true;
  const parts=partsAt(startDate,timeZone),day=`${parts.year}-${parts.month}-${parts.day}`,hour=Number(parts.hour),minute=Number(parts.minute);
  for(let index=0;index<occurrences;index++){
    const occurrenceStart=localTime(addLocalDays(day,index*7),hour,minute,timeZone),occurrenceEnd=new Date(occurrenceStart.getTime()+duration);
    if(events.some(event=>{
      if(event.start?.dateTime&&event.end?.dateTime)return new Date(event.start.dateTime)<occurrenceEnd&&new Date(event.end.dateTime)>occurrenceStart;
      if(event.start?.date&&event.end?.date){
        const eventStart=localTime(event.start.date,0,0,timeZone),eventEnd=localTime(event.end.date,0,0,timeZone);
        return eventStart<occurrenceEnd&&eventEnd>occurrenceStart;
      }
      return false;
    }))return true;
  }
  return false;
}

export function toBusyIntervals(items,timeZone='UTC'){
  const intervals=[];
  for(const event of items){
    if(event.start?.dateTime&&event.end?.dateTime){intervals.push({start:{dateTime:event.start.dateTime},end:{dateTime:event.end.dateTime}});continue}
    if(!event.start?.date||!event.end?.date)continue;
    for(let day=event.start.date;day<event.end.date;day=addLocalDays(day,1)){
      intervals.push({start:{dateTime:localTime(day,0,0,timeZone).toISOString()},end:{dateTime:localTime(addLocalDays(day,1),0,0,timeZone).toISOString()}});
    }
  }
  return intervals;
}

export async function analyzeCalendar({ days=5, lookback=30, timeZone:requestedZone='UTC', includeGmail=true, breakPreferences={} }={}) {
  const calendar=await googleApi('/calendar/v3/calendars/primary?fields=timeZone,summary');
  const timeZone=calendar.timeZone || requestedZone || 'UTC';
  const now=new Date(), end=new Date(now.getTime()+days*86400000);
  const params=new URLSearchParams({ timeMin:now.toISOString(), timeMax:end.toISOString(), singleEvents:'true', orderBy:'startTime', maxResults:'250', fields:'items(id,summary,description,start,end,attendees(email,displayName,responseStatus),organizer(email,displayName),location)' });
  const calendarData=await googleApi(`/calendar/v3/calendars/primary/events?${params}`);
  const calendarItems=calendarData.items||[],busyIntervals=toBusyIntervals(calendarItems,timeZone);
  const events=calendarItems.filter(e=>e.start?.dateTime&&e.end?.dateTime).map(e=>({...e,summary:e.summary||'(Untitled event)'}));
  const tokenEmail=(await import('./google.mjs')).readGoogleToken;
  const stored=includeGmail?await tokenEmail():null;
  const external=new Set(includeGmail?events.flatMap(e=>(e.attendees||[]).map(a=>a.email).filter(email=>email&&email.toLowerCase()!==String(stored?.email||'').toLowerCase())):[]);
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
  const proposals=makeRecoverySlots(busyIntervals,{timeZone,preferences:breakPreferences,rangeStart:now,days});
  const strained=events.filter((e,i)=>enriched[i]?.sentiment==='Strained').length;
  return { source:includeGmail?'Google Calendar + Gmail':'Google Calendar', timeZone, calendarName:calendar.summary||'Primary calendar', range:{start:now.toISOString(),end:end.toISOString(),days}, meetingCount:events.length, emailCount:[...contextByEmail.values()].reduce((n,ms)=>n+ms.length,0), strainedMeetings:strained, events:enriched, busyIntervals, proposals, steps:[
    {title:'Read your Google Calendar',detail:`${events.length} meetings found over the next ${days} days.`},
    {title:includeGmail?'Review related Gmail context':'Keep planning calendar-only',detail:includeGmail?`Checked ${[...contextByEmail.values()].reduce((n,ms)=>n+ms.length,0)} recent message snippets from meeting participants. Message bodies are not retained.`:'Gmail and event details are not used for recovery-break planning.'},
    {title:'Estimate meeting strain',detail:`Scored duration, density, attendee count, and available email tone. Sentiment is a local phrase-based estimate.`},
    {title:'Find recovery gaps',detail:`Found ${proposals.length} usable recovery gap${proposals.length===1?'':'s'} in your working day.`}
  ]};
}

export function makeDemoCalendar() {
  const base=new Date();
  const monday=new Date(base); monday.setDate(base.getDate()+((8-base.getDay())%7)); monday.setHours(9,0,0,0);
  const event=(day,h1,m1,dur,title,sentimentLabel,context)=>{const s=new Date(monday);s.setDate(monday.getDate()+day);s.setHours(h1,m1,0,0);const e=new Date(s.getTime()+dur*60000);return{id:`demo-${day}-${h1}-${title}`,title,start:{dateTime:s.toISOString()},end:{dateTime:e.toISOString()},durationMinutes:dur,strain:sentimentLabel==='Strained'?8:sentimentLabel==='Positive'?3:5,sentiment:sentimentLabel,emailCount:context?1:0,emailContext:context?[{subject:`Re: ${title}`,from:'client@example.test',date:s.toISOString(),snippet:context,sentiment:sentimentLabel}]:[],reason:context?`${sentimentLabel.toLowerCase()} tone in a seeded related message`:'No related seeded email context'} };
  const events=[event(0,9,0,50,'Initech weekly sync','Strained','The migration delay is a serious concern. Please confirm a recovery plan before the escalation.'),event(0,10,0,45,'Globex renewal preparation','Positive','Thanks for the draft. The renewal plan looks good and the client is pleased.'),event(1,9,0,60,'Client escalation review','Strained','We are frustrated by the missed date and need a clear owner for the issue.'),event(1,10,0,50,'Umbrella QBR','Positive','Great discussion and excellent progress. Appreciate the team’s quick response.'),event(2,11,0,45,'Project delivery standup','Neutral','Reviewing this week’s delivery status and open actions.')];
  const proposals=makeRecoverySlots(events,{timeZone:'Europe/Prague',rangeStart:base,days:5});
  return {source:'Seeded mockup data',timeZone:'Europe/Prague',calendarName:'Demo calendar',range:{days:5},meetingCount:events.length,emailCount:4,strainedMeetings:2,events,proposals,steps:[{title:'Read the demo calendar',detail:`${events.length} seeded meetings found over the next five days.`},{title:'Review seeded Gmail context',detail:'4 sample message snippets from meeting participants.'},{title:'Estimate meeting strain',detail:'Scored duration, density, attendee count, and seeded email tone.'},{title:'Find recovery gaps',detail:`Found ${proposals.length} recovery gaps in the seeded calendar.`}]};
}
