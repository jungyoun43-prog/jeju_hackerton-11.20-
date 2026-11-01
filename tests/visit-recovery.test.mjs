import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentService } from '../agent/service.mjs';
import { createMemorySessionStore } from '../agent/store.mjs';
import { validateMessageRequest } from '../agent/validation.mjs';
import { visitSessionId, requestFingerprint, normalizeRequestReceipts, MAX_REQUEST_RECEIPTS } from '../agent/visit-recovery.mjs';

const token='v'.repeat(43), initialTime=Date.parse('2026-11-01T10:00:00Z');
const body=(extra={})=>({message:'11월19일 오후2시로 합성 방문일정을 바꿔 주세요.',requestId:'visit-request-0001',visitToken:token,...extra});
const done=(text='합성 준비를 확인했습니다.')=>({content:[{text}],stopReason:'end_turn'});
const update={content:[{toolUse:{toolUseId:'visit-update',name:'update_visit',input:{date:'2026-11-19',appointmentTime:'14:00'}}}],stopReason:'tool_use'};
const parsed=value=>JSON.parse(value.body);
const post=(service,value=body(),path='/api/agent')=>service.handleAgentRequest({method:'POST',path,body:value,headers:{'content-type':'application/json'}});
const resume=service=>post(service,{visitToken:token},'/api/agent/resume');
function fixture({outputs=[update,done()],ttlSeconds=3600,wrapStore=value=>value}={}) {
  let time=initialTime,charged=0;
  const memory=createMemorySessionStore({now:()=>time,ttlSeconds});
  const operations=[],store=wrapStore({...memory,...Object.fromEntries(['loadOrCreate','acquire','save','release','consumeTurn'].map(name=>[name,async(...args)=>{operations.push(name);if(name==='consumeTurn')charged++;return memory[name](...args);}]))});
  const calls=[],provider={connected:true,model:'fixture',async respond(input){calls.push(input);const result=outputs.shift();assert.ok(result,'검사 응답 부족');return typeof result==='function'?result(input):result;}};
  const service=createAgentService({store,provider,now:()=>time});
  return {memory,store,operations,calls,service,advance:seconds=>{time+=seconds*1000;},now:()=>time,charged:()=>charged};
}

test('방문 토큰은 고정된 해시 세션으로 분리하고 업무 지문은 전송 필드·JSON 키 순서에 무관하다',()=>{
  assert.match(visitSessionId(token),/^[A-Za-z0-9_-]{43}$/);assert.notEqual(visitSessionId(token),token);
  assert.notEqual(visitSessionId(token),visitSessionId('w'.repeat(43)));
  for(const invalid of [null,'','a'.repeat(42),'a'.repeat(44),'!'.repeat(43)])assert.throws(()=>visitSessionId(invalid));
  const first=validateMessageRequest(body({history:[{role:'user',text:'기존 요청'}],preferences:{taxiProviderId:'auto',wheelchair:true,companionNeeded:false}}));
  const next=validateMessageRequest(body({sessionId:visitSessionId(token),progressToken:'p'.repeat(43),history:[{text:'기존 요청',role:'user'}],preferences:{companionNeeded:false,wheelchair:true,taxiProviderId:'auto'}}));
  assert.equal(requestFingerprint(first),requestFingerprint(next));
  assert.notEqual(requestFingerprint(first),requestFingerprint({...first,message:'다른 요청'}));
});

test('첫 응답을 잃고 sessionId 없이 재시도해도 도구·모델·차감은 한 번만 수행한다',async()=>{
  const f=fixture(),first=await post(f.service);
  assert.equal(first.statusCode,200);
  const original=parsed(first);assert.equal(original.sessionId,visitSessionId(token));assert.equal(original.caseState.patient.nextVisit,'2026-11-19');
  const before=f.operations.length,retry=await post(f.service,body({progressToken:'p'.repeat(43)}));
  assert.equal(retry.statusCode,200);assert.equal(parsed(retry).sessionId,original.sessionId);assert.match(parsed(retry).reply,/이미 처리/);
  assert.equal(parsed(retry).needsInput,parsed(retry).pendingActions.length > 0);
  assert.deepEqual(parsed(retry).caseState,original.caseState);assert.equal(f.calls.length,2);assert.equal(f.charged(),1);
  assert.deepEqual(f.operations.slice(before),['loadOrCreate']);
  const state=f.memory.inspect()[0];assert.equal(state.turns,1);assert.equal(state.requestReceipts[0].status,'completed');
  for(const value of [token,'p'.repeat(43),body().message,original.reply])assert.equal(JSON.stringify(state).includes(value),false);
  assert.equal(JSON.stringify(f.calls).includes(token),false);
});

