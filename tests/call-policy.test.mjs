import test from 'node:test';
import assert from 'node:assert/strict';
import { CALL_TARGETS, buildCallPlan } from '../app/call-policy.js';
import { createDemoCase, applyAction } from '../app/domain.js';
import supportData from '../app/data/visit-support-providers.json' with {type:'json'};
import hospitalData from '../app/data/hospital-candidates.json' with {type:'json'};

const REAL_FLAGS = ['realDelegationVerified','realAdapterConfigured','actualCallPlaced','reservationConfirmed','clinicalAcceptanceConfirmed'];
const provider = type => structuredClone(supportData.providers.find(item => item.serviceType === type));
const disclosure = plan => Object.fromEntries(plan.minimumDisclosure.map(item => [item.field,item.value]));
const assertUnconnected = plan => { for (const field of REAL_FLAGS) assert.equal(plan[field],false,field); };

test('전화 계획은 네 대상만 지원하고 입력 상태를 변경하거나 계획끼리 참조를 공유하지 않는다', () => {
  const state = createDemoCase(), before = structuredClone(state);
  assert.deepEqual(CALL_TARGETS,['mainland','jeju','taxi','companion']);
  const first = buildCallPlan(state,'jeju'), second = buildCallPlan(state,'jeju');
  assert.deepEqual(first,second);
  first.questions.push('이 계획만 수정'); first.recipient.name = '임시 표시';
  assert.notDeepEqual(first,second);
  assert.deepEqual(state,before);
  for (const target of [undefined,'emergency','__proto__',{},null]) assert.throws(() => buildCallPlan(state,target),TypeError);
  assert.throws(() => buildCallPlan(null,'jeju'),TypeError);
});

test('최소 전달값은 행정 준비 항목으로 제한하고 이름·진단·기록·연락처·상세 주소를 읽어 넣지 않는다', () => {
  const state = createDemoCase();
  const secrets = ['PRIVATE_PATIENT','PRIVATE_CAREGIVER','PRIVATE_DIAGNOSIS','PRIVATE_RECORD','PRIVATE_PHONE','PRIVATE_ADDRESS'];
  Object.assign(state.patient,{name:secrets[0],age:'PRIVATE_AGE',caregiver:secrets[1],purpose:secrets[2],diagnosis:secrets[2],phone:secrets[4],address:secrets[5],area:`제주특별자치도 제주시 애월읍 ${secrets[5]} 123`});
  state.documents[0].content = secrets[3];
  state.visitSupport.requirements.appointmentTime = '09:30';
  for (const target of CALL_TARGETS) {
    const plan = buildCallPlan(state,target), serialized = JSON.stringify(plan);
    for (const secret of [...secrets,'PRIVATE_AGE']) assert.equal(serialized.includes(secret),false,`${target}: ${secret}`);
    for (const item of plan.minimumDisclosure) {
      assert.ok(['date','area','destination','appointmentTime','wheelchair','companionNeeded'].includes(item.field));
      assert.equal(typeof item.value,'string');
    }
    assert.equal(disclosure(plan).date,'2026-11-12');
    assert.equal(disclosure(plan).appointmentTime,'09:30');
    if (target === 'taxi' || target === 'companion') assert.equal(disclosure(plan).area,'제주시 애월읍');
    else assert.equal(Object.hasOwn(disclosure(plan),'area'),false);
  }
});

test('유효하지 않은 날짜·시각·행정지역은 전달값으로 만들지 않는다', () => {
  const state = createDemoCase();
  state.patient.nextVisit = '2026-02-30'; state.patient.area = 'PRIVATE_UNKNOWN_AREA';
  state.visitSupport.requirements.appointmentTime = 'PRIVATE_TIME';
  const values = disclosure(buildCallPlan(state,'taxi'));
  for (const field of ['date','area','appointmentTime']) assert.equal(Object.hasOwn(values,field),false);
});

