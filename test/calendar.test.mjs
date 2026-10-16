import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCalendarConflict, makeRecoverySlots, normalizeBreakPreferences, toBusyIntervals } from '../lib/calendar.mjs';
import { adviseCalendarBreaks } from '../lib/oracle.mjs';

const at=(value)=>new Date(value).toISOString();

test('break preferences use Oracle-managed durations and the weekday work window',()=>{
  assert.deepEqual(normalizeBreakPreferences({mode:'roomy',cadence:'weekly',durationMinutes:20,activity:'coffee',windowStart:'10:00',windowEnd:'16:00',weekdays:[1,3,6]}),{
    durationMinutes:15,durationMode:'oracle',allowedDurations:[5,7,8,9,10,15],mode:'roomy',cadence:'weekly',activity:'surprise',windowStart:'09:00',windowEnd:'17:00',weekdays:[1,2,3,4,5],bufferMinutes:5,maxPerDay:20
  });
  assert.equal(normalizeBreakPreferences({mode:'unknown',cadence:'often'}).mode,'balanced');
  assert.equal(normalizeBreakPreferences({mode:'unknown',cadence:'often'}).cadence,'daily');
});

test('slot generation honors busy events and the Oracle-managed local workday',()=>{
  const proposals=makeRecoverySlots([{start:{dateTime:'2026-10-19T08:00:00Z'},end:{dateTime:'2026-10-19T09:00:00Z'}}],{
    timeZone:'Europe/Prague',rangeStart:'2026-10-19T06:00:00Z',days:1,
    preferences:{durationMinutes:15,windowStart:'09:00',windowEnd:'12:00',weekdays:[1],bufferMinutes:0,maxPerDay:3}
  });
  assert.ok(proposals.length>0);
  assert.ok(proposals.every(slot=>slot.start>='2026-10-19T07:00:00.000Z'&&slot.end<='2026-10-19T15:00:00.000Z'));
  assert.ok(proposals.every(slot=>!(slot.start<'2026-10-19T09:00:00.000Z'&&slot.end>'2026-10-19T08:00:00.000Z')));
});

test('surprise style resolves to a concrete warm activity and an Oracle-supported duration',()=>{
  const [slot]=makeRecoverySlots([],{timeZone:'UTC',rangeStart:'2026-10-19T06:00:00Z',days:1,preferences:{durationMinutes:5,activity:'surprise',windowStart:'09:00',windowEnd:'12:00',weekdays:[1],maxPerDay:1}});
  assert.ok(slot);
  assert.notEqual(slot.activity,'surprise');
  assert.match(slot.title,/reset|breathing|Fresh-air|Coffee|keyboard/i);
  assert.ok([5,7,8,9,10,15].includes(slot.durationMinutes));
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
