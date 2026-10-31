import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createAgentService } from '../agent/service.mjs';
import { createMemorySessionStore } from '../agent/store.mjs';
import { AGENT_TOOLS, createToolDispatcher } from '../agent/tools.mjs';
import { createProgressReporter, normalizeProgressSnapshot, progressKey, readProgress, PROGRESS_TOOLS, isProgressKey } from '../agent/progress.mjs';
import { validateMessageRequest, validateProgressRequest } from '../agent/validation.mjs';

const token=()=>randomBytes(32).toString('base64url');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const done=text=>({content:[{text}],stopReason:'end_turn'});
const use=(name,input={})=>({content:[{toolUse:{toolUseId:'progress-call',name,input}}],stopReason:'tool_use'});
const post=(service,body,path='/api/agent')=>service.handleAgentRequest({method:'POST',path,body,headers:{'content-type':'application/json'}});
const request=(extra={})=>({message:'합성 준비 상태를 확인해 주세요.',requestId:'progress-request-fixture-001',...extra});
const poll=async(service,progressToken)=>JSON.parse((await post(service,{progressToken},'/api/agent/progress')).body);
const fixtureProvider=outputs=>({connected:true,model:'progress-fixture',async respond(input){const output=outputs.shift();assert.ok(output);return typeof output==='function'?output(input):output;}});

test('선택 progressToken과 조회 DTO를 엄격히 검증하고 preview에는 허용하지 않는다',async()=>{
  const progressToken=token();
  assert.equal(validateMessageRequest(request({progressToken})).progressToken,progressToken);
  assert.deepEqual(validateProgressRequest({progressToken}),{progressToken});
  for(const value of [undefined,null,43,{},'',progressToken.slice(1),progressToken+'a','/'.repeat(43),'a'.repeat(42)+' ']) {
    assert.throws(()=>validateMessageRequest(request({progressToken:value})),error=>error.code==='INVALID_PROGRESS_TOKEN');
    assert.throws(()=>validateProgressRequest({progressToken:value}),error=>error.code==='INVALID_PROGRESS_TOKEN');
  }
  for(const body of [{},[],{progressToken,requestId:'other'},{progressToken,message:'PRIVATE'},{progressToken,sessionId:token()}])assert.throws(()=>validateProgressRequest(body));
  const service=createAgentService();
  assert.equal((await post(service,{scenarioId:'aewol-parent-visit',requestId:'progress-preview-fixture',progressToken},'/api/agent/preview')).statusCode,400);
  assert.equal((await service.handleAgentRequest({method:'GET',path:'/api/agent/progress'})).statusCode,405);
});

test('토큰·해시 키 뒤의 줄바꿈은 일반 요청·진행 조회·저장 키에서 거절한다',async()=>{
  const progressToken=token(),key=progressKey(progressToken);
  let reads=0,writes=0,models=0;
  const store={async readProgress(){reads++;return null;},async writeProgress(){writes++;return true;}};
  const service=createAgentService({store,provider:{connected:true,model:'fixture',async respond(){models++;throw new Error('실행 금지');}}});
  assert.equal(isProgressKey(key),true);
  for(const suffix of ['\n','\r','\r\n','\u2028','\u2029']) {
    const invalidToken=progressToken+suffix;
    assert.throws(()=>validateMessageRequest(request({progressToken:invalidToken})),error=>error.code==='INVALID_PROGRESS_TOKEN');
    assert.throws(()=>validateProgressRequest({progressToken:invalidToken}),error=>error.code==='INVALID_PROGRESS_TOKEN');
    assert.throws(()=>progressKey(invalidToken));
    assert.equal(isProgressKey(key+suffix),false);
    for(const [path,body] of [['/api/agent',request({progressToken:invalidToken})],['/api/agent/progress',{progressToken:invalidToken}]]) {
      const response=await post(service,body,path);
      assert.equal(response.statusCode,400);assert.equal(JSON.parse(response.body).error.code,'INVALID_PROGRESS_TOKEN');
    }
  }
  assert.equal(reads,0);assert.equal(writes,0);assert.equal(models,0);
});

