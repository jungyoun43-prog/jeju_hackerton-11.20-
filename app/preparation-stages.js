import {getCareJourneySummary} from './care-journey.js';
import {getVisitSupportSummary} from './visit-support.js';

export const PREPARATION_STAGES=Object.freeze([
  Object.freeze({id:'records',number:1,title:'요청·자료 확인',shortTitle:'자료 확인'}),
  Object.freeze({id:'hospitals',number:2,title:'병원·협진 준비',shortTitle:'병원 문의'}),
  Object.freeze({id:'support',number:3,title:'이동·동행 조율',shortTitle:'이동·동행'}),
  Object.freeze({id:'plan',number:4,title:'방문 계획·답변',shortTitle:'혼디의 정리'}),
]);
export const PREPARATION_STAGE_IDS=Object.freeze(PREPARATION_STAGES.map(stage=>stage.id));
const TOOL_STAGE=Object.freeze({
  apply_care_preferences:'records',get_case:'records',update_visit:'records',request_records:'records',mark_document_missing:'records',
  search_hospital_contacts:'hospitals',select_hospital_contact:'hospitals',request_hospital_contact:'hospitals',
  find_support:'support',prepare_inquiries:'support',request_support_contact:'support',update_call_retry_policy:'support',
  prepare_review:'plan',get_care_journey:'plan',build_report:'plan',summarize_preparation:'plan',
});
export function getToolStage(name,input={}) {
  input=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  if(name==='search_public_data')return ['taxi','companion','travel'].includes(input.purpose)?'support':'records';
  if(name==='analyze_public_data')return ['support_candidates','travel_time'].includes(input.analysis)?'support':'records';
  if(name==='update_call_retry_policy')return ['mainland','jeju'].includes(input.target)?'hospitals':'support';
  if(name==='run_journey_demo')return ({missing_record:'records',jeju_unavailable:'hospitals',time_changed:'support'})[input.scenarioId]??'plan';
  if(name==='run_call_recovery_demo')return ['call_identity_required','call_documents_or_schedule'].includes(input.scenarioId)?'hospitals':'support';
  return Object.hasOwn(TOOL_STAGE,name)?TOOL_STAGE[name]:null;
}
const TOOL_LABELS=Object.freeze({
  apply_care_preferences:'기본 이동 조건',get_case:'현재 준비 상태',update_visit:'방문 조건',request_records:'자료 연결·보유 현황',mark_document_missing:'자료 미보유 정정',
  search_hospital_contacts:'공개 병원 문의 후보',select_hospital_contact:'지정한 병원 문의처',request_hospital_contact:'병원 접수 절차 시연',
  find_support:'공개 이동·동행 문의처',prepare_inquiries:'이동·동행 문의 초안',request_support_contact:'이동·동행 응답 시연',
  update_call_retry_policy:'허용한 재시도 범위',prepare_review:'자료·검토 준비',get_care_journey:'진료 준비의 다음 할 일',build_report:'방문 준비 보고서',
  summarize_preparation:'이번 요청의 준비 결과',search_public_data:'관련 공공데이터 목록',analyze_public_data:'공개 자료 조회·코드 계산',
  run_journey_demo:'합성 진료 여정',run_call_recovery_demo:'합성 전화 인계 상황',
});
// 모델의 임의 문자열을 복사하지 않는다. 새 도구는 고정 표시 목록에서 명시적으로 검토한다.
export const PROGRESS_TOOLS=Object.freeze(Object.keys(TOOL_LABELS));
export function progressActivity(event) {
  const label=Object.hasOwn(TOOL_LABELS,event?.tool)?TOOL_LABELS[event.tool]:null;
  if(!label){
    if(event?.status==='failed')return '이번 요청을 마치지 못했어요. 응답을 확인해 주세요.';
    if(event?.status==='needs_input')return '다음 준비에 필요한 확인이 있어요.';
    if(event?.status==='completed')return '확인한 준비 결과를 받고 있어요.';
    return event?.stage==='plan'?'혼디가 다음 준비와 답변을 확인하고 있어요.':'혼디가 요청을 확인하고 있어요.';
  }
  return `${label} · ${event.status==='started'?'확인 중':event.status==='failed'?'추가 확인 필요':event.status==='needs_input'?'확인할 내용 있음':'결과 도착'}`;
}
const ownKeys=(value,keys)=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const isTool=value=>value===null||PROGRESS_TOOLS.includes(value);
/** 고정 진행 메타데이터만 받는다. 입력·결과·자유문을 진행 정보에 섞지 않는다. */
export function normalizePreparationProgress(value) {
  if(!ownKeys(value,['version','status','sequence','updatedAt','currentStage','stages','events'])||value.version!==1
    ||!['running','completed','failed'].includes(value.status)||!Number.isSafeInteger(value.sequence)||value.sequence<1||value.sequence>128
    ||typeof value.updatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.updatedAt)
    ||!Number.isFinite(Date.parse(value.updatedAt))||new Date(value.updatedAt).toISOString()!==value.updatedAt
    ||value.currentStage!==null&&!PREPARATION_STAGE_IDS.includes(value.currentStage)||!Array.isArray(value.stages)||value.stages.length!==PREPARATION_STAGE_IDS.length
    ||!Array.isArray(value.events)||value.events.length>32)return null;
  for(const [index,stage] of value.stages.entries()){
    if(!ownKeys(stage,['id','status','lastTool'])||stage.id!==PREPARATION_STAGE_IDS[index]
      ||!['waiting','running','observed','needs_input','failed'].includes(stage.status)||!isTool(stage.lastTool))return null;
  }
  let previous=0;
  for(const event of value.events){
    if(!ownKeys(event,['sequence','stage','tool','status'])||!Number.isSafeInteger(event.sequence)||event.sequence<=previous||event.sequence>value.sequence
      ||!PREPARATION_STAGE_IDS.includes(event.stage)||!isTool(event.tool)||!['started','completed','needs_input','failed'].includes(event.status))return null;
    previous=event.sequence;
  }
  const serialized=JSON.stringify(value);
  if(typeof serialized!=='string'||new TextEncoder().encode(serialized).byteLength>8192)return null;
  return structuredClone(value);
}
const source=value=>value&&typeof value.url==='string'?{url:value.url,label:value.datasetId?`제주데이터허브 ${value.datasetId}`:'공식 서비스 안내'}:null;
const uniqueSources=items=>[...new Map(items.filter(Boolean).map(item=>[item.url,item])).values()];
const safeEvent=event=>({tool:String(event.tool??''),label:String(event.label??'처리 결과').slice(0,160),detail:String(event.detail??'').slice(0,500),status:event.status,isSimulation:event.isSimulation===true,source:typeof event.source==='string'?event.source:''});
function baseStage(definition,status,label,summary,facts=[],gaps=[],sources=[]) {
  return {...definition,status,label,summary,facts,gaps,sources:uniqueSources(sources),events:[],liveActivity:'',live:false};
}

