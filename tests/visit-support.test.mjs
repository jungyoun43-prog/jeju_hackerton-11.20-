import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoCase, applyAction, getTasks, getProgress, calculateBurden, buildReport } from '../app/domain.js';
import { createVisitSupport, applyVisitSupportAction, reconcileVisitSupport, getVisitSupportSummary, buildSupportInquiry, buildVisitSupportReport } from '../app/visit-support.js';

const act = (state, type, args = {}) => applyAction(state, { type, ...args });
function provider(serviceType = 'call_taxi', overrides = {}) {
  const official = ['hospital_escort', 'accessible_transport'].includes(serviceType);
  const taxi = ['call_taxi', 'accessible_transport'].includes(serviceType);
  return {
    id: `synthetic-${serviceType}`, kind: taxi ? 'taxi' : 'companion', name: `합성 ${serviceType} 문의처`,
    region: serviceType === 'accessible_transport' ? '제주특별자치도' : '제주시 애월읍', address: '', phone: '064-000-0000', serviceType, description: '자동 검사에만 쓰는 합성 문의처',
    source: {
      datasetId: official ? '' : taxi ? '327' : '254',
      url: serviceType === 'hospital_escort' ? 'https://www.jjcsc.co.kr/Business/Market' : serviceType === 'accessible_transport' ? 'https://www.jejuhappycall.com/?mcode=guide01' : taxi ? 'https://www.data.go.kr/data/15056321/fileData.do' : 'https://jejudatahub.net/data/view/data/254',
      hubUrl: official ? '' : `https://jejudatahub.net/data/view/data/${taxi ? '327' : '254'}`,
      scope: official ? 'official-service-page' : taxi ? 'linked-public-file' : 'public-preview',
      asOf: official ? '' : taxi ? '2026-03-19' : '2020-04-17', retrievedAt: '2026-10-31',
    }, ...overrides,
  };
}
function selected(state = createDemoCase(), serviceType = 'call_taxi') {
  const record = provider(serviceType);
  return act(state, 'SUPPORT_SELECT_PROVIDER', { kind: record.kind, provider: record });
}
function prepared(state = createDemoCase(), serviceType = 'call_taxi') {
  const kind = provider(serviceType).kind;
  return act(selected(state, serviceType), 'SUPPORT_PREPARE_INQUIRY', { kind });
}
function available(state = createDemoCase(), serviceType = 'call_taxi', confirmations = {}) {
  return act(prepared(state, serviceType), 'SUPPORT_RECORD_RESPONSE', { kind: provider(serviceType).kind, outcome: 'available', ...confirmations });
}

test('초기 지원은 단일 방문의 문의 준비이며 기존 병원·자료·반복비용 의미를 보존한다', () => {
  const state = createDemoCase(), summary = getVisitSupportSummary(state);
  assert.deepEqual(state.visitSupport, createVisitSupport());
  assert.equal(summary.totalNeeded, 2);
  assert.equal(summary.preparedCount, 0);
  assert.match(summary.unresolved.join(' '), /문의처|예약 시각/);
  assert.equal(getTasks(state)[0].target, 'mainland');
  assert.equal(getProgress(state).prepared, 1);
  assert.equal(calculateBurden(state.plan).careGap, 1);
});

test('선택 전·초안 전·조건 변경 뒤 응답과 중복 응답은 차단한다', () => {
  const response = { kind: 'taxi', outcome: 'available' };
  assert.throws(() => act(createDemoCase(), 'SUPPORT_RECORD_RESPONSE', response), /문의처/);
  assert.throws(() => act(selected(), 'SUPPORT_RECORD_RESPONSE', response), /초안/);
  const one = act(prepared(), 'SUPPORT_RECORD_RESPONSE', response);
  assert.equal(one.visitSupport.taxi.status, 'available_demo');
  assert.throws(() => act(one, 'SUPPORT_RECORD_RESPONSE', response), /초안/);
  const moved = act(one, 'UPDATE_PATIENT', { values: { nextVisit: '2026-11-13' } });
  assert.throws(() => act(moved, 'SUPPORT_RECORD_RESPONSE', response), /초안/);
  const denied = act(prepared(), 'SET_PERMISSION', { permission: 'inquiry', value: false });
  assert.throws(() => act(denied, 'SUPPORT_RECORD_RESPONSE', response), /위임/);
});

