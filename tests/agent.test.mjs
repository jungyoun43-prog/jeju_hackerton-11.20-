import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentService } from '../agent/service.mjs';
import { createLambdaHandler } from '../agent/handler.mjs';
import { createMemorySessionStore } from '../agent/store.mjs';
import { AGENT_TOOLS, createToolDispatcher, assertSourceUrl } from '../agent/tools.mjs';
import { createDemoCase, buildReport, applyAction } from '../app/domain.js';
import { createConverseProvider } from '../agent/providers.mjs';

const req = (extra = {}) => ({message:'합성 방문 준비를 도와줘',requestId:'request-test-0001',...extra});
const call = (name,input = {},id = 'tool-1') => ({toolUse:{toolUseId:id,name,input}});
const use = (...content) => ({content,stopReason:'tool_use'});
const done = text => ({content:[{text}],stopReason:'end_turn'});
const post = (service,body = req(),path = '/api/agent') => service.handleAgentRequest({method:'POST',path,body,headers:{'Content-Type':'application/json'}});
const json = result => JSON.parse(result.body);
function scripted(outputs) {
  const calls = [];
  return {connected:true,model:'injected-test-model',calls,async respond(input) { calls.push(input); const output = outputs.shift(); assert.ok(output,'검사 provider 응답이 부족합니다.'); return typeof output === 'function' ? output(input) : output; }};
}

test('guided 준비는 이른 모델 종료 뒤 같은 요청에서 안전한 초안 최대 두 개만 이어 만든다',async()=>{
  const provider=scripted([done('현재 요청을 확인했습니다.')]),store=createMemorySessionStore();
  let charged=0;const service=createAgentService({provider,store:{...store,async consumeTurn(...args){charged++;return store.consumeTurn(...args);}}});
  const request=req({message:'방문 준비를 도와줘',guidedPreparation:true,visitToken:'g'.repeat(43),progressToken:'p'.repeat(43)});
  const response=await post(service,request),body=json(response);
  assert.equal(response.statusCode,200);assert.equal(provider.calls.length,1);assert.equal(charged,1);
  assert.deepEqual(body.events.map(item=>item.tool),['prepare_inquiries','prepare_inquiries']);
  for(const kind of ['taxi','companion'])assert.equal(body.caseState.visitSupport[kind].status,'prepared');
  assert.match(body.caseState.visitSupport.taxi.inquiry,/예약 시각: 미확인/);
  assert.deepEqual(body.caseState.documents,createDemoCase().documents);assert.equal(body.caseState.permissions.share,false);
  assert.ok(Object.values(body.caseState.inquiries).every(item=>item.status==='not_contacted'));
  assert.match(body.reply,/이동·동행 문의 초안/);assert.match(body.reply,/실제 전화·예약·배차/);
  const events=store.inspectProgress()[0].progress.events;
  assert.equal(events.filter(item=>item.tool==='prepare_inquiries'&&item.status==='completed').length,2);
  const retry=await post(service,request);assert.equal(retry.statusCode,200);assert.deepEqual(json(retry).caseState,body.caseState);
  assert.equal(provider.calls.length,1);assert.equal(charged,1);
});

test('guided false/생략은 기존 동작이고 boolean 외 값은 store·모델 접근 전에 거절한다',async()=>{
  for(const guidedPreparation of [false,undefined]){
    const provider=scripted([done('읽은 결과입니다.')]),service=createAgentService({provider});
    const response=await post(service,req(guidedPreparation===undefined?{}:{guidedPreparation}));
    assert.equal(response.statusCode,200);assert.deepEqual(json(response).events,[]);
    assert.equal(json(response).caseState.visitSupport.taxi.status,'not_selected');
  }
  const service=createAgentService({store:new Proxy({}, {get(){throw new Error('잘못된 boolean에서 저장소 호출 금지');}})});
  for(const guidedPreparation of [null,'true',1,[],{}]){
    const response=await post(service,req({guidedPreparation}));assert.equal(response.statusCode,400);
    assert.equal(json(response).error.code,'INVALID_GUIDED_PREPARATION');
  }
});

test('읽기·비교·부정 요청은 모델이 방문 상태를 바꿔도 fallback 범위를 넓히지 않는다',async()=>{
  for(const message of ['방문 준비 상태를 보여줘','택시와 동행을 비교해줘','방문 준비하지 말아줘','무관한 질문입니다.']){
    const provider=scripted([use(call('update_visit',{appointmentTime:'10:00'})),done('확인했습니다.')]);
    const response=await post(createAgentService({provider}),req({message,guidedPreparation:true}));
    assert.equal(response.statusCode,200);assert.deepEqual(json(response).events.map(item=>item.tool),['update_visit']);
    assert.equal(json(response).caseState.visitSupport.taxi.status,'not_selected');
    assert.equal(provider.calls.length,2);
  }
});

test('초안만 요청한 범위·실전화 금지·지원 해당 없음과 도구 한도를 지킨다',async()=>{
  const provider=scripted([done('초안을 확인합니다.')]);
  const only=await post(createAgentService({provider}),req({message:'택시 문의 초안을 현재 방문 조건으로 준비해줘. 실제 전화는 하지 말아 줘.',guidedPreparation:true}));
  assert.equal(only.statusCode,200);assert.deepEqual(json(only).events.map(item=>item.tool),['prepare_inquiries']);
  assert.equal(json(only).caseState.visitSupport.companion.status,'not_selected');
  const limited=await post(createAgentService({provider:scripted([done('한도 안에서 준비합니다.')]),config:{maxTools:1}}),req({guidedPreparation:true}));
  assert.equal(limited.statusCode,200);assert.equal(json(limited).events.length,1);
  assert.equal(json(limited).caseState.visitSupport.companion.status,'not_selected');
  assert.match(json(limited).reply,/도구 한도/);
  const store=createMemorySessionStore(),session=await store.loadOrCreate();
  session.state=applyAction(session.state,{type:'SUPPORT_UPDATE_REQUIREMENTS',values:{transportNeeded:false,companionNeeded:false}});await store.save(session);
  const none=await post(createAgentService({store,provider:scripted([done('조건을 유지합니다.')])}),req({sessionId:session.sessionId,guidedPreparation:true}));
  assert.equal(none.statusCode,200);assert.deepEqual(json(none).events,[]);
});

test('개인 기록 미연결·의료진 대기는 남기면서 독립 문의 초안은 이어 준비한다',async()=>{
  const provider=scripted([use(call('request_records',{source:'nhis'},'nhis-1'),call('prepare_review',{},'review-1')),done('실제 기록은 미연결입니다.')]);
  const result=await post(createAgentService({provider}),req({message:'건강 기록 연동은 미설정이어도 방문 준비를 도와줘',guidedPreparation:true})),body=json(result);
  assert.equal(result.statusCode,200);assert.equal(provider.calls.length,2);
  assert.deepEqual(body.events.map(item=>item.tool),['request_records','prepare_review','prepare_inquiries','prepare_inquiries']);
  assert.equal(body.events[0].status,'not_connected');assert.equal(body.events[1].status,'needs_input');
  assert.equal(body.caseState.documents.find(item=>item.id==='report').status,'missing');
  assert.equal(body.caseState.documents.find(item=>item.id==='exam').status,'not_performed');
  for(const kind of ['taxi','companion'])assert.equal(body.caseState.visitSupport[kind].status,'prepared');
  assert.ok(body.pendingActions.some(item=>/기록|진찰|의료진/.test(item.label)));
});

test('지원 미연결·초안 실패는 해당 종류만 멈추고 다른 독립 초안은 진행한다',async()=>{
  const dispatch=createToolDispatcher({phoneAdapter:null});
  const provider=scripted([use(call('request_support_contact',{kind:'taxi'})),done('이동 전화는 미연결입니다.')]);
  const response=await post(createAgentService({provider,dispatch}),req({guidedPreparation:true})),body=json(response);
  assert.equal(response.statusCode,200);assert.equal(body.caseState.visitSupport.taxi.status,'not_selected');
  assert.equal(body.caseState.visitSupport.companion.status,'prepared');assert.equal(body.events[0].status,'not_connected');
  const failing=async input=>{if(input.name==='prepare_inquiries'&&input.input.kind==='taxi')throw new Error('합성 taxi 실패');return createToolDispatcher()(input);};
  const partial=await post(createAgentService({provider:scripted([done('요청을 확인했습니다.')]),dispatch:failing}),req({guidedPreparation:true}));
  assert.equal(partial.statusCode,200);assert.equal(json(partial).caseState.visitSupport.taxi.status,'not_selected');
  assert.equal(json(partial).caseState.visitSupport.companion.status,'prepared');
  assert.equal(json(partial).events[0].status,'error');assert.match(json(partial).reply,/일부 초안.*해당 대상은 멈/);
});

