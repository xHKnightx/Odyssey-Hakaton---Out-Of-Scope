import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProfile, analyzeWisdom, hasShareableArtifact, validateProfileAnalysis, validateWisdomAnalysis } from '../lib/wisdom.mjs';

test('wisdom analysis keeps bounded profile skills, experience, and reusable assets',()=>{
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

test('a human capability never becomes a reusable asset without an explicit artifact',async()=>{
  const previous={base:process.env.LLM_BASE_URL,model:process.env.LLM_MODEL};
  delete process.env.LLM_BASE_URL;delete process.env.LLM_MODEL;
  const text='Я умею вайбкодить и быстро собирать прототипы.';
  const result=await analyzeWisdom({text,user:{},catalogue:[]});
  assert.ok(result.skills.includes('Vibe coding'));
  assert.equal(result.solutions.length,0);
  assert.equal(hasShareableArtifact(text),false);
  const guarded=validateWisdomAnalysis({profileSkills:['Vibe coding'],solutions:[{title:'Vibe coding skill',kind:'skill',summary:'Builds prototypes',evidence:'Я умею вайбкодить'}]},{sourceText:text});
  assert.equal(guarded.solutions.length,0);
  assert.equal(hasShareableArtifact('Я создала инструкцию для агента, которая собирает прототип.'),true);
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
