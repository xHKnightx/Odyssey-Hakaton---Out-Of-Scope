import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudio, transcriptionConfigured, transcriptionModel } from '../lib/transcription.mjs';

test('transcription uses the configured SecondStack audio model without exposing the key', async () => {
  const previous={base:process.env.LLM_BASE_URL,key:process.env.LLM_API_KEY,model:process.env.TRANSCRIPTION_MODEL};
  process.env.LLM_BASE_URL='https://secondstack.example/v1';
  process.env.LLM_API_KEY='local-secret';
  process.env.TRANSCRIPTION_MODEL='gpt-transcribe';
  let request;
  const result=await transcribeAudio(Buffer.from('audio'),'audio/webm',async(url,options)=>{
    request={url,options};
    return new Response(JSON.stringify({text:'  hello from voice  '}),{status:200,headers:{'content-type':'application/json'}});
  });
  assert.equal(transcriptionConfigured(),true);
  assert.equal(transcriptionModel(),'gpt-transcribe');
  assert.equal(result.text,'hello from voice');
  assert.equal(request.url,'https://secondstack.example/v1/audio/transcriptions');
  assert.equal(request.options.headers.authorization,'Bearer local-secret');
  assert.equal(request.options.body.get('model'),'gpt-transcribe');
  assert.equal(request.options.body.get('file').type,'audio/webm');
  for(const [name,value] of Object.entries(previous)){
    const key=name==='base'?'LLM_BASE_URL':name==='key'?'LLM_API_KEY':'TRANSCRIPTION_MODEL';
    if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});

test('transcription rejects empty recordings', async () => {
  const previous=process.env.LLM_BASE_URL;
  process.env.LLM_BASE_URL='https://secondstack.example/v1';
  await assert.rejects(()=>transcribeAudio(Buffer.alloc(0),'audio/webm'),/No microphone audio/);
  if(previous===undefined)delete process.env.LLM_BASE_URL;else process.env.LLM_BASE_URL=previous;
});
