import test from 'node:test';
import assert from 'node:assert/strict';
import { rankOracleContext, tokenize } from '../lib/oracle.mjs';

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
