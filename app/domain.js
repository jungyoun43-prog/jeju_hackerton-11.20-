/**
 * 제주 진료 나침반의 결정적 시연용 워크플로.
 * 모델 호출·실제 전화·기록 전송·의료 판단을 수행하지 않는다.
 */
export const DOCUMENT_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'history', label: '치료 이력 요약', description: '기존 치료 병원에서 받은 진료·치료 이력', owner: '보호자' }),
  Object.freeze({ id: 'report', label: '최근 검사 판독문', description: '기관이 요청한 검사 판독문과 시행일 확인', owner: '보호자' }),
  Object.freeze({ id: 'exam', label: '제주 대면 진찰 소견', description: '제주 의료진이 실제 진찰 후 작성한 기록', owner: '제주 의료진' }),
  Object.freeze({ id: 'referral', label: '의료진 작성 의뢰서', description: '기관이 의사 명의 의뢰를 요구할 때 작성·확인', owner: '제주 의료진' }),
]);

const BASE_DOCUMENTS = ['history', 'report', 'exam'];
const TARGETS = ['mainland', 'jeju'];
const CALL_OUTCOMES = ['documents', 'referral', 'unreachable', 'not_participating'];
const REVIEW_OUTCOMES = ['needs_information', 'local_followup', 'mainland_visit'];
const COST_FIELDS = {
  localTransport: '제주 내 왕복 이동비',
  offIslandTransport: '환자 도외 왕복 교통비',
  lodging: '일행 공동 숙박비',
  medical: '진료 본인부담금',
  caregiverTransport: '보호자 왕복 교통비',
};

