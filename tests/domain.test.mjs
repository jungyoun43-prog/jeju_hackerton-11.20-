import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoCase, applyAction, getTasks, getProgress, getSummary, calculateBurden, buildReport } from '../app/domain.js';

const action = (state, type, values = {}) => applyAction(state, { type, ...values });
function readyState() {
  let state = createDemoCase();
  for (const target of ['mainland', 'jeju']) state = action(state, 'RECORD_CALL', { target, outcome: 'documents' });
  for (const id of ['report', 'exam']) state = action(state, 'ADD_DOCUMENT', { id, content: `합성 ${id} 기록`, source: '합성 의료진 작성 시연 자료' });
  return action(state, 'SET_PERMISSION', { permission: 'share', value: true });
}
function reviewedState(outcome = 'local_followup') {
  return action(action(readyState(), 'SUBMIT_PACKET'), 'RECORD_REVIEW', { outcome });
}

test('처음은 도외 병원 문의가 우선이며 합성 기록만 보유한다', () => {
  const state = createDemoCase();
  assert.equal(getTasks(state)[0].target, 'mainland');
  assert.equal(getProgress(state).prepared, 1);
  assert.equal(getProgress(state).total, 3);
  assert.match(state.patient.existingHospital, /가상/);
  assert.match(state.documents[0].source, /합성/);
});

test('상태 변경은 원본과 독립적인 복제본을 반환한다', () => {
  const state = createDemoCase();
  const before = structuredClone(state);
  const next = action(state, 'RECORD_CALL', { target: 'mainland', outcome: 'referral' });
  assert.deepEqual(state, before);
  assert.notEqual(next, state);
  assert.notEqual(next.documents, state.documents);
  assert.equal(next.inquiries.mainland.status, 'confirmed');
});

test('문의 권한이 없으면 통화 응답 재현을 거부한다', () => {
  const state = action(createDemoCase(), 'SET_PERMISSION', { permission: 'inquiry', value: false });
  assert.throws(() => action(state, 'RECORD_CALL', { target: 'mainland', outcome: 'documents' }), /위임/);
});

test('연결 실패와 미참여는 도외 방문 필요성으로 해석하지 않는다', () => {
  for (const outcome of ['unreachable', 'not_participating']) {
    const state = action(createDemoCase(), 'RECORD_CALL', { target: 'mainland', outcome });
    assert.equal(state.inquiries.mainland.status, outcome);
    assert.equal(state.review.outcome, null);
    assert.equal(state.packet.status, 'draft');
    assert.equal(getTasks(state)[0].action, 'call');
    assert.throws(() => action(state, 'SUBMIT_PACKET'), /두 기관/);
  }
});

test('의사 의뢰 요구는 의료진 담당 작업이며 반복해도 필수 항목을 중복하지 않는다', () => {
  let state = action(createDemoCase(), 'RECORD_CALL', { target: 'mainland', outcome: 'referral' });
  state = action(state, 'RECORD_CALL', { target: 'mainland', outcome: 'referral' });
  const task = getTasks(state).find(item => item.target === 'referral');
  assert.equal(task.owner, '제주 의료진');
  assert.equal(getProgress(state).total, 4);
  assert.equal(state.inquiries.mainland.requestedDocuments.filter(id => id === 'referral').length, 1);
});

test('두 기관 절차·필수 자료·공유 허용을 각각 검증해야 접수할 수 있다', () => {
  let state = createDemoCase();
  assert.throws(() => action(state, 'SUBMIT_PACKET'), /두 기관/);
  state = action(state, 'RECORD_CALL', { target: 'mainland', outcome: 'documents' });
  assert.throws(() => action(state, 'SUBMIT_PACKET'), /두 기관/);
  state = action(state, 'RECORD_CALL', { target: 'jeju', outcome: 'documents' });
  assert.throws(() => action(state, 'SUBMIT_PACKET'), /필수 자료/);
  for (const id of ['report', 'exam']) state = action(state, 'ADD_DOCUMENT', { id, content: '합성 기록', source: '시연 자료' });
  assert.throws(() => action(state, 'SUBMIT_PACKET'), /공유/);
  state = action(state, 'SET_PERMISSION', { permission: 'share', value: true });
  state = action(state, 'SUBMIT_PACKET');
  assert.equal(state.review.status, 'pending');
  assert.equal(getTasks(state)[0].action, 'wait');
  assert.equal(getProgress(state).index, 3);
  assert.throws(() => action(state, 'SUBMIT_PACKET'), /이미/);
});

test('의뢰가 요구된 뒤에는 의뢰서도 접수의 필수 조건이다', () => {
  let state = readyState();
  state = action(state, 'RECORD_CALL', { target: 'jeju', outcome: 'referral' });
  assert.throws(() => action(state, 'SUBMIT_PACKET'), /의뢰서/);
  state = action(state, 'ADD_DOCUMENT', { id: 'referral', content: '합성 의사 의뢰', source: '의료진 작성 역할 시연' });
  assert.equal(action(state, 'SUBMIT_PACKET').packet.status, 'submitted');
});

