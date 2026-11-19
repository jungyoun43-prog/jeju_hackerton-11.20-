export const GUIDED_DEMO_ID = 'guided-visit';

const steps = [
  {stepId:'records',title:'판독문을 준비하셨나요?',detail:'11월 12일 오전 10시, 애월에 계신 어머니가 제주우리병원을 방문하는 가상 사례예요. 먼저 최근 검사 판독문이 있는지 알려주세요.',choices:[{id:'records_ready',label:'판독문 있어요'},{id:'records_missing',label:'아직 못 받았어요'}]},
  {stepId:'hospitals',title:'양쪽 병원에 어떤 절차를 확인할까요?',detail:'기존 도외 병원에는 자료 발급을, 제주 병원에는 접수와 제출 방법을 문의해요. 체험할 상황을 선택해 주세요.',choices:[{id:'hospitals_accept',label:'양쪽 병원에 절차를 확인해 주세요'},{id:'hospitals_declined',label:'제주 병원이 접수를 받지 않는 경우'}]},
  {stepId:'support',title:'어떤 이동 지원이 필요하세요?',detail:'필요한 차량에 맞는 공개 문의처를 찾고 동행 지원도 알아봐요. 차량 가능 안내와 동행 연락 실패를 시연합니다.',choices:[{id:'support_taxi',label:'일반 택시와 동행이 필요해요'},{id:'support_wheelchair',label:'휠체어 차량과 동행이 필요해요'}]},
  {stepId:'plan',title:'현재 일정으로 준비표를 정리할까요?',detail:'준비한 내용과 아직 확인할 일을 한곳에 모아요. 진료 시각이 바뀌었다면 차량과 동행 조건도 다시 확인해야 해요.',choices:[{id:'plan_keep',label:'현재 일정으로 준비표를 정리해 주세요'},{id:'plan_changed',label:'진료가 오후2시로 바뀌었어요'}]},
];

/** 고정 선택 이력만 허용한다. 종료는 체험 종료이며 실제 진료 준비 완료가 아니다. */
export function getGuidedDemo(answers) {
  if (!Array.isArray(answers) || answers.length > steps.length) return null;
  for (let index=0; index<answers.length; index++) {
    if (!steps[index].choices.some(choice=>choice.id===answers[index])) return null;
  }
  const complete = answers.length === steps.length;
  const step = steps[Math.min(answers.length,steps.length-1)];
  return {answers:[...answers],stepId:step.stepId,title:complete?'방문 준비표를 정리했어요':step.title,
    detail:complete?'체험을 마쳤습니다. 미확인 사항과 사람에게 넘길 일을 확인해 주세요. 실제 발신·예약·배차·의료진 수락은 없습니다.':step.detail,
    choices:complete?[]:step.choices.map(choice=>({...choice})),complete};
}