test('고정 도구 allowlist는 현재 모델 도구와 서버 내부 준비 두 종류만 포함한다',()=>{
  assert.deepEqual([...PROGRESS_TOOLS].sort(),[...AGENT_TOOLS.map(item=>item.name),'apply_care_preferences','summarize_preparation'].sort());
});

test('실제 provider 대기→도구 시작→도구 결과→응답 저장 전이를 중간 조회한다',async()=>{
  const progressToken=token(),providerEntered=deferred(),providerGate=deferred(),toolEntered=deferred(),toolGate=deferred(),answerEntered=deferred(),answerGate=deferred();
  const store=createMemorySessionStore(),dispatch=createToolDispatcher();
  const provider=fixtureProvider([
    async input=>{assert.equal(JSON.stringify(input).includes(progressToken),false);providerEntered.resolve();await providerGate.promise;return use('request_records',{source:'nhis'});},
    async input=>{assert.equal(input.messages.at(-1).content[0].toolResult.status,'success');answerEntered.resolve();await answerGate.promise;return done('실제 기록 연계는 설정 전입니다.');},
  ]);
  const service=createAgentService({provider,store,dispatch:async input=>{toolEntered.resolve();await toolGate.promise;return dispatch(input);}});
  assert.equal(service.getCapabilities().progress,'poll');
  const pending=post(service,request({progressToken}));
  await providerEntered.promise;await tick();
  const planning=await poll(service,progressToken);
  assert.equal(planning.available,true);assert.equal(planning.progress.status,'running');assert.equal(planning.progress.currentStage,'records');
  assert.deepEqual(planning.progress.events.at(-1),{sequence:1,stage:'records',tool:null,status:'started'});
  providerGate.resolve();await toolEntered.promise;await tick();
  const running=await poll(service,progressToken);
  assert.equal(running.progress.stages[0].status,'running');assert.equal(running.progress.stages[0].lastTool,'request_records');
  assert.equal(running.progress.events.at(-1).status,'started');
  toolGate.resolve();await answerEntered.promise;await tick();
  const observed=await poll(service,progressToken);
  assert.ok(observed.progress.sequence>running.progress.sequence);
  assert.equal(observed.progress.currentStage,'plan');assert.equal(observed.progress.stages[0].status,'needs_input');
  assert.ok(observed.progress.events.some(item=>item.tool==='request_records'&&item.status==='needs_input'));
  answerGate.resolve();const result=await pending;
  assert.equal(result.statusCode,200);
  const finished=await poll(service,progressToken);
  assert.equal(finished.progress.status,'completed');assert.equal(finished.progress.stages[3].status,'needs_input');
  assert.deepEqual(Object.keys(JSON.parse(result.body)).sort(),['capabilities','caseState','events','needsInput','pendingActions','reply','requestId','sessionId'].sort());
  assert.equal(result.body.includes(progressToken),false);assert.equal(JSON.stringify(store.inspect()).includes(progressToken),false);
  assert.equal(store.inspect()[0].turns,1);
});

test('폴링은 상태 읽기만 하고 미등록 토큰과 저장 실패는200 unavailable이다',async()=>{
  const operations=[];
  const store=new Proxy({async readProgress(){operations.push('read');return null;},async writeProgress(){throw new Error('write forbidden');}}, {get(target,key){if(key in target)return target[key];throw new Error('세션·lease·budget 접근 금지');}});
  const provider={connected:true,model:'fixture',respond(){throw new Error('모델 호출 금지');}},service=createAgentService({provider,store});
  for(let index=0;index<3;index++)assert.deepEqual(await poll(service,token()),{available:false,progress:null});
  assert.deepEqual(operations,['read','read','read']);
  const broken=createAgentService({provider,store:{async readProgress(){throw new Error('PRIVATE SDK sk-private');},async writeProgress(){}}});
  const result=await post(broken,{progressToken:token()},'/api/agent/progress');
  assert.equal(result.statusCode,200);assert.deepEqual(JSON.parse(result.body),{available:false,progress:null});assert.equal(result.headers['cache-control'],'no-store');
  assert.equal(result.body.includes('PRIVATE'),false);
  const invalid=await post(service,{progressToken:'short'},'/api/agent/progress');
  assert.equal(invalid.statusCode,400);assert.equal(operations.length,3);
});

