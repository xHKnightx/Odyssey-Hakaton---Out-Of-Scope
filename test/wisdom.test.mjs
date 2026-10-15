import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProfile, analyzeWisdom, validateProfileAnalysis, validateWisdomAnalysis } from '../lib/wisdom.mjs';

test('wisdom analysis keeps bounded skills, experience, and reusable solutions',()=>{
  const result=validateWisdomAnalysis({
    headline:'Useful work',summary:'Review it',skills:['Salesforce','Salesforce','Data quality'],
    experience:[{title:'Led a migration',details:'40,000 accounts'}],
    solutions:[{title:'Duplicate Account Cleaner',kind:'agent',summary:'Finds likely duplicate accounts.',runnable:true,minutesSaved:45}]
  });
  assert.deepEqual(result.skills,['Salesforce','Data quality']);
  assert.equal(result.experience[0].title,'Led a migration');
  assert.equal(result.solutions[0].kind,'agent');
  assert.equal(result.solutions[0].minutesSaved,45);
});

test('local wisdom fallback distinguishes experience from a built solution',async()=>{
  const previous={base:process.env.LLM_BASE_URL,model:process.env.LLM_MODEL};
  delete process.env.LLM_BASE_URL;delete process.env.LLM_MODEL;
  const experience=await analyzeWisdom({text:'I mentored junior engineers for three years.',user:{},catalogue:[]});
  const solution=await analyzeWisdom({text:'I built a Salesforce agent that cleans duplicate accounts.',user:{},catalogue:[]});
  assert.equal(experience.mode,'local');
  assert.equal(experience.solutions.length,0);
  assert.equal(solution.solutions.length,1);
  assert.ok(solution.skills.includes('Salesforce'));
  if(previous.base)process.env.LLM_BASE_URL=previous.base;if(previous.model)process.env.LLM_MODEL=previous.model;
});

test('profile analysis returns editable profile fields without catalogue solutions',async()=>{
  const previous={base:process.env.LLM_BASE_URL,model:process.env.LLM_MODEL};
  delete process.env.LLM_BASE_URL;delete process.env.LLM_MODEL;
  const validated=validateProfileAnalysis({title:'CRM Architect',team:'CRM',skills:['Salesforce','Salesforce'],experience:'Led CRM migrations.'});
  assert.deepEqual(validated.skills,['Salesforce']);
  const result=await analyzeProfile('I lead Salesforce CRM migrations and improve data quality.');
  assert.equal(result.mode,'local');
  assert.equal(result.team,'CRM');
  assert.ok(result.skills.includes('Salesforce'));
  assert.equal('solutions' in result,false);
  if(previous.base)process.env.LLM_BASE_URL=previous.base;if(previous.model)process.env.LLM_MODEL=previous.model;
});