test('후보·상태·조건을 복제하고 호출자가 후보 객체를 바꿔도 선택을 변조하지 않는다', () => {
  const original = createDemoCase(), before = structuredClone(original), record = provider();
  const next = act(original, 'SUPPORT_SELECT_PROVIDER', { kind: 'taxi', provider: record });
  assert.deepEqual(original, before);
  record.source.url = 'https://example.invalid/';record.name = '변조된 이름';
  assert.notEqual(next.visitSupport.taxi.provider.name, record.name);
  assert.equal(next.visitSupport.taxi.provider.source.url, 'https://www.data.go.kr/data/15056321/fileData.do');
  assert.notEqual(next.visitSupport.requirements, original.visitSupport.requirements);
  const summary = getVisitSupportSummary(next);summary.taxi.source.url = 'https://example.invalid/';
  assert.equal(next.visitSupport.taxi.provider.source.url, 'https://www.data.go.kr/data/15056321/fileData.do');
});

test('문의 초안에는 일정·공개 기관·지역만 사용하고 실명·진단·문서내용을 넣지 않는다', () => {
  const state = selected();
  state.patient.name = 'PRIVATE_NAME_0001';state.patient.caregiver = 'PRIVATE_CAREGIVER';
  state.patient.purpose = 'PRIVATE_DIAGNOSIS_0002';state.documents[0].content = 'PRIVATE_TEST_RESULT_0003';
  state.selectedHospital = { companyName: '공개 가상 기관', address: '제주시 공개 주소' };
  const inquiry = buildSupportInquiry(state, 'taxi');
  assert.match(inquiry, /제주시 애월읍|2026-11-12|공개 가상 기관|제주시 공개 주소/);
  for (const privateValue of [state.patient.name, state.patient.caregiver, state.patient.purpose, state.documents[0].content]) assert.equal(inquiry.includes(privateValue), false);
  assert.match(inquiry, /실제 발신 없음|비용은 확정하지/);
  assert.equal(buildSupportInquiry(state, 'taxi'), inquiry);
});

test('차량·돌봄 문의처·병원동행·교통약자 서비스의 질문을 구분한다', () => {
  for (const [serviceType, expected] of [
    ['call_taxi', [/왕복/, /요금/, /예약 시각/]],
    ['care_contact', [/현재 병원 동행을 제공/, /이용 자격/, /다른 기관/]],
    ['hospital_escort', [/요청한 날짜/, /지원 범위/, /신청 자격/]],
    ['accessible_transport', [/회원 등록/, /휠체어/, /이용 대상/]],
  ]) {
    const state = selected(createDemoCase(), serviceType);
    const questions = getVisitSupportSummary(state)[provider(serviceType).kind].questions.join(' ');
    for (const pattern of expected) assert.match(questions, pattern, serviceType);
  }
});

test('가능 합성 응답도 시각·휠체어·특수교통 자격이 빠지면 준비 공백으로 남긴다', () => {
  let state = act(createDemoCase(), 'SUPPORT_UPDATE_REQUIREMENTS', { values: { companionNeeded: false, wheelchair: true } });
  state = available(state, 'accessible_transport');
  let summary = getVisitSupportSummary(state);
  assert.equal(summary.preparedCount, 0);
  assert.match(summary.unresolved.join(' '), /예약 시각/);
  assert.match(summary.unresolved.join(' '), /휠체어/);
  assert.match(summary.unresolved.join(' '), /이용자격/);
  state = act(state, 'SUPPORT_UPDATE_REQUIREMENTS', { values: { appointmentTime: '10:30' } });
  assert.equal(state.visitSupport.taxi.status, 'needs_recheck');
  state = act(state, 'SUPPORT_PREPARE_INQUIRY', { kind: 'taxi' });
  state = act(state, 'SUPPORT_RECORD_RESPONSE', { kind: 'taxi', outcome: 'available', wheelchairConfirmed: true, eligibilityConfirmed: true });
  summary = getVisitSupportSummary(state);
  assert.equal(summary.preparedCount, 1);
  assert.equal(summary.totalNeeded, 1);
  assert.deepEqual(summary.unresolved, []);
  assert.equal(summary.taxi.status, 'available_demo');
  assert.match(summary.taxi.label, /시연/);
  assert.match(buildVisitSupportReport(state), /실제 예약·배차·동행인 배정이 아닙니다/);
});

