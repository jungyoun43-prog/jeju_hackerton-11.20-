import { getCallRecoveryHandoffs } from './call-recovery.js';
export { CALL_RECOVERY_SCENARIOS } from './call-recovery.js';
import hospitalData from './data/hospital-candidates.json' with { type: 'json' };
import supportData from './data/visit-support-providers.json' with { type: 'json' };
import { getSupportCandidates } from './support-data.js';

/** 공개 자료는 문의 경로에만 사용한다. 임상 결과·개인 기록·전화는 서버 고정 합성 시연이다. */
export const JOURNEY_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'missing_record', label: '자료 누락', description: '의료진 역할의 요구 자료와 보유 목록을 비교하고 판독문 발급·제출 절차 문의를 잇는 합성 시연' }),
  Object.freeze({ id: 'jeju_unavailable', label: '제주 요청 접수 거절', description: '행정 접수 거절을 임상 결론과 구분하고 다른 공개 문의 후보와 후속 질문을 정리하는 합성 시연' }),
  Object.freeze({ id: 'time_changed', label: '진료 시각 변경', description: '휠체어 대여·이동·동행 안내 뒤 시각이 바뀌어 귀가와 동행을 재확인하는 합성 시연' }),
]);
const PATHWAYS = Object.freeze([
  { id: 'local_transfer', label: '도내 전환', detail: '제주 의료진·기관과 기존 도외 의료진의 확인 근거가 있어야 제주에서 이어갈 준비를 정리합니다.' },
  { id: 'shared_care', label: '부분 제주 진행', detail: '의료진이 확인한 범위에 한해 제주 진찰·검사 준비와 기존 도외 진료를 나눠 연결합니다.' },
  { id: 'mainland_continues', label: '도외 유지', detail: '기존 도외 의료진·기관이 확인한 계획을 따라 방문 준비를 연결합니다. 행정 접수 거절로 정하지 않습니다.' },
]);
const GUIDANCE = Object.freeze({
  preparation: { documentId: 'guidance-preparation-demo', label: '기존 도외 의료진 역할의 자료·일정 안내 · 합성',
    excerpt: '[고정 합성 원문] 치료 이력과 최근 검사 판독문을 준비하고, 예정된 제주 방문에서 실제 진찰 소견과 의료진 명의 의뢰서가 필요한지 확인해 주세요. 방문 전에 판독문 발급 절차와 제주 제출 방법을 확인해 주세요. 진료 연결 방식은 의료진 검토 전입니다.', authoredAt: '2026-10-30', outcome: null },
  local_transfer: { documentId: 'guidance-local-transfer-demo', label: '양 기관 의료진 역할의 도내 전환 안내 · 합성',
    excerpt: '[고정 합성 원문] 제주 진찰 기록과 제출 자료를 양 기관 의료진이 검토한 이 시연에서는 도내 전환 준비를 진행하는 것으로 안내합니다. 실제 환자의 진료 수락이나 예약이 아닙니다.', authoredAt: '2026-10-31', outcome: 'local_transfer' },
  shared_care: { documentId: 'guidance-shared-care-demo', label: '양 기관 의료진 역할의 부분 제주 진행 안내 · 합성',
    excerpt: '[고정 합성 원문] 이 시연에서는 제주 진찰·자료 준비를 진행하고 기존 도외 전문의 진료를 함께 이어가는 범위로 안내합니다. 실제 검사 지시·치료 계획·환자 수락이 아닙니다.', authoredAt: '2026-10-31', outcome: 'shared_care' },
  mainland_continues: { documentId: 'guidance-mainland-continues-demo', label: '기존 도외 의료진 역할의 도외 유지 안내 · 합성',
    excerpt: '[고정 합성 원문] 제출 자료를 검토한 이 시연에서는 기존 도외 대면 방문 준비를 유지하는 것으로 안내합니다. 제주 기관의 행정 접수 여부로 내린 결론이 아니며 실제 환자의 임상 판단이 아닙니다.', authoredAt: '2026-10-31', outcome: 'mainland_continues' },
});
const FINDINGS = Object.freeze({
  jeju_unavailable: {target:'jeju',label:'제주 행정 접수 거절 · 합성',detail:'[고정 합성 원문] 이번 요청의 협진 접수를 진행하기 어렵습니다. 환자별 임상 판단이 아닌 행정 접수 미참여 응답입니다. 다음 문의는 거절 기관을 제외한 공개 후보의 담당 창구·기관 종류·자료 제출 절차이며 기존 의료진 계획을 유지합니다.'},
  report_issuance: { target: 'mainland', label: '판독문 발급 절차 안내 · 합성', detail: '보유 목록에 최근 판독문이 없어 기존 도외 병원의 의무기록 발급 창구에 본인·대리 확인, 발급 기간과 파일 형식을 문의하는 합성 안내를 받았습니다. 실제 발급은 하지 않았습니다. 다음 질문: 제주 접수 창구에서 이 파일의 제출 방법·작성일 확인·수신 확인 절차를 어떻게 안내하나요?' },
  report_submission: { target: 'jeju', label: '제주 자료 제출 방식 안내 · 합성', detail: '도외 병원의 발급 절차 안내를 바탕으로 제주 접수 창구에 파일 형식·제출 경로·작성일과 수신 확인을 문의한 합성 안내입니다. 판독문 원본을 확보한 뒤 별도 본인·대리 확인과 공유 범위를 확인해야 합니다. 실제 발급·기관 전송·수신은 미실행입니다.' },
  hospital_wheelchair: { target: 'jeju', label: '병원 휠체어 대여·수령·반납 안내 · 합성', detail: '합성 병원 역할은 1층 안내 창구에서 대여 문의·수령·당일 같은 창구 반납 절차를 확인하도록 안내했습니다. 당일 수량·실제 대여·병원 밖 반출은 미확인입니다. 다음 이동 문의에는 병원 대여품의 수령 전 이동, 본인 휠체어 사용 여부, 앉은 채 탑승·승하차·동행인 탑승을 따로 확인합니다.' },
  taxi_conditions: { target: 'taxi', label: '이동 탑승·귀가 조정 안내 · 합성', detail: '합성 이동 문의에서 이용자격·회원등록, 휠체어에 앉은 채 탑승 방식, 승하차 보조·동행인 탑승과 희망 시각의 차량을 각각 확인할 항목으로 정리했습니다. 가능 응답만으로 자격·탑승 지원·배차를 확정하지 않습니다. 다음 동행 문의: 진료가 지연되면 귀가 차량 요청 시각과 동행 종료시간·추가 비용을 함께 재조정하나요?' },
  companion_conditions: { target: 'companion', label: '동행 범위·진료 지연 대응 안내 · 합성', detail: '합성 동행 역할은 병원 휠체어 수령·반납 보조, 승하차와 차량 동행인 탑승 범위를 별도로 확인하고, 진료 지연 시 귀가 차량과 동행 종료시간·추가 비용을 재조정하는 절차를 안내했습니다. 실제 동행인 배정·예약은 미확인입니다.' },
});
const SUPPORT_STATUSES = ['not_selected', 'selected', 'prepared', 'available_demo', 'unavailable_demo', 'unreachable_demo', 'needs_recheck'];
const STATUS_LABELS = { not_selected: '문의처 미선택', selected: '공개 문의처 선택', prepared: '문의 준비·응답 전', available_demo: '가능 응답·합성', unavailable_demo: '불가 응답·합성', unreachable_demo: '연락 실패·합성', needs_recheck: '조건 변경·재확인' };
const CONTEXT_KEYS = ['date', 'time', 'area', 'destination', 'wheelchair', 'transportNeeded', 'companionNeeded'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (ok, message = '진료 연결 시연 상태를 확인해 주세요.') => { if (!ok) throw new Error(message); };
const keys = (value, allowed) => isObject(value) && Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const timestamp = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const safeText = (value, max = 1000) => typeof value === 'string' ? value.slice(0, max) : '';
const now = () => new Date().toISOString();

export function createCareJourney() {
  return { version: 1, scenarioId: null, guidance: [], findings: [], scheduleRevision: 0, scheduleChanges: [], medicalRevision: 0 };
}
function contextOf(state) {
  const requirements = state.visitSupport?.requirements ?? {};
  return { date: safeText(state.patient?.nextVisit, 10), time: safeText(requirements.appointmentTime, 5), area: safeText(state.patient?.area, 200),
    destination: safeText(state.selectedHospital?.companyName ?? state.patient?.localHospital, 300), wheelchair: requirements.wheelchair === true,
    transportNeeded: requirements.transportNeeded !== false, companionNeeded: requirements.companionNeeded !== false };
}
function validateContext(value) {
  assert(keys(value, CONTEXT_KEYS));
  assert(value.date === '' || validDate(value.date));
  assert(value.time === '' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time));
  for (const [key, max] of [['area', 200], ['destination', 300]]) assert(typeof value[key] === 'string' && value[key].length <= max && !/[\u0000-\u001f\u007f]/.test(value[key]));
  for (const key of ['wheelchair', 'transportNeeded', 'companionNeeded']) assert(typeof value[key] === 'boolean');
}
/** 저장 허용 필드는 fixed ID·시점·방문 조건뿐이다. 의료 원문·사용자 메시지·모델 응답은 넣지 않는다. */
export function validateCareJourneyState(value) {
  assert(keys(value, ['version', 'scenarioId', 'guidance', 'findings', 'scheduleRevision', 'scheduleChanges', 'medicalRevision']) && value.version === 1);
  assert(value.scenarioId === null || JOURNEY_SCENARIOS.some(item => item.id === value.scenarioId));
  assert(Number.isSafeInteger(value.medicalRevision)&&value.medicalRevision>=0&&value.medicalRevision<=10000);
  assert(Number.isSafeInteger(value.scheduleRevision) && value.scheduleRevision >= 0 && value.scheduleRevision <= 10000);
  assert(Array.isArray(value.guidance) && value.guidance.length <= Object.keys(GUIDANCE).length && new Set(value.guidance.map(item => item.id)).size === value.guidance.length);
  for (const item of value.guidance) {
    assert(Object.hasOwn(GUIDANCE,item.id)&&keys(item,GUIDANCE[item.id].outcome ? ['id','confirmedAt','medicalRevision'] : ['id','confirmedAt'])&&timestamp(item.confirmedAt));
    if(GUIDANCE[item.id].outcome) assert(Number.isSafeInteger(item.medicalRevision)&&item.medicalRevision>=0&&item.medicalRevision<=value.medicalRevision);
  }
  assert(Array.isArray(value.findings) && value.findings.length <= 30);
  for (const item of value.findings) { assert(keys(item, ['id', 'at', 'conditions']) && Object.hasOwn(FINDINGS, item.id) && timestamp(item.at)); validateContext(item.conditions); }
  assert(Array.isArray(value.scheduleChanges) && value.scheduleChanges.length <= 8);
  for (const change of value.scheduleChanges) {
    assert(keys(change, ['revision', 'at', 'previous', 'current', 'taxiStatus', 'companionStatus']));
    assert(Number.isSafeInteger(change.revision) && change.revision > 0 && change.revision <= value.scheduleRevision && timestamp(change.at));
    validateContext(change.previous); validateContext(change.current);
    assert(SUPPORT_STATUSES.includes(change.taxiStatus) && SUPPORT_STATUSES.includes(change.companionStatus));
  }
  return value;
}
function journeyOf(state) { return state?.careJourney ? validateCareJourneyState(state.careJourney) : createCareJourney(); }
function log(state, title, detail) {
  const sequence = (state.events ?? []).reduce((max, item) => Math.max(max, Number(/^event-(\d+)$/.exec(item.id)?.[1]) || 0), 0) + 1;
  state.events = [...(state.events ?? []), { id: `event-${sequence}`, at: now(), title, detail, kind: 'journey', source: '서버 고정 합성 진료 연결 시연 · 실제 발신 없음' }].slice(-200);
}
function findingFor(state, id, current = false) {
  const context = contextOf(state);
  return journeyOf(state).findings.findLast(item => item.id === id && (!current || JSON.stringify(item.conditions) === JSON.stringify(context)));
}
function evidenceForGuidance(item) {
  const original = GUIDANCE[item.id];
  return { documentId: original.documentId, label: original.label, excerpt: original.excerpt, authoredAt: original.authoredAt, confirmedAt: item.confirmedAt,
    confirmation: 'demo_confirmed', sourceUrl: null, isSimulation: true };
}
function documentEvidence(doc) {
  return { documentId: doc.id, label: safeText(doc.label, 300), excerpt: safeText(doc.content, 800), authoredAt: validDate(doc.authoredAt) ? doc.authoredAt : null,
    confirmedAt: null, confirmation: 'unverified', sourceUrl: null, isSimulation: true };
}