test('최초 동시 요청은 같은 세션을 공유하며 완료 전 중복/본문변경을 실행하지 않는다',async t=>{
  let release,entered;const started=new Promise(resolve=>{entered=resolve;});
  const f=fixture({outputs:[async()=>{entered();return new Promise(resolve=>{release=()=>resolve(done());});}]});
  t.after(()=>release?.());
  const first=post(f.service);await started;
  const duplicate=await post(f.service),conflict=await post(f.service,body({message:'같은 ID의 다른 요청'}));
  assert.equal(duplicate.statusCode,409);assert.equal(parsed(duplicate).error.code,'REQUEST_IN_PROGRESS');
  assert.equal(conflict.statusCode,409);assert.equal(parsed(conflict).error.code,'REQUEST_CONFLICT');
  assert.equal(f.memory.inspect().length,1);assert.equal(f.calls.length,1);assert.equal(f.charged(),1);
  release();assert.equal((await first).statusCode,200);assert.equal((await post(f.service)).statusCode,200);assert.equal(f.calls.length,1);
});

test('진행 중 복구는 마지막 확인 상태와 running만 읽고 TTL·lease·차감을 바꾸지 않는다',async t=>{
  let release,entered;const started=new Promise(resolve=>{entered=resolve;});
  const f=fixture({outputs:[async()=>{entered();return new Promise(resolve=>{release=()=>resolve(done());});}]});
  t.after(()=>release?.());const first=post(f.service);await started;
  const original=f.memory.inspect()[0],before=f.operations.length,result=await resume(f.service),value=parsed(result);
  assert.equal(result.statusCode,200);assert.deepEqual(Object.keys(value).sort(),['caseState','pendingActions','recovery','sessionId']);
  assert.deepEqual(value.recovery,{savedAt:null,expiresAt:original.expiresAt,request:{requestId:body().requestId,status:'running'}});
  assert.equal(value.caseState.patient.nextVisit,'2026-11-12');assert.deepEqual(f.operations.slice(before),['loadOrCreate']);
  assert.equal(f.memory.inspect()[0].expiresAt,original.expiresAt);assert.equal(f.calls.length,1);assert.equal(f.charged(),1);
  for(const value of [token,requestFingerprint(validateMessageRequest(body()))])assert.equal(result.body.includes(value),false);
  release();assert.equal((await first).statusCode,200);
});

test('완료 상태는 새 서비스에서 읽을 수 있고 과거 답변 원문은 복원하지 않는다',async()=>{
  const responseMarker='보관하지 않는 모델 답변 검사문구';
  const f=fixture({outputs:[update,done(responseMarker)]});assert.equal((await post(f.service)).statusCode,200);
  f.advance(100);const expiresAt=f.memory.inspect()[0].expiresAt,before=f.operations.length;
  const reader=createAgentService({store:f.store,now:f.now,provider:{connected:true,model:'forbidden',respond(){throw new Error('복구에서 모델 호출 금지');}}});
  const result=await resume(reader),value=parsed(result);assert.equal(result.statusCode,200);
  assert.equal(value.caseState.patient.nextVisit,'2026-11-19');assert.equal(value.recovery.savedAt,new Date(initialTime).toISOString());
  assert.equal(value.recovery.request.status,'completed');assert.equal(value.recovery.expiresAt,expiresAt);
  assert.deepEqual(f.operations.slice(before),['loadOrCreate']);assert.equal(result.body.includes(responseMarker),false);
  assert.equal(f.memory.inspect()[0].expiresAt,expiresAt);assert.equal(f.charged(),1);
});

test('완료된 같은 ID의 다른 본문·설정·이력은 충돌이며 같은 내용만 재표시한다',async()=>{
  const f=fixture({outputs:[done()]});assert.equal((await post(f.service)).statusCode,200);
  for(const change of [{message:'다른 본문'},{preferences:{taxiProviderId:'auto',wheelchair:true,companionNeeded:false}},{history:[{role:'user',text:'다른 이력'}]}]){
    const result=await post(f.service,body(change));assert.equal(result.statusCode,409);assert.equal(parsed(result).error.code,'REQUEST_CONFLICT');
  }
  assert.equal((await post(f.service,body({sessionId:visitSessionId(token)}))).statusCode,200);assert.equal(f.calls.length,1);assert.equal(f.charged(),1);
});