const now = () => new Date().toISOString();
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, label, max = 20000) => {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${label}을(를) 올바르게 입력해 주세요.`);
  return value.trim();
};

function assertState(state) {
  assert(object(state) && state.version === 1 && object(state.patient) && object(state.permissions)
    && Array.isArray(state.documents) && object(state.inquiries) && object(state.packet)
    && object(state.review) && object(state.plan) && Array.isArray(state.events), '지원하지 않는 사례 상태입니다. 시연을 새로 시작해 주세요.');
  for (const id of TARGETS) assert(object(state.inquiries[id]), '병원 문의 상태를 확인해 주세요.');
  for (const { id } of DOCUMENT_DEFINITIONS) assert(state.documents.some(doc => doc.id === id), '자료 목록을 확인해 주세요.');
}

function event(state, title, detail, kind, source = '결정적 시뮬레이터') {
  const at = now();
  state.events.push({ id: `event-${state.events.length + 1}`, at, title, detail, kind, source });
}

function invalidateReview(state) {
  state.packet = { status: 'draft', submittedAt: null };
  state.review = { status: 'not_requested', outcome: null, note: '', source: '' };
}

function requiredDocuments(state) {
  return [...new Set([...BASE_DOCUMENTS, ...TARGETS.flatMap(target => state.inquiries[target].requestedDocuments)])];
}

function missingDocuments(state) {
  const required = new Set(requiredDocuments(state));
  return state.documents.filter(doc => required.has(doc.id) && doc.status !== 'ready');
}

const proceduresConfirmed = state => TARGETS.every(target => state.inquiries[target].status === 'confirmed');

export function createDemoCase() {
  const at = now();
  return {
    version: 1,
    patient: {
      name: '김정희', age: 68, area: '제주시 애월읍', caregiver: '김하늘',
      existingHospital: '서울 기존 치료 병원 (가상)', localHospital: '제주 협진 병원 (가상)',
      purpose: '암 치료 후 추적 진료의 협진 준비', nextVisit: '2026-11-12',
    },
    permissions: { inquiry: true, share: false },
    documents: DOCUMENT_DEFINITIONS.map(doc => ({
      id: doc.id, label: doc.label,
      status: doc.id === 'history' ? 'ready' : doc.id === 'exam' ? 'not_performed' : 'missing',
      source: doc.id === 'history' ? '시연용 합성 치료 이력' : '',
      content: doc.id === 'history' ? '합성 사례입니다. 기존 도외 병원에서 치료 후 추적 진료를 준비하고 있습니다. 실제 환자 기록이나 진료 계획이 아닙니다.' : '',
    })),
    inquiries: Object.fromEntries(TARGETS.map(id => [id, { status: 'not_contacted', response: '', requestedDocuments: [], transcript: [], at: null }])),
    packet: { status: 'draft', submittedAt: null },
    review: { status: 'not_requested', outcome: null, note: '', source: '' },
    plan: { visits: 2, caregiverAvailable: 1, localTransport: 40000, offIslandTransport: null, lodging: null, medical: null, caregiverTransport: null },
    events: [{ id: 'event-1', at, title: '시연 사례를 준비했어요', detail: '합성 환자·가상 기관으로 문의와 자료 보완 과정을 확인합니다.', kind: 'case', source: '시연용 합성 사례' }],
  };
}

function callResponse(target, outcome) {
  const department = target === 'mainland' ? '도외 병원 협진 창구 역할' : '제주 병원 접수 창구 역할';
  if (outcome === 'unreachable') return { status: 'unreachable', response: '전화 연결이 되지 않았습니다. 접수 절차와 참여 여부는 미확인입니다.', requestedDocuments: null, transcript: [{ speaker: '시뮬레이터', text: '전화 연결 실패 응답을 재현했습니다. 실제 발신은 하지 않았습니다.' }] };
  if (outcome === 'not_participating') return { status: 'not_participating', response: '현재 이 기관의 협진 참여가 어렵다는 운영 응답입니다. 환자의 진료 장소에 관한 임상 판단이 아닙니다.', requestedDocuments: null, transcript: [{ speaker: department, text: '이번 요청의 협진 접수를 진행하기 어렵습니다. (합성 응답)' }] };
  const requestedDocuments = outcome === 'referral' ? [...BASE_DOCUMENTS, 'referral'] : [...BASE_DOCUMENTS];
  const response = outcome === 'referral'
    ? '치료 이력, 최근 판독문, 제주 진찰 소견과 함께 의료진 명의 의뢰서를 준비해 주세요. 접수 절차 확인이며 환자별 협진 수락은 의료진 검토 후 결정됩니다.'
    : '치료 이력과 최근 검사 판독문, 제주 의료진의 대면 진찰 소견을 준비해 주세요. 자료를 접수한 뒤 의료진이 검토합니다.';
  return {
    status: 'confirmed', response, requestedDocuments,
    transcript: [
      { speaker: '문의 도우미 역할', text: '보호자가 위임한 범위에서 협진 접수 창구와 준비 자료를 문의합니다. (시연·실제 발신 없음)' },
      { speaker: department, text: `${response} (합성 응답)` },
      { speaker: '문의 도우미 역할', text: '접수 안내를 기록하겠습니다. 예약 확정이나 환자별 진료 가능 판단으로 표시하지 않겠습니다.' },
    ],
  };
}

function validatePlan(plan) {
  assert(object(plan), '방문·비용 조건을 확인해 주세요.');
  assert(Number.isInteger(plan.visits) && plan.visits >= 1 && plan.visits <= 100, '방문 횟수는 1~100 사이의 정수로 입력해 주세요.');
  assert(Number.isInteger(plan.caregiverAvailable) && plan.caregiverAvailable >= 0 && plan.caregiverAvailable <= 100, '동행 가능 횟수는 0~100 사이의 정수로 입력해 주세요.');
  for (const [field, label] of Object.entries(COST_FIELDS)) {
    const value = plan[field];
    assert(value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 1000000000), `${label}는 0 이상의 정수 원 단위로 입력하고, 미확인이면 비워 주세요.`);
  }
}

export function applyAction(state, action) {
  assertState(state);
  assert(object(action) && typeof action.type === 'string', '실행할 작업을 확인해 주세요.');
  const next = structuredClone(state);
  switch (action.type) {
    case 'SET_PERMISSION': {
      assert(['inquiry', 'share'].includes(action.permission) && typeof action.value === 'boolean', '위임 항목과 허용 여부를 확인해 주세요.');
      if (next.permissions[action.permission] === action.value) return next;
      next.permissions[action.permission] = action.value;
      if (!action.value) invalidateReview(next);
      event(next, '위임 범위를 갱신했어요', `${action.permission === 'share' ? '자료 공유' : '전화 문의'} ${action.value ? '허용' : '해제'} · 시연 설정`, 'permission', '사용자 입력');
      break;
    }
    case 'RECORD_CALL': {
      assert(TARGETS.includes(action.target), '문의할 기관을 선택해 주세요.');
      assert(CALL_OUTCOMES.includes(action.outcome), '지원하지 않는 문의 응답입니다.');
      assert(next.permissions.inquiry, '전화 문의 위임을 허용한 뒤 문의를 진행해 주세요.');
      const old = next.inquiries[action.target];
      const result = callResponse(action.target, action.outcome);
      const requestedDocuments = result.requestedDocuments ?? old.requestedDocuments;
      if (old.status !== result.status || JSON.stringify(old.requestedDocuments) !== JSON.stringify(requestedDocuments)) invalidateReview(next);
      next.inquiries[action.target] = { ...result, requestedDocuments: [...new Set(requestedDocuments)], at: now() };
      event(next, `${action.target === 'mainland' ? '기존 도외' : '제주'} 병원 문의 응답을 기록했어요`, result.response, 'call', '합성 전화 응답 · 실제 발신 없음');
      break;
    }
    case 'ADD_DOCUMENT': {
      const doc = next.documents.find(item => item.id === action.id);
      assert(doc, '지원하지 않는 자료 항목입니다.');
      const content = text(action.content, '자료 내용');
      const source = text(action.source, '자료 출처', 300);
      if (doc.status === 'ready' && doc.content === content && doc.source === source) return next;
      invalidateReview(next);
      Object.assign(doc, { status: 'ready', content, source });
      event(next, `${doc.label}를 준비했어요`, '입력된 자료의 보유 상태만 갱신했습니다. 진찰 시행이나 의학적 적합성을 검증한 것은 아닙니다.', 'document', source);
      break;
    }
    case 'REMOVE_DOCUMENT': {
      const doc = next.documents.find(item => item.id === action.id);
      assert(doc, '지원하지 않는 자료 항목입니다.');
      invalidateReview(next);
      Object.assign(doc, { status: 'missing', content: '', source: '' });
      event(next, `${doc.label} 준비 상태를 해제했어요`, '자료 변경에 따라 이전 검토 상태를 갱신하고 보완이 필요하도록 표시합니다.', 'document');
      break;
    }
    case 'SUBMIT_PACKET': {
      assert(next.permissions.inquiry, '전화 문의 위임 상태를 다시 확인해 주세요.');
      assert(proceduresConfirmed(next), '두 기관의 협진 접수 절차를 먼저 확인해 주세요.');
      const missing = missingDocuments(next);
      assert(missing.length === 0, `필수 자료를 준비해 주세요: ${missing.map(doc => doc.label).join(', ')}`);
      assert(next.permissions.share, '자료 공유 범위를 확인하고 허용해 주세요.');
      assert(next.packet.status !== 'submitted', '이미 검토 접수를 재현했습니다. 회신을 기다려 주세요.');
      next.packet = { status: 'submitted', submittedAt: now() };
      next.review = { status: 'pending', outcome: null, note: '', source: '' };
      event(next, '의료진 검토 접수를 재현했어요', '실제 기관 전송은 하지 않았습니다. 접수와 의료진의 환자별 협진 수락은 다른 상태입니다.', 'packet', '자료 전송 시뮬레이터');
      break;
    }
    case 'RECORD_REVIEW': {
      assert(REVIEW_OUTCOMES.includes(action.outcome), '지원하지 않는 의료진 회신 시나리오입니다.');
      assert(next.permissions.share && next.permissions.inquiry && next.packet.status === 'submitted' && next.review.status === 'pending', '자료 보완과 검토 접수를 마친 뒤 의료진 역할의 회신을 재현해 주세요.');
      const defaults = {
        needs_information: '검토에 추가 판독문이 필요합니다. 최신 자료를 보완한 뒤 다시 검토를 요청해 주세요.',
        local_followup: '합성 의료진 역할의 회신입니다. 이번 시연의 현지 진찰과 기록 검토 범위에 맞춰 제주 후속 방문 준비를 진행해 주세요. 실제 환자에게 적용할 진료 계획이 아닙니다.',
        mainland_visit: '합성 의료진 역할의 회신입니다. 이번 시연에서는 도외 대면 방문 준비가 필요하다고 가정합니다. 실제 환자에게 적용할 진료 판단이 아닙니다.',
      };
      const note = action.note === undefined ? defaults[action.outcome] : text(action.note, '의료진 역할 회신', 10000);
      if (action.outcome === 'needs_information') {
        next.packet = { status: 'draft', submittedAt: null };
        Object.assign(next.documents.find(doc => doc.id === 'report'), { status: 'missing', content: '', source: '' });
        next.review = { status: 'needs_information', outcome: 'needs_information', note, source: '합성 의료진 역할 회신' };
      } else {
        next.review = { status: 'completed', outcome: action.outcome, note, source: '합성 의료진 역할 회신' };
      }
      event(next, action.outcome === 'needs_information' ? '추가 자료 보완 요청을 받았어요' : '의료진 역할의 회신을 기록했어요', note, 'review', '합성 의료진 역할 회신');
      break;
    }
    case 'UPDATE_PLAN': {
      assert(object(action.values) && Object.keys(action.values).length > 0, '변경할 방문·비용 조건을 입력해 주세요.');
      const allowed = ['visits', 'caregiverAvailable', ...Object.keys(COST_FIELDS)];
      assert(Object.keys(action.values).every(key => allowed.includes(key)), '지원하지 않는 비용·일정 항목입니다.');
      const plan = { ...next.plan, ...action.values };
      validatePlan(plan);
      next.plan = plan;
      event(next, '방문 부담 가정을 다시 계산했어요', '횟수·예산은 사용자 입력 가정입니다. 진료 계획이나 예약을 변경하지 않았습니다.', 'plan', '사용자 입력 가정');
      break;
    }
    case 'UPDATE_PATIENT': {
      assert(object(action.values) && Object.keys(action.values).length > 0, '변경할 사례 정보를 입력해 주세요.');
      assert(Object.keys(action.values).every(key => ['name', 'area', 'caregiver', 'nextVisit'].includes(key)), '지원하지 않는 사례 정보입니다.');
      for (const [key, value] of Object.entries(action.values)) {
        const normalized = text(value, '사례 정보', 200);
        if (key === 'nextVisit') {
          assert(/^\d{4}-\d{2}-\d{2}$/.test(normalized) && !Number.isNaN(Date.parse(`${normalized}T00:00:00Z`)) && new Date(`${normalized}T00:00:00Z`).toISOString().slice(0, 10) === normalized, '방문일은 올바른 날짜로 입력해 주세요.');
        }
        next.patient[key] = normalized;
      }
      invalidateReview(next);
      event(next, '사례 정보를 수정했어요', '정보 변경에 따라 자료와 검토 상태를 다시 확인합니다.', 'case', '사용자 입력');
      break;
    }
    default: throw new Error('지원하지 않는 작업입니다. 화면의 작업을 다시 선택해 주세요.');
  }
  return next;
}

export function getTasks(state) {
  assertState(state);
  if (state.review.status === 'completed') {
    const burden = calculateBurden(state.plan);
    return [{ id: 'execute-plan', title: state.review.outcome === 'mainland_visit' ? '도외 방문 준비를 정리해 주세요' : '제주 후속 진료 준비를 정리해 주세요', description: `합성 의료진 회신에 따른 준비안입니다. 예약은 아직 확정되지 않았습니다.${burden.careGap ? ` 동행 담당자가 필요한 방문 ${burden.careGap}건이 있습니다.` : ''}`, owner: '보호자', action: 'plan' }];
  }
  if (state.review.status === 'pending') return [{ id: 'wait-review', title: '의료진 역할의 회신을 기다려요', description: '검토 접수를 재현한 상태입니다. 합성 회신으로 추가 자료 요청 또는 다음 준비 단계를 확인할 수 있어요.', owner: '도외 의료진', action: 'wait' }];
  const tasks = [];
  for (const target of TARGETS) {
    const inquiry = state.inquiries[target];
    if (inquiry.status === 'confirmed') continue;
    if (target === 'jeju' && state.inquiries.mainland.status !== 'confirmed') continue;
    tasks.push({
      id: `call-${target}`, title: `${target === 'mainland' ? '기존 도외' : '제주'} 병원에 접수 절차를 문의해 주세요`,
      description: !state.permissions.inquiry ? '전화 문의 위임 범위를 먼저 허용해 주세요.' : inquiry.status === 'unreachable' ? '연결되지 않아 절차는 미확인입니다. 다시 문의할 창구를 확인해 주세요.' : inquiry.status === 'not_participating' ? '협진 미참여는 운영 상태입니다. 다른 참여 창구를 확인할 수 있으며 임상 판단을 뜻하지 않습니다.' : '접수 창구와 필요한 자료를 확인합니다. 통화 응답을 시연합니다.',
      owner: '진행 도우미', action: 'call', target,
    });
  }
  for (const doc of missingDocuments(state)) {
    const definition = DOCUMENT_DEFINITIONS.find(item => item.id === doc.id);
    tasks.push({ id: `prepare-${doc.id}`, title: `${doc.label}를 준비해 주세요`, description: doc.id === 'exam' ? '제주 의료진의 대면 진찰이 필요합니다. 도우미는 진찰 소견을 대신 작성하지 않습니다.' : doc.id === 'referral' ? '의료진이 작성·확인해야 하는 의뢰서입니다.' : definition.description, owner: definition.owner, action: 'document', target: doc.id });
  }
  if (proceduresConfirmed(state) && missingDocuments(state).length === 0) tasks.push({ id: 'submit-packet', title: '준비한 자료의 검토 접수를 진행해 주세요', description: state.permissions.share ? '자료 목록과 출처를 확인한 뒤 접수를 재현합니다. 실제 기관 전송은 하지 않습니다.' : '자료 공유 범위를 확인하고 허용한 뒤 접수를 재현할 수 있어요.', owner: '보호자', action: 'submit' });
  return tasks;
}

export function getProgress(state) {
  assertState(state);
  const required = requiredDocuments(state);
  const prepared = state.documents.filter(doc => required.includes(doc.id) && doc.status === 'ready').length;
  const index = state.review.status === 'completed' ? 4 : state.review.status === 'pending' ? 3 : !proceduresConfirmed(state) ? 1 : 2;
  const steps = [
    { id: 'request', label: '요청 정리' }, { id: 'inquiry', label: '병원 문의' },
    { id: 'documents', label: '자료 준비' }, { id: 'review', label: '전문의 검토' }, { id: 'plan', label: '실행 계획' },
  ].map((step, i) => ({ ...step, status: i < index ? 'done' : i === index ? 'current' : 'pending' }));
  return { index, label: steps[index].label, steps, prepared, total: required.length };
}

export function getSummary(state) {
  const progress = getProgress(state);
  const task = getTasks(state)[0];
  const request = state.review.status === 'needs_information' ? '의료진 역할이 추가 판독문을 요청해 보완 단계로 돌아왔어요. ' : '';
  return `${request}현재는 ${progress.label} 단계이고 필수 자료 ${progress.total}개 중 ${progress.prepared}개가 준비됐어요. ${task ? `${task.title}. ${task.description}` : '현재 조건을 다시 확인해 주세요.'} 이 안내는 결정적 시뮬레이터의 진행 설명이며 의료적 판단이 아닙니다.`;
}

export function calculateBurden(plan) {
  validatePlan(plan);
  const unknownItems = Object.entries(COST_FIELDS).filter(([field]) => plan[field] === null).map(([, label]) => label);
  const perVisit = ['localTransport', 'offIslandTransport', 'lodging', 'medical'].reduce((sum, field) => sum + (plan[field] ?? 0), 0);
  const accompaniedVisits = Math.min(plan.visits, plan.caregiverAvailable);
  return {
    estimatedSubtotal: perVisit * plan.visits + (plan.caregiverTransport ?? 0) * accompaniedVisits,
    unknownItems, careGap: Math.max(0, plan.visits - plan.caregiverAvailable), complete: unknownItems.length === 0,
  };
}

const md = value => String(value ?? '').replace(/[<>]/g, char => char === '<' ? '&lt;' : '&gt;').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

export function buildReport(state) {
  assertState(state);
  const progress = getProgress(state);
  const burden = calculateBurden(state.plan);
  const rows = state.documents.map(doc => `| ${md(doc.label)} | ${doc.status === 'ready' ? '자료 보유' : doc.status === 'not_performed' ? '진찰 시행 전' : '미보유/보완 필요'} | ${md(doc.source || '미확인')} |`).join('\n');
  return `# 제주 진료 나침반 진행 보고서\n\n합성 환자·가상 기관의 시연 결과입니다. 실제 통화·기관 전송·예약·의료진 판단은 수행하지 않았습니다.\n\n작성 시각: ${now()}\n\n## 사례\n\n- 환자: ${md(state.patient.name)} (합성 사례)\n- 보호자: ${md(state.patient.caregiver)}\n- 지역: ${md(state.patient.area)}\n- 기존 병원: ${md(state.patient.existingHospital)}\n- 제주 병원: ${md(state.patient.localHospital)}\n- 목적: ${md(state.patient.purpose)}\n- 준비 일정: ${md(state.patient.nextVisit)} (시연 일정·예약 확정 아님)\n\n## 현재 진행\n\n${getSummary(state)}\n\n전화 문의 허용: ${state.permissions.inquiry ? '허용' : '해제'} / 자료 공유 허용: ${state.permissions.share ? '허용' : '해제'}\n\n${TARGETS.map(target => `- ${target === 'mainland' ? '기존 도외' : '제주'} 병원: ${md(state.inquiries[target].status)} · ${md(state.inquiries[target].response || '미문의')} · 출처: 합성 전화 응답`).join('\n')}\n\n## 준비 자료 (${progress.prepared}/${progress.total})\n\n| 자료 | 상태 | 출처 |\n| --- | --- | --- |\n${rows}\n\n## 다음 행동\n\n${getTasks(state).map(task => `- ${md(task.title)} / 담당: ${md(task.owner)} / ${md(task.description)}`).join('\n')}\n\n## 의료진 역할 회신\n\n${md(state.review.note || '회신 전입니다.')}\n\n출처: ${md(state.review.source || '미확인')}\n\n## 부담 가정\n\n방문 ${state.plan.visits}회, 보호자 동행 가능 ${state.plan.caregiverAvailable}회. 입력한 예산의 소계: ${burden.estimatedSubtotal.toLocaleString('ko-KR')}원. 미확인 항목은 합계에 포함하지 않았으며 0원 확정이 아닙니다.\n\n- 미확인: ${burden.unknownItems.join(', ') || '입력 가정 내 없음'}\n- 동행 미배정 방문: ${burden.careGap}회\n- 계산 범위: 방문당 제주 왕복 이동·환자 도외 왕복 교통·일행 공동 숙박·진료비를 방문 횟수로 곱하고, 보호자 왕복 교통은 동행 가능한 횟수만 곱합니다. 불필요한 항목은 사용자가 명시적으로 0을 입력합니다.\n- 금액·방문 횟수는 사용자 입력 가정이며 실제 견적·급여 판정·의학적 계획이 아닙니다.\n\n## 실행 이력\n\n${state.events.map(item => `- ${item.at}: ${md(item.title)} — ${md(item.detail)} (출처: ${md(item.source)})`).join('\n')}\n\n## 한계\n\n결정적 규칙으로 동작하며 런타임 AI 모델은 연결되지 않았습니다. 공공데이터의 병원명·진료과는 실제 협진 참여나 환자별 적합성을 보장하지 않습니다. 실제 데이터 접근·이용조건, 기관 연동, 통화, 임상 검증은 별도로 필요합니다.\n`;
}