test('자료 보완 회신은 판독문을 다시 요구하고 재접수·재검토가 가능하다', () => {
  let state = action(readyState(), 'SUBMIT_PACKET');
  state = action(state, 'RECORD_REVIEW', { outcome: 'needs_information' });
  assert.equal(state.review.status, 'needs_information');
  assert.equal(state.packet.status, 'draft');
  assert.equal(getTasks(state)[0].target, 'report');
  assert.match(getSummary(state), /추가 판독문/);
  assert.throws(() => action(state, 'RECORD_REVIEW', { outcome: 'local_followup' }), /보완/);
  state = action(state, 'ADD_DOCUMENT', { id: 'report', content: '보완한 합성 판독문', source: '추가 시연 자료' });
  state = action(state, 'SUBMIT_PACKET');
  state = action(state, 'RECORD_REVIEW', { outcome: 'local_followup' });
  assert.equal(state.review.status, 'completed');
  assert.equal(getProgress(state).index, 4);
  assert.equal(getTasks(state)[0].action, 'plan');
  assert.match(state.review.source, /합성/);
});

test('자료 변경·삭제·통화 실패·권한 해제는 이전 검토 결과를 무효화한다', () => {
  const reviewed = reviewedState();
  const changes = [
    ['ADD_DOCUMENT', { id: 'report', content: '다른 합성 판독문', source: '수정 시연 자료' }],
    ['REMOVE_DOCUMENT', { id: 'exam' }],
    ['RECORD_CALL', { target: 'jeju', outcome: 'unreachable' }],
    ['SET_PERMISSION', { permission: 'share', value: false }],
    ['SET_PERMISSION', { permission: 'inquiry', value: false }],
  ];
  for (const [type, values] of changes) {
    const next = action(reviewed, type, values);
    assert.equal(next.review.status, 'not_requested', type);
    assert.equal(next.review.outcome, null, type);
    assert.equal(next.packet.status, 'draft', type);
  }
});

test('동일 자료·동일 확인 결과를 다시 기록해도 유효한 회신을 소거하지 않는다', () => {
  let state = reviewedState();
  state = action(state, 'RECORD_CALL', { target: 'jeju', outcome: 'documents' });
  const doc = state.documents.find(item => item.id === 'report');
  state = action(state, 'ADD_DOCUMENT', { id: 'report', content: doc.content, source: doc.source });
  assert.equal(state.review.status, 'completed');
});

test('의료진 역할 회신도 검토 접수 전에 만들 수 없다', () => {
  assert.throws(() => action(createDemoCase(), 'RECORD_REVIEW', { outcome: 'mainland_visit' }), /접수/);
  const state = reviewedState('mainland_visit');
  assert.match(getTasks(state)[0].title, /도외 방문 준비/);
  assert.match(getTasks(state)[0].description, /예약은 아직 확정되지/);
});

test('미확인 비용을 확정 0원으로 바꾸지 않고 소계와 동행 공백을 표시한다', () => {
  const result = calculateBurden(createDemoCase().plan);
  assert.equal(result.estimatedSubtotal, 80000);
  assert.equal(result.unknownItems.length, 4);
  assert.equal(result.careGap, 1);
  assert.equal(result.complete, false);
});

test('공동 숙박을 보호자 인원만큼 중복하지 않고 보호자 이동은 동행 횟수만 반영한다', () => {
  const plan = { visits: 3, caregiverAvailable: 1, localTransport: 10000, offIslandTransport: 200000, lodging: 100000, medical: 50000, caregiverTransport: 150000 };
  assert.deepEqual(calculateBurden(plan), { estimatedSubtotal: 1230000, unknownItems: [], careGap: 2, complete: true });
  assert.equal(calculateBurden({ ...plan, caregiverAvailable: 10 }).estimatedSubtotal, 1530000);
});

test('부담 가정 변경은 의료진 회신을 변경하지 않는다', () => {
  const state = reviewedState();
  const updated = action(state, 'UPDATE_PLAN', { values: { visits: 4, caregiverAvailable: 0 } });
  assert.deepEqual(updated.review, state.review);
  assert.equal(calculateBurden(updated.plan).careGap, 4);
});

test('지원하지 않는 작업·타깃·출처 없는 자료·잘못된 숫자와 날짜를 거부한다', () => {
  const state = createDemoCase();
  for (const input of [
    { type: 'DIAGNOSE' },
    { type: 'RECORD_CALL', target: '__proto__', outcome: 'documents' },
    { type: 'RECORD_CALL', target: 'mainland', outcome: 'booked' },
    { type: 'ADD_DOCUMENT', id: 'unknown', content: 'x', source: 'x' },
    { type: 'ADD_DOCUMENT', id: 'report', content: '', source: 'x' },
    { type: 'ADD_DOCUMENT', id: 'report', content: 'x', source: '' },
    { type: 'SET_PERMISSION', permission: 'share', value: 'true' },
    { type: 'UPDATE_PLAN', values: { visits: 0 } },
    { type: 'UPDATE_PLAN', values: { visits: 1.5 } },
    { type: 'UPDATE_PLAN', values: { caregiverAvailable: -1 } },
    { type: 'UPDATE_PLAN', values: { medical: Number.NaN } },
    { type: 'UPDATE_PLAN', values: { medical: '100' } },
    { type: 'UPDATE_PLAN', values: { medical: -100 } },
    { type: 'UPDATE_PLAN', values: { unknown: 0 } },
    { type: 'UPDATE_PATIENT', values: { nextVisit: '2026-02-30' } },
  ]) assert.throws(() => applyAction(state, input), Error, JSON.stringify(input));
});

test('보고서는 시연·출처·미확인·모델 미연동을 공개하고 HTML을 이스케이프한다', () => {
  const state = action(createDemoCase(), 'UPDATE_PATIENT', { values: { name: '<script>alert(1)</script>' } });
  const report = buildReport(state);
  for (const pattern of [/합성 환자/, /실제 통화/, /시연용 합성 치료 이력/, /미확인/, /런타임 AI 모델은 연결되지/]) assert.match(report, pattern);
  assert.doesNotMatch(report, /<script>/);
});
