import {getCareJourneySummary} from './care-journey.js';
import {getVisitSupportSummary} from './visit-support.js';

export const PREPARATION_STAGES=Object.freeze([
  Object.freeze({id:'records',number:1,title:'방문·자료 확인',shortTitle:'자료 확인'}),
  Object.freeze({id:'hospitals',number:2,title:'병원·협진 준비',shortTitle:'병원 문의'}),
  Object.freeze({id:'support',number:3,title:'이동·동행 조율',shortTitle:'이동·동행'}),
  Object.freeze({id:'plan',number:4,title:'방문 준비표',shortTitle:'방문 준비표'}),
]);
export const PREPARATION_STAGE_IDS=Object.freeze(PREPARATION_STAGES.map(stage=>stage.id));
const labels={not_started:'준비 전',needs_input:'보호자 확인 필요',prepared:'준비 결과 있음',waiting_external:'기관·의료진 확인 필요',handoff:'사람이 이어받을 일',needs_recheck:'변경 조건 재확인',not_needed:'이번 방문은 해당 없음'};
const recorded=status=>['available_demo','unavailable_demo','unreachable_demo','needs_recheck'].includes(status);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

/** 기존 합성 상태의 읽기 전용 업무 projection. 관측·답변 횟수는 완료 근거가 아니다. */
export function getPreparationWorkflow(state) {
  const journey=getCareJourneySummary(state),support=getVisitSupportSummary(state),requirements=state.visitSupport.requirements;
  const tasks=[],questions=new Map(),actions=[];
  const add=(id,stageId,status,actor,owner,title,detail,requestDraft=null,question=null)=>{
    const task={id,stageId,status,actor,owner,title,detail,requestDraft:requestDraft||null};
    tasks.push(task);if(question)questions.set(id,question);return task;
  };
  const needed=['taxi','companion'].filter(kind=>support[kind].status!=='not_needed');
  const destination=state.selectedHospital?.companyName||state.patient.localHospital;
  const core=[
    [validDate(state.patient.nextVisit),'visit-date','records','방문일 확인','방문 날짜를 알려 주세요.'],
    [Boolean(state.patient.area?.trim()),'visit-area','records','출발 지역 확인','출발할 제주 행정지역을 알려 주세요.'],
    [Boolean(destination?.trim()),'visit-hospital','hospitals','방문 대상 확인','문의할 제주 병원 이름을 알려 주세요.'],
  ];
  for(const [known,id,stageId,title,question] of core)if(!known)add(id,stageId,'needs_input','caregiver','보호자',title,'모르는 조건은 미정으로 남기며 임의로 채우지 않습니다.',null,question);
  // 시각 미정은 실제 예약의 공백이다. 공개 문의 초안은 미확인 표기로 먼저 준비할 수 있다.
  if(!requirements.appointmentTime)add('appointment-time','records','waiting_external','institution','진료기관·보호자','진료 시각 확인 필요','진료 시각은 미확인입니다. 실제 기관 문의는 하지 않았습니다. 확인되면 알려 주세요. 다른 문의 초안은 시각 미정으로 준비할 수 있습니다.');
  for(const target of ['mainland','jeju']){
    const inquiry=state.inquiries[target],handoff=journey.handoffs.find(item=>item.target===target);
    const title=`${target==='mainland'?'기존 도외':'제주'} 병원 접수 절차`;
    if(!handoff)add(`hospital-${target}`,'hospitals',inquiry.status==='confirmed'?'prepared':['unreachable','not_participating'].includes(inquiry.status)?'handoff':'not_started',inquiry.status==='not_contacted'?'agent':inquiry.status==='confirmed'?'institution':'caregiver',inquiry.status==='confirmed'?'기관 접수창구':'보호자·기관 접수창구',title,inquiry.response||'접수·의뢰/회송 창구와 준비 자료 문의가 필요합니다. 실제 발신·진료 수락은 확인 전입니다.',`실제 발신 없이 ${target==='mainland'?'기존 도외':'제주'} 병원의 접수 절차 합성 문의 준비를 이어 정리해 줘.`);
  }
  const stageFor=id=>id==='records-compare'||id==='report-obtain'||id==='report-delivery'||id.startsWith('physician-')?'records':id==='report-issuance'||id==='report-submission'||id==='jeju-alternative'||id==='wheelchair-loan'?'hospitals':id.endsWith('-coordination')?'support':'plan';
  for(const task of journey.tasks){
    if(journey.handoffs.some(item=>item.id===task.id)||task.id.endsWith('-coordination'))continue;
    const stageId=stageFor(task.id),clinician=task.id.startsWith('physician-')||task.id==='pathway-review';
    const canPrepare=['report-issuance','report-submission','wheelchair-loan','jeju-alternative'].includes(task.id)&&task.status==='todo';
    add(task.id,stageId,task.status==='ready'?'prepared':task.status==='recheck'?'needs_recheck':canPrepare?'not_started':'waiting_external',clinician?'clinician':canPrepare?'agent':'institution',task.owner,task.title,task.detail,task.requestDraft);
  }
  if(state.documents.some(doc=>doc.id==='history'&&doc.status!=='ready'))add('history-obtain','records','waiting_external','institution','기존 치료 병원·보호자','치료 이력 원본 확보','치료 이력 보유가 미확인입니다. 기존 병원의 발급 절차와 작성일을 확인해야 합니다.');
  for(const handoff of journey.handoffs){
    if(['taxi','companion'].includes(handoff.target)&&!needed.includes(handoff.target))continue;
    add(handoff.id,['mainland','jeju'].includes(handoff.target)?'hospitals':'support','handoff',handoff.reason==='missing_documents'?'institution':'caregiver',handoff.owner,handoff.title,handoff.detail,handoff.requestDraft);
  }
  for(const kind of needed){
    const entry=state.visitSupport[kind],item=support[kind],name=kind==='taxi'?'이동':'동행';
    const handoff=journey.handoffs.some(task=>task.target===kind);
    const priorAttempt=Boolean(state.callRecovery?.targets[kind]?.attempts.length);
    const previousResponse=state.careJourney?.scheduleChanges?.some(change=>recorded(change[`${kind}Status`]));
    const canDraft=core.every(([known])=>known)&&['not_selected','selected'].includes(entry.status)&&!handoff&&!priorAttempt&&!previousResponse;
    if(canDraft)actions.push({name:'prepare_inquiries',input:{kind}});
    if(handoff)continue;
    const status=entry.status==='needs_recheck'||['not_selected','selected'].includes(entry.status)&&(priorAttempt||previousResponse)?'needs_recheck':['unavailable_demo','unreachable_demo'].includes(entry.status)?'handoff':['prepared','available_demo'].includes(entry.status)?'prepared':'not_started';
    add(`${kind}-draft`,'support',status,status==='not_started'?'agent':status==='handoff'?'caregiver':'institution',status==='not_started'?'혼디':status==='handoff'?'보호자':`${name} 지원 문의처`,`${name} 문의 초안`,`${item.providerName?`${item.providerName} · `:''}${item.label}. 실제 예약·배차·동행 배정은 미확인입니다.`,`${name==='이동'?'택시':'병원 동행'} 문의 초안을 현재 방문 조건으로 준비해 줘. 실제 전화는 하지 말아 줘.`);
    if(status==='prepared')add(`${kind}-confirmation`,'support','waiting_external','institution',`${name} 지원 문의처`,`${name} 실제 지원 조건 확인`,item.unresolved.length?item.unresolved.join(' '):'가능 응답은 합성이며 실제 차량·인력·예약·비용 확인이 필요합니다.');
  }
  const remaining=tasks.filter(task=>task.status!=='prepared'&&task.status!=='not_needed');
  const priority=task=>task.status==='needs_input'?0:task.status==='needs_recheck'?1:task.status==='not_started'&&task.actor==='agent'?2:task.status==='handoff'?3:4;
  const automatic=actions.length?tasks.find(task=>task.id===`${actions[0].input.kind}-draft`):null;
  const first=remaining.find(task=>task.status==='needs_input')||remaining.find(task=>task.status==='needs_recheck')||automatic||[...remaining].sort((a,b)=>priority(a)-priority(b))[0]||null;
  const currentTask=first?{...first,question:questions.get(first.id)||null,choices:[]}:null;
  const statusOf=stageTasks=>['needs_input','needs_recheck','handoff','not_started','waiting_external'].find(status=>stageTasks.some(task=>task.status===status))||'prepared';
  const hasWork=Object.values(state.inquiries).some(item=>item.status!=='not_contacted')||['taxi','companion'].some(kind=>state.visitSupport[kind].status!=='not_selected');
  const stages=PREPARATION_STAGES.map(definition=>{
    const stageTasks=tasks.filter(task=>task.stageId===definition.id),left=stageTasks.filter(task=>task.status!=='prepared');
    const status=definition.id==='support'&&!needed.length?'not_needed':definition.id==='plan'?hasWork?'waiting_external':'not_started':statusOf(stageTasks);
    const active=left.find(task=>task.status===status)||left[0];
    return {id:definition.id,title:definition.title,status,label:status==='not_started'&&stageTasks.some(task=>task.status==='prepared')?'남은 준비 있음':labels[status],summary:'',actor:active?.actor||'institution',remainingCount:definition.id==='plan'?remaining.length:left.length};
  });
  const plan=stages[3];plan.label=hasWork?'미확인을 포함한 방문 준비표':'방문 준비표 작성 전';plan.summary=`현재 상태로 계산한 준비표 · 남은 일 ${remaining.length}건 · 실제 예약·배차·진료 수락 미확인`;
  for(const stage of stages.slice(0,3))stage.summary=stage.status==='not_needed'?'이동과 동행 모두 요청하지 않은 조건입니다.':`${stage.label} · 남은 일 ${stage.remainingCount}건`;
  const waitingCount=remaining.filter(task=>['waiting_external','handoff'].includes(task.status)).length;
  return {version:1,currentStageId:currentTask?.stageId||'plan',currentTask,stages,remainingTasks:remaining,nextAutomaticActions:actions,
    summary:{label:remaining.length?`준비 결과와 남은 일 ${remaining.length}건`:'확인한 준비 결과',remainingCount:remaining.length,waitingCount,preparedCount:tasks.filter(task=>task.status==='prepared').length},visitReady:false};
}