test('불가·불통은 다른 문의처나 재문의 작업을 만들고 의료 판단은 바꾸지 않는다', () => {
  for (const outcome of ['unavailable', 'unreachable']) {
    const state = prepared();
    const next = act(state, 'SUPPORT_RECORD_RESPONSE', { kind: 'taxi', outcome });
    assert.equal(next.visitSupport.taxi.status, `${outcome}_demo`);
    assert.match(getVisitSupportSummary(next).nextActions[0].title, /재문의|다른 문의처/);
    assert.deepEqual(next.review, state.review);
    assert.deepEqual(next.packet, state.packet);
    assert.deepEqual(next.documents, state.documents);
  }
});

test('방문일·기관·예약시각·휠체어 변경은 기록된 응답과 추가 확인을 무효화한다', () => {
  let state = act(createDemoCase(), 'SUPPORT_UPDATE_REQUIREMENTS', { values: { appointmentTime: '09:30', wheelchair: true } });
  state = available(state, 'accessible_transport', { wheelchairConfirmed: true, eligibilityConfirmed: true });
  const changes = [
    next => act(next, 'UPDATE_PATIENT', { values: { nextVisit: '2026-11-13' } }),
    next => act(next, 'SUPPORT_UPDATE_REQUIREMENTS', { values: { appointmentTime: '10:00' } }),
    next => act(next, 'SUPPORT_UPDATE_REQUIREMENTS', { values: { wheelchair: false } }),
    next => reconcileVisitSupport(next, { ...structuredClone(next), patient: { ...next.patient, localHospital: '새로운 가상 병원' } }),
  ];
  for (const change of changes) {
    const next = change(state);
    assert.equal(next.visitSupport.taxi.status, 'needs_recheck');
    assert.equal(next.visitSupport.taxi.response, '');
    assert.equal(next.visitSupport.taxi.wheelchairConfirmed, false);
    assert.equal(next.visitSupport.taxi.eligibilityConfirmed, false);
    assert.equal(state.visitSupport.taxi.status, 'available_demo');
  }
});

test('선택·초안 단계의 문의도 새 날짜·기관으로 갱신하고 이전 초안을 남기지 않는다', () => {
  let state = prepared();
  const oldInquiry = state.visitSupport.taxi.inquiry;
  state = act(state, 'UPDATE_PATIENT', { values: { nextVisit: '2026-11-14' } });
  assert.equal(state.visitSupport.taxi.status, 'prepared');
  assert.match(state.visitSupport.taxi.inquiry, /2026-11-14/);
  assert.doesNotMatch(state.visitSupport.taxi.inquiry, /2026-11-12/);
  assert.notEqual(state.visitSupport.taxi.inquiry, oldInquiry);
  const selectedOnly = selected();
  const moved = act(selectedOnly, 'SUPPORT_UPDATE_REQUIREMENTS', { values: { appointmentTime: '11:00' } });
  assert.equal(moved.visitSupport.taxi.status, 'selected');
  assert.equal(moved.visitSupport.taxi.inquiry, undefined);
});

test('출발 지역이 달라지면 지역 전용 문의처를 해제하고 도 단위 특수교통은 재확인한다', () => {
  const local = available();
  const moved = act(local, 'UPDATE_PATIENT', { values: { area: '서귀포시 성산읍' } });
  assert.equal(moved.visitSupport.taxi.provider, null);
  assert.equal(moved.visitSupport.taxi.status, 'not_selected');
  const wide = available(createDemoCase(), 'accessible_transport');
  const updated = act(wide, 'UPDATE_PATIENT', { values: { area: '서귀포시 성산읍' } });
  assert.ok(updated.visitSupport.taxi.provider);
  assert.equal(updated.visitSupport.taxi.status, 'needs_recheck');
  assert.throws(() => act(moved, 'SUPPORT_SELECT_PROVIDER', { kind: 'taxi', provider: provider() }), /출발 지역/);
});

