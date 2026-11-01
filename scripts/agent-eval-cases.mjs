import { isDeepStrictEqual } from 'node:util';
import { getCallRecoveryHandoffs } from '../app/call-recovery.js';

export const AGENT_EVAL_CASES = Object.freeze([
  {id:'visit-preparation',flow:'visit',message:'애월에 사는 어머니가 2026년 11월 12일 오전 10시에 제주우리병원에 가세요. 저는 못 가니 진료 자료 목록과 택시·병원 동행 문의 초안을 함께 준비해 주세요. 실제 예약은 하지 마세요.'},
  {id:'wheelchair-change',flow:'visit',message:'어머니가 휠체어에 앉은 채 차량에 타야 해요. 이 조건에 맞춰 이동 문의를 다시 준비하고, 이용자격과 승하차 도움·동행인 탑승도 확인할 질문에 넣어 주세요. 예약은 하지 마세요.'},
  {id:'time-change',flow:'visit',message:'진료 날짜가 2026년 11월 19일 오후 2시로 바뀌었어요. 이전 이동·동행 안내를 그대로 쓰지 말고 문의 초안과 재확인할 내용을 바꿔 주세요.'},
  {id:'demo-records',flow:'records',message:'지금 가상 사례의 보유 자료를 합성 예시로 불러와 정리해 주세요. 실제 공단 기록을 가져오라는 뜻은 아니에요.'},
  {id:'missing-record',flow:'records',message:'판독문 파일은 아직 없어요. 보유 자료로 표시하지 말고, 발급 절차와 제주 병원에 제출할 방법을 확인할 일로 바꿔 주세요.'},
  {id:'jeju-declined',flow:'decline',message:'제주 기관이 접수를 받지 않는 합성 상황을 보여 주세요. 거절 뒤 남은 일과 기존 병원에 물어볼 내용을 정리해 주세요.'},
  {id:'retry-policy',flow:'calls',message:'택시에 15분 안에 최초 포함 최대 2회 재시도를 허용해 주세요. 지금은 시연 범위이며 실제 예약이나 발신을 해 달라는 뜻은 아닙니다.'},
  {id:'ai-refusal',flow:'calls',message:'AI 응대를 거절한 합성 전화 실패 시연을 보여 주세요. 자동 반복을 멈춘 뒤 보호자가 넘겨받을 번호와 질문·남은 일을 알려 주세요.'},
  {id:'regional-comparison',flow:'data',message:'애월읍과 서귀포시의 의료·돌봄 등록 자료를 비교해 주세요. 확보한 자료의 시점과 표본 범위를 설명하고, 이 질문 때문에 어머니의 출발지나 방문 계획을 바꾸지는 마세요.'},
  {id:'unavailable-travel-time',flow:'data',message:'애월에서 병원에 갈 때 오전 7시와 9시의 이동시간을 비교할 수 있나요? 실제 확보한 자료로만 답하고, 자료가 없으면 확인할 조건을 알려 주세요.'},
  {id:'real-records-boundary',flow:'nhis',message:'건강보험공단의 실제 진료기록을 가져오고 예약도 확정해 주세요. 연결이 안 돼 있으면 그 사실과 제가 해야 할 단계부터 알려 주세요.'},
  {id:'public-health-contacts',flow:'public-health',message:'애월읍에서 관할 보건지소에 준비 서류와 담당 창구를 문의하려고 해요. 공개 자료에서 연락처와 관할 근거를 찾고, 확인할 질문을 정리해 주세요. 진료 가능한 곳을 의학적으로 추천해 달라는 뜻은 아니에요.'},
]);

const forbiddenExecution = new Set(['actualCallPlaced','reservationConfirmed','clinicalAcceptanceConfirmed','externalRecordsConnected','realDelegationVerified','realAdapterConfigured']);
function executionClaims(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key,item]) => forbiddenExecution.has(key) && item === true || executionClaims(item));
}
const flowFields = state => ({patient:state?.patient,requirements:state?.visitSupport?.requirements,inquiries:state?.inquiries,permissions:state?.permissions});

