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

export const MIN_BREAK_RECOVERY_GAP_MINUTES=30;

export function hasBreakSpacingConflict(existing,{start,end,minGapMinutes=MIN_BREAK_RECOVERY_GAP_MINUTES}={}){
  const candidateStart=new Date(start).getTime(),candidateEnd=new Date(end).getTime(),gap=Math.max(0,Number(minGapMinutes)||0)*60000;
  if(!Number.isFinite(candidateStart)||!Number.isFinite(candidateEnd)||candidateEnd<=candidateStart)return true;
  return existing.some(item=>{
    const otherStart=new Date(item.start?.dateTime||item.start).getTime(),otherEnd=new Date(item.end?.dateTime||item.end).getTime();
    if(!Number.isFinite(otherStart)||!Number.isFinite(otherEnd)||otherEnd<=otherStart)return false;
    return candidateStart<otherEnd+gap&&candidateEnd+gap>otherStart;
  });
}

export function normalizeBreakPreferences(raw={}) {
  const durationMode='oracle',durationMinutes=15,windowStart='09:00',windowEnd='17:00',activity='surprise';
  const mode=['gentle','balanced','roomy'].includes(raw.mode)?raw.mode:'balanced';
  const start=clockMinutes(windowStart),end=clockMinutes(windowEnd);
  const weekdays=[1,2,3,4,5];
  if(!Object.hasOwn(BREAK_STYLES,activity))throw new Error('Choose a break style from the list.');
  if(start===null||end===null||end-start<60)throw new Error('Choose a valid working window that is at least one hour long.');
  if(!weekdays.length)throw new Error('Choose at least one weekday.');
  const cadence=raw.cadence==='weekly'?'weekly':'daily';
  return {durationMinutes,durationMode,allowedDurations:[5,7,8,9,10,15],mode,cadence,activity,windowStart,windowEnd,weekdays,bufferMinutes:5,maxPerDay:20};
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
      const usableMinutes=(segment.end-segment.start)/60000-preferences.bufferMinutes*2;
      const durationMinutes=preferences.durationMode==='oracle'?[15,10,9,8,7,5].find(value=>value<=usableMinutes)||0:preferences.durationMinutes;
      if(!durationMinutes)continue;
      const earliest=new Date(segment.start.getTime()+preferences.bufferMinutes*60000),latest=new Date(segment.end.getTime()-preferences.bufferMinutes*60000-durationMinutes*60000);
      let start=new Date(Math.ceil(earliest.getTime()/(step*60000))*step*60000);
      if(start<earliest)start=new Date(start.getTime()+step*60000);
      if(preferences.maxPerDay===1){const midpoint=new Date((earliest.getTime()+latest.getTime())/2);start=new Date(Math.ceil(midpoint.getTime()/(30*60000))*30*60000)}
      while(start<=latest&&added<preferences.maxPerDay&&proposals.length<60){
        const end=new Date(start.getTime()+durationMinutes*60000),local=partsAt(start,timeZone),label=`${local.weekday} ${local.hour}:${local.minute} · ${durationMinutes} min`;
        const choices=Object.keys(BREAK_STYLES).filter(key=>key!=='surprise'),resolvedActivity=preferences.activity==='surprise'?choices[(new Date(`${day}T00:00:00Z`).getUTCDate()+weekday)%choices.length]:preferences.activity,style=BREAK_STYLES[resolvedActivity];
        proposals.push({key:`${day}-${start.toISOString()}`,day,weekday,label,start:start.toISOString(),end:end.toISOString(),timeZone,durationMinutes,activity:resolvedActivity,title:style.title,reason:`${style.reason} (${durationMinutes} minutes)`});
        added++;start=new Date(start.getTime()+step*60000);
      }
      if(added>=preferences.maxPerDay||proposals.length>=60)break;
    }
  }
  return proposals;
}