test('합성 문의 허용·자료 공유·자녀 관계나 임의 성공 필드는 실제 위임·연결·예약·진료 수락을 증명하지 않는다', () => {
  const state = createDemoCase();
  state.permissions = {inquiry:true,share:true,realDelegationVerified:true};
  state.patient.relationship = '성인 자녀';
  for (const field of REAL_FLAGS) state[field] = true;
  for (const target of CALL_TARGETS) {
    const plan = buildCallPlan(state,target);
    assert.equal(plan.simulation.inquiryDelegated,true); assertUnconnected(plan);
    assert.equal(plan.preCallChecks.find(item => item.id === 'delegation').status,'unverified');
    assert.match(plan.preCallChecks.find(item => item.id === 'delegation').detail,/성인 자녀/);
    assert.match(plan.openingScript,/확인 후 사용할 예정 문구/);
    assert.match(plan.openingScript,/AI 전화 도우미/);
    assert.match(plan.preCallChecks.find(item => item.id === 'ai-notice').detail,/거절/);
  }
  state.permissions.inquiry = false;
  assert.equal(buildCallPlan(state,'jeju').simulation.inquiryDelegated,false);
  assert.equal(buildCallPlan(state,'jeju').preCallChecks.find(item => item.id === 'simulation-inquiry').status,'missing');
});

test('녹음·전사·보관 미설정과 국외 이전 미검증을 유지하고 완료 고지를 만들어내지 않는다', () => {
  const state = createDemoCase();
  state.recordHandling = {recording:true,transcription:true,retention:'forever',overseasTransfer:'approved'};
  for (const target of CALL_TARGETS) {
    const plan = buildCallPlan(state,target);
    for (const field of ['recording','transcription','retention']) assert.equal(plan.recordHandling[field],'not_configured');
    assert.equal(plan.recordHandling.overseasTransfer,'not_verified');
    assert.match(plan.recordHandling.notice,/거절 방법/);
    assert.match(plan.recordHandling.notice,/국외 이전/);
    assert.doesNotMatch(plan.openingScript,/녹음합니다|통화를 기록합니다|위임받았습니다|법적으로 문제없/);
    assert.equal(plan.preCallChecks.find(item => item.id === 'record-handling').status,'missing');
    assert.equal(plan.preCallChecks.find(item => item.id === 'fees').status,'unverified');
  }
});

test('병원 등록 표본에 없는 전화번호를 만들지 않으며 합성 confirmed는 행정 절차로 한정한다', () => {
  let state = createDemoCase();
  state = applyAction(state,{type:'SELECT_LOCAL_HOSPITAL',hospital:hospitalData.records.find(item => item.id === 'hospital-4')});
  state.selectedHospital.phone = '064-123-4567';
  for (const target of ['mainland','jeju']) state = applyAction(state,{type:'RECORD_CALL',target,outcome:target === 'mainland' ? 'referral' : 'documents'});
  const local = buildCallPlan(state,'jeju'), mainland = buildCallPlan(state,'mainland');
  assert.equal(local.recipient.name,'제주우리병원');
  assert.equal(local.recipient.sourceUrl,'https://jejudatahub.net/data/view/data/859');
  for (const plan of [local,mainland]) {
    assert.equal(plan.recipient.phone,null); assert.equal(plan.recipient.contactVerified,false);
    assert.equal(plan.simulation.status,'confirmed');
    assert.match(plan.simulation.label,/합성 접수 절차/); assertUnconnected(plan);
    assert.ok(plan.questions.some(question => /의뢰서/.test(question)));
    assert.ok(plan.nextActions.some(action => /의료진/.test(action)));
  }
  assert.ok(local.questions.some(question => /도외 병원/.test(question)));
  assert.ok(mainland.questions.some(question => /제주/.test(question)));
  assert.equal(disclosure(local).destination,'제주우리병원');
});

