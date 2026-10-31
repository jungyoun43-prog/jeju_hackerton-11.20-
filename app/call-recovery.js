import hospitalData from './data/hospital-candidates.json' with { type: 'json' };
import supportData from './data/visit-support-providers.json' with { type: 'json' };

export const CALL_RECOVERY_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'call_no_answer', label: '무응답·재시도 한도', description: '명시한 15분 안에 최초 포함 최대 2회 합성 문의 뒤 자동 재시도를 멈추는 시연' }),
  Object.freeze({ id: 'call_ai_declined', label: 'AI 응대 거절·보호자 인계', description: 'AI 응대 거절 뒤 자동 반복 문의를 중단하고 공개 번호·질문을 보호자에게 넘기는 합성 시연' }),
  Object.freeze({ id: 'call_identity_required', label: '본인확인·환자 직접 단계', description: '기관의 본인확인 요구를 환자 직접 단계로 넘기고 Agent가 인증·재시도를 완료하지 않는 합성 시연' }),
  Object.freeze({ id: 'call_documents_or_schedule', label: '서류·일정 막힘', description: '서류 부족을 발급 작업에 연결하고 예약 불가는 보호자가 허용한 다른 날짜 문의로만 잇는 합성 시연' }),
]);
export const CALL_FAILURE_REASONS = Object.freeze(['no_answer', 'ai_declined', 'identity_required', 'missing_documents', 'no_slots', 'not_participating']);
const TARGETS = ['mainland', 'jeju', 'taxi', 'companion'];
const OUTCOMES = ['answered', ...CALL_FAILURE_REASONS];
const REASONS = {
  recipient_changed:{title:'문의처 변경 · 새 대행 범위 확인',owner:'보호자',detail:'이전 문의처에서 합성 응답을 받은 뒤 수신처가 바뀌었습니다. 이전 연락처·시도 이력을 새 기관의 응답이나 실패로 옮기지 않고 새 대행 범위와 사람의 문의 단계를 확인합니다.'},
  no_answer: { title: '무응답 · 허용 범위 확인', owner: '보호자', detail: '연락이 닿지 않은 합성 시도입니다. 명시적으로 정한 총 횟수·시간 안에서만 다음 문의를 시연할 수 있으며, 기본 미설정이면 자동 재시도하지 않습니다.' },
  ai_declined: { title: 'AI 응대 거절 · 보호자 인계', owner: '보호자', detail: '기관 역할이 AI 응대를 거절했습니다. 자동 반복 문의를 중단하고 공개 문의번호·문의 내용·남은 일을 보호자에게 넘깁니다. 재시도 정책으로 이 중단을 해제하지 않습니다.' },
  identity_required: { title: '본인확인 요구 · 환자 직접 단계', owner: '환자 본인', detail: '기관 역할이 본인확인을 요구했습니다. 환자가 기관의 공식 절차를 직접 진행해야 하며 Agent는 인증정보를 받거나 본인확인·재시도를 완료하지 않습니다.' },
  missing_documents: { title: '서류 부족 · 발급 작업 연결', owner: '환자 본인·적법한 대리인', detail: '최근 검사 판독문이 부족하다는 합성 안내입니다. 보유 목록 비교→기존 병원 발급 문의→원본·작성일 확보→제주 제출 방식 확인으로 연결합니다. 실제 발급·제출은 미실행입니다.' },
  no_slots: { title: '예약 불가 · 다른 날짜 문의 허용 확인', owner: '보호자·기관 접수창구', detail: '요청 일정의 예약이 어렵다는 합성 안내입니다. 보호자가 다른 날짜 문의를 명시적으로 허용한 범위에서만 접수 창구에 다시 묻습니다. 날짜를 임의 선택하거나 예약을 확정하지 않습니다.' },
  not_participating: { title: '접수 미참여 · 다른 창구 확인', owner: '보호자·기관 접수창구', detail: '이번 요청의 행정 접수를 진행하기 어렵다는 합성 안내입니다. 임상 결론이나 도외 유지 확정으로 해석하지 않고 다른 접수 창구를 확인합니다.' },
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const assert = (ok, message = '전화 실패·인계 상태를 확인해 주세요.') => { if (!ok) throw new Error(message); };
const timestamp = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const recipientIds = new Set(['demo-mainland', 'demo-jeju', ...hospitalData.records.map(item => item.id), ...supportData.providers.map(item => item.id)]);
function initialEntry() { return { recipientId: null, reason: null, attempts: [], retryPolicy: { maxAttempts: null, windowMinutes: null, startsAt: null, expiresAt: null }, checkedAt: null, alternativeDateRequestId: null, alternativeDatesAllowed: false }; }
export function createCallRecovery() { return { version: 1, targets: Object.fromEntries(TARGETS.map(target => [target, initialEntry()])) }; }
export function validateCallRecoveryState(value) {
  assert(keys(value, ['version', 'targets']) && value.version === 1 && keys(value.targets, TARGETS));
  for (const [target,entry] of Object.entries(value.targets)) {
    assert(keys(entry, ['recipientId', 'reason', 'attempts', 'retryPolicy', 'checkedAt', 'alternativeDateRequestId', 'alternativeDatesAllowed']));
    assert(entry.recipientId === null || recipientIds.has(entry.recipientId));
    if(entry.recipientId!==null) assert(target==='mainland' ? entry.recipientId==='demo-mainland' : target==='jeju' ? entry.recipientId==='demo-jeju'||hospitalData.records.some(item=>item.id===entry.recipientId) : supportData.providers.some(item=>item.id===entry.recipientId&&item.kind===target));
    assert(entry.reason === null || CALL_FAILURE_REASONS.includes(entry.reason));
    assert(entry.checkedAt === null || timestamp(entry.checkedAt));
    assert(entry.alternativeDateRequestId === null || typeof entry.alternativeDateRequestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{11,79}$/.test(entry.alternativeDateRequestId));
    assert(typeof entry.alternativeDatesAllowed === 'boolean');
    assert(Array.isArray(entry.attempts) && entry.attempts.length <= 50);
    for (const [index, attempt] of entry.attempts.entries()) assert(keys(attempt, ['number', 'at', 'outcome', 'isSimulation']) && attempt.number === index + 1 && timestamp(attempt.at) && OUTCOMES.includes(attempt.outcome) && attempt.isSimulation === true);
    if(entry.reason!==null) assert(entry.attempts.findLast(item=>item.outcome!=='answered')?.outcome===entry.reason);
    const policy = entry.retryPolicy;
    assert(keys(policy, ['maxAttempts', 'windowMinutes', 'startsAt', 'expiresAt']));
    if (policy.maxAttempts === null) assert(Object.values(policy).every(item => item === null));
    else assert(Number.isSafeInteger(policy.maxAttempts) && policy.maxAttempts >= 1 && policy.maxAttempts <= 3 && Number.isSafeInteger(policy.windowMinutes) && policy.windowMinutes >= 1 && policy.windowMinutes <= 120
      && timestamp(policy.startsAt) && timestamp(policy.expiresAt) && Date.parse(policy.expiresAt) === Date.parse(policy.startsAt) + policy.windowMinutes * 60000);
  }
  return value;
}
function recoveryOf(state) { return state.callRecovery ? validateCallRecoveryState(state.callRecovery) : createCallRecovery(); }
export function callRecipientId(state, target) { return target === 'mainland' ? 'demo-mainland' : target === 'jeju' ? hospitalData.records.find(item => item.companyName === state.selectedHospital?.companyName)?.id ?? 'demo-jeju' : state.visitSupport?.[target]?.provider?.id ?? null; }
function contactFor(state, target, recipientId) {
  const hospital = hospitalData.records.find(item => item.id === recipientId), provider = supportData.providers.find(item => item.id === recipientId);
  if (hospital) return { name: hospital.companyName, phone: null, sourceUrl: hospital.source.url };
  if (provider) return { name: provider.name, phone: provider.phone || null, sourceUrl: provider.source.url };
  return { name: target === 'mainland' ? '기존 도외 병원 (가상) · 실제 창구 확인 전' : '제주 협진 병원 (가상) · 실제 창구 확인 전', phone: null, sourceUrl: null };
}
export function getCallAttemptGate(state, target, at) {
  assert(TARGETS.includes(target) && timestamp(at));
  const entry = recoveryOf(state).targets[target], policy = entry.retryPolicy;
  if(entry.recipientId!==null && callRecipientId(state,target)!==entry.recipientId) return {allowed:false,status:'handed_off',stopAutomatic:true,detail:`이전 문의처 ${contactFor(state,target,entry.recipientId).name}의 합성 응답·실패 여부와 시도 이력을 보존합니다. 현재 선택한 새 기관의 응답이나 거절로 해석하지 않습니다. 이 합성 시연은 대상별 한 수신처의 복구를 다루므로 새 기관에는 사람이 확인할 문의 초안을 준비합니다.`};
  if (['ai_declined', 'identity_required', 'not_participating'].includes(entry.reason)) return { allowed: false, status: 'handed_off', stopAutomatic: true, detail: REASONS[entry.reason].detail };
  if (entry.reason && entry.attempts.at(-1)?.outcome === 'answered') return { allowed:false, status:'followup_required',stopAutomatic:true,detail:'실패 뒤 합성 후속 안내를 받았으며 이전 실패·시도 이력과 사람이 마칠 작업을 보존합니다. 실제 예약·발급·본인확인으로 덮지 않습니다.' };
  if (entry.reason === 'missing_documents' && state.documents?.find(item => item.id === 'report')?.status !== 'ready') return { allowed: false, status: 'blocked', stopAutomatic: true, detail: '판독문 원본 확보 작업이 남아 있어 같은 문의를 자동 반복하지 않습니다.' };
  if (entry.reason === 'no_slots' && !entry.alternativeDatesAllowed) return { allowed: false, status: 'waiting_user', stopAutomatic: true, detail: '다른 날짜 문의의 명시적 허용이 없어 일정 문의를 자동 반복하지 않습니다.' };
  if (entry.attempts.length>=50) return {allowed:false,status:'retry_exhausted',stopAutomatic:true,detail:'합성 시도 내역 한도에 도달하여 추가 문의를 실행하지 않습니다.'};
  if (policy.maxAttempts !== null && entry.attempts.length >= policy.maxAttempts) return { allowed: false, status: 'retry_exhausted', stopAutomatic: true, detail: `최초 포함 총 ${policy.maxAttempts}회 한도에 도달했습니다. 새 정책을 반복 적용해도 시도 이력을 초기화하지 않습니다.` };
  if (policy.expiresAt !== null && Date.parse(at) >= Date.parse(policy.expiresAt)) return { allowed: false, status: 'retry_expired', stopAutomatic: true, detail: `허용한 ${policy.windowMinutes}분의 합성 문의 시간이 끝났습니다. 자동 재시도하지 않습니다.` };
  if (entry.reason === 'no_answer' && policy.maxAttempts === null) return { allowed: false, status: 'policy_required', stopAutomatic: true, detail: '재시도 횟수·시간이 미설정이라 무응답 뒤 자동 재시도할 수 없습니다.' };
  return { allowed: true, status: entry.reason === 'no_answer' ? 'retry_allowed' : 'ready', stopAutomatic: false, detail: entry.reason === 'no_answer' ? '명시한 총 횟수·시간 안에서만 다음 합성 문의를 시연할 수 있습니다. 실제 재시도 발신은 예약하지 않았습니다.' : '현재 합성 문의의 준비 조건을 확인합니다.' };
}
/** at·outcome은 서버 어댑터 전용이다. HTTP·모델 도구 인자로 노출하지 않는다. */
export function applyCallRecoveryAction(state, action) {
  assert(TARGETS.includes(action.target));
  const next = structuredClone(state); next.callRecovery = structuredClone(recoveryOf(state));
  const entry = next.callRecovery.targets[action.target];
  if (['CALL_SET_RETRY_POLICY','CALL_ALLOW_ALTERNATIVE_DATES'].includes(action.type)) assert(entry.recipientId===null||entry.recipientId===callRecipientId(next,action.target),'이전 문의처와 새 문의처의 대행 범위를 혼합하지 않습니다. 사람이 새 범위를 확인해 주세요.');
  if (action.type === 'CALL_SET_RETRY_POLICY') {
    assert(keys(action, ['type', 'target', 'maxAttempts', 'windowMinutes', 'at']) && timestamp(action.at));
    assert(Number.isSafeInteger(action.maxAttempts) && action.maxAttempts >= 1 && action.maxAttempts <= 3 && Number.isSafeInteger(action.windowMinutes) && action.windowMinutes >= 1 && action.windowMinutes <= 120);
    if (entry.retryPolicy.maxAttempts === action.maxAttempts && entry.retryPolicy.windowMinutes === action.windowMinutes) return next;
    const startsAt = entry.retryPolicy.startsAt ?? action.at;
    entry.retryPolicy = { maxAttempts: action.maxAttempts, windowMinutes: action.windowMinutes, startsAt, expiresAt: new Date(Date.parse(startsAt) + action.windowMinutes * 60000).toISOString() };
    entry.checkedAt = action.at;
  } else if (action.type === 'CALL_ALLOW_ALTERNATIVE_DATES') {
    assert(keys(action, ['type', 'target', 'requestId']) && typeof action.requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{11,79}$/.test(action.requestId));
    if (entry.alternativeDateRequestId !== action.requestId) { entry.alternativeDateRequestId = action.requestId; entry.alternativeDatesAllowed = true; }
  } else if (action.type === 'CALL_CHECK_GATE') {
    assert(keys(action, ['type', 'target', 'at']) && timestamp(action.at)); entry.checkedAt = action.at;
  } else if (action.type === 'CALL_RECORD_ATTEMPT') {
    assert(keys(action, ['type', 'target', 'outcome', 'at']) && timestamp(action.at) && OUTCOMES.includes(action.outcome));
    assert(getCallAttemptGate(next, action.target, action.at).allowed, '허용된 횟수·시간·사람 인계 단계를 확인한 뒤 문의해 주세요.');
    assert(entry.attempts.length < 50, '합성 문의 내역의 한도에 도달했습니다.');
    entry.recipientId ??= callRecipientId(next, action.target);
    entry.attempts.push({ number: entry.attempts.length + 1, at: action.at, outcome: action.outcome, isSimulation: true });
    entry.checkedAt = action.at;
    if (action.outcome !== 'answered') entry.reason = action.outcome;
    if (action.outcome !== 'answered') {
      if (['mainland','jeju'].includes(action.target)) {
        next.inquiries[action.target] = { ...next.inquiries[action.target], status:action.outcome === 'not_participating' ? 'not_participating' : 'unreachable',response:REASONS[action.outcome].detail,transcript:[{speaker:'기관 역할 · 합성 문의',text:REASONS[action.outcome].detail}],at:action.at };
        next.packet = {status:'draft',submittedAt:null}; next.review = {status:'not_requested',outcome:null,note:'',source:''};
      } else if (next.visitSupport?.[action.target]) {
        const support=next.visitSupport[action.target]; support.status='unreachable_demo';support.response=REASONS[action.outcome].detail;
        if ('wheelchairConfirmed' in support) support.wheelchairConfirmed=false;
        if ('eligibilityConfirmed' in support) support.eligibilityConfirmed=false;
      }
    }
    if (action.outcome === 'no_slots') entry.alternativeDatesAllowed = false;
  } else throw new Error('지원하지 않는 전화 실패·인계 작업입니다.');
  validateCallRecoveryState(next.callRecovery);
  return next;
}
export function getCallRecoveryHandoffs(state) {
  const recovery = recoveryOf(state), handoffs = [];
  for (const target of TARGETS) {
    const entry = recovery.targets[target],changed=entry.recipientId!==null&&callRecipientId(state,target)!==entry.recipientId;
    if (!entry.reason&&!changed) continue;
    const reasonId=entry.reason??'recipient_changed',reason=REASONS[reasonId],at = entry.checkedAt ?? entry.attempts.at(-1)?.at;
    const gate = getCallAttemptGate(state, target, at), contact = contactFor(state, target, entry.recipientId);
    const remainingTasks = reasonId === 'recipient_changed' ? ['이전 수신처의 합성 응답·시도 이력 보존','새 지정 기관의 문의 창구와 새 대행 범위를 보호자가 직접 확인','새 기관의 공개 문의 초안을 사람이 검토'] : entry.reason === 'missing_documents' ? ['요구 문서와 보유 목록 비교', '기존 병원 판독문 발급 창구·본인/대리 확인', '원본과 작성일 확보', '제주 제출 방식·수신 확인']
      : entry.reason === 'no_slots' ? ['보호자가 허용한 다른 날짜 문의 범위 확인', '기관의 가능한 일자 안내 확인', '보호자의 날짜 선택', '변경 뒤 이동·동행 재확인']
      : entry.reason === 'identity_required' ? ['환자가 기관 공식 창구에서 직접 본인확인', '기관이 확인한 뒤 남은 자료·일정 문의를 사람에게 인계']
      : entry.reason === 'ai_declined' ? ['보호자가 공개 문의번호와 질문 확인', '사람이 문의할 창구로 직접 연락', '진행 결과와 남은 자료·일정 확인']
      : entry.reason === 'not_participating' ? ['기존 의료진 계획 유지', '거절 기관을 제외한 공개 문의 후보 확인', '기관 종류·접수 조건과 자료 제출 방식 문의']
      : [gate.allowed ? '허용 횟수·시간 안에서만 다음 합성 문의 시연' : '자동 재시도 중단·보호자의 다음 문의 범위 확인', '접수 창구와 가능한 연락 시간 확인'];
    const questions = [reasonId === 'recipient_changed' ? `현재 지정한 ${contactFor(state,target,callRecipientId(state,target)).name}에 새로 문의할 창구·범위를 보호자가 확인했나요? 이전 기관의 응답을 새 기관에 적용하지 않습니다.` : entry.reason === 'identity_required' ? '환자 본인이 직접 진행해야 할 공식 본인확인 절차와 창구는 어디인가요?' : entry.reason === 'ai_declined' ? '보호자가 직접 문의할 수 있는 창구·공개 번호·응대 시간은 무엇인가요?' : entry.reason === 'missing_documents' ? '누락한 판독문의 발급·제출 형식, 작성일과 수신 확인 절차는 무엇인가요?' : entry.reason === 'no_slots' ? '보호자가 허용한 범위의 다른 날짜를 안내받을 수 있나요? 날짜 선택·예약은 별도로 확인하겠습니다.' : '접수 가능한 창구·연락 시간과 남은 준비 자료는 무엇인가요?',
      '실제 전화·본인확인·발급·예약은 아직 하지 않았습니다. 필요한 사람의 다음 단계만 안내해 주세요.'];
    const requestDraft = `${contact.name}${contact.phone ? ` (${contact.phone}, 공개 등록번호·연결 미확인)` : ' (실제 문의번호 확인 필요)'} 문의를 ${reason.owner}에게 넘길 수 있도록 ${reason.title}의 시도 내역·질문·남은 일을 정리해 줘. 자동 반복 문의나 실제 인증·예약은 진행하지 말아 줘.`;
    handoffs.push({ id: `call-${target}-${reasonId}`, target, reason: reasonId, status: gate.status, title: reason.title, detail: `${reason.detail} ${gate.detail} 문의 이력은 합성 시연이며 실제 발신이 아닙니다.`, attempts: entry.attempts.map(item => ({ ...item })),
      retryPolicy: { configured: entry.retryPolicy.maxAttempts !== null, ...entry.retryPolicy, scheduled: false }, owner: reason.owner, contact, questions, remainingTasks, requestDraft, stopAutomatic: gate.stopAutomatic, actualCallPlaced: false });
  }
  return handoffs;
}
