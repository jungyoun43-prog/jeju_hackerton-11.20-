import test from 'node:test';
import assert from 'node:assert/strict';
import { openAISettings, createRuntimeAgent as runtimeAgent, OPENAI_MODELS } from '../agent/config.mjs';
import { createMemoryModelBudget } from '../agent/model-budget.mjs';
import { createMemorySessionStore } from '../agent/store.mjs';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const apiKey='fixture-only-openai-key-not-a-real-credential';
const createRuntimeAgent = options => runtimeAgent({usageStore:createMemoryModelBudget(),...options});
const requestId='config-request-fixture-001';
const message='합성 사례의 현재 준비 상태를 확인해 주세요.';
const post=(service,body={message,requestId})=>service.handleAgentRequest({method:'POST',path:'/api/agent',headers:{'content-type':'application/json'},body});
const textResponse=text=>({id:'resp_fixture_text',status:'completed',output:[{id:'msg_fixture_text',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}]});

test('빈 키·템플릿 placeholder는 모델을 구성하지 않고 preview만 실행한다',async()=>{
  for(const key of ['',undefined,'your_api_key_here','여기에_입력','<API_KEY>','sk-...']) {
    const service=createRuntimeAgent({env:{OPENAI_API_KEY:key},fetchImpl:()=>{throw new Error('유료 호출 금지');}});
    assert.equal(service.getCapabilities().llm,false);
    assert.equal((await post(service)).statusCode,503);
    const preview=await service.handleAgentRequest({method:'POST',path:'/api/agent/preview',body:{scenarioId:'aewol-parent-visit',requestId}});
    assert.equal(preview.statusCode,200);
    assert.equal(JSON.parse(preview.body).isPreview,true);
  }
});

test('키 한 항목으로 Sol을 기본 구성하고 Terra는 명시적으로 선택한다',async()=>{
  assert.equal(openAISettings({OPENAI_API_KEY:apiKey}).model,'gpt-6.1-sol');
  for(const model of OPENAI_MODELS) {
    let sent;
    const service=createRuntimeAgent({env:{OPENAI_API_KEY:apiKey,OPENAI_MODEL:model},fetchImpl:async(url,options)=>{
      assert.equal(String(url),'https://api.openai.com/v1/responses');
      sent=JSON.parse(options.body);
      assert.equal(new Headers(options.headers).get('authorization'),'Bearer '+apiKey);
      return Response.json(textResponse('합성 준비 상태를 안내합니다.'));
    }});
    assert.equal(service.getCapabilities().llm,true);
    const result=await post(service);
    assert.equal(result.statusCode,200);
    assert.equal(sent.model,model);
    assert.equal(sent.store,false);
    assert.equal(result.body.includes(apiKey),false);
  }
});

test('설정 오류는 키를 에러에 넣지 않고 다른 모델로 자동 대체하지 않는다',()=>{
  for(const extra of [{OPENAI_MODEL:'gpt-6.1-sol-terra'},{OPENAI_REASONING_EFFORT:'ultra'},{OPENAI_MAX_OUTPUT_TOKENS:'0'},{OPENAI_TIMEOUT_MS:'90000'}]) {
    assert.throws(()=>openAISettings({OPENAI_API_KEY:apiKey,...extra}),error=>error instanceof TypeError && !error.message.includes(apiKey));
  }
  assert.throws(()=>openAISettings({OPENAI_API_KEY:'fixture\ncredential'}),/OPENAI_API_KEY/);
});

test('실제 서비스 loop가 Responses tool call과 reasoning을 이어주고 새 턴은 분리한다',async()=>{
  const requests=[];
  const reasoning='fixture-encrypted-reasoning-not-to-persist';
  const store=createMemorySessionStore();
  const service=createRuntimeAgent({env:{OPENAI_API_KEY:apiKey},store,fetchImpl:async(url,options)=>{
    const payload=JSON.parse(options.body);requests.push(payload);
    if(requests.length===1)return Response.json({id:'resp_tool_fixture',status:'completed',output:[
      {id:'rs_fixture',type:'reasoning',summary:[],encrypted_content:reasoning},
      {id:'fc_fixture',type:'function_call',status:'completed',call_id:'call_fixture_case',name:'get_case',arguments:'{}'},
    ]});
    return Response.json(textResponse('합성 사례와 준비 상태를 확인했습니다.'));
  }});
  const progressToken='p'.repeat(43),first=await post(service,{message,requestId,progressToken}),body=JSON.parse(first.body);
  assert.equal(first.statusCode,200);
  assert.equal(body.events[0].tool,'get_case');
  assert.ok(JSON.stringify(requests[1].input).includes(reasoning));
  assert.ok(requests[1].input.some(item=>item.type==='function_call_output' && item.call_id==='call_fixture_case'));
  assert.equal(first.body.includes(reasoning),false);
  assert.equal(JSON.stringify(store.inspect()).includes(reasoning),false);
  assert.equal(JSON.stringify(store.inspectProgress()).includes(reasoning),false);
  assert.equal(JSON.stringify(store.inspectProgress()).includes(progressToken),false);
  assert.equal(JSON.stringify(requests).includes(progressToken),false);
  assert.equal(first.body.includes(progressToken),false);
  const second=await post(service,{message,requestId:'config-request-fixture-002',sessionId:body.sessionId});
  assert.equal(second.statusCode,200);
  assert.equal(JSON.stringify(requests[2].input).includes(reasoning),false);
});