/** 읽기 전용 화면 projection. 단계 완료는 임상 수락·예약·배차 완료를 뜻하지 않는다. */
export function getPreparationBoard(state,{events=[],progress=null,pending=false,responseCount=0,requestProblem=''}={}) {
  progress=normalizePreparationProgress(progress);
  const journey=getCareJourneySummary(state),support=getVisitSupportSummary(state),requirements=state.visitSupport.requirements;
  const docs=state.documents??[],available=docs.filter(doc=>doc.status==='ready').length;
  const recordGaps=docs.filter(doc=>doc.status!=='ready').map(doc=>`${doc.label} · ${doc.status==='not_performed'?'의료진 수행·확인 필요':'보유 여부 확인 필요'}`);
  if(!requirements.appointmentTime)recordGaps.unshift('진료 시각을 확인해 주세요.');
  const records=baseStage(PREPARATION_STAGES[0],recordGaps.length?'needs_input':'available',recordGaps.length?'확인할 정보 있음':'자료 확인 결과',
    `보유 표시 ${available}개 · 합성 자료`,[
      {label:'출발',value:state.patient.area},{label:'방문',value:`${state.patient.nextVisit} · ${requirements.appointmentTime||'시각 미정'}`},
      {label:'자료',value:docs.filter(doc=>doc.status==='ready').map(doc=>doc.label).join(' · ')||'보유 자료 확인 전'},
    ],recordGaps);
  const inquiries=Object.entries(state.inquiries??{}),confirmed=inquiries.filter(([,item])=>item.status==='confirmed').length;
  const hospitalHandoffs=journey.handoffs.filter(item=>['mainland','jeju'].includes(item.target));
  const hospitalBlocked=!!hospitalHandoffs.length||inquiries.some(([,item])=>['unreachable','not_participating'].includes(item.status));
  const inquiryLabels={not_contacted:'문의 준비 전',confirmed:'접수 안내 · 시연',unreachable:'연락 확인 필요 · 시연',not_participating:'해당 요청 접수 불가 · 시연'};
  const hospitals=baseStage(PREPARATION_STAGES[1],hospitalBlocked?'needs_input':confirmed?'available':'waiting',hospitalBlocked?'사람이 이어받을 일':confirmed?'절차 안내 있음 · 시연':'문의 준비 전',
    `양 기관 접수 절차 ${confirmed}/2곳 안내 · 실제 진료 수락 미확인`,[
      {label:'기존 병원',value:inquiryLabels[state.inquiries.mainland.status]||'확인 전'},
      {label:'제주 병원',value:`${state.patient.localHospital} · ${inquiryLabels[state.inquiries.jeju.status]||'확인 전'}`},
    ],hospitalHandoffs.map(item=>`${item.owner} · ${item.detail}`));
  const supportHandoffs=journey.handoffs.filter(item=>['taxi','companion'].includes(item.target));
  const recheck=['taxi','companion'].some(kind=>support[kind].status==='needs_recheck');
  const selected=['taxi','companion'].some(kind=>!['not_selected','not_needed'].includes(support[kind].status));
  const supportBlocked=!!supportHandoffs.length||['taxi','companion'].some(kind=>['unavailable_demo','unreachable_demo'].includes(support[kind].status));
  const mobility=baseStage(PREPARATION_STAGES[2],recheck?'needs_recheck':supportBlocked?'needs_input':selected?'available':support.totalNeeded?'waiting':'not_needed',
    !support.totalNeeded?'이번 조건에서 필요 없음':recheck?'변경 조건 재확인':supportBlocked?'인계·추가 확인 필요':selected?'문의 준비 결과':'문의 준비 전',
    !support.totalNeeded?'이번 조건에서는 별도의 이동·동행 지원을 요청하지 않았어요.':requirements.wheelchair?'휠체어 탑승·승하차 지원과 동행 조건을 함께 확인해요.':'출발 지역과 방문 시각에 맞는 이동·동행을 준비해요.',
    ['taxi','companion'].map(kind=>({label:kind==='taxi'?'이동':'동행',value:support[kind].status==='not_needed'?'필요 없음':support[kind].providerName?`${support[kind].providerName} · ${support[kind].label}`:support[kind].label})),
    [...journey.schedule.recheckReasons,...supportHandoffs.map(item=>`${item.owner} · ${item.detail}`),...support.unresolved],
    ['taxi','companion'].map(kind=>support[kind].status==='not_needed'?null:source(support[kind].source)));
  const plan=baseStage(PREPARATION_STAGES[3],responseCount?'available':'waiting',responseCount?'이번 요청의 답변':'말씀을 기다리고 있어요.',
    responseCount?'확인된 준비와 남은 일을 함께 읽어 보세요.':'입력창에 필요한 준비를 한 번에 말씀해 주세요.',
    [{label:'다음 확인',value:journey.nextActions[0]?.title||'요청하실 내용을 말씀해 주세요.'}],[]);
  const stages=[records,hospitals,mobility,plan];
  // 기호는 자료·문의 준비만 요약한다. 미확인은 문의 실패나 임상 부적합이 아니다.
  records.signal=recordGaps.length?'attention':'available';
  hospitals.signal=hospitalBlocked?'blocked':confirmed===inquiries.length?'available':confirmed?'attention':'waiting';
  const requiredSupport=['taxi','companion'].filter(kind=>support[kind].status!=='not_needed');
  const draftedSupport=requiredSupport.every(kind=>['prepared','available_demo'].includes(support[kind].status));
  mobility.signal=!support.totalNeeded?'not_needed':recheck?'attention':supportBlocked?'blocked':draftedSupport?'available':selected?'attention':'waiting';
  plan.signal=responseCount?'available':'waiting';
  for(const event of Array.isArray(events)?events:[]){
    if(!event||typeof event!=='object')continue;
    const id=PREPARATION_STAGE_IDS.includes(event.stage)?event.stage:event.tool==='analyze_public_data'&&/이동|동행/.test(event.label)?'support':getToolStage(event.tool);
    if(id)stages.find(stage=>stage.id===id).events.push(safeEvent(event));
  }
  for(const stage of stages){stage.events=stage.events.slice(-5);const gaps=[...new Set(stage.gaps)];stage.gapCount=gaps.length;stage.gaps=gaps;}
  let activeStageId=responseCount?'plan':'records';
  const live=pending&&progress?.status==='running'&&PREPARATION_STAGE_IDS.includes(progress.currentStage);
  if(live)activeStageId=progress.currentStage;
  if(pending&&progress){
    for(const stage of stages){
      const reported=progress.stages.find(item=>item.id===stage.id);
      const observed=progress.events.filter(event=>event.stage===stage.id).at(-1);
      if(observed)stage.liveActivity=progressActivity(observed);
      else if(reported&&reported.status!=='waiting')stage.liveActivity=progressActivity({stage:stage.id,tool:reported.lastTool,status:reported.status==='running'?'started':reported.status==='observed'?'completed':reported.status});
      stage.live=!!live&&stage.id===activeStageId;
    }
  }
  if(requestProblem){plan.status='needs_input';plan.signal='attention';plan.label='응답 확인 필요';plan.summary=requestProblem;activeStageId='plan';}
  return {version:1,activeStageId,stages,pending,hasResponse:responseCount>0,progressAvailable:!!progress,
    boundary:journey.boundary,overallLabel:pending?(progress?'준비 도구의 진행 상태를 확인하고 있어요.':'요청을 전달하고 답변을 기다리고 있어요.'):'실제 전화·예약·배차는 연결 전 · 현재 합성 사례',
  };
}
