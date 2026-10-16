import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { cosineSimilarity, createRetrieval, personSearchDocument, selectRelevantPeople, selectRelevantSolutions, solutionSearchDocument } from '../lib/retrieval.mjs';

test('person embedding document excludes identifying fields',()=>{
  const document=personSearchDocument({name:'Priya Nair',title:'Solutions Architect',team:'Platform',skills:'Calendar design, Integrations',experience:'Automated calendar workflows',location:'Sofia',availability:'Thursday'});
  assert.match(document,/Solutions Architect/);
  assert.match(document,/Calendar design/);
  assert.doesNotMatch(document,/Priya|Nair|Sofia|Thursday/);
});

test('solution embedding document contains discovery metadata',()=>{
  const document=solutionSearchDocument({title:'Calendar Breather',kind:'agent',summary:'Find recovery breaks',runnable:1});
  assert.match(document,/Calendar Breather/);
  assert.match(document,/Runnable: yes/);
});

test('cosine similarity ranks identical vectors highest',()=>{
  assert.equal(cosineSimilarity([1,0],[1,0]),1);
  assert.equal(cosineSimilarity([1,0],[0,1]),0);
});

test('relevance gate returns a dynamic number of strong semantic matches',()=>{
  const records=[
    {id:1,retrieval:{score:.62,semantic:.54,lexical:1}},
    {id:2,retrieval:{score:.48,semantic:.46,lexical:.5}},
    {id:3,retrieval:{score:.34,semantic:.37,lexical:.33}},
    {id:4,retrieval:{score:.21,semantic:.29,lexical:0}}
  ];
  assert.deepEqual(selectRelevantPeople(records).map(record=>record.id),[1,2]);
});

test('solution relevance gate returns only strong candidates instead of filling the limit',()=>{
  const records=[
    {id:1,retrieval:{score:.58,semantic:.52,lexical:1}},
    {id:2,retrieval:{score:.43,semantic:.44,lexical:.5}},
    {id:3,retrieval:{score:.24,semantic:.31,lexical:0}},
    {id:4,retrieval:{score:.18,semantic:.22,lexical:0}},
    {id:5,retrieval:{score:.12,semantic:.18,lexical:0}}
  ];
  assert.deepEqual(selectRelevantSolutions(records).map(record=>record.id),[1,2]);
});

test('relevance gate returns nobody when the best semantic match is weak',()=>{
  const records=[
    {id:1,retrieval:{score:.2,semantic:.28,lexical:0}},
    {id:2,retrieval:{score:.18,semantic:.25,lexical:0}}
  ];
  assert.deepEqual(selectRelevantPeople(records),[]);
});

test('exact-only relevance gate preserves lexical matches up to the limit',()=>{
  const records=[1,.5,.33,.25].map((lexical,index)=>({id:index+1,retrieval:{score:lexical,semantic:0,lexical}}));
  assert.deepEqual(selectRelevantPeople(records,{limit:3,semanticEnabled:false}).map(record=>record.id),[1,2,3]);
});

test('FTS5 exact search finds systems and skills without embeddings',async()=>{
  const previous={base:process.env.LLM_BASE_URL,key:process.env.LLM_API_KEY,model:process.env.EMBEDDING_MODEL};
  delete process.env.LLM_BASE_URL;delete process.env.LLM_API_KEY;delete process.env.EMBEDDING_MODEL;
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,title TEXT,team TEXT,skills TEXT,experience TEXT,availability TEXT,location TEXT,initials TEXT,color TEXT);
    CREATE TABLE solutions(id INTEGER PRIMARY KEY,title TEXT,kind TEXT,summary TEXT,runnable INTEGER,minutes_saved INTEGER,owner_id INTEGER);`);
  db.prepare('INSERT INTO users VALUES(1,?,?,?,?,?,?,?,?,?)').run('Test Person','Salesforce Architect','CRM','Sales Cloud, Apex','Built Salesforce integrations','','','TP','#fff');
  db.prepare('INSERT INTO solutions VALUES(1,?,?,?,?,?,?)').run('CRM Helper','agent','Moves call notes into Salesforce',1,20,1);
  const retrieval=createRetrieval(db);await retrieval.indexPerson(1);await retrieval.indexSolution(1);
  const result=await retrieval.search('Salesforce',{peopleLimit:5,solutionLimit:5});
  assert.equal(result.mode,'exact');assert.equal(result.people[0].id,1);assert.equal(result.solutions[0].id,1);
  db.close();
  if(previous.base)process.env.LLM_BASE_URL=previous.base;if(previous.key)process.env.LLM_API_KEY=previous.key;if(previous.model)process.env.EMBEDDING_MODEL=previous.model;
});
