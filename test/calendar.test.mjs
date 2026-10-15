import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCalendarConflict, makeRecoverySlots, normalizeBreakPreferences, toBusyIntervals } from '../lib/calendar.mjs';
import { adviseCalendarBreaks } from '../lib/oracle.mjs';

const at=(value)=>new Date(value).toISOString();

test('break preferences validate duration, windows, and weekdays',()=>{
  assert.deepEqual(normalizeBreakPreferences({durationMinutes:15,windowStart:'10:00',windowEnd:'16:00',weekdays:[1,3,3,6]}),{
    durationMinutes:15,windowStart:'10:00',windowEnd:'16:00',weekdays:[1,3],bufferMinutes:5,maxPerDay:2
  });
  assert.throws(()=>normalizeBreakPreferences({durationMinutes:25}),/break length/);
  assert.throws(()=>normalizeBreakPreferences({windowStart:'16:00',windowEnd:'16:30'}),/working window/);
  assert.throws(()=>normalizeBreakPreferences({weekdays:[6,7]}),/weekday/);
});

test('slot generation honors busy events, preferences, and the local workday',()=>{
  const proposals=makeRecoverySlots([{start:{dateTime:'2026-10-19T08:00:00Z'},end:{dateTime:'2026-10-19T09:00:00Z'}}],{
    timeZone:'Europe/Prague',rangeStart:'2026-10-19T06:00:00Z',days:1,
    preferences:{durationMinutes:20,windowStart:'09:00',windowEnd:'12:00',weekdays:[1],bufferMinutes:0,maxPerDay:3}
  });
  assert.equal(proposals.length,2);
  assert.ok(proposals.every(slot=>slot.start>='2026-10-19T07:00:00.000Z'&&slot.end<='2026-10-19T10:00:00.000Z'));
  assert.ok(proposals.every(slot=>!(slot.start<'2026-10-19T09:00:00.000Z'&&slot.end>'2026-10-19T08:00:00.000Z')));
});

test('all-day Google events become timezone-aware busy intervals',()=>{
  const intervals=toBusyIntervals([{start:{date:'2026-10-19'},end:{date:'2026-10-20'}}],'Europe/Prague');
  assert.deepEqual(intervals,[{start:{dateTime:at('2026-10-18T22:00:00Z')},end:{dateTime:at('2026-10-19T22:00:00Z')}}]);
});

test('weekly conflict check follows local wall time over a DST boundary and catches all-day events',()=>{
  const start='2026-03-22T09:30:00+01:00';
  const weekly=[{start:{dateTime:'2026-03-29T07:30:00Z'},end:{dateTime:'2026-03-29T08:00:00Z'}}];
  assert.equal(hasCalendarConflict(weekly,{start,end:'2026-03-22T09:50:00+01:00',timeZone:'Europe/Prague',occurrences:3}),true);
  const allDay=[{start:{date:'2026-03-29'},end:{date:'2026-03-30'}}];
  assert.equal(hasCalendarConflict(allDay,{start,end:'2026-03-22T09:50:00+01:00',timeZone:'Europe/Prague',occurrences:3}),true);
  assert.equal(hasCalendarConflict([],{start,end:'2026-03-22T09:50:00+01:00',timeZone:'Europe/Prague',occurrences:3}),false);
});

test('Oracle calendar advice validates slot keys and sends no event details',async()=>{
  const old={base:process.env.LLM_BASE_URL,model:process.env.LLM_MODEL,key:process.env.LLM_API_KEY,fetch:globalThis.fetch};
  let prompt='';
  process.env.LLM_BASE_URL='https://gateway.example.test';process.env.LLM_MODEL='test-model';process.env.LLM_API_KEY='';
  globalThis.fetch=async(_url,options)=>{
    prompt=JSON.parse(options.body).messages[0].content;
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({answer:'Take the earlier option.',recommendedSlotKeys:['safe-key','invented-key']})}}]})};
  };
  try{
    const result=await adviseCalendarBreaks({messages:[{role:'user',content:'A quiet pause after calls'}],preferences:{durationMinutes:20},slots:[{key:'safe-key',label:'Mon 10:00',start:'2026-10-19T08:00:00Z',end:'2026-10-19T08:20:00Z',durationMinutes:20,weekday:1,title:'Sensitive client name'}]});
    assert.equal(result.mode,'llm');
    assert.deepEqual(result.recommendedSlotKeys,['safe-key']);
    assert.doesNotMatch(prompt,/Sensitive client name/);
  }finally{
    globalThis.fetch=old.fetch;
    for(const [key,value] of [['LLM_BASE_URL',old.base],['LLM_MODEL',old.model],['LLM_API_KEY',old.key]])if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});
