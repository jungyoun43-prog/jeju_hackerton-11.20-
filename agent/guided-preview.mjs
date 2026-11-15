import { createDemoCase } from '../app/domain.js';
import { getGuidedDemo } from '../app/guided-demo.js';
import { getCareJourneySummary } from '../app/care-journey.js';
import { createToolDispatcher, createPhoneSimulationAdapter, getPendingActions } from './tools.mjs';
import { fail } from './errors.mjs';

export async function buildGuidedPreview({answers,requestId,capabilities}) {
  const guidedDemo = getGuidedDemo(answers);
  fail(guidedDemo,'INVALID_PREVIEW_ANSWERS','현재 단계의 고정 답변을 순서대로 선택해 주세요.');
  const adapter = createPhoneSimulationAdapter();
  const dispatch = createToolDispatcher({phoneAdapter:{...adapter,async hospital(input) {
    if (input.target === 'jeju' && answers[1] === 'hospitals_declined') return {outcome:'not_participating',isSimulation:true};
    return adapter.hospital(input);
  }}});
  let state = createDemoCase();
  const events = [];
  const initial = getGuidedDemo([]);
  const previewMessages = [{role:'assistant',text:`${initial.detail} ${initial.title}`}];
  const run = async (name,input={}) => {
    const result = await dispatch({name,input,state,userMessage:'제주우리병원 방문 준비 고정 합성 체험을 실행해 주세요.'});
    state = result.state;
    events.push(...result.events);
  };
  await run('update_visit',{appointmentTime:'10:00',caregiverAvailable:0});
  for (let index=0; index<answers.length; index++) {
    const answer = answers[index];
    const current = getGuidedDemo(answers.slice(0,index));
    previewMessages.push({role:'user',text:current.choices.find(choice=>choice.id===answer).label});
    let resultText;
    switch (index) {
      case 0:
        await run('request_records',{source:'nhis'});
        if (answer === 'records_ready') await run('request_records',{source:'demo'});
        resultText = answer === 'records_ready'?'고정 합성 FHIR의 치료 이력·판독문을 준비 목록에 반영했어요.':'판독문을 미확보 상태로 남겼어요. 다음 병원 문의에서 발급·제출 절차를 확인합니다.';
        resultText += ' 건강정보 고속도로·공단 실제 기록은 미연결이며 진찰 소견·의뢰서는 만들지 않았어요.';
        break;
      case 1:
        await run('search_hospital_contacts',{name:'제주우리병원'});
        await run('select_hospital_contact',{hospitalId:'hospital-4'});
        await run('request_hospital_contact',{target:'mainland'});
        await run('request_hospital_contact',{target:'jeju'});
        resultText = answer === 'hospitals_declined'?'제주 병원의 행정 접수 거절을 합성으로 확인했어요. 임상 결론을 내리지 않고 거절 기관을 제외한 공개 후보와 후속 문의를 남겼어요.':'양쪽 병원의 접수·자료 절차를 합성으로 확인했어요. 미확보 자료의 발급·제출과 실제 의료진 확인은 남아 있어요.';
        break;
      case 2:
        await run('update_visit',{wheelchair:answer==='support_wheelchair',transportNeeded:true,companionNeeded:true});
        for (const kind of ['taxi','companion']) {
          await run('find_support',{kind});
          await run('prepare_inquiries',{kind});
          await run('request_support_contact',{kind});
        }
        resultText = answer === 'support_wheelchair'?'교통약자 이동지원 문의 후보를 우선 연결했어요. 이용자격·앉은 채 탑승과 병원 휠체어 대여·수령·반납은 확인 전이에요.':'애월 지역의 일반 택시와 병원 동행 문의 후보를 연결했어요.';
        resultText += ' 택시 가능 응답은 합성이며 배차가 아닙니다. 동행 연락 실패는 보호자가 문의할 일로 남겼어요.';
        break;
      case 3:
        if (answer === 'plan_changed') await run('update_visit',{appointmentTime:'14:00'});
        await run('prepare_review');
        await run('build_report');
        resultText = answer === 'plan_changed'?'진료 시각을 14:00로 바꾸고 기존 이동·동행 응답을 재확인으로 표시했어요.':'현재 일정의 준비표와 남은 일을 정리했어요.';
        resultText += ' 미확보 자료·병원 접수 상태·동행 인계는 준비표에 유지됩니다. 실제 진찰·자료 공유 동의·의료진 수락·예약은 완료하지 않았어요.';
        break;
    }
    const next = getGuidedDemo(answers.slice(0,index+1));
    previewMessages.push({role:'assistant',text:`${resultText} ${next.title}`});
  }
  return {sessionId:'',requestId,reply:previewMessages.at(-1).text,caseState:state,events:events.slice(-24),
    pendingActions:getPendingActions(state),capabilities:{...capabilities,llm:false},needsInput:true,isPreview:true,
    careJourney:getCareJourneySummary(state),previewMessages,guidedDemo};
}