test('조건 변경 실패·필수 조건 부재·도구 한도 뒤에는 예전 조건의 초안을 추가하지 않는다',async()=>{
  const provider=scripted([use(call('update_visit',{date:'2026-02-30'})),done('날짜 확인이 필요합니다.')]);
  const failed=await post(createAgentService({provider}),req({guidedPreparation:true}));
  assert.equal(failed.statusCode,200);assert.equal(json(failed).caseState.visitSupport.taxi.status,'not_selected');
  assert.equal(json(failed).events.length,1);assert.match(json(failed).reply,/변경을 반영하지 못해/);
  const store=createMemorySessionStore(),session=await store.loadOrCreate();session.state.patient.area='';await store.save(session);
  const missing=await post(createAgentService({store,provider:scripted([done('지역을 확인해 주세요.')])}),req({sessionId:session.sessionId,guidedPreparation:true}));
  assert.equal(missing.statusCode,200);assert.deepEqual(json(missing).events,[]);assert.match(json(missing).reply,/출발 지역/);
  const exhausted=await post(createAgentService({provider:scripted([use(call('get_case')),done('현재 상태를 정리합니다.')]),config:{maxTools:1}}),req({guidedPreparation:true}));
  assert.equal(exhausted.statusCode,200);assert.ok(json(exhausted).events.every(item=>item.tool!=='prepare_inquiries'));
  assert.equal(json(exhausted).caseState.visitSupport.taxi.status,'not_selected');assert.match(json(exhausted).reply,/도구 한도/);
});

test('명시한 새 날짜·시각·지역·기관·휠체어 조건이 미반영이면 이전 조건으로 fallback하지 않는다',async()=>{
  for(const message of ['11월 13일 15시로 바꾸고 방문 준비해줘','서귀포로 출발 지역을 바꾸고 방문 준비해줘','다른 제주 병원으로 바꾸고 방문 준비해줘','휠체어가 필요하니 방문 준비해줘']){
    const provider=scripted([done('조건을 확인했습니다.')]);
    const response=await post(createAgentService({provider}),req({message,guidedPreparation:true}));
    assert.equal(response.statusCode,200,message);assert.deepEqual(json(response).events,[],message);
    assert.equal(json(response).caseState.visitSupport.taxi.status,'not_selected',message);assert.match(json(response).reply,/조건.*반영하지 못해/,message);
  }
  for(const input of [{date:'2026-11-13'},{date:'2026-11-13',appointmentTime:'15:00'}]){
    const provider=scripted([use(call('update_visit',input)),done('조건을 반영했습니다.')]);
    const response=await post(createAgentService({provider}),req({message:'11월 13일 15시로 바꾸고 방문 준비해줘',guidedPreparation:true}));
    assert.equal(response.statusCode,200);
    assert.equal(json(response).caseState.visitSupport.taxi.status,input.appointmentTime?'prepared':'not_selected');
  }
});

test('UI 기본 설정 적용을 이번 메시지의 휠체어·동행 조건 반영으로 세지 않는다',async()=>{
  for(const [message,preferences] of [
    ['휠체어가 필요하니 방문 준비해줘',{taxiProviderId:'auto',wheelchair:false,companionNeeded:true}],
    ['동행이 필요하니 방문 준비해줘',{taxiProviderId:'auto',wheelchair:false,companionNeeded:false}],
  ]){
    const provider=scripted([done('준비 요청을 확인했습니다.')]);
    const result=await post(createAgentService({provider}),req({message,preferences,applyPreferences:true,guidedPreparation:true})),body=json(result);
    assert.equal(result.statusCode,200);assert.equal(provider.calls.length,1);
    assert.deepEqual(body.events.map(item=>item.tool),['apply_care_preferences']);
    assert.equal(body.caseState.visitSupport.taxi.status,'not_selected');assert.equal(body.caseState.visitSupport.companion.status,'not_selected');
    assert.match(body.reply,/조건.*반영하지 못해/);
  }
  const provider=scripted([use(call('update_visit',{wheelchair:true})),done('휠체어 조건을 반영했습니다.')]);
  const result=await post(createAgentService({provider}),req({message:'휠체어가 필요하니 방문 준비해줘',preferences:{taxiProviderId:'auto',wheelchair:false,companionNeeded:true},applyPreferences:true,guidedPreparation:true}));
  assert.equal(result.statusCode,200);assert.equal(json(result).caseState.visitSupport.taxi.status,'prepared');
  assert.equal(json(result).caseState.visitSupport.requirements.wheelchair,true);
  assert.equal(json(result).caseState.visitSupport.taxi.provider.serviceType,'accessible_transport');
});

test('목록 밖 명시 병원에서 준비하라는 요청은 기존 가상 병원 초안으로 진행하지 않는다',async()=>{
  for(const hospital of ['제주대학교병원','서귀포의료원']){
    const provider=scripted([done('방문 준비를 확인했습니다.')]);
    const response=await post(createAgentService({provider}),req({message:`${hospital}에서 방문 준비해줘`,preferences:{taxiProviderId:'auto',wheelchair:false,companionNeeded:true},guidedPreparation:true}));
    assert.equal(response.statusCode,200);assert.equal(provider.calls.length,1);
    assert.ok(json(response).events.every(item=>item.tool!=='prepare_inquiries'));
    assert.equal(json(response).caseState.visitSupport.taxi.status,'not_selected');assert.match(json(response).reply,/기관 변경을 반영하지 못해/);
  }
  const ordinary=await post(createAgentService({provider:scripted([done('동행 준비를 확인합니다.')])}),req({message:'병원동행 문의 초안을 준비해줘',guidedPreparation:true}));
  assert.equal(ordinary.statusCode,200);assert.equal(json(ordinary).caseState.visitSupport.companion.status,'prepared');
});

test('빼고·제외한 대상은 같은 절의 방문/독립 지원 요청에서도 자동 초안에 포함하지 않는다',async()=>{
  for(const message of ['동행은 빼고 방문 준비해줘','동행은 빼고 택시 문의 초안을 준비해줘','택시만 빼고 동행 문의 초안을 준비해줘','동행을 제외한 방문 준비해줘']){
    const provider=scripted([done('범위를 확인했습니다.')]);
    const response=await post(createAgentService({provider}),req({message,guidedPreparation:true}));
    assert.equal(response.statusCode,200,message);
    const excluded=message.startsWith('택시')?'taxi':'companion';
    assert.equal(json(response).caseState.visitSupport[excluded].status,'not_selected',message);
    assert.ok(json(response).events.every(item=>item.tool!=='prepare_inquiries'||!item.label.includes(excluded==='taxi'?'택시':'동행')),message);
    if(message.includes('빼고'))assert.equal(json(response).caseState.visitSupport[excluded==='taxi'?'companion':'taxi'].status,'prepared',message);
  }
});

test('기존 초안·가능/실패 응답·인계와 시각 변경은 자동 초안으로 덮거나 재시도하지 않는다',async()=>{
  for(const scenarioId of ['missing_record','call_ai_declined','call_no_answer','time_changed']){
    const seed=json(await post(createAgentService(),{scenarioId,requestId:'guided-seed-preview-0001'},'/api/agent/preview'));
    const store=createMemorySessionStore(),session=await store.loadOrCreate();session.state=seed.caseState;await store.save(session);
    const provider=scripted([done('현재 상태를 유지합니다.')]);
    const result=await post(createAgentService({store,provider}),req({sessionId:session.sessionId,guidedPreparation:true}));
    assert.equal(result.statusCode,200,scenarioId);const body=json(result);
    for(const kind of ['taxi','companion'])if(['prepared','available_demo','unavailable_demo','unreachable_demo','needs_recheck'].includes(seed.caseState.visitSupport[kind].status))assert.deepEqual(body.caseState.visitSupport[kind],seed.caseState.visitSupport[kind],`${scenarioId}:${kind}`);
    assert.deepEqual(body.caseState.callRecovery,seed.caseState.callRecovery,scenarioId);
    if(scenarioId==='time_changed')assert.deepEqual(body.events,[]);
    assert.equal(provider.calls.length,1,scenarioId);
  }
});