test('일반 요청의 토큰 누락·잘못된 입력·미연결·preview는 진행 저장을 하지 않는다',async()=>{
  let writes=0,reads=0;
  const memory=createMemorySessionStore(),store={...memory,async writeProgress(...args){writes++;return memory.writeProgress(...args);},async readProgress(...args){reads++;return memory.readProgress(...args);}};
  const connected=createAgentService({store,provider:fixtureProvider([done('합성 답변')])});
  assert.equal((await post(connected,request())).statusCode,200);assert.equal(writes,0);
  assert.equal((await post(connected,request({progressToken:'bad'}))).statusCode,400);assert.equal(writes,0);
  const disconnected=createAgentService({store:new Proxy({}, {get(){throw new Error('미연결 store 접근 금지');}})});
  assert.deepEqual(await poll(disconnected,token()),{available:false,progress:null});
  assert.equal((await post(disconnected,request({progressToken:token()}))).statusCode,503);
  assert.equal((await post(disconnected,{scenarioId:'aewol-parent-visit',requestId:'progress-preview-without-token'},'/api/agent/preview')).statusCode,200);
  assert.equal(reads,0);assert.equal(writes,0);
  let previewStoreAccess=0;
  const preview=createAgentService({provider:{connected:true,model:'fixture',respond(){throw new Error('모델 호출 금지');}},store:new Proxy({}, {get(){previewStoreAccess++;throw new Error('preview store 접근 금지');}})});
  const example=await post(preview,{scenarioId:'aewol-parent-visit',requestId:'connected-progress-preview'},'/api/agent/preview');
  assert.equal(example.statusCode,200);assert.equal(JSON.parse(example.body).capabilities.progress,'unavailable');assert.equal(previewStoreAccess,0);
});

test('메모리 진행은 해시 키·120초 TTL·별도 DTO이며 원문과 사본 수정을 보관하지 않는다',async()=>{
  let now=Date.parse('2026-10-31T12:00:00Z');
  const store=createMemorySessionStore({now:()=>now}),progressToken=token();
  const reporter=createProgressReporter({store,token:progressToken,now:()=>now});
  reporter.started('search_hospital_contacts',{name:'PRIVATE_QUERY',phone:'010-0000-0000',source:'https://private.invalid'});
  reporter.finished('search_hospital_contacts',{},'completed');reporter.completed();await reporter.flush();
  const stored=store.inspectProgress();
  assert.equal(stored.length,1);assert.equal(stored[0].pk,progressKey(progressToken));assert.equal(stored[0].expiresAt,Math.floor(now/1000)+120);
  assert.deepEqual(Object.keys(stored[0]).sort(),['pk','writerId','expiresAt','sequence','progress'].sort());
  assert.match(stored[0].writerId,/^[a-f0-9]{32}$/);
  const serialized=JSON.stringify(stored);
  for(const value of [progressToken,'PRIVATE_QUERY','010-0000-0000','private.invalid','patient','sessionId','query','reasoning','arguments','result'])assert.equal(serialized.includes(value),false);
  const received=await store.readProgress(progressKey(progressToken));received.stages[0].status='failed';
  assert.notEqual((await store.readProgress(progressKey(progressToken))).stages[0].status,'failed');
  assert.deepEqual(store.inspect(),[]);
  now+=119000;assert.equal((await readProgress(store,progressToken)).available,true);
  now+=1000;assert.deepEqual(await readProgress(store,progressToken),{available:false,progress:null});
});

test('진행 DTO의 추가 필드·임의 도구·단계·시점·역순 sequence를 거절한다',async()=>{
  const store=createMemorySessionStore(),progressToken=token(),reporter=createProgressReporter({store,token:progressToken});
  reporter.started('get_case');reporter.completed();await reporter.flush();
  const base=await store.readProgress(progressKey(progressToken));
  for(const mutate of [
    value=>{value.patient='PRIVATE';},value=>{value.stages[0].arguments={};},value=>{value.events[0].result='PRIVATE';},
    value=>{value.events[0].tool='PRIVATE_PROVIDER_TOOL';},value=>{value.stages[0].lastTool='PRIVATE';},value=>{value.currentStage='clinical_acceptance';},
    value=>{value.status='reserved';},value=>{value.updatedAt='PRIVATE';},value=>{value.events.reverse();},
    value=>{value.sequence=129;},value=>{value.stages.pop();},value=>{value.events[0].sequence=0;},
  ]){const value=structuredClone(base);mutate(value);assert.throws(()=>normalizeProgressSnapshot(value));}
});