test('8개 정상 순차 준비 계획도 8번째 호출을 도구 없는 요약으로 예약해 완료한 상태를 보존한다',async()=>{
  const plan = [
    ['get_case',{}],['update_visit',{appointmentTime:'10:00'}],
    ['search_hospital_contacts',{name:'제주우리병원'}],['select_hospital_contact',{hospitalId:'hospital-4'}],
    ['request_records',{source:'demo'}],['prepare_inquiries',{kind:'taxi'}],
    ['prepare_inquiries',{kind:'companion'}],['request_support_contact',{kind:'taxi'}],
  ];
  const requests = [],store = createMemorySessionStore(),reasoning = 'fixture-private-bounded-reasoning';
  const service = createRuntimeAgent({env:{OPENAI_API_KEY:apiKey,OPENAI_MAX_CALLS_PER_TURN:'8'},store,fetchImpl:async(_url,options) => {
    const body = JSON.parse(options.body); requests.push(body);
    assert.equal(body.store,false);
    if (body.tool_choice === 'none') {
      assert.equal(requests.length,8);
      assert.equal(body.input.filter(item => item.type === 'function_call_output').length,7);
      const last = JSON.parse(body.input.at(-1).output).content[0].json;
      assert.equal(last.runtime.summaryOnly,true);
      assert.equal(last.runtime.modelCallsRemaining,1);
      assert.ok(JSON.stringify(body.input).includes(reasoning));
      return Response.json(textResponse('합성 자료와 택시·동행 문의 초안을 준비했습니다. 전화 문의 시연과 실제 예약·배차는 진행하지 않았습니다.'));
    }
    const [name,input] = plan[requests.length - 1];
    return Response.json({status:'completed',output:[
      {id:`rs_${requests.length}`,type:'reasoning',summary:[],encrypted_content:reasoning},
      {id:`fc_${requests.length}`,type:'function_call',call_id:`bounded_${requests.length}`,name,arguments:JSON.stringify(input),status:'completed'},
    ]});
  }});
  const result = await post(service,{message:'제주우리병원 진료 자료와 택시·동행 준비를 부탁해요.',requestId,progressToken:'q'.repeat(43)}),body = JSON.parse(result.body);
  assert.equal(result.statusCode,200);
  assert.equal(requests.length,8);
  assert.equal(body.caseState.selectedHospital.companyName,'제주우리병원');
  assert.equal(body.caseState.documents.find(item => item.id === 'report').status,'ready');
  assert.equal(body.caseState.visitSupport.taxi.status,'prepared');
  assert.equal(body.caseState.visitSupport.companion.status,'prepared');
  assert.equal(body.events.filter(item => item.status === 'completed').length,7);
  assert.equal(body.events.some(item => item.tool === 'request_support_contact'),false);
  assert.ok(body.pendingActions.some(item => item.kind === 'continue-preparation'));
  assert.match(body.reply,/실행 전인 작업/);
  assert.equal(body.needsInput,true);
  assert.equal(store.inspect()[0].turns,1);
  assert.deepEqual(store.inspect()[0].requestIds,[requestId]);
  assert.equal(JSON.stringify(store.inspect()).includes(reasoning),false);
  assert.equal(result.body.includes(reasoning),false);
  assert.equal(store.inspectProgress()[0].progress.status,'completed');
  assert.ok(store.inspectProgress()[0].progress.events.length<=32);
  assert.equal(JSON.stringify(store.inspectProgress()).includes(reasoning),false);
});

test('Node env-file 부팅에서 키 한 줄만으로 API가 구성되고 실제 네트워크 없이 응답한다',async t=>{
  const directory=await mkdtemp(resolve(tmpdir(),'jeju-env-entry-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const preload=resolve(directory,'fetch-fixture.mjs');
  await writeFile(preload,`globalThis.fetch=async(url,options)=>{
    if(url!=='https://api.openai.com/v1/responses')throw new Error('Unexpected endpoint');
    const request=JSON.parse(options.body);
    if(!['gpt-6.1-sol','gpt-6.1-terra'].includes(request.model)||request.store!==false)throw new Error('Invalid fixture request');
    return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'명시적 fetch fixture 응답'}]}]});
  };`);
  for(const model of OPENAI_MODELS) {
    const file=resolve(directory,model+'.env');
    await writeFile(file,`OPENAI_API_KEY=${apiKey}\n${model==='gpt-6.1-terra'?'OPENAI_MODEL='+model+'\n':''}`,{mode:0o600});
    const env={...process.env,HOST:'127.0.0.1',PORT:'0',OPENAI_USAGE_DIR:resolve(directory,'usage')};
    for(const key of ['OPENAI_API_KEY','OPENAI_MODEL','OPENAI_REASONING_EFFORT','OPENAI_MAX_OUTPUT_TOKENS','OPENAI_TIMEOUT_MS','DEMO_DAILY_TURN_LIMIT'])delete env[key];
    const child=spawn(process.execPath,[`--env-file=${file}`,`--import=${pathToFileURL(preload).href}`,'scripts/server.mjs'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe'],windowsHide:true});
    try {
      const base=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('env 부팅 시간 초과')),5000);
        child.stdout.on('data',chunk=>{const match=chunk.toString().match(/Local: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
        child.once('error',()=>{clearTimeout(timer);reject(new Error('env 부팅 실패'));});
        child.once('exit',()=>{clearTimeout(timer);reject(new Error('env 서버 종료'));});
      });
      const caps=await (await fetch(base+'/api/agent/capabilities')).json();
      assert.equal(caps.llm,true);assert.equal(Object.hasOwn(caps,'model'),false);assert.equal(Object.hasOwn(caps,'reasoningEffort'),false);
      const response=await fetch(base+'/api/agent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,requestId})});
      assert.equal(response.status,200);
      const body=await response.json();
      assert.equal(body.reply,'명시적 fetch fixture 응답');
      assert.equal(JSON.stringify(body).includes(apiKey),false);
    } finally {
      if(child.exitCode===null && child.signalCode===null){child.kill('SIGTERM');await once(child,'exit');}
    }
  }
});