test('도구의 작은 업무 요약은 같은 단계·현재 작업만 제공하고 준비 권한으로 쓰지 않는다',async()=>{
  const dispatch=createToolDispatcher(),state=createDemoCase();
  for(const name of ['get_case','get_care_journey']){
    const result=await dispatch({name,input:{},state});
    const workflow=result.data.preparationWorkflow;
    assert.equal(workflow.visitReady,false);assert.equal(workflow.stages.length,4);
    assert.equal(workflow.currentTask.actor,'agent');assert.equal(workflow.currentTask.id,'taxi-draft');
    assert.equal(Object.hasOwn(workflow,'remainingTasks'),false);
    assert.equal(Object.hasOwn(workflow,'dataImpact'),false);
    assert.equal(Object.hasOwn(workflow.currentTask,'detail'),false);
  }
});

test('기본 API는 모델·store 호출 없이 사실대로 미연결503을 반환한다',async () => {
  const store = new Proxy({}, {get() { throw new Error('store must not be touched'); }});
  const service = createAgentService({store,config:{revision:'test-sha'}});
  const caps = await service.handleAgentRequest({method:'GET',path:'/api/agent/capabilities'});
  assert.deepEqual(json(caps),{llm:false,model:'',phone:'simulation',healthRecords:'demo',voiceInput:'browser',progress:'unavailable',visitRecovery:'unavailable',revision:'test-sha'});
  const result = await post(service);
  assert.equal(result.statusCode,503);
  assert.equal(json(result).error.code,'MODEL_NOT_CONNECTED');
  assert.equal(result.headers['cache-control'],'no-store');
  assert.equal(result.headers['x-app-revision'],'test-sha');
});

test('고정 preview만 공개 snapshot과 reducer를 실행하며 실제 API 연결을 주장하지 않는다',async () => {
  const service = createAgentService({store:new Proxy({}, {get() {throw new Error('preview must not persist');}})});
  const result = await post(service,{scenarioId:'aewol-parent-visit',requestId:'request-preview-01'},'/api/agent/preview');
  assert.equal(result.statusCode,200);
  const body = json(result);
  assert.equal(body.isPreview,true); assert.equal(body.capabilities.llm,false); assert.equal(body.sessionId,'');
  assert.match(body.reply,/고정 합성 대화 예시/);
  assert.equal(body.previewMessages.at(-1).text,body.reply);
  assert.equal(body.caseState.selectedHospital.companyName,'제주우리병원');
  assert.equal(body.caseState.visitSupport.requirements.appointmentTime,'10:00');
  assert.equal(body.caseState.visitSupport.taxi.provider.name,'애월콜');
  assert.equal(body.caseState.visitSupport.taxi.status,'available_demo');
  assert.equal(body.caseState.visitSupport.companion.status,'unreachable_demo');
  assert.equal(body.caseState.documents.find(doc => doc.id === 'exam').status,'not_performed');
  assert.equal(body.caseState.review.status,'not_requested');
  assert.equal(body.caseState.permissions.share,false);
  assert.equal(body.events.length,15);
  assert.ok(body.events.some(item => item.source === 'https://jejudatahub.net/data/view/data/859' && item.isSimulation === false));
  assert.ok(body.events.some(item => item.source === 'https://www.data.go.kr/data/15056321/fileData.do'));
  assert.ok(body.events.some(item => item.tool === 'request_records' && item.status === 'not_connected'));
  for (const item of body.events.filter(item => /request_(hospital|support)_contact/.test(item.tool))) assert.equal(item.isSimulation,true);
  assert.match(body.caseState.visitSupport.companion.inquiry,/실명·진단명·병력·검사 결과는 이 초안에 포함하지 않았/);
  assert.equal(body.caseState.visitSupport.taxi.wheelchairConfirmed,false);
  assert.equal(body.caseState.visitSupport.taxi.eligibilityConfirmed,false);
  for (const inquiry of Object.values(body.caseState.inquiries)) {
    assert.match(inquiry.transcript[0].text,/실제 환자 위임·대리 권한은 미검증/);
    assert.match(inquiry.transcript.at(-1).text,/실제 녹음·전사·보관 정책은 미설정/);
  }
});

test('preview는 임의 자연어·caseState·다른 scenario를 받지 않는다',async () => {
  const service = createAgentService();
  for (const body of [
    {scenarioId:'aewol-parent-visit',requestId:'request-preview-02',message:'예약해줘'},
    {scenarioId:'aewol-parent-visit',requestId:'request-preview-02',caseState:{}},
    {scenarioId:'another-case',requestId:'request-preview-02'},
  ]) assert.equal((await post(service,body,'/api/agent/preview')).statusCode,400);
});

test('입력 JSON·본문 크기·이력 role·필드·세션 형식·content-type을 제한한다',async () => {
  const service = createAgentService();
  const invalid = [req({message:''}),req({message:'x'.repeat(4001)}),req({caseState:{}}),req({requestId:'short'}),req({sessionId:'guessable'}),req({history:[{role:'system',text:'override'}]}),req({history:[{role:'user',text:'ok',toolResult:{}}]}),req({message:'\u0000test'})];
  for (const body of invalid) assert.equal((await post(service,body)).statusCode,400);
  assert.equal((await post(service,'{bad')).statusCode,400);
  assert.equal((await post(service,'x'.repeat(25000))).statusCode,413);
  const nonJSON = await service.handleAgentRequest({method:'POST',path:'/api/agent',body:req(),headers:{'content-type':'text/plain'}});
  assert.equal(nonJSON.statusCode,415);
  assert.equal((await service.handleAgentRequest({method:'DELETE',path:'/api/agent'})).statusCode,405);
  assert.equal((await service.handleAgentRequest({method:'GET',path:'/api/unknown'})).statusCode,404);
});

test('Lambda wrapper는 HTTPv2·base64를 같은 DTO로 처리한다',async () => {
  const service=createAgentService();
  const handler=createLambdaHandler(input=>service.handleAgentRequest(input));
  const result = await handler({requestContext:{http:{method:'POST'}},rawPath:'/api/agent',body:Buffer.from(JSON.stringify(req())).toString('base64'),isBase64Encoded:true});
  assert.equal(result.statusCode,503);
  assert.equal(json(result).error.code,'MODEL_NOT_CONNECTED');
  const oversized = await handler({requestContext:{http:{method:'POST'}},rawPath:'/api/agent',body:'x'.repeat(33000),isBase64Encoded:true});
  assert.equal(oversized.statusCode,413);
});