test('모델 실패는 failed receipt로 남겨 같은 요청의 자동 실행·추가 차감을 막는다',async()=>{
  const f=fixture({outputs:[()=>{throw new Error('PRIVATE upstream credential');}]});
  const first=await post(f.service);assert.equal(first.statusCode,503);assert.equal(first.body.includes('PRIVATE'),false);
  const retry=await post(f.service);assert.equal(retry.statusCode,409);assert.equal(parsed(retry).error.code,'REQUEST_INTERRUPTED');
  const restored=parsed(await resume(f.service));assert.equal(restored.recovery.request.status,'interrupted');assert.equal(restored.recovery.savedAt,null);
  assert.equal(f.memory.inspect()[0].requestReceipts[0].status,'failed');assert.equal(f.memory.inspect()[0].turns,0);assert.equal(f.calls.length,1);assert.equal(f.charged(),1);
});

test('완료 저장 ack 유실 뒤 failed/이전 상태로 덮지 않고 저장된 결과를 재표시한다',async()=>{
  let lost=false;
  const f=fixture({wrapStore:store=>({...store,async save(item,...args){await store.save(item,...args);if(!lost && item.requestReceipts?.at(-1).status==='completed'){lost=true;throw new Error('PRIVATE write acknowledgement lost');}}})});
  assert.equal((await post(f.service)).statusCode,503);
  const stored=f.memory.inspect()[0];assert.equal(stored.requestReceipts[0].status,'completed');assert.equal(stored.state.patient.nextVisit,'2026-11-19');
  const retry=await post(f.service);assert.equal(retry.statusCode,200);assert.equal(parsed(retry).caseState.patient.nextVisit,'2026-11-19');
  assert.equal(f.calls.length,2);assert.equal(f.charged(),1);
});

test('시작 receipt 저장 ack 유실은 모델을 실행하지 않고 재시작 뒤에도 보수적으로 인계한다',async()=>{
  let lost=false;
  const f=fixture({outputs:[],wrapStore:store=>({...store,async save(item,...args){await store.save(item,...args);if(!lost){lost=true;throw new Error('PRIVATE started acknowledgement lost');}}})});
  assert.equal((await post(f.service)).statusCode,503);assert.equal(f.charged(),0);assert.equal(f.calls.length,0);
  assert.equal(parsed(await post(f.service)).error.code,'REQUEST_IN_PROGRESS');
  f.advance(66);const reader=createAgentService({store:f.store,provider:{connected:true,model:'forbidden',respond(){throw new Error('재실행 금지');}},now:f.now});
  const retry=await post(reader);assert.equal(retry.statusCode,409);assert.equal(parsed(retry).error.code,'REQUEST_INTERRUPTED');
  assert.equal(parsed(await resume(reader)).recovery.request.status,'interrupted');assert.equal(f.charged(),0);assert.equal(f.calls.length,0);
});

test('새 요청 실패 뒤에는 이전 완료 시각·상태를 유지하고 마지막 실패를 별도로 표시한다',async()=>{
  const f=fixture({outputs:[update,done(),()=>{throw new Error('PRIVATE later failure');}]});
  assert.equal((await post(f.service)).statusCode,200);f.advance(5);
  assert.equal((await post(f.service,body({requestId:'visit-request-0002',message:'다음 준비를 확인해 주세요.'}))).statusCode,503);
  const value=parsed(await resume(f.service));assert.equal(value.caseState.patient.nextVisit,'2026-11-19');
  assert.equal(value.recovery.savedAt,new Date(initialTime).toISOString());assert.equal(value.recovery.request.requestId,'visit-request-0002');assert.equal(value.recovery.request.status,'interrupted');
});

test('receipt 한도에서는 기록을 버리지 않고 새 실행만 거절한다',async()=>{
  const f=fixture({outputs:[]}),session=await f.store.loadOrCreate(undefined,{initialSessionId:visitSessionId(token)});
  session.requestReceipts=Array.from({length:MAX_REQUEST_RECEIPTS},(_,index)=>({requestId:`visit-old-request-${String(index).padStart(3,'0')}`,digest:'a'.repeat(64),status:'failed',at:initialTime}));
  await f.store.save(session);
  const before=JSON.stringify(f.memory.inspect()),result=await post(f.service);assert.equal(result.statusCode,429);assert.equal(parsed(result).error.code,'REQUEST_LIMIT');
  assert.equal(JSON.stringify(f.memory.inspect()),before);assert.equal(f.calls.length,0);assert.equal(f.charged(),0);
});

test('알 수 없는/만료된 복구 토큰은 세션을 만들거나 TTL을 연장하지 않는다',async()=>{
  const f=fixture({outputs:[done()],ttlSeconds:1});
  assert.equal((await resume(f.service)).statusCode,404);assert.equal(f.memory.inspect().length,0);assert.equal(f.operations.includes('save'),false);
  assert.equal((await post(f.service)).statusCode,200);f.advance(2);
  const result=await resume(f.service);assert.equal(result.statusCode,404);assert.equal(parsed(result).error.code,'SESSION_EXPIRED');assert.equal(f.calls.length,1);assert.equal(f.charged(),1);
});