test('이벤트32개·순번128개를 넘지 않고 마지막 실패를 기록할 공간을 보존한다',async()=>{
  const store=createMemorySessionStore(),progressToken=token(),reporter=createProgressReporter({store,token:progressToken});
  for(let index=0;index<200;index++)reporter.finished('get_case');
  reporter.failed();await reporter.flush();
  const value=(await readProgress(store,progressToken)).progress;
  assert.equal(value.sequence,128);assert.equal(value.events.length,32);assert.equal(value.status,'failed');assert.equal(value.events.at(-1).status,'failed');
  for(let index=1;index<value.events.length;index++)assert.ok(value.events[index].sequence>value.events[index-1].sequence);
});

test('알 수 없는 도구·부적절한 분류 인자는 진행을 오염시키거나 실행 결과를 바꾸지 않는다',async()=>{
  const progressToken=token(),store=createMemorySessionStore();
  const unknown='PRIVATE_TOOL_01012345678';
  // 두 번의 오류도 서로 다른 toolUseId로 전달한다.
  const provider=fixtureProvider([use(unknown,{query:'PRIVATE_QUERY'}),{content:[{toolUse:{toolUseId:'bad-arguments',name:'run_journey_demo',input:{scenarioId:{toString:null}}}}],stopReason:'tool_use'},done('허용된 도구 조건을 확인해 주세요.')]);
  const result=await post(createAgentService({store,provider}),request({progressToken}));
  assert.equal(result.statusCode,200);
  const progress=await poll(createAgentService({store,provider}),progressToken);
  assert.equal(progress.progress.status,'completed');
  assert.equal(JSON.stringify(progress).includes(unknown),false);assert.equal(JSON.stringify(progress).includes('PRIVATE_QUERY'),false);
});

test('도구 오류는 failed, 복구 가능한 미연결 결과는 needs_input으로 남기고 전체 답변은 완료할 수 있다',async()=>{
  const progressToken=token(),store=createMemorySessionStore();
  const provider=fixtureProvider([use('request_support_contact',{kind:'taxi'}),done('문의 초안 준비가 먼저 필요합니다.')]);
  const service=createAgentService({store,provider});
  assert.equal((await post(service,request({progressToken}))).statusCode,200);
  const value=(await poll(service,progressToken)).progress;
  assert.equal(value.status,'completed');assert.equal(value.stages[2].status,'failed');
  assert.ok(value.events.some(item=>item.tool==='request_support_contact'&&item.status==='failed'));
});

test('provider·상태 저장·모델 응답 오류와 요청 timeout은 안전한 실패 진행을 남긴다',async()=>{
  for(const variant of ['provider','save','invalid','timeout','load']) {
    const progressToken=token(),memory=createMemorySessionStore();
    const provider={connected:true,model:'fixture',async respond(){if(variant==='timeout')return new Promise(()=>{});if(variant==='provider')throw new Error('PRIVATE provider reasoning');return variant==='invalid'?{content:[]}:done('응답');}};
    const store={...memory,...(variant==='save'?{async save(){throw new Error('PRIVATE store');}}:{}),...(variant==='load'?{async loadOrCreate(){throw new Error('PRIVATE store');}}:{})};
    const service=createAgentService({store,provider,config:{deadlineMs:variant==='timeout'?20:1000}});
    const result=await post(service,request({progressToken}));
    assert.ok(result.statusCode>=500,variant);assert.equal(result.body.includes('PRIVATE'),false);
    await tick();const value=await poll(service,progressToken);
    assert.equal(value.available,true,variant);assert.equal(value.progress.status,'failed',variant);assert.equal(JSON.stringify(value).includes('PRIVATE'),false);
  }
});

