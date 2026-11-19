import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createFileModelBudget, createMemoryModelBudget } from '../agent/model-budget.mjs';
import { createRuntimeAgent } from '../agent/config.mjs';
import { createOpenAIProvider } from '../agent/openai-provider.mjs';

const key='fixture-key-budget-only';
const req={system:'합성 검사',messages:[{role:'user',content:[{text:'준비 상태'}]}],tools:[]};
const reply=()=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'합성 준비를 확인했습니다.'}]}]});
async function directory(t) { const root=await mkdtemp(resolve(tmpdir(),'hondi-budget-'));t.after(()=>rm(root,{recursive:true,force:true}));return root; }

test('파일 카운터는 동시 호출·새 인스턴스·새 키에도 같은 UTC 한도를 유지한다',async t=>{
  const root=await directory(t);let time=Date.parse('2026-11-17T23:59:00Z');
  const make=()=>createFileModelBudget({directory:root,now:()=>time});
  const outcomes=await Promise.allSettled(Array.from({length:20},()=>make().consumeModelCall(5)));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,5);
  assert.ok(outcomes.filter(x=>x.status==='rejected').every(x=>x.reason.code==='MODEL_DAILY_LIMIT'));
  await assert.rejects(make().consumeModelCall(5),{code:'MODEL_DAILY_LIMIT'});
  const names=await readdir(resolve(root,'2026-11-17'));assert.equal(names.length,5);
  for(const name of names)assert.equal(await readFile(resolve(root,'2026-11-17',name),'utf8'),'');
  time+=61000;await make().consumeModelCall(5);
  assert.equal((await readdir(resolve(root,'2026-11-18'))).length,1);
});

test('한도 저장 실패·중단은 외부 전송 전에 멈추고 원문 오류를 노출하지 않는다',async t=>{
  const root=await directory(t),file=resolve(root,'not-a-directory');await writeFile(file,'');
  const budget=createFileModelBudget({directory:file});let calls=0;
  const provider=createOpenAIProvider({apiKey:key,beforeRequest:options=>budget.consumeModelCall(3,options),fetchImpl:async()=>{calls++;return reply();}});
  await assert.rejects(provider.respond(req),error=>error.code==='MODEL_BUDGET_UNAVAILABLE'&&!error.message.includes(file));
  assert.equal(calls,0);
  await assert.rejects(createFileModelBudget({directory:root}).consumeModelCall(3,{signal:AbortSignal.abort()}),{code:'AGENT_TIMEOUT'});
  assert.equal((await readdir(root)).length,1);
});

test('실패한 API 시도도 한도를 쓰며 재전송·자동 재시도 없이 차단한다',async()=>{
  const budget=createMemoryModelBudget();let calls=0;
  const provider=createOpenAIProvider({apiKey:key,beforeRequest:options=>budget.consumeModelCall(1,options),fetchImpl:async()=>{calls++;throw new Error('PRIVATE_RAW_PROVIDER_ERROR');}});
  await assert.rejects(provider.respond(req),{code:'MODEL_UNAVAILABLE'});
  await assert.rejects(provider.respond(req),{code:'MODEL_DAILY_LIMIT'});
  assert.equal(calls,1);
});

test('계정 잔액 오류는 고정 문구로 응답하고 같은 provider의 추가 호출을 중단한다',async()=>{
  let calls=0;const provider=createOpenAIProvider({apiKey:key,fetchImpl:async()=>{calls++;return Response.json({error:{code:'insufficient_quota',message:'PRIVATE '+key}},{status:429});}});
  await assert.rejects(provider.respond(req),error=>error.code==='MODEL_QUOTA_EXHAUSTED'&&!error.message.includes(key)&&!error.message.includes('PRIVATE'));
  await assert.rejects(provider.respond(req),{code:'MODEL_NOT_CONNECTED'});
  assert.equal(calls,1);assert.equal(provider.connected,false);
});

test('실제 서비스는 medium과 호출 한도를 적용하며 capabilities·응답에서 모델 설정을 숨긴다',async()=>{
  const usageStore=createMemoryModelBudget();let calls=0;
  const service=createRuntimeAgent({env:{OPENAI_API_KEY:key,OPENAI_DAILY_CALL_LIMIT:'1'},usageStore,fetchImpl:async(_url,options)=>{
    calls++;const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6.1-sol');assert.equal(body.reasoning.effort,'medium');assert.equal(body.max_output_tokens,4096);return reply();
  }});
  for(const path of ['/api/agent/capabilities','/api/agent']) {
    const response=await service.handleAgentRequest({method:path.endsWith('capabilities')?'GET':'POST',path,body:{message:'합성 준비 상태를 알려주세요',requestId:'budget-fixture-first'}});
    assert.equal(response.statusCode,200);assert.doesNotMatch(response.body,/gpt-|medium|reasoningEffort|OPENAI_/);
  }
  const rejected=await service.handleAgentRequest({method:'POST',path:'/api/agent',body:{message:'다른 합성 준비',requestId:'budget-fixture-second'}});
  assert.equal(rejected.statusCode,429);assert.equal(JSON.parse(rejected.body).error.code,'MODEL_DAILY_LIMIT');assert.equal(calls,1);
});

test('요청당 6회 설정은 마지막 호출을 요약 전용으로 바꾸고 7번째 전송을 하지 않는다',async()=>{
  let calls=0;const service=createRuntimeAgent({env:{OPENAI_API_KEY:key,OPENAI_MAX_CALLS_PER_TURN:'6'},usageStore:createMemoryModelBudget(),fetchImpl:async(_url,options)=>{
    calls++;const body=JSON.parse(options.body);
    if(calls===6){assert.equal(body.tool_choice,'none');return reply();}
    return Response.json({status:'completed',output:[{type:'function_call',id:'fc_'+calls,call_id:'c_'+calls,name:'get_case',arguments:'{}'}]});
  }});
  const response=await service.handleAgentRequest({method:'POST',path:'/api/agent',body:{message:'합성 준비 확인',requestId:'budget-fixture-six-rounds'}});
  assert.equal(response.statusCode,200);assert.equal(calls,6);
});