/** 서버 고정 합성 결과만 기록한다. Agent 공개 인자에는 action·결과·원문·날짜를 받지 않는다. */
export function applyCareJourneyAction(state, action) {
  const allowed = action.type === 'JOURNEY_START_SCENARIO' ? ['type', 'scenarioId'] : action.type === 'JOURNEY_RECORD_FINDING' ? ['type', 'findingId'] : ['type', 'guidanceId'];
  assert(keys(action, allowed), '고정 합성 시연 항목만 기록할 수 있습니다.');
  const next = structuredClone(state); next.careJourney = structuredClone(journeyOf(state));
  const journey = next.careJourney;
  if (action.type === 'JOURNEY_START_SCENARIO') {
    assert(JOURNEY_SCENARIOS.some(item => item.id === action.scenarioId), '지원하는 합성 상황을 선택해 주세요.');
    journey.scenarioId = action.scenarioId;
    log(next, '합성 진료 연결 상황을 시작했어요', `${JOURNEY_SCENARIOS.find(item => item.id === action.scenarioId).label} · 실제 환자 기록·전화·예약과 구분합니다.`);
  } else if (action.type === 'JOURNEY_RECORD_GUIDANCE') {
    assert(Object.hasOwn(GUIDANCE, action.guidanceId) && next.permissions?.inquiry === true, '허용된 합성 의료진 안내를 확인해 주세요.');
    const original = GUIDANCE[action.guidanceId];
    if (original.outcome) {
      const required = new Set(['history', 'report', 'exam', ...Object.values(next.inquiries ?? {}).flatMap(item => item.requestedDocuments ?? [])]);
      assert(next.permissions.share === true && next.packet?.status === 'submitted' && next.review?.status === 'pending'
        && ['mainland', 'jeju'].every(target => next.inquiries?.[target]?.status === 'confirmed')
        && next.documents.every(doc => !required.has(doc.id) || doc.status === 'ready'), '자료 보완과 양 기관 검토 접수를 마친 뒤 고정 합성 의료진 회신을 확인해 주세요.');
      next.review = { status: 'completed', outcome: original.outcome, note: original.excerpt, source: original.label };
    } else assert(['mainland', 'jeju'].some(target => next.inquiries?.[target]?.status === 'confirmed'), '합성 접수 안내를 먼저 확인해 주세요.');
    journey.guidance = [...journey.guidance.filter(item => item.id !== action.guidanceId), { id: action.guidanceId, confirmedAt: now(), ...(original.outcome ? {medicalRevision:journey.medicalRevision} : {}) }];
    log(next, '고정 합성 의료진 역할 안내를 확인했어요', original.label);
  } else if (action.type === 'JOURNEY_RECORD_FINDING') {
    assert(Object.hasOwn(FINDINGS, action.findingId) && next.permissions?.inquiry === true, '허용된 합성 문의 안내를 확인해 주세요.');
    const target = FINDINGS[action.findingId].target;
    if (target === 'mainland' || target === 'jeju') assert(next.inquiries?.[target]?.status === (action.findingId === 'jeju_unavailable' ? 'not_participating' : 'confirmed'), '해당 기관의 합성 절차 안내가 필요합니다.');
    else assert(next.visitSupport?.[target]?.status === 'available_demo', '해당 지원의 합성 가능 응답이 필요합니다.');
    if (action.findingId === 'report_submission') assert(findingFor(next, 'report_issuance'), '기존 병원의 판독문 발급 절차를 먼저 확인해 주세요.');
    if (action.findingId === 'hospital_wheelchair') assert(contextOf(next).wheelchair, '휠체어 지원 필요 조건을 먼저 확인해 주세요.');
    const context = contextOf(next);
    journey.findings = [...journey.findings.filter(item => item.id !== action.findingId || JSON.stringify(item.conditions) !== JSON.stringify(context)), { id: action.findingId, at: now(), conditions: context }].slice(-30);
    log(next, '합성 문의의 다음 확인을 연결했어요', FINDINGS[action.findingId].label);
  } else throw new Error('지원하지 않는 진료 연결 작업입니다.');
  return next;
}

