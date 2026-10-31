import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentService } from '../agent/service.mjs';
import { createLambdaHandler } from '../agent/handler.mjs';
import { createMemorySessionStore } from '../agent/store.mjs';
import { createToolDispatcher, assertSourceUrl } from '../agent/tools.mjs';
import { createDemoCase } from '../app/domain.js';
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

test('기본 API는 모델·store 호출 없이 사실대로 미연결503을 반환한다',async () => {
  const store = new Proxy({}, {get() { throw new Error('store must not be touched'); }});
  const service = createAgentService({store,config:{revision:'test-sha'}});
  const caps = await service.handleAgentRequest({method:'GET',path:'/api/agent/capabilities'});
  assert.deepEqual(json(caps),{llm:false,model:'',phone:'simulation',healthRecords:'demo',voiceInput:'browser',revision:'test-sha'});
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
  assert.ok(body.events.some(item => item.source === 'https://jejudatahub.net/data/view/data/859' && item.isSimulation === false));
  assert.ok(body.events.some(item => item.source === 'https://www.data.go.kr/data/15056321/fileData.do'));
  assert.ok(body.events.some(item => item.tool === 'request_records' && item.status === 'not_connected'));
  for (const item of body.events.filter(item => /request_(hospital|support)_contact/.test(item.tool))) assert.equal(item.isSimulation,true);
  assert.match(body.caseState.visitSupport.companion.inquiry,/실명·진단명·병력·검사 결과는 이 초안에 포함하지 않았/);
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
  const retry = await post(service,req({sessionId:first.sessionId,message:'중복요청에서는 바꾸지 않아야 함'}));
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
