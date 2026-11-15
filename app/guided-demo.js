export const GUIDED_DEMO_ID = 'guided-visit';

const steps = [
  {stepId:'records',title:'판독문을 준비하셨나요?',detail:'애월의 가상 어머니가 11월 12일 오전 10시 제주우리병원을 방문하는 합성 체험입니다. 실제 기록 조회·전화·예약은 하지 않습니다.',choices:[{id:'records_ready',label:'판독문 있어요'},{id:'records_missing',label:'아직 못 받았어요'}]},
  {stepId:'hospitals',title:'양쪽 병원에 어떤 절차를 확인할까요?',detail:'자료 보유 현황을 유지하면서 기존 도외 병원과 제주 병원의 접수·발급·제출 절차를 합성 문의합니다.',choices:[{id:'hospitals_accept',label:'양쪽 병원에 절차를 확인해 주세요'},{id:'hospitals_declined',label:'제주 병원이 접수를 받지 않는 경우'}]},
  {stepId:'support',title:'어떤 이동 지원이 필요하세요?',detail:'공개 자료의 문의 후보를 찾아 택시 가능 응답과 동행 연락 실패를 합성으로 확인합니다.',choices:[{id:'support_taxi',label:'일반 택시와 동행이 필요해요'},{id:'support_wheelchair',label:'휠체어 차량과 동행이 필요해요'}]},
  {stepId:'plan',title:'현재 일정으로 준비표를 정리할까요?',detail:'자료 미확보·기관 거절·동행 인계를 남기며 일정이 바뀌면 이동과 동행을 재확인으로 돌립니다.',choices:[{id:'plan_keep',label:'현재 일정으로 준비표를 정리해 주세요'},{id:'plan_changed',label:'진료가 오후2시로 바뀌었어요'}]},
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