export function reconcileCareJourney(previous, nextState) {
  const before = contextOf(previous), after = contextOf(nextState);
  if (JSON.stringify(before) === JSON.stringify(after)) return nextState;
  const next = structuredClone(nextState); next.careJourney = structuredClone(journeyOf(nextState));
  const journey = next.careJourney;
  journey.scheduleRevision += 1;
  journey.scheduleChanges = [...journey.scheduleChanges, { revision: journey.scheduleRevision, at: now(), previous: before, current: after,
    taxiStatus: previous.visitSupport?.taxi?.status ?? 'not_selected', companionStatus: previous.visitSupport?.companion?.status ?? 'not_selected' }].slice(-8);
  return next;
}
function contextLabel(context) { return `${context.date || '날짜 미확인'} ${context.time || '시각 미확인'} · ${context.area || '지역 미확인'} → ${context.destination || '기관 미확인'} · 휠체어 ${context.wheelchair ? '필요' : '불필요'}`; }
function changeReasons(change) {
  const labels = { date: '방문일', time: '진료 시각', area: '출발 지역', destination: '방문 기관', wheelchair: '휠체어 조건', transportNeeded: '이동 필요', companionNeeded: '동행 필요' };
  return CONTEXT_KEYS.filter(key => change.previous[key] !== change.current[key]).map(key => `${labels[key]} ${String(change.previous[key] || '미확인')} → ${String(change.current[key] || '미확인')}`);
}