test('복구 입력·method·content-type과 세션/토큰 불일치는 store 실행 전에 거절된다',async()=>{
  const f=fixture({outputs:[]});
  for(const invalid of [{},{visitToken:'bad'},{visitToken:token,sessionId:'x'.repeat(43)},{visitToken:null},{visitToken:token,history:[]}])assert.equal((await post(f.service,invalid,'/api/agent/resume')).statusCode,400);
  assert.equal((await f.service.handleAgentRequest({method:'GET',path:'/api/agent/resume'})).statusCode,405);
  assert.equal((await f.service.handleAgentRequest({method:'POST',path:'/api/agent/resume',body:{visitToken:token},headers:{'content-type':'text/plain'}})).statusCode,415);
  assert.equal((await post(f.service,body({sessionId:'x'.repeat(43)}))).statusCode,400);
  assert.deepEqual(f.operations,[]);assert.equal(f.calls.length,0);
});

test('전송용 토큰을 본문·이력·requestId로 우회해 모델·DB·오류에 남기지 않는다',async()=>{
  const f=fixture({outputs:[]});
  for(const change of [{message:token},{history:[{role:'user',text:token}]},{requestId:token},{requestId:'sk-proj-'+ 'z'.repeat(40)}]){
    const result=await post(f.service,body(change));assert.equal(result.statusCode,400);assert.equal(result.body.includes(token),false);assert.equal(result.body.includes('sk-proj-'),false);
  }
  assert.deepEqual(f.operations,[]);assert.equal(f.calls.length,0);
});

test('v1 세션의 완료 ID는 유지하며 새로운 요청부터 고정 receipt를 추가한다',async()=>{
  const f=fixture({outputs:[done()]}),legacy=await f.store.loadOrCreate();legacy.turns=1;legacy.requestIds=['legacy-request-0001'];await f.store.save(legacy);
  assert.equal(Object.hasOwn(f.memory.inspect()[0],'requestReceipts'),false);
  const retry=await post(f.service,{message:'과거 v1 요청',requestId:'legacy-request-0001',sessionId:legacy.sessionId});assert.equal(retry.statusCode,200);assert.equal(f.charged(),0);
  const next=await post(f.service,{message:'다음 요청',requestId:'legacy-request-0002',sessionId:legacy.sessionId});assert.equal(next.statusCode,200);
  const saved=f.memory.inspect()[0];assert.deepEqual(saved.requestIds,['legacy-request-0001','legacy-request-0002']);assert.equal(saved.requestReceipts.length,1);assert.equal(saved.turns,2);
});

test('receipt 검증은 원문 추가·빈 배열 칸·중복ID·상태/완료ID 불일치를 거절한다',()=>{
  const valid={requestId:'visit-request-0001',digest:'a'.repeat(64),status:'started',at:initialTime};
  for(const value of [[{...valid,message:'PRIVATE'}],new Array(1),[valid,valid],[{...valid,status:'unknown'}],[{...valid,at:NaN}],[{...valid,digest:token}],[{...valid,status:'completed'}]])assert.throws(()=>normalizeRequestReceipts(value));
  assert.throws(()=>normalizeRequestReceipts([valid],[valid.requestId]));
  const copy=normalizeRequestReceipts([valid]);copy[0].status='failed';assert.equal(valid.status,'started');
});


test('busy 메모리 항목도 만료되면 복구404이며 조회가 삭제·TTL연장·lease해제를 하지 않는다',async()=>{
  const f=fixture({outputs:[],ttlSeconds:1}),session=await f.store.loadOrCreate(undefined,{initialSessionId:visitSessionId(token)});
  await f.store.acquire(session.sessionId);f.advance(2);
  const before=JSON.stringify(f.memory.inspect()),offset=f.operations.length,result=await resume(f.service);
  assert.equal(result.statusCode,404);assert.equal(parsed(result).error.code,'SESSION_EXPIRED');assert.equal(JSON.stringify(f.memory.inspect()),before);
  assert.deepEqual(f.operations.slice(offset),['loadOrCreate']);assert.equal(f.calls.length,0);assert.equal(f.charged(),0);
  await assert.rejects(f.store.loadOrCreate(undefined,{initialSessionId:session.sessionId}),error=>error.code==='SESSION_EXPIRED');
  await f.store.release(session.sessionId);
});