export function makePreMeetingSlots(events,{busyIntervals=[],timeZone='UTC',preferences:rawPreferences={},rangeStart=new Date()}={}) {
  const preferences=normalizeBreakPreferences({...rawPreferences,durationMinutes:15}),now=new Date(rangeStart),startWindow=clockMinutes(preferences.windowStart),endWindow=clockMinutes(preferences.windowEnd),busy=busyIntervals.map(e=>({start:new Date(e.start?.dateTime||e.start),end:new Date(e.end?.dateTime||e.end)})),slots=[];
  for(const event of events){
    const meetingStart=new Date(event.start?.dateTime||'');if(!Number.isFinite(meetingStart.getTime()))continue;
    const p=partsAt(meetingStart,timeZone),weekday=WEEKDAY_INDEX[p.weekday],day=`${p.year}-${p.month}-${p.day}`;
    if(!preferences.weekdays.includes(weekday))continue;
    const end=new Date(meetingStart.getTime()-preferences.bufferMinutes*60000),start=new Date(end.getTime()-15*60000),mins=Number(p.hour)*60+Number(p.minute);
    const windowOpen=localTime(day,Math.floor(startWindow/60),startWindow%60,timeZone),windowClose=localTime(day,Math.floor(endWindow/60),endWindow%60,timeZone);
    if(start<now||start<windowOpen||end>windowClose||busy.some(b=>b.start<end&&b.end>start))continue;
    const key=`pre-${event.id||start.toISOString()}`;
    slots.push({key,meetingKey:key,day,title:'A cheerful little prelude',reason:'A 15-minute cheerful pause before your meeting. Pick one kind thing: coffee, a stretch, fresh air, or a tiny victory dance.',activity:'surprise',label:`Before ${p.hour}:${p.minute}`,start:start.toISOString(),end:end.toISOString(),timeZone,durationMinutes:15,weekday,meetingTitle:String(event.summary||'Upcoming meeting').slice(0,160)});
  }
  return slots;
}