test('새 토큰으로 중복 요청을 읽어도 모델·budget은 추가 실행하지 않고 진행만 완료한다',async()=>{
  let calls=0,turns=0;
  const memory=createMemorySessionStore(),store={...memory,async consumeTurn(...args){turns++;return memory.consumeTurn(...args);}};
  const provider={connected:true,model:'fixture',async respond(){calls++;return done('합성 응답');}},service=createAgentService({store,provider});
  const first=JSON.parse((await post(service,request({progressToken:token()}))).body);
  const progressToken=token(),duplicate=await post(service,request({sessionId:first.sessionId,progressToken}));
  assert.equal(duplicate.statusCode,200);assert.equal(calls,1);assert.equal(turns,1);assert.deepEqual(JSON.parse(duplicate.body).events,[]);
  const value=(await poll(service,progressToken)).progress;
  assert.equal(value.status,'completed');assert.equal(value.sequence,1);assert.deepEqual(value.events,[{sequence:1,stage:'plan',tool:null,status:'completed'}]);
});

test('진행 조회와 일일 예산 거절은 모델 호출을 추가하거나 보관된 세션 턴을 늘리지 않는다',async()=>{
  let calls=0;const store=createMemorySessionStore(),provider={connected:true,model:'fixture',async respond(){calls++;return done('합성 응답');}};
  const service=createAgentService({store,provider,config:{dailyTurns:1}}),firstToken=token();
  const first=JSON.parse((await post(service,request({progressToken:firstToken}))).body);
  for(let index=0;index<4;index++)assert.equal((await poll(service,firstToken)).progress.status,'completed');
  const failedToken=token(),limited=await post(service,request({sessionId:first.sessionId,requestId:'progress-budget-request-002',progressToken:failedToken}));
  assert.equal(limited.statusCode,429);assert.equal(JSON.parse(limited.body).error.code,'DAILY_LIMIT');
  assert.equal((await poll(service,failedToken)).progress.status,'failed');assert.equal(calls,1);assert.equal(store.inspect()[0].turns,1);
});

test('같은 활성 토큰을 재사용한 다른 요청은 기존 진행을 덮거나 만료를 연장하지 않는다',async()=>{
  const progressToken=token(),store=createMemorySessionStore(),first=createProgressReporter({store,token:progressToken});
  first.started('request_records',{source:'demo'});await first.flush();
  const before=store.inspectProgress()[0],second=createProgressReporter({store,token:progressToken});
  second.started('find_support',{kind:'taxi'});second.completed();await second.flush();
  assert.deepEqual(store.inspectProgress()[0],before);
  first.completed();await first.flush();assert.equal((await readProgress(store,progressToken)).progress.status,'completed');
});

test('초기 저장 뒤 ack timeout이 나도 다음 실제 전이에서 네 단계와 마지막 응답을 기록한다',async()=>{
  const memory=createMemorySessionStore(),progressToken=token();
  let first=true,attempts=0;
  const store={...memory,async writeProgress(key,snapshot,options){
    attempts++;
    const written=await memory.writeProgress(key,snapshot,options);
    if(first){first=false;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('PRIVATE lost ack')),{once:true}));}
    return written;
  }};
  const reporter=createProgressReporter({store,token:progressToken});
  reporter.finished('apply_care_preferences');
  await reporter.flush();
  const initial=memory.inspectProgress()[0];
  assert.equal(initial.sequence,1);
  // 최초 응답 유실 뒤 이 실제 전이가 없으면 임의 재시도/가짜 진행은 생성하지 않는다.
  assert.equal(attempts,1);
  reporter.finished('search_hospital_contacts');await reporter.flush();
  reporter.finished('prepare_inquiries',{kind:'taxi'});await reporter.flush();
  reporter.completed();await reporter.flush();
  const stored=memory.inspectProgress()[0],value=(await readProgress(store,progressToken)).progress;
  assert.equal(stored.writerId,initial.writerId);assert.equal(stored.expiresAt,initial.expiresAt);
  assert.equal(value.status,'completed');assert.equal(value.sequence,4);
  assert.deepEqual(value.stages.map(item=>item.status),['observed','observed','observed','observed']);
  assert.equal(JSON.stringify(value).includes('writerId'),false);assert.equal(JSON.stringify(value).includes('PRIVATE'),false);
});

