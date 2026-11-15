import { GUIDED_DEMO_ID } from '../app/guided-demo.js';
import { buildGuidedPreview } from './guided-preview.mjs';
import { createDemoCase } from '../app/domain.js';
import { createToolDispatcher, getPendingActions } from './tools.mjs';
import { JOURNEY_SCENARIOS, CALL_RECOVERY_SCENARIOS, getCareJourneySummary } from '../app/care-journey.js';

/** 모델·DB·전화망을 쓰지 않는 명시적 사전 작성 예시. 자유 입력을 해석하지 않는다. */
export const PREVIEW_SCENARIO = Object.freeze({
  id:'aewol-parent-visit',
  userMessage:'11월 12일 오전 10시, 애월에 계신 어머니의 제주우리병원 방문 준비를 도와줘. 나는 동행할 수 없어서 택시와 동행 지원도 알아봐 줘.',
  steps:[
    ['get_case',{}],
    ['update_visit',{appointmentTime:'10:00',caregiverAvailable:0}],
    ['search_hospital_contacts',{name:'제주우리병원'}],
    ['select_hospital_contact',{hospitalId:'hospital-4'}],
    ['request_records',{source:'nhis'}],
    ['request_records',{source:'demo'}],
    ['request_hospital_contact',{target:'mainland'}],
    ['request_hospital_contact',{target:'jeju'}],
    ['find_support',{kind:'taxi'}],
    ['find_support',{kind:'companion'}],
    ['prepare_inquiries',{kind:'taxi'}],
    ['prepare_inquiries',{kind:'companion'}],
    ['request_support_contact',{kind:'taxi'}],
    ['request_support_contact',{kind:'companion'}],
    ['prepare_review',{}],
  ],
});
export async function buildFixedPreview({capabilities,requestId,scenarioId = PREVIEW_SCENARIO.id,answers}) {
  if (scenarioId === GUIDED_DEMO_ID) return buildGuidedPreview({answers,requestId,capabilities});
  if (scenarioId !== PREVIEW_SCENARIO.id) {
    const recoveryScenario=CALL_RECOVERY_SCENARIOS.find(item=>item.id===scenarioId);
    const scenario = recoveryScenario ?? JOURNEY_SCENARIOS.find(item => item.id === scenarioId);
    if (!scenario) throw new Error('지원하지 않는 합성 상황입니다.');
    const userMessage = `${scenario.label} 상황을 고정 합성 시연으로 실행해 줘.`;
    const result = await createToolDispatcher()({name:recoveryScenario ? 'run_call_recovery_demo' : 'run_journey_demo',input:{scenarioId},state:createDemoCase(),userMessage});
    const summary = getCareJourneySummary(result.state);
    const scenarioReply = {
      call_no_answer:'서버 고정 합성 시계로 15분 안에 최초 포함 최대 2회 문의를 시연했고 세 번째 문의는 어댑터 호출 전에 막았습니다. 재시도는 실제로 예약되지 않았습니다. 실패와 시도 내역·공개 번호·질문·남은 일을 보호자에게 넘깁니다.',
      call_ai_declined:'기관 역할의 AI 응대 거절 뒤 자동 반복 문의를 중단했습니다. 공개 문의번호와 문의 내용·남은 일을 보호자에게 넘기며 재시도 정책으로 중단을 해제하지 않습니다.',
      call_identity_required:'기관 역할의 본인확인 요구를 환자 직접 단계로 넘겼습니다. Agent가 인증정보를 받거나 본인확인·재시도를 완료하지 않습니다.',
      call_documents_or_schedule:'기존 병원의 서류 부족은 판독문 발급·제출 작업에 연결했습니다. 제주 일정 불가는 보호자가 다른 날짜 문의를 허용하기 전에는 막았고, 허용 뒤에도 날짜 선택·예약은 하지 않았습니다. 실패 이유·누적 시도·담당자·남은 일을 보존합니다.',
      missing_record:'요구 문서·일정과 보유 목록을 비교해 판독문 누락을 찾고, 기존 도외 병원의 발급 절차와 제주 제출 방식 문의를 합성으로 이어갔어요. 휠체어 대여·수령·반납 안내를 이동·동행 질문에 연결했습니다. 실제 판독문 발급·제출과 의료진의 진료 연결 확인은 남아 있어요.',
      jeju_unavailable:'제주 요청의 행정 접수 거절을 합성으로 재현했어요. 이를 도외 진료가 필요하다는 임상 결론으로 바꾸지 않고 기존 의료진 계획을 유지하며, 거절 기관을 제외한 공개 문의 후보와 접수 질문을 정리했습니다. 다음에는 담당 창구와 자료 제출 조건을 확인해야 해요.',
      time_changed:'병원 휠체어 대여·수령·반납과 차량 탑승·동행 범위 안내 뒤 진료 시각이 10:00에서 14:00로 바뀐 상황을 합성으로 재현했어요. 이전 조건과 가능 응답을 기록에 남기고 이동·동행을 재확인으로 바꿨습니다. 새 시각의 귀가 차량·진료 지연과 동행 종료시간 재조정은 아직 문의 전이에요.',
    }[scenarioId];
    const reply = `고정 합성 상황 미리보기입니다. ${scenarioReply} 실제 개인 기록 조회·전화·예약·배차·기관의 환자 수락은 수행하지 않았습니다.`;
    return {sessionId:'',requestId,reply,caseState:result.state,events:result.events,pendingActions:getPendingActions(result.state),capabilities:{...capabilities,llm:false},needsInput:true,isPreview:true,
      careJourney:summary,previewMessages:[{role:'user',text:userMessage},{role:'assistant',text:reply}]};
  }
  const dispatch = createToolDispatcher();
  let state = createDemoCase();
  const events = [], pending = [];
  for (const [name,input] of PREVIEW_SCENARIO.steps) {
    const result = await dispatch({name,input,state,userMessage:PREVIEW_SCENARIO.userMessage});
    state = result.state;
    events.push(...result.events);
    pending.push(...result.pendingActions);
  }
  const reply = '고정 합성 대화 예시입니다. 11월 12일 10시 방문 조건으로 제주우리병원의 등록정보, 애월콜과 동행 문의 경로를 연결하고 초안을 준비했어요. 병원 접수 안내와 택시 가능 응답, 동행 연락 실패를 합성으로 재현했습니다. 실제 공단 기록 조회·전화·예약·배차는 이루어지지 않았어요. 다음에는 제주 의료진의 실제 진찰 소견·의뢰서와 동행 지원 가능 여부를 확인해야 합니다.';
  return {
    sessionId:'',requestId,reply,caseState:state,events,
    pendingActions:[...new Map([...pending,...getPendingActions(state)].map(item => [item.id,item])).values()].slice(0,12),
    capabilities:{...capabilities,llm:false},needsInput:true,isPreview:true,
    previewMessages:[{role:'user',text:PREVIEW_SCENARIO.userMessage},{role:'assistant',text:reply}],
  };
}