function addLocalDays(day,amount){const date=new Date(`${day}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10)}

export function calendarWeekRange(week='current',timeZone='UTC',referenceDate=new Date()){
  const p=partsAt(referenceDate,timeZone),day=`${p.year}-${p.month}-${p.day}`,weekday=WEEKDAY_INDEX[p.weekday],offset=-(weekday-1)+(week==='previous'?-7:0),startDay=addLocalDays(day,offset),endDay=addLocalDays(startDay,7);
  return {start:localTime(startDay,0,0,timeZone),end:localTime(endDay,0,0,timeZone)};
}

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

export async function analyzeCalendar({ days=5, lookback=30, timeZone:requestedZone='UTC', includeGmail=true, includeHistory=false, breakPreferences={},rangeStart=null,rangeEnd=null }={}) {
  const calendar=await googleApi('/calendar/v3/calendars/primary?fields=timeZone,summary');
  const timeZone=calendar.timeZone || requestedZone || 'UTC';
  const now=rangeStart?new Date(rangeStart):new Date(),end=rangeEnd?new Date(rangeEnd):new Date(now.getTime()+days*86400000);
  const params=new URLSearchParams({ timeMin:now.toISOString(), timeMax:end.toISOString(), singleEvents:'true', orderBy:'startTime', maxResults:'250', fields:'items(id,summary,description,start,end,attendees(email,displayName,responseStatus),organizer(email,displayName),location)' });
  const calendarData=await googleApi(`/calendar/v3/calendars/primary/events?${params}`);
  const calendarItems=calendarData.items||[],busyIntervals=toBusyIntervals(calendarItems,timeZone);
  const workingCalendarItems=calendarItems.filter(event=>{
    let weekday=null;
    if(event.start?.dateTime)weekday=WEEKDAY_INDEX[partsAt(new Date(event.start.dateTime),timeZone).weekday];
    else if(event.start?.date)weekday=new Date(`${event.start.date}T12:00:00Z`).getUTCDay()||7;
    return weekday>=1&&weekday<=5;
  });
  const events=workingCalendarItems.filter(e=>e.start?.dateTime&&e.end?.dateTime).map(e=>({...e,summary:e.summary||'(Untitled event)'}));
  let historyItems=[];
  if(includeHistory){
    const historyParams=new URLSearchParams({timeMin:new Date(now.getTime()-90*86400000).toISOString(),timeMax:now.toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'250',fields:'items(id,summary,start,end,attendees(email,displayName))'});
    const history=await googleApi(`/calendar/v3/calendars/primary/events?${historyParams}`);historyItems=history.items||[];
  }
  const tokenEmail=(await import('./google.mjs')).readGoogleToken;
  const stored=includeGmail?await tokenEmail():null;
  const ownDomain=String(stored?.email||'').split('@')[1]?.toLowerCase();
  const personalDomains=new Set(['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','icloud.com','me.com']);
  const companyDomains=new Map();
  for(const event of events){for(const attendee of event.attendees||[]){const domain=String(attendee.email||'').split('@')[1]?.toLowerCase();if(domain&&domain!==ownDomain&&!personalDomains.has(domain)){if(!companyDomains.has(domain))companyDomains.set(domain,`company-${companyDomains.size+1}`)}}}
  const external=new Set(includeGmail?events.flatMap(e=>(e.attendees||[]).map(a=>a.email).filter(email=>email&&email.toLowerCase()!==String(stored?.email||'').toLowerCase()&&companyDomains.has(String(email).split('@')[1]?.toLowerCase()))):[]);
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
  const meetingContext=includeHistory?events.map(event=>{
    const domains=[...new Set((event.attendees||[]).map(a=>String(a.email||'').split('@')[1]?.toLowerCase()).filter(domain=>domain&&companyDomains.has(domain)))];
    const companyKeys=domains.map(domain=>companyDomains.get(domain));
    const attendeeEmails=(event.attendees||[]).map(a=>String(a.email||'').toLowerCase()).filter(email=>domains.includes(email.split('@')[1]));
    const matchesClient=old=>(old.attendees||[]).some(a=>attendeeEmails.includes(String(a.email||'').toLowerCase())||domains.includes(String(a.email||'').split('@')[1]?.toLowerCase()));
    const eventStart=new Date(event.start.dateTime);
    const historical=historyItems.filter(old=>old.id!==event.id&&matchesClient(old)&&new Date(old.start?.dateTime||old.start?.date||0)<eventStart);
    const earlierThisWindow=events.filter(old=>old.id!==event.id&&matchesClient(old)&&new Date(old.start.dateTime)<eventStart);
    const prior=[...historical,...earlierThisWindow].sort((a,b)=>new Date(a.start?.dateTime||a.start?.date||0)-new Date(b.start?.dateTime||b.start?.date||0));
    const longClientMeetings=prior.filter(old=>old.start?.dateTime&&old.end?.dateTime&&(new Date(old.end.dateTime)-new Date(old.start.dateTime))/60000>=45).length;
    const emailMatches=[...new Map(attendeeEmails.flatMap(email=>contextByEmail.get(email)||[]).map(m=>[`${m.date}|${m.subject}|${m.snippet}`,m])).values()].slice(0,3);
    const scores=emailMatches.map(m=>m.sentiment.score),tone=scores.length&&scores.reduce((a,b)=>a+b,0)/scores.length<=-1?'Tense':scores.length&&scores.reduce((a,b)=>a+b,0)/scores.length>=1?'Upbeat':'Unknown';
    const priorMeetings=prior.map(m=>({title:String(m.summary||'Meeting').slice(0,160),date:m.start?.dateTime||m.start?.date||''}));
    const durationMinutes=Math.round((new Date(event.end.dateTime)-eventStart)/60000),meetingOrdinal=prior.length+1;
    const repeatedClientMeeting=meetingOrdinal>=3&&(durationMinutes>=45||longClientMeetings>=2);
    const localConcern=tone==='Tense'||repeatedClientMeeting||/escalat|incident|critical risk|overdue|complain|difficult|blocked|failure/i.test(`${event.summary} ${priorMeetings.map(m=>m.title).join(' ')}`);
    const local=partsAt(eventStart,timeZone);
    return {key:`meeting-${event.id}`,companyKeys:[...new Set(companyKeys)],title:event.summary,day:`${local.year}-${local.month}-${local.day}`,startsAt:event.start.dateTime,durationMinutes,tone,localConcern,repeatedClientMeeting,meetingOrdinal,priorMeetingCount:prior.length,longClientMeetings,emails:emailMatches.map(m=>({subject:m.subject,snippet:m.snippet})),priorMeetings};
  }):[];
  const preMeetingSlots=includeHistory?makePreMeetingSlots(events,{busyIntervals,timeZone,preferences:breakPreferences,rangeStart:now}):[];
  const strained=events.filter((e,i)=>enriched[i]?.sentiment==='Strained').length;
  const dailyLoadMap=new Map();
  for(const item of enriched){const local=partsAt(new Date(item.start.dateTime),timeZone),day=`${local.year}-${local.month}-${local.day}`,row=dailyLoadMap.get(day)||{day,meetings:0,meetingMinutes:0,highIntensityCount:0,clientPressureCount:0};row.meetings++;row.meetingMinutes+=item.durationMinutes;if(item.strain>=7)row.highIntensityCount++;dailyLoadMap.set(day,row)}
  for(const item of meetingContext){const row=dailyLoadMap.get(item.day);if(row&&item.localConcern)row.clientPressureCount++}
  const dailyLoad=[...dailyLoadMap.values()].sort((a,b)=>a.day.localeCompare(b.day));
  const calendarEvents=workingCalendarItems.map(event=>({id:event.id,title:String(event.summary||'(Untitled event)').slice(0,180),start:event.start,end:event.end,allDay:Boolean(event.start?.date)}));
  return { source:includeGmail?'Google Calendar + Gmail':'Google Calendar', timeZone, calendarName:calendar.summary||'Primary calendar', range:{start:now.toISOString(),end:end.toISOString(),days}, meetingCount:events.length, emailCount:[...contextByEmail.values()].reduce((n,ms)=>n+ms.length,0), strainedMeetings:strained, dailyLoad, events:enriched, calendarEvents, busyIntervals, proposals, meetingContext, preMeetingSlots, steps:[
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