test('초기 저장 전 일시 오류와 후속 ack 유실은 최신 실제 전이로 회복하고 조건부 소유 충돌은 중단한다',async()=>{
  const memory=createMemorySessionStore(),progressToken=token();
  let attempts=0;
  const store={...memory,async writeProgress(...args){
    attempts++;
    if(attempts===1)throw new Error('PRIVATE transport before commit');
    const written=await memory.writeProgress(...args);
    if(attempts===2)throw new Error('PRIVATE lost acknowledgement');
    return written;
  }};
  const reporter=createProgressReporter({store,token:progressToken});
  reporter.planning(true);await reporter.flush();
  assert.equal(memory.inspectProgress().length,0);
  reporter.finished('search_hospital_contacts');await reporter.flush();
  assert.equal(memory.inspectProgress()[0].sequence,2);
  reporter.finished('prepare_inquiries',{kind:'companion'});await reporter.flush();
  reporter.completed();await reporter.flush();
  assert.equal((await readProgress(store,progressToken)).progress.status,'completed');
  const original=memory.inspectProgress()[0],before=attempts;
  const second=createProgressReporter({store,token:progressToken});
  second.started('get_case');await second.flush();
  second.finished('search_hospital_contacts');second.completed();await second.flush();
  assert.equal(attempts,before+1);assert.deepEqual(memory.inspectProgress()[0],original);
});

test('같은 TTL의 다른 writer는 높은 순번으로도 기존 진행을 바꾸지 못한다',async()=>{
  const store=createMemorySessionStore(),progressToken=token(),reporter=createProgressReporter({store,token:progressToken});
  reporter.started('get_case');await reporter.flush();
  const row=store.inspectProgress()[0],otherWriter=row.writerId==='0'.repeat(32)?'1'.repeat(32):'0'.repeat(32);
  const newer={...row.progress,sequence:10,status:'completed'};
  assert.equal(await store.writeProgress(row.pk,newer,{expiresAt:row.expiresAt,writerId:otherWriter}),false);
  assert.deepEqual(store.inspectProgress()[0],row);
  assert.equal(await store.writeProgress(row.pk,newer,{expiresAt:row.expiresAt,writerId:row.writerId}),true);
  assert.equal(await store.writeProgress(row.pk,row.progress,{expiresAt:row.expiresAt,writerId:row.writerId}),false);
  const value=await store.readProgress(row.pk);assert.equal(value.sequence,10);assert.equal(Object.hasOwn(value,'writerId'),false);
});

test('진행 쓰기 도중 완료돼도 flush는 단일 writer의 진행·최종 두 I/O를 기다린다',async()=>{
  const memory=createMemorySessionStore(),progressToken=token();let active=0,maxActive=0,writes=0;
  const store={...memory,async writeProgress(...args){
    active++;maxActive=Math.max(maxActive,active);writes++;
    try{await new Promise(resolve=>setTimeout(resolve,115));return await memory.writeProgress(...args);}
    finally{active--;}
  }};
  const reporter=createProgressReporter({store,token:progressToken});
  reporter.planning(true);reporter.completed();await reporter.flush();
  assert.equal(writes,2);assert.equal(maxActive,1);assert.equal(active,0);
  const value=(await readProgress(store,progressToken)).progress;
  assert.equal(value.sequence,2);assert.equal(value.status,'completed');assert.equal(value.currentStage,'plan');
});

test('진행 저장이 멈춰도 모델·상태 저장·응답은 기존 deadline 안에서 완료하고 읽기도 짧게 끝낸다',async()=>{
  let modelCalls=0;const signals=[];
  const memory=createMemorySessionStore(),store={...memory,async writeProgress(_key,_value,options){signals.push(options.signal);return new Promise(()=>{});},async readProgress(){return new Promise(()=>{});}};
  const provider={connected:true,model:'fixture',async respond(){modelCalls++;return done('진행 연결과 무관한 합성 응답');}};
  const service=createAgentService({provider,store,config:{deadlineMs:30}}),startedAt=performance.now();
  const result=await post(service,request({progressToken:token()}));
  assert.equal(result.statusCode,200);assert.equal(modelCalls,1);assert.equal(memory.inspect()[0].turns,1);assert.ok(performance.now()-startedAt<500);
  assert.deepEqual(await poll(service,token()),{available:false,progress:null});
  assert.equal(signals[0].aborted,true);
  assert.ok(signals.length<=2,'진행 대기 1개와 예약된 최종 상태만 시도한다.');
});
