import test from 'node:test';
import assert from 'node:assert/strict';
import { rankOracleContext, resolveMentionedPeople, tokenize } from '../lib/oracle.mjs';

const solutions=[
  {id:1,title:'Calendar Breather',kind:'agent',summary:'Find recovery breaks between meetings',owner:'Priya'},
  {id:2,title:'Contract Review',kind:'skill',summary:'Find clauses in supplier contracts',owner:'Anastasia'}
];
const people=[
  {id:1,name:'Priya',title:'Automation Lead',team:'Finance',skills:'calendar, automation'},
  {id:2,name:'Anastasia',title:'Transformation Lead',team:'Operations',skills:'contracts, facilitation'}
];

test('tokenizer keeps Cyrillic and adds cross-language concepts',()=>{
  assert.deepEqual(tokenize('Нужно разобрать календарь и встречи'),['разобрать','календарь','calendar','встречи','meeting']);
});

test('Russian calendar request ranks Calendar Breather first',()=>{
  const ranked=rankOracleContext('Мой календарь забит встречами',solutions,people);
  assert.equal(ranked.solutions[0].id,1);
  assert.equal(ranked.people[0].id,1);
});

test('people mentioned by role are resolved only from retrieved candidates',()=>{
  const people=[{id:7,title:'Senior Data Engineer'},{id:9,title:'Data Governance Lead'},{id:11,title:'Salesforce Architect'}];
  assert.deepEqual(resolveMentionedPeople('Ask the Senior Data Engineer, with the Data Governance Lead as a secondary option.',people),[7,9]);
  assert.deepEqual(resolveMentionedPeople('Ask an aerospace cryptographer.',people),[]);
  assert.deepEqual(resolveMentionedPeople('The Data Governance Lead can help.',people,[7]),[7,9]);
});