/** 전화 초안에 필요한 행정·이동 정보만 반환한다. 의료 원문·진단·실명은 포함하지 않는다. */
export function getJourneyContactContext(state, target) {
  const lines = [], wheelchair = state.visitSupport?.requirements?.wheelchair === true;
  if (target === 'mainland') {
    if (state.documents?.find(doc => doc.id === 'report')?.status !== 'ready') lines.push('최근 검사 판독문 보유가 미확인입니다. 발급 창구·본인/대리 확인·발급 기간·파일 형식 문의가 필요합니다.');
    if (findingFor(state, 'report_submission')) lines.push('제주 제출 방식의 합성 안내를 바탕으로 발급 파일의 작성일과 형식·수신 확인 절차를 다시 확인합니다.');
  } else if (target === 'jeju') {
    if (findingFor(state, 'report_issuance')) lines.push('기존 병원에서 판독문 발급 절차를 안내한 합성 이력이 있습니다. 파일 제출 방식·작성일 확인·수신 확인을 이어 문의합니다. 실제 발급은 미확인입니다.');
    if (wheelchair) lines.push('병원 휠체어 대여·수령 위치·수령 전 이동 보조·반납 시각과 병원 밖 반출 가능 여부를 확인해 주세요.');
  } else {
    if (wheelchair) {
      if (findingFor(state, 'hospital_wheelchair')) lines.push('병원 역할의 합성 안내: 1층 안내 창구 대여 문의·수령·당일 같은 창구 반납. 당일 수량·대여·반출은 미확인입니다. 수령 전 이동과 본인 휠체어 사용을 구분해 주세요.');
      else lines.push('병원 휠체어 대여·수령·반납이 미확인입니다. 병원 수령 전 이동과 본인 휠체어 사용 여부를 구분해 주세요.');
      lines.push('차량에 휠체어에 앉은 채 탑승하는지, 승하차 보조와 동행인 탑승을 각각 확인해 주세요.');
    }
    if (target === 'companion' && findingFor(state, 'taxi_conditions')) lines.push('이동 문의의 합성 안내를 동행 범위에 반영합니다. 승하차·동행인 탑승·병원 휠체어 반납과 귀가 요청 시각을 함께 맞춰 주세요.');
    lines.push('진료가 지연되면 귀가 차량 요청과 동행 종료시간·추가 비용을 어떻게 재조정하나요?');
    const last = journeyOf(state).scheduleChanges.at(-1);
    if (last && ['available_demo', 'unavailable_demo', 'unreachable_demo', 'needs_recheck'].includes(last[`${target}Status`])) lines.push(`변경 전 ${contextLabel(last.previous)}의 ${STATUS_LABELS[last[`${target}Status`]]}입니다. 변경 후 ${contextLabel(last.current)}: ${changeReasons(last).join(', ')} 때문에 차량·동행 범위를 재확인해 주세요.`);
  }
  return lines;
}
function sourceQuestions(state, kind) {
  const wheelchair = state.visitSupport?.requirements?.wheelchair === true;
  if (kind === 'hospital') return ['공개 등록정보의 기관명·등록 진료과와 현재 접수 창구·기관 종류를 확인해 주세요. 임상 적합성·수용·예약은 미확인입니다.', ...getJourneyContactContext(state, 'jeju')];
  if (kind === 'taxi') return [wheelchair ? '일반 콜택시 자료에 앉은 채 탑승·승하차 지원 필드가 없습니다. 교통약자센터의 이용자격·회원등록·차량 조건을 따로 확인해 주세요.' : '등록 지역에서 병원 왕복·진료 지연 시 귀가 차량을 제공하는지 확인해 주세요.', ...getJourneyContactContext(state, 'taxi')];
  return ['등록 돌봄 문의처가 현재 병원동행을 제공하는지, 담당 지역·기관 종류·자격·신청 절차를 확인해 주세요.', ...getJourneyContactContext(state, 'companion')];
}
function hospitalClass(record) { return /요양병원/.test(record.companyName) ? '요양병원명' : /치과병원/.test(record.companyName) ? '치과병원명' : '병원명'; }
function publicContacts(state) {
  const city = /서귀포/.test(state.patient?.area ?? '') ? '서귀포시' : /제주시/.test(state.patient?.area ?? '') ? '제주시' : '';
  const selected = state.selectedHospital, classification = selected ? hospitalClass(selected) : '';
  const rejected = state.inquiries?.jeju?.status === 'not_participating';
  const hospitals = hospitalData.records.filter(record => (!city || record.address.includes(city)) && (!classification || hospitalClass(record) === classification) && (!rejected || record.companyName !== (selected?.companyName ?? state.patient?.localHospital)));
  const wheelchair = state.visitSupport?.requirements?.wheelchair === true;
  const taxis = getSupportCandidates(supportData, { kind: 'taxi', area: state.patient?.area ?? '', wheelchair });
  const companions = getSupportCandidates(supportData, { kind: 'companion', area: state.patient?.area ?? '', wheelchair });
  return { city, classification, rejected, hospitals, taxis, companions };
}
function dataImpactFor(state, contacts) {
  const area = safeText(state.patient?.area, 200) || '출발 지역 미확인', wheelchair = state.visitSupport?.requirements?.wheelchair === true;
  const taxi327 = contacts.taxis.filter(record => record.source.datasetId === '327'), care254 = contacts.companions.filter(record => record.source.datasetId === '254');
  const officialTaxi = contacts.taxis.filter(record => record.serviceType === 'accessible_transport'), officialCompanion = contacts.companions.filter(record => record.serviceType === 'hospital_escort');
  const names = records => records.slice(0, 4).map(record => record.name ?? record.companyName).join(', ') || '해당 표본 없음';
  return [
    { id: 'hospital859', datasetId: '859', sourceUrl: hospitalData.sourceUrl, title: '병·의원 859 · 공개 표본', candidateCount: contacts.hospitals.length,
      detail: `20행 중 정상 등록 13개에서 ${contacts.city || '지역 미지정'}${contacts.classification ? ` · 선택한 기관과 같은 ${contacts.classification} 분류` : ''}${contacts.rejected ? ' · 접수 거절 기관 제외' : ''}로 문의 후보를 좁혔습니다: ${names(contacts.hospitals)}. 기관명 분류는 면허상 종별·환자 적합성 판정이 아닙니다. 수집 ${hospitalData.time.collectedAt.join(', ')} · 조회 ${hospitalData.retrievedAt.slice(0, 10)}. 현재 수용·협진·예약·휠체어 대여는 미확인입니다.`, questions: sourceQuestions(state, 'hospital') },
    { id: 'taxi327', datasetId: '327', sourceUrl: 'https://www.data.go.kr/data/15056321/fileData.do', title: '콜택시 327 · 연결 공개 파일', candidateCount: taxi327.length,
      detail: `34개 공개 문의처에서 ${area} 등록 지역에 맞는 문의 후보: ${names(taxi327)}. 기준 ${supportData.datasets.find(item => item.id === '327').asOf}. ${wheelchair ? '휠체어 조건 때문에 일반 콜택시 선호보다 별도 공식 이동지원 문의를 먼저 준비하며, 일반 차량의 앉은 채 탑승은 추정하지 않습니다.' : '일반 왕복 이동 문의를 준비합니다.'} 현재 차량·배차·비용은 미확인입니다.`, questions: sourceQuestions(state, 'taxi') },
    { id: 'care254', datasetId: '254', sourceUrl: 'https://jejudatahub.net/data/view/data/254', title: '돌봄 254 · 과거 등록 문의처', candidateCount: care254.length,
      detail: `19개 과거 등록 문의처 중 ${area}의 지역별 기관 문의 후보: ${names(care254)}. 기준 ${supportData.datasets.find(item => item.id === '254').asOf}. ${wheelchair ? '휠체어 수령·반납 보조와 승하차·동행 범위 질문을 추가합니다.' : '병원동행 제공 여부부터 문의합니다.'} 등록 자체는 현재 병원동행 제공·담당지역·인력 확인이 아닙니다.`, questions: sourceQuestions(state, 'companion') },
    { id: 'official-accessible', datasetId: null, sourceUrl: 'https://www.jejuhappycall.com/?mcode=guide01', title: '공식 교통약자 이동지원 안내 · 허브 별도', candidateCount: officialTaxi.length,
      detail: `${names(officialTaxi)} · ${wheelchair ? '휠체어 조건에 따라 우선 문의 경로로 연결합니다.' : '특별한 이동 지원이 필요하면 조건을 확인할 경로입니다.'} ${area}의 이용자격·회원등록·앉은 채 탑승·승하차 보조·동행인·시각별 차량은 별도 문의입니다. 나이·병명으로 자격을 인정하지 않습니다. 조회 ${supportData.retrievedAt.slice(0, 10)}.`, questions: sourceQuestions(state, 'taxi') },
    { id: 'official-escort', datasetId: null, sourceUrl: 'https://www.jjcsc.co.kr/Business/Market', title: '공식 아름동행 소개 · 허브 별도', candidateCount: officialCompanion.length,
      detail: `${names(officialCompanion)} · 병원동행 소개를 별도 문의 경로로 연결합니다. ${area} 지원지역·대상·해당 시각 인력·${wheelchair ? '휠체어 수령·반납·승하차 보조·' : ''}진료 지연 시 귀가와 동행 재조정은 확인 전입니다. 조회 ${supportData.retrievedAt.slice(0, 10)}.`, questions: sourceQuestions(state, 'companion') },
  ];
}