test('같은 선택·같은 조건·개인 이름·반복 예산 변화는 단일 방문 확인을 지우지 않는다', () => {
  const state = available();
  const sameProvider = act(state, 'SUPPORT_SELECT_PROVIDER', { kind: 'taxi', provider: provider() });
  const sameTime = act(state, 'SUPPORT_UPDATE_REQUIREMENTS', { values: { appointmentTime: '' } });
  const nameOnly = act(state, 'UPDATE_PATIENT', { values: { name: '합성 새 이름' } });
  const budget = act(state, 'UPDATE_PLAN', { values: { visits: 3, caregiverAvailable: 0 } });
  for (const next of [sameProvider, sameTime, nameOnly, budget]) assert.equal(next.visitSupport.taxi.status, 'available_demo');
});

test('필요 없음은 지원별로 계산하고 다시 필요해지면 과거 응답을 재사용하지 않는다', () => {
  const state = available();
  const off = act(state, 'SUPPORT_UPDATE_REQUIREMENTS', { values: { transportNeeded: false, companionNeeded: false } });
  const summary = getVisitSupportSummary(off);
  assert.equal(summary.totalNeeded, 0);
  assert.equal(summary.taxi.status, 'not_needed');
  assert.equal(summary.companion.status, 'not_needed');
  assert.deepEqual(summary.unresolved, []);
  assert.throws(() => act(off, 'SUPPORT_PREPARE_INQUIRY', { kind: 'taxi' }), /필요하지 않은/);
  const on = act(off, 'SUPPORT_UPDATE_REQUIREMENTS', { values: { transportNeeded: true } });
  assert.equal(on.visitSupport.taxi.status, 'needs_recheck');
});

test('잘못된 지원 입력·출처·종류·URL과 과도한 payload를 거부한다', () => {
  const state = createDemoCase(), good = provider();
  for (const values of [{ wheelchair: 'yes' }, { appointmentTime: '24:00' }, { appointmentTime: '10:60' }, { appointmentTime: '오전10시' }, { extra: true }, {}]) assert.throws(() => act(state, 'SUPPORT_UPDATE_REQUIREMENTS', { values }));
  for (const record of [
    { ...good, kind: 'companion' },
    { ...good, serviceType: 'booked' },
    { ...good, name: 'x'.repeat(301) },
    { ...good, phone: 'javascript:alert(1)' },
    { ...good, source: { ...good.source, url: 'https://www.data.go.kr.evil.invalid/data/15056321/fileData.do' } },
    { ...good, source: { ...good.source, url: 'https://user:password@www.data.go.kr/data/15056321/fileData.do' } },
    { ...good, source: { ...good.source, url: 'http://www.data.go.kr/data/15056321/fileData.do' } },
    { ...good, source: { ...good.source, scope: 'private-api' } },
    { ...good, source: { ...good.source, asOf: '' } },
    { ...good, source: { ...good.source, retrievedAt: '2026-02-30' } },
    { ...good, source: { ...good.source, hubUrl: 'https://jejudatahub.net/data/view/data/254' } },
  ]) assert.throws(() => act(state, 'SUPPORT_SELECT_PROVIDER', { kind: 'taxi', provider: record }));
  assert.throws(() => act(state, 'SUPPORT_SELECT_PROVIDER', { kind: '__proto__', provider: good }));
  assert.throws(() => applyVisitSupportAction(state, { type: 'DIAGNOSE' }));
  assert.throws(() => act(prepared(), 'SUPPORT_RECORD_RESPONSE', { kind: 'taxi', outcome: 'booked' }));
  const oversized = { ...good, ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['extra' + i, 'x'])) };
  assert.throws(() => act(state, 'SUPPORT_SELECT_PROVIDER', { kind: 'taxi', provider: oversized }));
});

test('지원 보고서는 공개 출처·자료시점·시연 응답을 표시하고 로그를 제한한다', () => {
  let state = available();
  const report = buildReport(state);
  assert.match(report, /이번 방문의 이동·동행 문의/);
  assert.match(report, /15056321\/fileData.do/);
  assert.match(report, /2026-03-19/);
  assert.match(report, /합성 응답 · 실제 발신 없음/);
  for (let i = 0; i < 220; i++) state = act(state, 'SUPPORT_PREPARE_INQUIRY', { kind: 'taxi' });
  assert.equal(state.events.length, 200);
  assert.equal(new Set(state.events.map(event => event.id)).size, 200);
});