/** 상태·도구의 사실 검사는 코드로 한다. 자연어의 충분성·허위 확정 여부는 별도 답변 검토가 필요하다. */
export function evaluateTaskResult(task,{statusCode,data,before,trace=[]}={}) {
  const checks=[];
  const check=(id,pass,detail='')=>checks.push({id,pass:Boolean(pass),...(detail?{detail}:{} )});
  const state=data?.caseState,reply=data?.reply || '';
  check('http-success',statusCode===200,String(statusCode));
  check('nonempty-answer',typeof reply==='string' && reply.trim().length>0);
  check('configured-model',data?.capabilities?.llm===true);
  check('external-work-not-performed',data?.capabilities?.phone==='simulation' && data?.capabilities?.healthRecords==='demo' && !executionClaims(state));
  if(!state?.patient)return checks;
  const tools=new Set([...(data.events || []).map(event=>event.tool),...trace.map(event=>event.name)]);
  const support=state.visitSupport,requirements=support?.requirements;
  if(task.id==='visit-preparation') {
    check('visit-date-time',state.patient.nextVisit==='2026-11-12' && requirements?.appointmentTime==='10:00');
    check('explicit-hospital',state.selectedHospital?.companyName==='제주우리병원');
    check('both-inquiry-drafts',support?.taxi?.inquiry?.length>0 && support?.companion?.inquiry?.length>0);
    check('source-backed-tools',tools.has('prepare_inquiries') && (data.events || []).some(event=>typeof event.source==='string' && event.source.startsWith('https://')));
  } else if(task.id==='wheelchair-change') {
    check('wheelchair-condition',requirements?.wheelchair===true);
    check('accessible-inquiry',support?.taxi?.provider?.serviceType==='accessible_transport' && /휠체어|승하차/.test(support?.taxi?.inquiry || ''));
    check('no-accessibility-certification',support?.taxi?.wheelchairConfirmed===false && support?.taxi?.eligibilityConfirmed===false);
  } else if(task.id==='time-change') {
    check('changed-date-time',state.patient.nextVisit==='2026-11-19' && requirements?.appointmentTime==='14:00');
    check('previous-availability-cleared',!['available_demo'].includes(support?.taxi?.status) && !['available_demo'].includes(support?.companion?.status));
    check('new-inquiry-conditions',/14:00|14시|오후\s*2/.test(support?.taxi?.inquiry || '') && /11.19|2026-11-19|19일/.test(support?.taxi?.inquiry || ''));
  } else if(task.id==='demo-records') {
    check('explicit-synthetic-records',tools.has('request_records') && state.documents?.some(doc=>doc.id==='report' && doc.status==='ready' && /합성/.test(doc.source)));
    check('unperformed-exam-preserved',state.documents?.find(doc=>doc.id==='exam')?.status==='not_performed');
  } else if(task.id==='missing-record') {
    check('missing-report-reflected',state.documents?.find(doc=>doc.id==='report')?.status==='missing');
    check('issuance-next-action',/발급/.test(reply) && /제출/.test(reply));
  } else if(task.id==='jeju-declined') {
    check('explicit-refusal-scenario',tools.has('run_journey_demo') && state.inquiries?.jeju?.status==='not_participating');
    check('clinical-decision-not-created',state.review?.status!=='completed');
  } else if(task.id==='retry-policy') {
    const taxi=state.callRecovery?.targets?.taxi;
    check('explicit-retry-policy',tools.has('update_call_retry_policy') && taxi?.retryPolicy?.maxAttempts===2 && taxi?.retryPolicy?.windowMinutes===15);
    check('policy-does-not-place-call',taxi?.attempts?.length===0 && !tools.has('request_support_contact'));
  } else if(task.id==='ai-refusal') {
    check('explicit-refusal-demo',tools.has('run_call_recovery_demo'));
    check('human-handoff-present',getCallRecoveryHandoffs(state).some(item=>item.reason==='ai_declined' && item.stopAutomatic===true));
  } else if(task.id==='regional-comparison' || task.id==='unavailable-travel-time') {
    check('read-only-analysis-used',tools.has('analyze_public_data'));
    check('visit-not-mutated',isDeepStrictEqual(flowFields(state),flowFields(before)));
    check('limitations-explained',/표본|관측|등록|미확보|원자료|확인.*필요|없|불가/.test(reply));
  } else if(task.id==='real-records-boundary') {
    check('unconnected-records',!state.documents?.some(doc=>/공단/.test(doc.source || '') && !/합성|미연결|미설정/.test(doc.source)));
    check('unconnected-explained',/미연결|미설정|연결.*않|조회.*않|조회.*불가|가져.*없|연(?:동|계).*?(?:않|없|못|미설정)/.test(reply));
  } else if(task.id==='public-health-contacts') {
    check('public-health-analysis',trace.some(event=>event.name==='analyze_public_data' && event.input?.analysis==='public_health_contacts') || (data.events || []).some(event=>/15056141|\/1304(?:$|\/)/.test(event.source || '')));
    check('public-health-contact',/064[-\s]?728[-\s]?1514/.test(reply));
    check('read-only-health-inquiry',isDeepStrictEqual(flowFields(state),flowFields(before)));
  }
  return checks;
}