/** 브라우저·Node 공통 순수 DTO. legacy version1 상태에 careJourney가 없어도 읽는다. */
export function getCareJourneySummary(state) {
  const journey = journeyOf(state), context = contextOf(state), contacts = publicContacts(state);
  const guidance = journey.guidance.map(evidenceForGuidance);
  const clinical = journey.guidance.findLast(item => GUIDANCE[item.id].outcome && item.medicalRevision===journey.medicalRevision && state.permissions?.share===true && state.permissions?.inquiry===true);
  const chosen = clinical ? GUIDANCE[clinical.id].outcome : 'unconfirmed';
  const pathway = { status: clinical ? 'demo_confirmed' : 'unconfirmed', outcome: chosen,
    label: clinical ? `${PATHWAYS.find(item => item.id === chosen).label} · 의료진 역할 합성 안내` : '진료 연결 방식 미확인',
    detail: clinical ? '서버 고정 합성 의료진 안내의 출처·작성일·확인일을 표시했습니다. 실제 임상 판단·환자 수락·예약은 확인하지 않았습니다.' : contacts.rejected ? '제주 기관의 행정 접수 거절입니다. 진료 장소의 임상 결론으로 해석하지 않고 기존 의료진 계획을 유지하며 다른 접수 창구를 확인합니다.' : '도내 전환·부분 제주 진행·도외 유지 중 의료진·기관의 확인 근거가 있는 결과는 아직 없습니다. AI가 진료 장소를 정하지 않습니다.', evidence: clinical ? [evidenceForGuidance(clinical)] : [] };
  const tasks = [];
  const task = (id, title, status, owner, detail, evidence = [], requestDraft = '') => tasks.push({ id, title, status, owner, detail, evidence, requestDraft });
  const required = [...new Set(['history', 'report', 'exam', ...Object.values(state.inquiries ?? {}).flatMap(item => item.requestedDocuments ?? []), ...(guidance.length ? ['referral'] : [])])];
  const documents = state.documents ?? [], available = documents.filter(doc => required.includes(doc.id) && doc.status === 'ready'), missing = documents.filter(doc => required.includes(doc.id) && doc.status !== 'ready');
  if (contacts.rejected) task('jeju-alternative', '다른 제주 접수 창구 확인', 'todo', '보호자·기관 접수창구', `접수 거절은 운영 상태입니다. 기존 의료진 계획을 유지하고 거절 기관을 제외한 ${contacts.hospitals.length}개 공개 문의 후보(${contacts.hospitals.slice(0, 3).map(item => item.companyName).join(', ') || '이 지역 표본 없음'})의 담당 창구·기관 종류·접수 조건을 확인합니다. 임의 병원 선택·임상 추천·예약 확정은 하지 않습니다.`, [], '제주 접수 거절은 임상 판단과 구분하고, 현재 지역과 기관 종류에 맞는 다른 공개 문의 후보와 접수 질문을 정리해 줘. 병원은 임의로 선택하지 말아 줘.');
  task('records-compare', '요구 자료와 보유 목록 비교', 'ready', '보호자·양 기관', `요구: ${required.map(id => documents.find(doc => doc.id === id)?.label ?? id).join(', ')}. 보유: ${available.map(doc => doc.label).join(', ') || '없음'}. 보완: ${missing.map(doc => doc.label).join(', ') || '보유 목록상 없음'}. 방문 ${context.date || '미확인'} ${context.time || '시각 미확인'} 전 발급·제출 절차를 문의하며, 작성일 미상은 임의로 채우지 않습니다.`, [...guidance.filter(item => item.documentId === GUIDANCE.preparation.documentId), ...available.map(documentEvidence)], '현재 의료진 역할의 요구 문서·일정과 보유 자료를 비교하고 발급·제출에 필요한 다음 문의를 정리해 줘.');
  const reportReady = documents.find(doc => doc.id === 'report')?.status === 'ready', issuance = findingFor(state, 'report_issuance'), submission = findingFor(state, 'report_submission');
  task('report-issuance', '기존 병원에 판독문 발급 절차 문의', issuance ? 'ready' : 'todo', '기존 도외 병원 의무기록 창구', issuance ? `${FINDINGS.report_issuance.detail} 다음 의존 작업은 실제 판독문 확보와 제주 제출 방식 문의입니다.` : '최근 판독문 보유 여부·작성일을 확인하고 발급 창구, 본인·대리 확인, 기간·비용·파일 형식을 문의합니다. 이 절차 안내 뒤 제주 제출 방식 문의가 이어집니다.', guidance.filter(item => item.documentId === GUIDANCE.preparation.documentId), '기존 도외 병원에 최근 검사 판독문 발급 창구와 본인·대리 확인, 발급 기간·파일 형식을 합성 문의하고 제주 제출 방식의 다음 확인을 연결해 줘.');
  if (!reportReady) task('report-obtain', '판독문 원본·작성일 확보', issuance ? 'todo' : 'blocked', '환자 본인·적법한 대리인', '발급 절차 문의를 먼저 확인한 뒤 원본 파일과 작성일을 확보해야 합니다. 절차 안내는 실제 발급이 아니며 개인 기록 연계는 미연결입니다.', [], '판독문 발급 절차 안내와 실제 원본 확보가 다른 상태인지 확인하고 아직 필요한 본인·대리 확인과 자료를 정리해 줘.');
  task('report-submission', '제주 접수 창구에 제출 방식 문의', submission ? 'ready' : issuance ? 'todo' : 'blocked', '제주 병원 접수창구', submission ? FINDINGS.report_submission.detail : '기존 병원의 판독문 발급 형식 안내를 먼저 확인한 뒤 제주 제출 파일 형식·제출 경로·작성일 확인·수신 확인 절차를 문의합니다. 실제 파일이 없어도 절차 문의는 준비할 수 있습니다.', [], '기존 병원의 판독문 발급 안내를 바탕으로 제주 병원에 제출 파일 형식·작성일 확인·제출 경로와 수신 확인 절차를 합성 문의해 줘.');
  task('report-delivery', '자료 공유 범위와 실제 제출 확인', reportReady && submission ? 'todo' : 'blocked', '환자 본인·적법한 대리인·기관', '판독문 원본 확보와 제출 방식 안내가 선행되어야 합니다. 실제 본인·대리 권한·공유 범위 확인, 기관 제출과 수신 확인은 아직 하지 않았습니다.', [], '실제 기관 전송은 하지 말고, 판독문 원본과 제출 방식 안내 이후 남은 위임·공유 범위·수신 확인 작업을 정리해 줘.');
  for (const doc of missing.filter(item => ['exam', 'referral'].includes(item.id))) task(`physician-${doc.id}`, `${doc.label} 확인`, 'blocked', '담당 의료진', '실제 제주 진찰과 담당 의료진의 기록 작성·확인이 필요합니다. Agent가 진찰 소견·검사 지시·의뢰서를 대신 만들지 않습니다.', [], '제주 의료진의 실제 진찰 소견과 의뢰서 중 아직 필요한 기록과 양 기관 접수 절차만 정리해 줘.');
  if (context.wheelchair) task('wheelchair-loan', '병원 휠체어 대여·수령·반납 확인', findingFor(state, 'hospital_wheelchair', true) ? 'ready' : 'todo', '제주 병원 안내 창구', `${findingFor(state, 'hospital_wheelchair') ? FINDINGS.hospital_wheelchair.detail : '병원 휠체어 대여 가능·수량·수령 장소·수령 전 보조·반납 장소와 시각·반출 가능 여부를 문의합니다.'} 이 답을 차량 탑승 방식과 동행 역할 질문에 반영합니다.`, [], '제주 병원 휠체어 대여·수령·반납과 수령 전 이동 보조를 합성 문의하고, 답을 이동 차량·동행 질문에 반영해 줘.');
  for (const kind of ['taxi', 'companion']) {
    if (!context[kind === 'taxi' ? 'transportNeeded' : 'companionNeeded']) continue;
    const entry = state.visitSupport?.[kind], confirmed = entry?.status === 'available_demo';
    const ready = confirmed && (kind !== 'taxi' || !context.wheelchair || entry.wheelchairConfirmed === true && entry.eligibilityConfirmed === true);
    task(`${kind}-coordination`, kind === 'taxi' ? '차량 탑승·승하차·귀가 조건 확인' : '동행 범위·수령반납·종료시각 확인', entry?.status === 'needs_recheck' ? 'recheck' : ready ? 'ready' : 'todo', kind === 'taxi' ? '이동 지원 문의처' : '동행 지원 문의처', `${STATUS_LABELS[entry?.status] || '문의 전'} · ${getJourneyContactContext(state, kind).join(' ')} 실제 예약·배차·동행인 배정은 미확인입니다.`, [], kind === 'taxi' ? '현재 방문 조건으로 이동 지원의 이용자격·회원등록·휠체어에 앉은 채 탑승·승하차·동행인 탑승과 진료 지연 시 귀가 재조정을 합성 문의해 줘.' : '현재 방문 조건과 이동 문의 안내를 반영해 병원동행의 휠체어 수령·반납 보조·승하차·동행인 탑승·진료 지연 시 귀가와 종료시간 재조정을 합성 문의해 줘.');
  }
  task('pathway-review', '의료진·기관 근거로 진료 연결 확인', clinical ? 'ready' : 'blocked', '양 기관 의료진·접수 담당자', clinical ? pathway.detail : '요구 자료 보완과 실제 진찰·기관 접수 확인 뒤 의료진에게 도내 전환·부분 제주 진행·도외 유지의 범위를 확인해야 합니다. 행정 접수 거절이나 지원 가능 응답으로 진료 장소를 정하지 않습니다.', pathway.evidence, '현재 자료·접수 준비와 실제 의료진 확인이 필요한 부분을 구분해 정리해 줘. 도내 전환이나 도외 유지를 대신 결정하지 말아 줘.');
  const findings = journey.findings.map((item, index) => ({ id: `${item.id}-${index + 1}`, target: FINDINGS[item.id].target, label: FINDINGS[item.id].label,
    detail: `당시 조건: ${contextLabel(item.conditions)}. ${FINDINGS[item.id].detail}${JSON.stringify(item.conditions) !== JSON.stringify(context) ? ' 현재 방문 조건과 다르므로 이전 응답을 현재 조건의 확인으로 사용할 수 없습니다.' : ''}`, at: item.at, isSimulation: true }));
  for (const change of journey.scheduleChanges.filter(item => ['taxiStatus', 'companionStatus'].some(key => /_demo$|needs_recheck/.test(item[key])))) findings.push({ id: `schedule-${change.revision}`, target: 'schedule', label: '방문 조건 변경과 이전 합성 응답',
    detail: `변경 전: ${contextLabel(change.previous)} · 이동 ${STATUS_LABELS[change.taxiStatus]} / 동행 ${STATUS_LABELS[change.companionStatus]}. 변경 후: ${contextLabel(change.current)}. ${changeReasons(change).join(', ')} 때문에 귀가 차량·동행 종료시간과 지원 범위를 재확인해야 합니다. 이전 응답은 실제 예약이 아닙니다.`, at: change.at, isSimulation: true });
  const lastChange = journey.scheduleChanges.at(-1), recheckReasons = [];
  if (lastChange) for (const kind of ['taxi', 'companion']) if (['available_demo', 'unavailable_demo', 'unreachable_demo', 'needs_recheck'].includes(lastChange[`${kind}Status`]) && state.visitSupport?.[kind]?.status !== 'available_demo') recheckReasons.push(`${kind === 'taxi' ? '이동' : '동행'}: ${changeReasons(lastChange).join(', ')}. 이전 ${STATUS_LABELS[lastChange[`${kind}Status`]]}은 새 조건에 적용할 수 없어 ${kind === 'taxi' ? '귀가 차량' : '동행 종료시간·범위'} 재확인이 필요합니다.`);
  const scenario = JOURNEY_SCENARIOS.find(item => item.id === journey.scenarioId);
  const handoffs = getCallRecoveryHandoffs(state);
  tasks.unshift(...handoffs.map(handoff=>({id:handoff.id,title:handoff.title,status:handoff.stopAutomatic?'blocked':'todo',owner:handoff.owner,detail:handoff.detail,evidence:[],requestDraft:handoff.requestDraft})));
  return { version: 1, isSimulation: true, handoffs, pathway, pathways: PATHWAYS.map(item => ({ ...item, selected: item.id === chosen })), tasks, findings,
    schedule: { date: context.date, time: context.time, revision: journey.scheduleRevision, taxiStatus: state.visitSupport?.taxi?.status ?? 'not_selected', companionStatus: state.visitSupport?.companion?.status ?? 'not_selected', recheckReasons },
    dataImpact: dataImpactFor(state, contacts), nextActions: tasks.filter(item => item.status !== 'ready').map(({ id, title, detail, requestDraft }) => ({ id, title, detail, requestDraft })),
    activeScenario: scenario ? { id: scenario.id, label: scenario.label, summary: scenario.description } : null,
    boundary: { actualCallPlaced: false, reservationConfirmed: false, clinicalAcceptanceConfirmed: false, externalRecordsConnected: false } };
}
