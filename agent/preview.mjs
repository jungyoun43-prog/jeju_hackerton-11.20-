import { createDemoCase } from '../app/domain.js';
import { createToolDispatcher, getPendingActions } from './tools.mjs';

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
export async function buildFixedPreview({capabilities,requestId}) {
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