test('공개 지원 문의처의 번호·자료 범위를 보존하고 잘못된 출처는 연락처로 노출하지 않는다', () => {
  const state = createDemoCase();
  const taxi = provider('call_taxi'), care = provider('care_contact');
  state.visitSupport.taxi.provider = taxi; state.visitSupport.companion.provider = care;
  for (const target of ['taxi','companion']) {
    const plan = buildCallPlan(state,target), selected = state.visitSupport[target].provider;
    assert.equal(plan.recipient.name,selected.name);
    assert.equal(plan.recipient.phone,selected.phone);
    assert.equal(plan.recipient.sourceUrl,selected.source.url);
    assert.equal(plan.recipient.serviceType,selected.serviceType);
    assert.equal(plan.recipient.contactVerified,false);
    assert.equal(plan.minimumDisclosure.some(item => item.value === selected.phone),false);
  }
  assert.match(buildCallPlan(state,'companion').questions[0],/현재 병원동행을 제공/);
  state.visitSupport.taxi.provider.source.url = 'https://evil.test/collect';
  state.visitSupport.taxi.provider.phone = 'PRIVATE_PHONE';
  const blocked = buildCallPlan(state,'taxi');
  assert.equal(blocked.recipient.sourceUrl,null); assert.equal(blocked.recipient.phone,null);
  assert.doesNotMatch(JSON.stringify(blocked),/evil\.test|PRIVATE_PHONE/);
  state.visitSupport.taxi.provider = {kind:'taxi',serviceType:'__proto__',name:'미검증 문의처',source:{},phone:'064-123-4567'};
  const unknown = buildCallPlan(state,'taxi');
  assert.equal(unknown.recipient.sourceUrl,null); assert.equal(unknown.recipient.phone,null);
  assert.equal(unknown.recipient.serviceType,'');
});

test('휠체어 이동 문의는 자격·등록·탑승·승하차·동행인·시각·차량 질문을 포함하되 가능 응답을 배차로 표시하지 않는다', () => {
  const state = createDemoCase();
  state.visitSupport.requirements.wheelchair = true;
  state.visitSupport.requirements.appointmentTime = '10:00';
  state.visitSupport.taxi.provider = provider('accessible_transport');
  state.visitSupport.taxi.status = 'available_demo';
  const plan = buildCallPlan(state,'taxi'), questions = plan.questions.join('\n');
  assert.equal(plan.recipient.serviceType,'accessible_transport');
  assert.equal(plan.recipient.phone,'1899-6884');
  for (const topic of ['이용자격','회원등록','휠체어','탑승','승하차','동행인','희망 시각','차량 가능']) assert.ok(questions.includes(topic),topic);
  assert.match(plan.simulation.label,/합성 가능/); assert.match(plan.simulation.detail,/미확인/);
  assert.match(plan.requestDraft,/휠체어/); assert.match(plan.requestDraft,/실제 발신 없이/);
  assert.equal(disclosure(plan).wheelchair,'필요'); assertUnconnected(plan);
  assert.equal(state.visitSupport.taxi.wheelchairConfirmed,false);
  assert.equal(state.visitSupport.taxi.eligibilityConfirmed,false);
});

test('현재 상태를 다시 계산하므로 날짜·기관 변경 후 이전 계획을 재사용하지 않는다', () => {
  const state = createDemoCase();
  const before = buildCallPlan(state,'companion');
  state.patient.nextVisit = '2026-11-20'; state.patient.localHospital = '변경한 가상 기관';
  state.visitSupport.companion.status = 'needs_recheck';
  const after = buildCallPlan(state,'companion');
  assert.equal(disclosure(before).date,'2026-11-12'); assert.equal(disclosure(after).date,'2026-11-20');
  assert.equal(disclosure(after).destination,'변경한 가상 기관');
  assert.equal(after.simulation.status,'needs_recheck'); assert.match(after.simulation.detail,/이전 합성 응답/);
});