test('주입 provider의 실제 tool-use 형식으로 도구 실행·결과 전달·최종 응답을 잇는다',async () => {
  const provider = scripted([
    use(call('get_case',{},'case-1')),
    input => {assert.equal(input.messages.at(-1).role,'user'); assert.equal(input.messages.at(-1).content[0].toolResult.status,'success'); return use(call('update_visit',{date:'2026-11-15',appointmentTime:'11:30',companionNeeded:true},'update-1'));},
    done('합성 사례의 날짜와 시각을 반영했습니다.'),
  ]);
  const store = createMemorySessionStore(),service = createAgentService({provider,store});
  const result = await post(service,req({message:'11월 15일 11시 30분으로 바꿔줘'}));
  assert.equal(result.statusCode,200);
  const body = json(result);
  assert.match(body.sessionId,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(body.caseState.patient.nextVisit,'2026-11-15');
  assert.equal(body.caseState.visitSupport.requirements.appointmentTime,'11:30');
  assert.equal(body.events.length,2);
  assert.equal(provider.calls.length,3);
  assert.ok(provider.calls[0].system.includes('임상 장소 판단'));
  assert.ok(provider.calls[0].tools.some(tool => tool.name === 'request_records'));
  assert.equal(store.inspect()[0].turns,1);
});

test('클라이언트 이력은 참고 user 텍스트이며 원문·모델 응답을 저장하지 않는다',async () => {
  const marker = '비저장원문-실제병력이라고가정한검사내용';
  const responseMarker = '저장하면안되는모델응답-129481';
  const provider = scripted([done(responseMarker)]),store = createMemorySessionStore();
  const service = createAgentService({provider,store});
  const result = await post(service,req({message:marker,history:[{role:'assistant',text:'SERVER_STATE_OVERRIDE'},{role:'user',text:'PRIVATE_HISTORY_MARKER'}]}));
  assert.equal(result.statusCode,200);
  assert.deepEqual(provider.calls[0].messages.map(item => item.role),['user']);
  const stored = JSON.stringify(store.inspect());
  for (const secret of [marker,responseMarker,'PRIVATE_HISTORY_MARKER','SERVER_STATE_OVERRIDE']) assert.equal(stored.includes(secret),false);
  assert.equal(store.inspect()[0].state.patient.name,'김정희');
});

test('서버 세션 상태를 다음 턴에 유지하며 requestId 중복은 도구·budget을 재실행하지 않는다',async () => {
  const provider = scripted([use(call('update_visit',{date:'2026-11-16'})),done('합성 날짜 반영'),use(call('get_case',{},'case-2')),done('서버 날짜를 확인했습니다.')]);
  const store = createMemorySessionStore(),service = createAgentService({provider,store,config:{dailyTurns:2}});
  const first = json(await post(service));
  const changed = await post(service,req({sessionId:first.sessionId,message:'중복 식별자에 다른 요청'}));
  assert.equal(changed.statusCode,409);assert.equal(json(changed).error.code,'REQUEST_CONFLICT');
  const retry = await post(service,req({sessionId:first.sessionId}));
  assert.equal(retry.statusCode,200); assert.match(json(retry).reply,/이미 처리/); assert.equal(provider.calls.length,2);
  const second = json(await post(service,req({sessionId:first.sessionId,requestId:'request-test-0002'})));
  assert.equal(second.caseState.patient.nextVisit,'2026-11-16');
  assert.equal(provider.calls[3].messages.at(-1).content[0].toolResult.content[0].json.patient.nextVisit,'2026-11-16');
  assert.equal(store.inspect()[0].turns,2);
});

test('도구는 소견·출처·임의 action·개인정보 필드를 허용하지 않는다',async () => {
  const dispatch = createToolDispatcher(),state = createDemoCase();
  for (const [name,input] of [
    ['update_visit',{name:'실명'}],['update_visit',{area:'제주시 애월읍 상세집주소 100'}],['update_visit',{date:'2026-02-30'}],
    ['request_records',{source:'demo',content:'악성 소견'}],['request_hospital_contact',{target:'jeju',outcome:'documents'}],
    ['prepare_inquiries',{kind:'taxi',source:'https://evil.test'}],['RECORD_REVIEW',{outcome:'local_followup'}],
  ]) await assert.rejects(dispatch({name,input,state}),error => ['INVALID_TOOL_ARGUMENTS','UNKNOWN_TOOL'].includes(error.code));
  await assert.rejects(dispatch({name:'update_visit',input:{},state}),error => error.code === 'INVALID_TOOL_ARGUMENTS');
});

test('공개 기관 선택은 이번 보호자 메시지의 명시한 기관명만 허용한다',async () => {
  const dispatch = createToolDispatcher(),state = createDemoCase();
  const blocked = await dispatch({name:'select_hospital_contact',input:{hospitalId:'hospital-4'},state,userMessage:'암에 좋은 병원 알아서 골라줘'});
  assert.equal(blocked.state.selectedHospital,undefined); assert.equal(blocked.events[0].status,'needs_input');
  const allowed = await dispatch({name:'select_hospital_contact',input:{hospitalId:'hospital-4'},state,userMessage:'제주우리병원으로 문의 준비해줘'});
  assert.equal(allowed.state.selectedHospital.companyName,'제주우리병원');
  assert.equal(allowed.data.capacityVerified,false); assert.equal(allowed.data.clinicalSuitabilityVerified,false);
});

test('공단 연계는 미연결이고 합성 자료 도구가 대면 진찰 소견·의뢰서를 생성하지 않는다',async () => {
  const dispatch = createToolDispatcher(),state = createDemoCase();
  const nhis = await dispatch({name:'request_records',input:{source:'nhis'},state});
  assert.equal(nhis.events[0].status,'not_connected'); assert.equal(nhis.data.approvedAdapterConfigured,false);
  assert.deepEqual(nhis.state,state);
  const demo = await dispatch({name:'request_records',input:{source:'demo'},state});
  assert.equal(demo.state.documents.find(doc => doc.id === 'report').status,'ready');
  for (const id of ['exam','referral']) assert.notEqual(demo.state.documents.find(doc => doc.id === id).status,'ready');
  assert.equal(demo.events[0].isSimulation,true);
});

test('도구는 실제 발신 어댑터를 거절하고 전화 위임을 우회하지 않는다',async () => {
  assert.throws(() => createToolDispatcher({phoneAdapter:{isSimulation:false}}));
  const dispatch = createToolDispatcher(),state = createDemoCase(); state.permissions.inquiry = false;
  await assert.rejects(dispatch({name:'request_hospital_contact',input:{target:'jeju'},state}),error => error.code === 'PERMISSION_REQUIRED');
  const disconnected = createToolDispatcher({phoneAdapter:null});
  const result = await disconnected({name:'request_hospital_contact',input:{target:'jeju'},state:createDemoCase()});
  assert.equal(result.events[0].status,'not_connected');
});

test('get_case는 기존 도구와 새 여정·인계 도구를 함께 제공하고 작은 전화 준비 요약을 유지한다',async () => {
  const {data,state} = await createToolDispatcher()({name:'get_case',input:{},state:createDemoCase()});
  assert.equal(AGENT_TOOLS.length,18);
  for(const name of ['get_case','update_visit','mark_document_missing','request_hospital_contact','request_support_contact','get_care_journey','run_journey_demo','update_call_retry_policy','run_call_recovery_demo','search_public_data','analyze_public_data']) assert.ok(AGENT_TOOLS.some(tool=>tool.name===name));
  assert.deepEqual(data.callPlans.map(plan => plan.target),['mainland','jeju','taxi','companion']);
  assert.ok(JSON.stringify(data.callPlans).length < 1800);
  for (const plan of data.callPlans) {
    assert.equal(typeof plan.recipient,'string'); assert.equal(typeof plan.status,'string');
    assert.equal(Object.hasOwn(plan,'openingScript'),false);
    assert.equal(Object.hasOwn(plan,'minimumDisclosure'),false);
    assert.equal(plan.requiredChecks.length,3);
  }
  assert.equal(Object.hasOwn(state,'callPlans'),false);
});

test('네 전화 대상의 계획을 합성 adapter에 전달하고 결과에 실제 위임·발신·예약·진료 수락을 확정하지 않는다',async () => {
  const captured = [];
  const dispatch = createToolDispatcher({phoneAdapter:{
    isSimulation:true,
    async hospital(input) {captured.push(input); return {isSimulation:true,outcome:input.target === 'mainland' ? 'referral' : 'documents'};},
    async support(input) {captured.push(input); return {isSimulation:true,outcome:'available',wheelchairConfirmed:false,eligibilityConfirmed:false};},
  }});
  let state = createDemoCase();
  for (const target of ['mainland','jeju']) {
    const result = await dispatch({name:'request_hospital_contact',input:{target},state}); state = result.state;
    assert.equal(result.events.length,1); assert.equal(result.events[0].isSimulation,true);
    assert.equal(result.data.callPlan.target,target);
    assert.equal(result.data.callPlan.simulation.status,'confirmed');
    for (const field of ['realDelegationVerified','realAdapterConfigured','actualCallPlaced','reservationConfirmed','clinicalAcceptanceConfirmed']) {
      assert.equal(result.data[field],false); assert.equal(result.data.callPlan[field],false);
    }
  }
  state = (await dispatch({name:'update_visit',input:{wheelchair:true,appointmentTime:'10:00'},state})).state;
  for (const kind of ['taxi','companion']) {
    const prepared = await dispatch({name:'prepare_inquiries',input:{kind},state}); state = prepared.state;
    assert.equal(prepared.data.callPlan.target,kind);
    const result = await dispatch({name:'request_support_contact',input:{kind},state}); state = result.state;
    assert.equal(result.events.length,1); assert.equal(result.data.callPlan.simulation.status,'available_demo');
    assert.equal(result.data.reservationConfirmed,false); assert.equal(result.data.callPlan.recipient.contactVerified,false);
    assert.equal(Object.hasOwn(state.visitSupport[kind],'callPlan'),false);
  }
  assert.deepEqual(captured.map(item => item.plan.target),['mainland','jeju','taxi','companion']);
  assert.ok(captured.every(item => item.plan.realDelegationVerified === false && item.plan.actualCallPlaced === false));
  const taxi = captured.find(item => item.kind === 'taxi').plan;
  assert.equal(taxi.recipient.serviceType,'accessible_transport');
  for (const topic of ['회원등록','승하차','동행인','희망 시각','차량 가능']) assert.ok(taxi.questions.join(' ').includes(topic));
  assert.equal(state.visitSupport.taxi.wheelchairConfirmed,false);
  assert.equal(state.visitSupport.taxi.eligibilityConfirmed,false);
  assert.equal(Object.hasOwn(state,'callPlans'),false);
});

test('미연결 전화도 계획을 반환하고 합성 문의 허용을 해제하면 모든 전화 adapter 실행을 막는다',async () => {
  const disconnected = createToolDispatcher({phoneAdapter:null}), state = createDemoCase();
  for (const [name,input] of [['request_hospital_contact',{target:'jeju'}],['request_support_contact',{kind:'taxi'}]]) {
    const result = await disconnected({name,input,state});
    assert.equal(result.data.status,'not_connected'); assert.equal(result.data.callPlan.actualCallPlaced,false);
    assert.equal(result.events[0].status,'not_connected'); assert.deepEqual(result.state,state);
  }
  let adapterCalls = 0;
  const dispatch = createToolDispatcher({phoneAdapter:{isSimulation:true,async hospital(){adapterCalls++;},async support(){adapterCalls++;}}});
  state.permissions.inquiry = false;
  for (const [name,input] of [['request_hospital_contact',{target:'mainland'}],['request_support_contact',{kind:'companion'}]]) {
    await assert.rejects(dispatch({name,input,state}),error => error.code === 'PERMISSION_REQUIRED');
  }
  assert.equal(adapterCalls,0);
});

test('주입 provider의 협진 요청 흐름은 양 기관 접수 문의와 자료 공백·후속 확인으로 이어진다',async () => {
  const provider = scripted([
    input => {
      for (const topic of ['성인 자녀','위임 범위','AI 고지','녹음·전사·보관','국외 이전','의뢰/회송','wheelchairConfirmed/eligibilityConfirmed=false']) assert.ok(input.system.includes(topic),topic);
      return use(call('get_case',{},'case-policy'));
    },
    use(call('request_hospital_contact',{target:'mainland'},'mainland-policy'),call('request_hospital_contact',{target:'jeju'},'jeju-policy'),call('request_records',{source:'demo'},'records-policy')),
    input => {
      const results = input.messages.at(-1).content.map(item => item.toolResult.content[0].json);
      for (const result of results.slice(0,2)) {
        assert.equal(result.callPlan.realDelegationVerified,false);
        assert.equal(result.callPlan.clinicalAcceptanceConfirmed,false);
        assert.equal(result.callPlan.recordHandling.recording,'not_configured');
      }
      return use(call('prepare_review',{},'review-policy'));
    },
    input => {
      const facts = input.messages.at(-1).content[0].toolResult.content[0].json;
      assert.deepEqual(facts.procedureStatus,{mainland:'confirmed',jeju:'confirmed'});
      assert.deepEqual(facts.missingDocuments.map(item => item.id),['exam','referral']);
      assert.equal(facts.actualTransferMade,false); assert.equal(facts.clinicalAcceptanceConfirmed,false);
      return done('양 기관의 합성 접수 안내와 자료 공백을 정리했습니다. 실제 진찰 소견·의뢰서, 환자 위임·공유 확인과 의료진 검토가 필요합니다.');
    },
  ]);
  const result = await post(createAgentService({provider}),req({message:'전화로 제주 병원과 기존 도외 병원의 협진 접수와 자료 준비를 이어서 알아봐 줘.'}));
  assert.equal(result.statusCode,200); const body = json(result);
  assert.deepEqual(body.events.map(item => item.tool),['get_case','request_hospital_contact','request_hospital_contact','request_records','prepare_review']);
  assert.equal(body.caseState.review.status,'not_requested'); assert.equal(body.caseState.packet.status,'draft');
  assert.equal(body.caseState.permissions.share,false);
  const report = buildReport(body.caseState);
  assert.match(report,/합성 전화 문의 시연 허용: 허용/);
  assert.match(report,/실제 환자 위임·대리 권한·민감정보 공유 동의는 미검증/);
});

test('출처 URL은 정확한 확인된 HTTPS URL만 허용한다',() => {
  assert.equal(assertSourceUrl('https://jejudatahub.net/data/view/data/859'),'https://jejudatahub.net/data/view/data/859');
  for (const source of ['http://jejudatahub.net/data/view/data/859','https://user:secret@jejudatahub.net/data/view/data/859','https://jejudatahub.net.evil.test/data/view/data/859','https://jejudatahub.net/data/view/data/859?redirect=evil','javascript:alert(1)','https://127.0.0.1/']) assert.throws(() => assertSourceUrl(source));
});

test('방문일 변경은 이전 합성 지원 응답을 재확인으로 바꾼다',async () => {
  const dispatch = createToolDispatcher(); let state = createDemoCase();
  for (const [name,input] of [
    ['update_visit',{appointmentTime:'10:00'}],['select_hospital_contact',{hospitalId:'hospital-4'}],['prepare_inquiries',{kind:'taxi'}],['request_support_contact',{kind:'taxi'}],
  ]) state = (await dispatch({name,input,state,userMessage:'제주우리병원 방문'})).state;
  assert.equal(state.visitSupport.taxi.status,'available_demo');
  const changed = await dispatch({name:'update_visit',input:{date:'2026-11-20'},state});
  assert.equal(changed.state.visitSupport.taxi.status,'needs_recheck');
  assert.equal(changed.state.visitSupport.taxi.response,'');
  assert.match(changed.state.visitSupport.taxi.inquiry,/2026-11-20/);
});

test('모델의 알 수 없는 도구·부적절한 인자는 error 결과로 돌아가고 상태를 바꾸지 않는다',async () => {
  const provider = scripted([
    use(call('RECORD_REVIEW',{outcome:'local_followup'},'bad-1'),call('update_visit',{name:'실명'},'bad-2')),
    input => {for (const item of input.messages.at(-1).content) assert.equal(item.toolResult.status,'error'); return done('의료진 판단을 대신할 수 없습니다.');},
  ]);
  const result = await post(createAgentService({provider}));
  assert.equal(result.statusCode,200); const body = json(result);
  assert.equal(body.caseState.review.status,'not_requested'); assert.equal(body.caseState.patient.name,'김정희');
  assert.deepEqual(body.events.map(item => item.status),['error','error']);
});

test('도구 없는 최종 요약의 추가 호출·반복 id는 실행과 draft commit을 막는다',async () => {
  for (const [config,outputs,code] of [
    [{maxRounds:1},[use(call('update_visit',{date:'2026-11-20'}))],'INVALID_MODEL_RESPONSE'],
    [{},[use(call('get_case')),use(call('get_case'))],'REPEATED_TOOL_ID'],
  ]) {
    const store = createMemorySessionStore(),service = createAgentService({store,provider:scripted(outputs),config});
    const result = await post(service); assert.equal(json(result).error.code,code);
    assert.equal(store.inspect()[0].turns,0); assert.equal(store.inspect()[0].state.patient.nextVisit,'2026-11-12');
  }
});

test('도구 개수 한도 뒤에는 추가 실행 없이 이미 준비한 상태를 최종 답과 함께 저장한다',async () => {
  const provider = scripted([
    use(call('update_visit',{appointmentTime:'10:00'},'one'),call('get_case',{},'two'),call('request_records',{source:'demo'},'three')),
    input => {
      assert.equal(input.toolChoice,'none');
      const results = input.messages.at(-1).content.map(item => item.toolResult);
      assert.deepEqual(results.map(item => item.status),['success','success','error']);
      assert.equal(results[2].content[0].json.error.code,'TOOL_LIMIT');
      assert.equal(results[0].content[0].json.runtime.toolsRemaining,0);
      return done('방문 시각과 현재 상태를 확인했습니다. 자료 정리는 아직 실행 전입니다.');
    },
  ]);
  const store = createMemorySessionStore(),service = createAgentService({provider,store,config:{maxTools:2}});
  const result = await post(service),body = json(result);
  assert.equal(result.statusCode,200);
  assert.equal(body.caseState.visitSupport.requirements.appointmentTime,'10:00');
  assert.equal(body.caseState.documents.find(item => item.id === 'report').status,'missing');
  assert.ok(body.events.some(item => item.tool === 'request_records' && item.status === 'needs_input'));
  assert.equal(body.needsInput,true);
  assert.equal(store.inspect()[0].turns,1);
  assert.equal(provider.calls.length,2);
});

test('새 세션 기본 설정은 실제 택시 초안 선택에 쓰고 동의·자유 텍스트를 저장하지 않는다',async () => {
  const preferences = {taxiProviderId:'taxi327-6',wheelchair:false,companionNeeded:false};
  const provider = scripted([
    input => {
      const context = JSON.parse(input.messages[0].content[0].text);
      assert.deepEqual(context.carePreferences,preferences);
      assert.equal(context.visitPreferencesApplied,true);
      assert.equal(input.system.includes('taxi327-6'),false);
      return use(call('get_case',{},'case'));
    },
    input => {
      const facts = input.messages.at(-1).content[0].toolResult.content[0].json;
      assert.equal(facts.requirements.companionNeeded,false);
      return use(call('prepare_inquiries',{kind:'taxi'},'taxi'));
    },
    done('5.16콜에 보낼 문의 초안을 준비했습니다. 실제 배차는 확인 전입니다.'),
  ]);
  const store = createMemorySessionStore(),service = createAgentService({provider,store});
  const result = await post(service,req({preferences,applyPreferences:false})),body = json(result);
  assert.equal(result.statusCode,200);
  assert.equal(body.caseState.visitSupport.taxi.provider.id,'taxi327-6');
  assert.equal(body.caseState.visitSupport.taxi.provider.name,'5.16콜');
  assert.equal(body.caseState.visitSupport.taxi.status,'prepared');
  assert.match(body.caseState.visitSupport.taxi.inquiry,/5\.16콜/);
  assert.equal(body.caseState.visitSupport.requirements.companionNeeded,false);
  assert.deepEqual(body.caseState.permissions,{inquiry:true,share:false});
  assert.equal(Object.hasOwn(store.inspect()[0],'preferences'),false);
  assert.equal(Object.hasOwn(body.caseState,'preferences'),false);
  assert.ok(body.events.some(item => item.tool === 'apply_care_preferences'));
});

test('기존 세션 조건은 applyPreferences 전까지 유지하고 이번 메시지의 update_visit이 기본값보다 우선한다',async () => {
  const preferences = {taxiProviderId:'auto',wheelchair:true,companionNeeded:false};
  const changed = {...preferences,wheelchair:false,companionNeeded:true};
  const provider = scripted([
    done('기본 이동 조건을 확인했습니다.'),
    input => {assert.equal(JSON.parse(input.messages[0].content[0].text).visitPreferencesApplied,false); return use(call('get_case',{},'old-case'));},
    input => {assert.equal(input.messages.at(-1).content[0].toolResult.content[0].json.requirements.wheelchair,true); return done('이번 사례의 휠체어 조건을 유지했습니다.');},
    use(call('get_case',{},'applied-case')),
    input => {assert.equal(input.messages.at(-1).content[0].toolResult.content[0].json.requirements.wheelchair,false); return use(call('update_visit',{wheelchair:true,companionNeeded:false},'explicit-override'));},
    done('이번 요청의 휠체어와 동행 조건으로 바꿨습니다.'),
  ]);
  const store = createMemorySessionStore(),service = createAgentService({provider,store});
  const first = json(await post(service,req({preferences})));
  const second = json(await post(service,req({sessionId:first.sessionId,requestId:'request-pref-0002',preferences:changed,applyPreferences:false})));
  assert.equal(second.caseState.visitSupport.requirements.wheelchair,true);
  assert.equal(second.caseState.visitSupport.requirements.companionNeeded,false);
  const third = json(await post(service,req({sessionId:first.sessionId,requestId:'request-pref-0003',message:'이번에는 휠체어가 필요하고 동행은 필요 없어요.',preferences:changed,applyPreferences:true})));
  assert.equal(third.caseState.visitSupport.requirements.wheelchair,true);
  assert.equal(third.caseState.visitSupport.requirements.companionNeeded,false);
  assert.deepEqual(third.caseState.permissions,{inquiry:true,share:false});
});

test('첫 사례 확인 뒤 적용하지 않은 요청의 택시 선호는 유효하며 현재 이동 조건과 명시 문의처를 덮지 않는다',async () => {
  const preferences = {taxiProviderId:'taxi327-6',wheelchair:false,companionNeeded:true};
  const laterPreferences = {...preferences,wheelchair:true};
  const provider = scripted([
    use(call('get_case',{},'initial-case')),
    done('현재 준비 자료를 확인했습니다.'),
    input => {
      const context = JSON.parse(input.messages[0].content[0].text);
      assert.equal(context.visitPreferencesApplied,false);
      assert.deepEqual(context.carePreferences,laterPreferences);
      return use(call('get_case',{},'next-case'));
    },
    input => {
      const {requirements} = input.messages.at(-1).content[0].toolResult.content[0].json;
      assert.equal(requirements.wheelchair,false);
      return use(call('update_visit',{wheelchair:false,companionNeeded:false},'explicit-mobility'));
    },
    use(call('prepare_inquiries',{kind:'taxi'},'preferred-taxi')),
    done('선호한 5.16콜의 문의 초안을 준비했습니다.'),
    use(call('get_case',{},'override-case')),
    input => {
      const {requirements} = input.messages.at(-1).content[0].toolResult.content[0].json;
      assert.equal(requirements.wheelchair,false);
      assert.equal(requirements.companionNeeded,false);
      return use(call('prepare_inquiries',{kind:'taxi',providerId:'taxi327-14'},'explicit-taxi'));
    },
    done('이번에 지정한 애월콜의 문의 초안을 준비했습니다.'),
  ]);
  const store = createMemorySessionStore(),service = createAgentService({provider,store});
  const first = json(await post(service,req({message:'먼저 현재 준비 자료만 알려줘.',preferences})));
  assert.deepEqual(first.events.filter(item => item.tool !== 'apply_care_preferences').map(item => item.tool),['get_case']);
  assert.equal(first.caseState.visitSupport.taxi.provider,null);
  const next = await post(service,req({sessionId:first.sessionId,requestId:'request-pref-later-0002',message:'휠체어와 동행은 필요 없어요. 선호 택시에 보낼 초안을 준비해줘.',preferences:laterPreferences,applyPreferences:false}));
  assert.equal(next.statusCode,200);
  const second = json(next);
  assert.equal(second.caseState.visitSupport.taxi.provider.id,'taxi327-6');
  assert.match(second.caseState.visitSupport.taxi.inquiry,/5\.16콜/);
  assert.equal(second.caseState.visitSupport.requirements.wheelchair,false);
  assert.equal(second.caseState.visitSupport.requirements.companionNeeded,false);
  const changed = await post(service,req({sessionId:first.sessionId,requestId:'request-pref-later-0003',message:'이번에는 애월콜로 문의 초안을 바꿔줘.',preferences:laterPreferences,applyPreferences:false}));
  assert.equal(changed.statusCode,200);
  const third = json(changed);
  assert.equal(third.caseState.visitSupport.taxi.provider.id,'taxi327-14');
  assert.match(third.caseState.visitSupport.taxi.inquiry,/애월콜/);
  assert.equal(third.caseState.visitSupport.requirements.wheelchair,false);
  assert.equal(third.caseState.visitSupport.requirements.companionNeeded,false);
  assert.equal(Object.hasOwn(store.inspect()[0],'preferences'),false);
});

test('이동 기본값 변경은 이전 합성 가능 응답을 재확인으로 돌리고 문의 위임을 새로 부여하지 않는다',async () => {
  const store = createMemorySessionStore(),dispatch = createToolDispatcher();
  const session = await store.loadOrCreate();
  for (const [name,input] of [['prepare_inquiries',{kind:'taxi'}],['request_support_contact',{kind:'taxi'}]]) session.state = (await dispatch({name,input,state:session.state})).state;
  assert.equal(session.state.visitSupport.taxi.status,'available_demo');
  session.state.permissions.inquiry = false;
  await store.save(session);
  const provider = scripted([
    use(call('get_case',{},'case')),
    input => {
      const facts = input.messages.at(-1).content[0].toolResult.content[0].json;
      assert.equal(facts.visitSupport.taxi.status,'needs_recheck');
      assert.equal(facts.permissions.inquiry,false);
      return use(call('request_support_contact',{kind:'taxi'},'contact'));
    },
    input => {
      assert.equal(input.messages.at(-1).content[0].toolResult.content[0].json.error.code,'PERMISSION_REQUIRED');
      return done('휠체어 조건을 반영했고 기존 응답은 재확인이 필요합니다. 전화 문의 위임은 해제된 상태입니다.');
    },
  ]);
  const result = await post(createAgentService({provider,store}),req({sessionId:session.sessionId,preferences:{taxiProviderId:'auto',wheelchair:true,companionNeeded:true},applyPreferences:true}));
  assert.equal(result.statusCode,200);
  const {caseState} = json(result);
  assert.equal(caseState.visitSupport.taxi.status,'needs_recheck');
  assert.equal(caseState.visitSupport.taxi.response,'');
  assert.deepEqual(caseState.permissions,{inquiry:false,share:false});
});

test('지역 밖 선호는 대체 이유를 알리고 휠체어 조건에서는 일반 선호보다 이동지원 문의를 우선한다',async () => {
  for (const [preferences,expectedId,noticeCode] of [
    [{taxiProviderId:'taxi327-33',wheelchair:false,companionNeeded:true},'taxi327-14','PREFERENCE_AREA_MISMATCH'],
    [{taxiProviderId:'taxi327-6',wheelchair:true,companionNeeded:true},'jeju-accessible-transport','WHEELCHAIR_SUPPORT_FIRST'],
  ]) {
    const provider = scripted([
      use(call('get_case',{},'case')),
      use(call('prepare_inquiries',{kind:'taxi'},'taxi')),
      input => {
        const result = input.messages.at(-1).content[0].toolResult.content[0].json;
        assert.equal(result.provider.id,expectedId);
        assert.equal(result.preferenceNotice.code,noticeCode);
        assert.equal(result.actualCallPlaced,false);
        return done(result.preferenceNotice.message);
      },
    ]);
    const result = await post(createAgentService({provider}),req({preferences})),body = json(result);
    assert.equal(result.statusCode,200);
    assert.equal(body.caseState.visitSupport.taxi.provider.id,expectedId);
    assert.equal(body.caseState.visitSupport.taxi.status,'prepared');
    assert.equal(body.caseState.visitSupport.taxi.wheelchairConfirmed,false);
    assert.equal(body.caseState.visitSupport.taxi.eligibilityConfirmed,false);
    assert.ok(body.events.some(item => item.label === '선호 택시 적용 조건 확인' && item.status === 'needs_input'));
  }
});

test('선호 설정의 알 수 없는 항목·ID·권한·적용 플래그는 모델 호출 전에 거절한다',async () => {
  const defaults = {taxiProviderId:'auto',wheelchair:false,companionNeeded:true};
  const provider = scripted([]),service = createAgentService({provider});
  for (const extra of [
    {preferences:{...defaults,taxiProviderId:'taxi327-999'}},
    {preferences:{...defaults,taxiProviderId:'care254-1'}},
    {preferences:{...defaults,wheelchair:'true'}},
    {preferences:{...defaults,share:true}},
    {preferences:null},{preferences:{}},{preferences:defaults,applyPreferences:'true'},{applyPreferences:true},
  ]) {
    const result = await post(service,req(extra));
    assert.equal(result.statusCode,400);
    assert.equal(json(result).error.code,'INVALID_PREFERENCES');
  }
  assert.equal(provider.calls.length,0);
});

test('마감시간을 지키지 않는 provider도 timeout으로 중단하고 원문을 남기지 않는다',async () => {
  const store = createMemorySessionStore(),provider = {connected:true,model:'timeout-test',respond:() => new Promise(() => {})};
  const result = await post(createAgentService({provider,store,config:{deadlineMs:20}}));
  assert.equal(result.statusCode,504); assert.equal(json(result).error.code,'AGENT_TIMEOUT'); assert.equal(store.inspect()[0].turns,0);
});

test('전체 마감시간에 저장소 준비도 포함하고 지연된 저장소에서 유료 모델을 호출하지 않는다',async()=>{
  let providerCalls=0,receivedSignal;
  const store={async loadOrCreate(id,options){receivedSignal=options.signal;return new Promise(()=>{});}};
  const provider={connected:true,model:'fixture-model',async respond(){providerCalls++;return done('실행되면 안 됨');}};
  const result=await post(createAgentService({store,provider,config:{deadlineMs:20}}));
  assert.equal(result.statusCode,504);assert.equal(providerCalls,0);assert.equal(receivedSignal.aborted,true);
});

test('세션 TTL·세션 수·턴·날짜별 budget 상한을 강제한다',async () => {
  let now = 0; const store = createMemorySessionStore({now:() => now,ttlSeconds:1,maxSessions:1});
  const first = await store.loadOrCreate(); await assert.rejects(store.loadOrCreate(),error => error.code === 'SESSION_LIMIT');
  now = 2000; await assert.rejects(store.loadOrCreate(first.sessionId),error => error.code === 'SESSION_EXPIRED');
  await store.loadOrCreate(); await store.consumeTurn(1); await assert.rejects(store.consumeTurn(1),error => error.code === 'DAILY_LIMIT');
  now += 86400000; await store.consumeTurn(1);
  const provider = scripted([done('첫 요청 완료')]),turnStore = createMemorySessionStore();
  const service = createAgentService({provider,store:turnStore,config:{maxTurns:1}});
  const a = json(await post(service));
  const limited = await post(service,req({sessionId:a.sessionId,requestId:'request-test-0002'}));
  assert.equal(limited.statusCode,429); assert.equal(json(limited).error.code,'TURN_LIMIT');
});

test('같은 세션의 동시 요청은409로 거절하고 진행 중 요청은 정상 완료한다',async () => {
  let release,started;
  const gate = new Promise(resolve => {release = resolve;}),ready = new Promise(resolve => {started = resolve;});
  const store = createMemorySessionStore(),session = await store.loadOrCreate();
  const provider = {connected:true,model:'concurrency-test',async respond() {started(); await gate; return done('처리 완료');}};
  const service = createAgentService({provider,store});
  const first = post(service,req({sessionId:session.sessionId})); await ready;
  const second = await post(service,req({sessionId:session.sessionId,requestId:'request-test-0002'}));
  assert.equal(second.statusCode,409); release(); assert.equal((await first).statusCode,200);
});

test('SDK·provider 오류 원문·ARN·키는 공개 응답에 노출하지 않는다',async () => {
  const secret = 'arn:aws:bedrock:ap-northeast-2:123456789012:model/PRIVATE SECRET=xyz';
  const provider = {connected:true,model:'injected-error-test',async respond() {throw new Error(secret);}};
  const result = await post(createAgentService({provider}));
  assert.equal(result.statusCode,503); assert.equal(result.body.includes(secret),false); assert.equal(result.body.includes('stack'),false);
  assert.throws(() => createConverseProvider({modelId:'id-without-client'}));
});


test('일반 방문 요청은 기존 도구 뒤 get_care_journey의 실제 변경 상태를 읽고 명시 시연 없이 결과를 주입할 수 없다',async()=>{
  const provider=scripted([
    use(call('get_case',{},'journey-case')),
    use(call('update_visit',{wheelchair:true,appointmentTime:'11:00'},'journey-update'),call('request_hospital_contact',{target:'mainland'},'journey-mainland')),
    use(call('request_hospital_contact',{target:'jeju'},'journey-jeju')),
    use(call('get_care_journey',{},'journey-summary')),
    input=>{const facts=input.messages.at(-1).content[0].toolResult.content[0].json;assert.equal(facts.pathway.outcome,'unconfirmed');assert.equal(facts.schedule.time,'11:00');assert.ok(facts.tasks.some(x=>x.id==='wheelchair-loan'));assert.ok(facts.findings.some(x=>x.target==='mainland'));return done('판독문 발급·제출 문의와 휠체어 대여 확인을 합성으로 연결했습니다. 실제 진찰과 의료진 확인은 남아 있습니다.');},
  ]);
  const store=createMemorySessionStore(),result=await post(createAgentService({provider,store,config:{maxRounds:8}}),req({message:'병원 문의를 이어서 하고 휠체어도 필요합니다. 11시 방문 준비해줘'}));
  assert.equal(result.statusCode,200);assert.equal(json(result).caseState.careJourney.scenarioId,null);
  assert.equal(JSON.stringify(store.inspect()).includes('병원 문의를 이어서 하고 휠체어도 필요합니다'),false);
  assert.ok(!json(result).events.some(x=>x.tool==='run_journey_demo'));
  const dispatch=createToolDispatcher();
  for(const userMessage of ['자료가 없으니 준비해줘','자료 누락 시연하지 말고 실제로 해줘','자료 누락 시연이 무엇인지 설명해줘']) await assert.rejects(dispatch({name:'run_journey_demo',input:{scenarioId:'missing_record'},state:createDemoCase(),userMessage}),e=>e.code==='EXPLICIT_DEMO_REQUIRED');
  for(const input of [{scenarioId:'missing_record',outcome:'local_transfer'},{scenarioId:'missing_record',date:'2026-11-20'},{scenarioId:'missing_record',excerpt:'임의 원문'}]) await assert.rejects(dispatch({name:'run_journey_demo',input,state:createDemoCase(),userMessage:'자료 누락 상황을 합성 시연으로 실행해줘'}),e=>e.code==='INVALID_TOOL_ARGUMENTS');
});


const liveTimeChangeRequest='진료 시간이 바뀌었을 때의 합성 시연을 보여줘. 기존 차량·동행 안내에서 무엇을 다시 확인해야 하는지와 아직 실행하지 않은 일을 정리해줘.';
const naturalDemoRequests=[
  ['missing_record','run_journey_demo','진료 자료가 빠졌을 때의 합성 시연을 보여줘.'],
  ['missing_record','run_journey_demo','판독문이 빠진 상황을 합성 시연으로 재현해줘.'],
  ['missing_record','run_journey_demo','필요한 자료가 없는 상황의 합성 시연을 보여줘.'],
  ['jeju_unavailable','run_journey_demo','제주 기관이 요청을 받지 않는 상황을 합성 시연으로 보여줘.'],
  ['jeju_unavailable','run_journey_demo','제주 병원이 접수 요청을 안 받는 합성 시연을 보여줘.'],
  ['jeju_unavailable','run_journey_demo','제주 기관이 접수를 받지 않는 합성 상황을 보여 주세요. 거절 뒤 남은 일과 기존 병원에 물어볼 내용을 정리해 주세요.'],
  ['time_changed','run_journey_demo',liveTimeChangeRequest],
  ['time_changed','run_journey_demo','진료 시각이 바뀐 상황을 합성 시연으로 보여줘.'],
  ['time_changed','run_journey_demo','일정이 변경된 상황의 합성 시연을 보여줘.'],
  ['call_no_answer','run_call_recovery_demo','전화를 안 받는 상황을 합성 시연으로 보여줘.'],
  ['call_no_answer','run_call_recovery_demo','전화를 받지 않는 상황의 합성 시연을 보여줘.'],
  ['call_ai_declined','run_call_recovery_demo','AI 응대를 거절하는 상황을 합성 시연으로 보여줘.'],
  ['call_identity_required','run_call_recovery_demo','기관이 본인확인을 요구하는 합성 시연을 보여줘.'],
  ['call_identity_required','run_call_recovery_demo','본인 인증이 필요한 상황의 합성 시연을 보여줘.'],
  ['call_documents_or_schedule','run_call_recovery_demo','서류가 부족한 상황을 합성 시연으로 보여줘.'],
  ['call_documents_or_schedule','run_call_recovery_demo','예약이 안 되는 상황을 합성 시연으로 보여줘.'],
  ['call_documents_or_schedule','run_call_recovery_demo','예약이 되지 않는 상황의 합성 시연을 보여줘.'],
];
function assertNaturalDemoResult(data,scenarioId) {
  assert.equal(data.pathway.outcome,'unconfirmed');
  assert.ok(Object.values(data.boundary).every(value=>value===false));
  if(scenarioId.startsWith('call_')) assert.ok(data.handoffs.length>0);
  else assert.equal(data.activeScenario.id,scenarioId);
  if(scenarioId==='time_changed') {
    assert.equal(data.schedule.time,'14:00');assert.equal(data.schedule.taxiStatus,'needs_recheck');assert.equal(data.schedule.companionStatus,'needs_recheck');
    assert.equal(data.schedule.recheckReasons.length,2);assert.match(data.schedule.recheckReasons.join(' '),/10:00 → 14:00/);
  }
}

test('7개 합성 상황은 한국어 조사·시제·빠짐·받지않음 자연형을 dispatcher에서 실행한다',async()=>{
  const dispatch=createToolDispatcher();
  for(const [scenarioId,name,userMessage] of naturalDemoRequests) {
    const original=createDemoCase(),before=structuredClone(original),result=await dispatch({name,input:{scenarioId},state:original,userMessage});
    assertNaturalDemoResult(result.data,scenarioId);assert.deepEqual(original,before);
    assert.ok(result.events.some(item=>item.tool===name&&item.isSimulation===true),userMessage);
  }
});

test('실제 실패 문장과 7상황 자연형은 provider fixture의 get_case→demo 도구→최종 응답으로 이어진다',async()=>{
  for(const [index,[scenarioId,name,message]] of naturalDemoRequests.entries()) {
    const provider=scripted([
      use(call('get_case',{},`natural-case-${index}`)),
      use(call(name,{scenarioId},`natural-demo-${index}`)),
      input=>{
        const result=input.messages.at(-1).content[0].toolResult;assert.equal(result.status,'success',message);
        assertNaturalDemoResult(result.content[0].json,scenarioId);
        return done('요청한 합성 상황의 준비 상태와 재확인·사람 인계를 정리했습니다. 실제 발신·기관 전송·예약은 하지 않았습니다.');
      },
    ]);
    const store=createMemorySessionStore(),response=await post(createAgentService({provider,store}),req({message,requestId:`natural-demo-request-${index}`})),body=json(response);
    assert.equal(response.statusCode,200,message);assert.equal(provider.calls.length,3);
    assert.ok(body.events.some(item=>item.tool===name&&item.status==='completed'),message);
    assert.ok(!body.events.some(item=>item.status==='error'),message);
    assert.equal(JSON.stringify(store.inspect()).includes(message),false);
    if(scenarioId==='time_changed') {
      assert.equal(body.caseState.visitSupport.requirements.appointmentTime,'14:00');
      assert.equal(body.caseState.visitSupport.taxi.status,'needs_recheck');assert.equal(body.caseState.visitSupport.companion.status,'needs_recheck');
    }
  }
});

test('자연형 상황을 알아도 일반 요청·설명만 요청·부정한 시연 명령은 실행하지 않는다',async()=>{
  const dispatch=createToolDispatcher(),contexts=[
    ['missing_record','자료가 빠진'],['jeju_unavailable','제주 기관이 요청을 받지 않는'],['time_changed','진료 시간이 바뀌었을 때의'],
    ['call_no_answer','전화를 안 받는'],['call_ai_declined','AI 응대를 거절하는'],['call_identity_required','본인확인을 요구하는'],['call_documents_or_schedule','예약이 안 되는'],
  ];
  for(const [scenarioId,context] of contexts) {
    const name=scenarioId.startsWith('call_')?'run_call_recovery_demo':'run_journey_demo';
    for(const userMessage of [`${context} 상황에서 남은 준비를 정리해줘.`,`${context} 상황의 합성 시연이 무엇인지 설명해줘.`,`${context} 합성 상황이 무엇인지 설명해줘.`,`${context} 합성 상황을 보여주지 마.`,`${context} 상황을 시연하지 말아줘.`,`${context} 상황의 합성 시연을 보여주지 마.`,`${context} 상황의 합성 시연을 실행하면 안 돼.`,`${context} 상황의 합성 시연을 보여줘도 안 돼.`,`${context} 상황의 합성 시연을 보여줘선 안 돼.`,`${context} 상황의 합성 시연을 실행해도 안 돼.`,`${context} 상황을 시연해도 안 돼.`]) {
      const state=createDemoCase(),before=structuredClone(state);
      await assert.rejects(dispatch({name,input:{scenarioId},state,userMessage}),e=>e.code==='EXPLICIT_DEMO_REQUIRED',userMessage);assert.deepEqual(state,before);
    }
  }
});
