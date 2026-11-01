import { PUBLIC_DATA_TOOLS, executePublicDataTool, PUBLIC_DATA_SOURCE_URLS } from './public-data-tools.mjs';
import { getPreparationDataEvidence } from '../app/public-data-skill.js';
import { randomUUID } from 'node:crypto';
import { applyAction, createDemoCase, getTasks, buildReport } from '../app/domain.js';
import { getVisitSupportSummary, buildSupportInquiry } from '../app/visit-support.js';
import { filterHospitals } from '../app/hospitals.js';
import { getSupportCandidates, validateSupportRegistry } from '../app/support-data.js';
import hospitalData from '../app/data/hospital-candidates.json' with {type:'json'};
import supportData from '../app/data/visit-support-providers.json' with {type:'json'};
import { AgentError, fail } from './errors.mjs';
import { validateSchema } from './validation.mjs';
import { normalizeCarePreferences } from '../app/care-preferences.js';
import { CALL_TARGETS, buildCallPlan } from '../app/call-policy.js';
import { CALL_RECOVERY_SCENARIOS, CALL_FAILURE_REASONS, callRecipientId, getCallAttemptGate, getCallRecoveryHandoffs } from '../app/call-recovery.js';
import { getCareJourneySummary, JOURNEY_SCENARIOS } from '../app/care-journey.js';
import { getPreparationWorkflow } from '../app/preparation-workflow.js';

const registry = validateSupportRegistry(supportData);
const HOSPITAL_SOURCE = 'https://jejudatahub.net/data/view/data/859';
const NHIS_SOURCE = 'https://www.nhis.or.kr/';
const SOURCE_URLS = new Set([HOSPITAL_SOURCE, NHIS_SOURCE, ...registry.providers.flatMap(item => [item.source.url, item.source.hubUrl]).filter(Boolean), ...PUBLIC_DATA_SOURCE_URLS.map(value=>new URL(value).href)]);
export function assertSourceUrl(value) {
  let parsed; try { parsed = new URL(value); } catch { throw new AgentError('INVALID_SOURCE', '확인된 공식 출처 URL이 필요합니다.'); }
  fail(parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && SOURCE_URLS.has(parsed.href), 'INVALID_SOURCE', '확인된 공식 출처만 사용할 수 있습니다.');
  return parsed.href;
}
for (const hospital of hospitalData.records) {
  assertSourceUrl(hospital.source.url);
  fail(hospital.source.datasetId === '859' && hospital.source.kind === 'public-preview' && hospital.source.apiVerified === false, 'INVALID_SOURCE', '병원 공개 자료 출처를 확인해 주세요.');
}
const ADMIN_AREAS = Object.freeze([
  '제주시', '서귀포시',
  ...['애월읍','한림읍','한경면','구좌읍','조천읍','우도면','추자면'].map(area => `제주시 ${area}`),
  ...['대정읍','남원읍','성산읍','안덕면','표선면'].map(area => `서귀포시 ${area}`),
  ...['일도1동','일도2동','이도1동','이도2동','삼도1동','삼도2동','용담1동','용담2동','건입동','화북동','삼양동','봉개동','아라동','오라동','연동','노형동','외도동','이호동','도두동'].map(area => `제주시 ${area}`),
  ...['송산동','정방동','중앙동','천지동','효돈동','영천동','동홍동','서홍동','대륜동','대천동','중문동','예래동'].map(area => `서귀포시 ${area}`),
]);
const objectSchema = (properties = {}, required = [], extra = {}) => ({type:'object', properties, required, additionalProperties:false, ...extra});
const shortText = maxLength => ({type:'string', maxLength});
const kindSchema = {type:'string', enum:['taxi','companion']};
export const AGENT_TOOLS = Object.freeze([
  {name:'update_call_retry_policy',description:'사용자가 이번 요청의 같은 절에서 문의 대상과 N분 안에 최초 포함 최대 M회 재시도해 달라는 긍정 요청을 명시한 경우에만 합성 문의 허용 범위를 설정한다. 총1~3회·1~120분. 기존 시도·시계는 초기화하지 않으며 실제 자동 발신 예약·환자 위임이 아니다. AI거절·본인확인 중단을 해제하지 못한다.',inputSchema:objectSchema({target:{type:'string',enum:CALL_TARGETS},maxAttempts:{type:'integer',minimum:1,maximum:3},windowMinutes:{type:'integer',minimum:1,maximum:120}},['target','maxAttempts','windowMinutes'])},
  {name:'run_call_recovery_demo',description:'사용자가 무응답/AI응대거절/본인확인/서류·일정 막힘 중 특정 상황의 합성 시연 실행을 명시한 때만 고정 전화 실패·인계 예시를 실행한다. 실제 전화·인증·예약이나 재시도 발신 예약은 하지 않는다.',inputSchema:objectSchema({scenarioId:{type:'string',enum:CALL_RECOVERY_SCENARIOS.map(item=>item.id)}},['scenarioId'])},
  {name:'get_care_journey', description:'현재 진료 연결 근거, 요구 문서·일정과 보유자료 비교, 발급·제출 문의, 휠체어·귀가·동행 후속 작업과 조건 변경 재확인을 읽는다. 의료진 근거 없는 결과를 선택하지 않는다.', inputSchema:objectSchema()},
  {name:'run_journey_demo', description:'사용자가 특정 상황의 합성 시연·미리보기 실행을 명시적으로 요청했을 때만 고정 자료 누락/제주 접수 거절/진료 시각 변경 예시를 실행한다. 현재 합성 사례를 해당 고정 예시로 바꾸며 실제 결과·원문·날짜를 받지 않는다. 일반 방문 준비 요청에서는 사용하지 않는다.', inputSchema:objectSchema({scenarioId:{type:'string',enum:JOURNEY_SCENARIOS.map(item => item.id)}}, ['scenarioId'])},
  {name:'get_case', description:'서버의 합성 사례, 준비 상태·빠진 작업과 병원·이동·동행 전화 준비 요약을 확인한다. 실제 환자 위임 검증이 아니다.', inputSchema:objectSchema()},
  {name:'update_visit', description:'보호자가 명시한 방문일·행정지역·시각·이동/동행 필요만 변경한다. 실명·의료기록·주소 상세는 받지 않는다.', inputSchema:objectSchema({
    date:{type:'string',format:'date',maxLength:10}, area:{type:'string',enum:ADMIN_AREAS}, appointmentTime:{type:'string',format:'time',maxLength:5},
    transportNeeded:{type:'boolean'}, companionNeeded:{type:'boolean'}, wheelchair:{type:'boolean'}, caregiverAvailable:{type:'integer',minimum:0,maximum:100},
  }, [], {minProperties:1})},
  {name:'search_hospital_contacts', description:'허브859 공개13개 기관의 등록 사실을 검색한다. 현재 수용·협진·환자 적합성을 판단하지 않는다.', inputSchema:objectSchema({name:shortText(100),department:shortText(100),area:shortText(100)})},
  {name:'select_hospital_contact', description:'보호자가 현재 요청에서 이름을 명시한 공개 기관을 문의 대상으로 설정한다. 임상 장소 추천은 하지 않는다.', inputSchema:objectSchema({hospitalId:{type:'string',pattern:'^hospital-[0-9]{1,2}$',maxLength:20}}, ['hospitalId'])},
  {name:'request_records', description:'demo는 서버의 고정 합성 자료만 정리한다. nhis는 승인된 기록 연계가 미설정인 상태를 반환한다. 진찰 소견을 작성하지 않는다.', inputSchema:objectSchema({source:{type:'string',enum:['demo','nhis']}}, ['source'])},
  {name:'mark_document_missing', description:'보호자가 이번 요청에서 치료 이력·판독문·의뢰서 파일을 없거나 미보유라고 명시한 경우에만 합성 준비 목록을 미보유로 정정한다. 이전 제출·검토를 무효화한다. 문서 삭제나 실제 의료기록 조회가 아니며 미시행 진찰 상태는 변경하지 않는다.', inputSchema:objectSchema({documentId:{type:'string',enum:['history','report','referral']}}, ['documentId'])},
  {name:'request_hospital_contact', description:'제주 또는 기존 도외 병원 역할에 협진·의뢰/회송 창구와 접수·자료 절차를 묻는 합성 전화 시연. 공통 위임·최소정보·AI·기록 처리 계획을 포함하며 실제 발신·진료 수락·예약이 아니다.', inputSchema:objectSchema({target:{type:'string',enum:['mainland','jeju']}}, ['target'])},
  {name:'find_support', description:'택시327·돌봄254·별도 공식서비스에서 현재 행정지역과 지원 유형의 문의 후보를 찾는다. 가능 시간·예약은 미확인이다.', inputSchema:objectSchema({kind:kindSchema}, ['kind'])},
  {name:'prepare_inquiries', description:'공개 문의처 선택과 문의 초안을 함께 준비한다. providerId 생략 시 지역·휠체어 조건과 검증한 선호 택시를 반영한다. find_support 선행은 필수가 아니며 의료기록은 포함하지 않는다.', inputSchema:objectSchema({kind:kindSchema,providerId:{type:'string',maxLength:100,pattern:'^[a-z0-9_-]+$'}}, ['kind'])},
  {name:'request_support_contact', description:'현재 초안과 공통 전화 계획으로 합성 응답을 실행한다. 휠체어 이용자격·등록·탑승·승하차·동행인 탑승·희망 시각의 차량 여부도 문의 항목이다. 실제 예약·배차·동행인 배정은 하지 않는다.', inputSchema:objectSchema({kind:kindSchema}, ['kind'])},
  {name:'prepare_review', description:'현재 보유 자료와 접수 조건으로 의료진 검토 준비 상태를 정리한다. 미시행 대면진찰과 공유 동의는 대신 만들지 않는다.', inputSchema:objectSchema()},
  {name:'build_report', description:'확인된 준비 상태·근거와 미확인 사항을 보고서로 정리한다. 의료적 결론을 내리지 않는다.', inputSchema:objectSchema()},
  ...PUBLIC_DATA_TOOLS,
]);
const toolMap = new Map(AGENT_TOOLS.map(tool => [tool.name, tool]));
const PUBLIC_DATA_TOOL_NAMES = new Set(PUBLIC_DATA_TOOLS.map(tool=>tool.name));
function preparationDataContext(state) {
  return {area:state.patient.area,wheelchair:state.visitSupport.requirements.wheelchair,hospitalName:state.selectedHospital?.companyName || state.patient.localHospital};
}
function preparationDataEvidence(state,purpose) {
  const evidence=getPreparationDataEvidence(preparationDataContext(state),purpose);
  // 이미 선택·준비한 문의를 다른 후보 제안으로 덮지 않고 근거와 질문만 붙인다.
  const {preparationActions,...compact}=evidence;
  return compact;
}


export function createPhoneSimulationAdapter() {
  return Object.freeze({
    isSimulation:true,
    async hospital({target}) { return {outcome:target === 'mainland' ? 'referral' : 'documents', isSimulation:true}; },
    async support({kind}) { return {outcome:kind === 'taxi' ? 'available' : 'unreachable', isSimulation:true, wheelchairConfirmed:false,eligibilityConfirmed:false}; },
  });
}
const recordsTemplate = Object.freeze({
  report:'[고정 합성 판독문 보유 예시] 최근 검사 자료의 파일이 있는 것으로 시연합니다. 실제 검사 결과·병변·치료 판단은 포함하지 않습니다. 의료진이 원본과 시행일을 확인해야 합니다.',
});
function event(tool, label, detail, {status = 'completed', isSimulation = false, source} = {}) {
  if (typeof source === 'string' && /^https?:/i.test(source)) assertSourceUrl(source);
  return {id:randomUUID(), tool,label,status,detail,isSimulation,...(source ? {source} : {})};
}
function pending(kind,label,reason) { return {id:`pending-${kind}`,kind,label,reason}; }
const realCallStatus = Object.freeze({realDelegationVerified:false,realAdapterConfigured:false,actualCallPlaced:false,reservationConfirmed:false,clinicalAcceptanceConfirmed:false});
function callPlanSummaries(state) {
  return CALL_TARGETS.map(target => {
    const plan = buildCallPlan(state,target);
    return {target,recipient:plan.recipient.name,status:plan.simulation.status,label:plan.simulation.label,
      requiredChecks:plan.preCallChecks.filter(check => ['delegation','recipient','record-handling'].includes(check.id)).map(({label,status}) => ({label,status}))};
  });
}
export function getPendingActions(state) {
  const journey = getCareJourneySummary(state);
  const tasks = journey.nextActions.slice(0, 5).map(task => pending(`journey-${task.id}`,task.title,task.detail));
  tasks.push(...getTasks(state).slice(0, 5).map(task => pending(task.id,task.title,task.description)));
  const support = getVisitSupportSummary(state);
  for (const action of support.nextActions) tasks.push(pending(`support-${action.kind}`,action.title,action.reason));
  return tasks.slice(0,12);
}
function caseFacts(state) {
  return {
    isSynthetic:true,patient:state.patient,selectedHospital:state.selectedHospital ?? null,
    permissions:state.permissions,documents:state.documents.map(({id,label,status,source}) => ({id,label,status,source})),
    inquiries:Object.fromEntries(Object.entries(state.inquiries).map(([target,item]) => [target,{status:item.status,requestedDocuments:item.requestedDocuments,source:'합성 전화 역할 · 실제 발신 없음'}])),
    packet:state.packet,review:state.review,visitSupport:getVisitSupportSummary(state),requirements:state.visitSupport.requirements,
    nextActions:getPendingActions(state),callPlans:callPlanSummaries(state),careJourney:getCareJourneySummary(state),preparationWorkflow:preparationWorkflowContext(state),
  };
}
export function preparationWorkflowContext(state) {
  const {currentStageId,currentTask,stages,nextAutomaticActions,visitReady}=getPreparationWorkflow(state);
  return {currentStageId,currentTask:currentTask?{id:currentTask.id,status:currentTask.status,actor:currentTask.actor,title:currentTask.title,question:currentTask.question}:null,
    stages:stages.map(({id,status,actor,remainingCount})=>({id,status,actor,remainingCount})),nextAutomaticActions,visitReady};
}
function supportCandidates(state,kind) { return getSupportCandidates(registry,{kind,area:state.patient.area,wheelchair:state.visitSupport.requirements.wheelchair}); }
function publicProvider(item) { return {...item,source:{...item.source,url:assertSourceUrl(item.source.url)}}; }

function explicitJourneyDemo(message, scenarioId) {
  const request = typeof message === 'string' ? message.normalize('NFKC').replace(/\s+/g,' ').replace(/합성\s*상황/g,'합성 시연') : '';
  if (/(?:시연|데모|미리\s*보기)(?:은|는|을|를)?\s*(?:하지|말|없이|금지|아니|원치)|(?:실제|진짜)로만/.test(request)) return false;
  // 실패 상황의 "받지 않는다"와 사용자의 "시연하지 말라"는 서로 다른 뜻이다.
  if (/(?:시연|데모|미리\s*보기)[^.!?;\n]{0,40}(?:보여(?:\s*(?:줘|주어|주))?|(?:실행|진행|재현|시작)(?:해(?:\s*(?:줘|주어|주))?|하)?)(?:지\s*(?:마|말)|(?:면|도|서는|선)\s*안\s*(?:돼|되))/.test(request)
    || /(?:시연|데모|미리\s*보기)(?:은|는|을|를)?\s*(?:하|해(?:\s*(?:줘|주어|주))?)(?:면|도|서는|선)\s*안\s*(?:돼|되)/.test(request)) return false;
  const requested = /(?:시연|데모|미리\s*보기).{0,30}(?:보여|실행|진행|재현|시작)|(?:보여|실행|진행|재현|시작).{0,30}(?:시연|데모|미리\s*보기)|\b(?:run|show)\b.{0,30}\b(?:demo|preview)\b/i.test(request) || /(?:시연|데모|미리\s*보기)(?:을|를)?\s*(?:해\s*줘|해\s*주|해주세요)/.test(request);
  // 상황 표현만 조사·시제·띄어쓰기를 허용한다. 실행 의도 검사는 위에서 별도로 유지한다.
  const terms = {
    missing_record: /(?:자료|판독문|기록|문서).{0,8}(?:누락|부족|빠졌|빠진|빠져|없)|missing_record/,
    jeju_unavailable: /제주.{0,12}(?:접수\s*)?거절|접수거절|제주.{0,12}(?:요청|접수|협진).{0,12}(?:받지않|안받|수락하지않|거부|불가)|jeju_unavailable/,
    time_changed: /(?:시간|시각|일정).{0,8}(?:변경|바뀌|바뀐|달라졌|달라진)|time_changed/,
    call_no_answer: /무응답|(?:전화|연락).{0,12}(?:안받|받지않|받을수없|연결되지않|연결안되|응답하지않|응답이없)|call_no_answer/,
    call_ai_declined: /(?:AI|인공지능).{0,18}(?:거절|거부|응대하지않|응답하지않|받지않|안받)|call_ai_declined/i,
    call_identity_required: /(?:본인|신원).{0,5}(?:확인|인증)|call_identity_required/,
    call_documents_or_schedule: /서류.{0,8}(?:일정|막힘|부족|빠졌|빠진|없|미비)|(?:예약|일정|접수).{0,8}(?:안되|되지않|불가|못잡|잡지못)|call_documents_or_schedule/,
  };
  return requested && terms[scenarioId].test(request.replace(/\s+/g,''));
}
const REQUEST_ENDING = String.raw`(?:해\s*(?:줘(?:요)?|주세요|주십시오|주셔요)|하(?:세요|십시오)|(?:를\s*)?허용(?:해\s*(?:줘(?:요)?|주세요)|합니다|할게요))(?=\s*$)`;
const RETRY_ACTION = String.raw`(?:재시도|다시\s*(?:문의|연락|시도))(?:를|는|만|도)?\s*`;
const INQUIRY_ACTION = String.raw`(?:문의|확인)(?:을|를|는|만|도)?\s*`;
const FORBIDDEN_RESULT = String.raw`(?:안\s*(?:돼|되|됩|됨)|않|금지|불허|원치|원하지|말아)`;
const PROHIBITION = String.raw`(?:절대\s*|자동으로\s*)?(?:하지|안\s*해|안\s*하|말(?:아|고|라)|금지|불허|원치|원하지|필요\s*없|(?:하(?:면|시면|는\s*것은|는\s*건|는\s*걸|는\s*것을|기는)|해(?:도|서는|선|\s*주면|\s*줘서는|\s*줘도))\s*${FORBIDDEN_RESULT}|해\s*주지)`;
const actionMentions={retry:new RegExp(RETRY_ACTION),inquiry:new RegExp(INQUIRY_ACTION)};
const negativeActions = {
  retry: new RegExp(`${RETRY_ACTION}${PROHIBITION}`),
  inquiry: new RegExp(`${INQUIRY_ACTION}${PROHIBITION}`),
};
const quotedOrTagged = /["'“”‘’「」『』`<>\[\]]|^\s*>|&(?:lt|gt|quot|apos|#\d+|#x[0-9a-f]+);|(?:예시|인용|설명|문구|문장|프롬프트|도구\s*결과)/i;
const regexText = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function authorizationTargets(state, clause) {
  const labels = {
    mainland: [String.raw`기존\s*도외\s*(?:치료\s*)?병원`, String.raw`도외\s*(?:치료\s*)?병원`, String.raw`서울\s*(?:기존\s*)?(?:치료\s*)?병원`],
    jeju: [String.raw`(?:제주|도내|현지)\s*(?:협진\s*)?병원`],
    taxi: [String.raw`택시`, String.raw`교통약자\s*(?:이동\s*)?지원센터`, String.raw`이동\s*지원(?:센터|\s*문의처)`],
    companion: [String.raw`병원\s*동행`, String.raw`동행\s*(?:지원|문의처|기관|업체)`],
  };
  const names = { mainland:state.patient?.existingHospital, jeju:state.selectedHospital?.companyName ?? state.patient?.localHospital, taxi:state.visitSupport?.taxi?.provider?.name, companion:state.visitSupport?.companion?.provider?.name };
  for(const [target,name] of Object.entries(names)) if(typeof name==='string'&&name.trim()) labels[target].push(regexText(name.replace(/\s*\(가상\)/g,'').trim()));
  return Object.entries(labels).filter(([,aliases])=>new RegExp(aliases.join('|')).test(clause)).map(([target])=>target);
}
// 소수·천 단위 구분의 점/쉼표를 절 구분자로 잘라 숫자의 일부가 새 값이 되지 않게 한다.
function splitAuthorizationClauses(value,separators) {
  const parts=[];let start=0;
  for(let index=0;index<value.length;index++) {
    if(!separators.includes(value[index])) continue;
    if(value[index]==='.'||value[index]===',') {
      let left=index-1,right=index+1;
      while(left>=0&&/\s/.test(value[left])) left--;
      while(right<value.length&&/\s/.test(value[right])) right++;
      if(/\d/.test(value[left]??'')&&/\d/.test(value[right]??'')) continue;
    }
    parts.push(value.slice(start,index));start=index+1;
  }
  parts.push(value.slice(start));return parts;
}
/** 인용·태그는 허용 근거가 아니다. 다른 대상이나 다른 문장의 숫자/명령을 합치지 않는다. */
function authorizationClauses(message,state) {
  if(typeof message!=='string') return [];
  const plain = message.normalize('NFKC').replace(/(?:```|~~~)[\s\S]*?(?:(?:```|~~~)|$)/g,'');
  const clauses=[];
  for(const line of plain.split(/[\r\n]+/)) {
    if(quotedOrTagged.test(line)) continue;
    for(const sentence of splitAuthorizationClauses(line,'.!?;')) {
      let conditionalTarget=[];
      for(const part of splitAuthorizationClauses(sentence,',')) {
        const clause=part.trim();if(!clause)continue;
        const named=authorizationTargets(state,clause),targets=named.length?named:conditionalTarget;
        clauses.push({clause,targets});
        // "택시가 무응답이면, ..."처럼 같은 문장의 조건절만 이어 읽는다.
        conditionalTarget=targets.length===1&&/(?:면|경우|때)\s*$/.test(clause)?targets:[];
      }
    }
  }
  return clauses;
}
/** 이번 요청의 명시적 준비 범위만 쓴다. 읽기·인용·부정은 실행 범위가 아니다. */
export function getGuidedPreparationKinds(message,state) {
  const requested=new Set(),blocked=new Set(),exclusive=new Set();
  for(const part of authorizationClauses(message,state)){
    // 실발신 금지는 그대로 지키면서, 별도로 요청한 내부 초안까지 금지로 바꾸지 않는다.
    const clause=part.clause.replace(/(?:실제\s*(?:전화|발신|통화)|실발신)(?:는|은|를|을)?\s*(?:하지|걸지)\s*(?:말아(?:\s*(?:줘(?:요)?|주세요))?|말고|마(?:세요|라)?)/g,'').trim();
    const kinds=[...(/택시|이동|교통/.test(clause)?['taxi']:[]),...(/동행/.test(clause)?['companion']:[])];
    const broad=!kinds.length&&/(?:방문|진료|협진)(?:을|를)?\s*(?:전체\s*)?준비/.test(clause)&&!/(?:만|뿐)(?:\s|을|은|해|알|준|정)/.test(clause);
    if(/하지|말아|마세요|마라|금지|불허|않|필요\s*없|원치|원하지|(?:빼|제외)\s*(?:줘|주세요|하고|해)|(?:^|\s)안\s*(?:준비|정리|문의|알아)|준비\s*안/.test(clause)){
      for(const kind of kinds.length?kinds:['taxi','companion'])blocked.add(kind);continue;
    }
    if(/(?:택시|이동|교통)(?:\s*지원)?\s*만/.test(clause))exclusive.add('taxi');
    if(/동행(?:\s*지원)?\s*만/.test(clause))exclusive.add('companion');
    if(/비교|검색|조회|설명|현황|상태|확인만|(?:보여|알려)\s*(?:줘|주세요)|만약|가정|경우|(?:라면|다면|으면)/.test(clause))continue;
    if(!/(?:준비(?:를)?\s*(?:이어(?:서)?\s*)?(?:해|하)|초안(?:을)?\s*(?:만들어|작성해)|챙겨|알아봐|도와)\s*(?:줘(?:요)?|주세요|주십시오)\s*$/.test(clause))continue;
    for(const kind of broad?['taxi','companion']:kinds)requested.add(kind);
  }
  return ['taxi','companion'].filter(kind=>requested.has(kind)&&!blocked.has(kind)&&(!exclusive.size||exclusive.has(kind)));
}
/** 명시한 새 조건을 모델이 건너뛰면 이전 조건으로 자동 초안을 만들지 않는다. */
export function getGuidedPreparationChanges(message,state) {
  const text=String(message).normalize('NFKC'),fields=[];
  if(/\d{4}-\d{2}-\d{2}|\d{1,2}\s*월\s*\d{1,2}\s*일|내일|모레|다음\s*(?:주|달)|(?:방문일|날짜).{0,12}(?:바꾸|변경|수정)/.test(text))fields.push('date');
  if(/\d{1,2}\s*:\s*\d{2}|\d{1,2}\s*시|오전|오후|(?:시각|시간).{0,12}(?:바꾸|변경|수정)/.test(text))fields.push('appointmentTime');
  const area=state.patient.area.replace(/\s+/g,''),compact=text.replace(/\s+/g,'');
  if(ADMIN_AREAS.some(value=>{const name=value.split(' ').at(-1).replace(/[읍면시]$/,'');return new RegExp(`${regexText(name)}(?:에서|으로|로|(?:출발|거주|지역))`).test(compact)&&!area.includes(name);})||/(?:출발지|출발\s*지역).{0,12}(?:바꾸|변경|수정)/.test(text))fields.push('area');
  const hospital=state.selectedHospital?.companyName||state.patient.localHospital;
  if(hospitalData.records.some(item=>text.includes(item.companyName)&&item.companyName!==hospital)||/(?:다른|새로운|새)\s*(?:제주|도내)?\s*병원|(?:병원|기관).{0,12}(?:바꾸|변경|수정)/.test(text))fields.push('hospital');
  if(/휠체어/.test(text))fields.push('wheelchair');
  for(const [field,subject] of [['transportNeeded','(?:택시|이동)'],['companionNeeded','동행']])if(new RegExp(`${subject}.{0,12}(?:필요\\s*없|불필요|필요해|필요하|추가|제외)`).test(text))fields.push(field);
  return fields;
}
function explicitMissingDocument(message,state,id) {
  const labels={history:/(?:치료|진료)\s*이력|병력\s*요약/,report:/판독문/,referral:/의뢰서/};
  const absent='없(?:어|어요|습니다|다|음|어서|고)|미보유|분실|발급\\s*전|준비(?:가)?\\s*(?:안|않|못)|보유(?:하고)?\\s*있지\\s*않';
  const related=new RegExp(`(?:${labels[id].source})(?:(?!판독문|의뢰서|(?:치료|진료)\\s*이력|병력\\s*요약).){0,36}(?:${absent})`);
  return authorizationClauses(message,state).some(({clause})=>related.test(clause)
    && !/없(?:진|지|는\s*(?:것|건|게))\s*않|미보유.{0,5}아니|분실.{0,6}아니|(?:지우|해제하|제외하|삭제하)지|없어(?:지|도)|(?:만약|가정|경우)|(?:없|분실).{0,15}(?:으면|하면|라면|다면|더라도)|(?:없|미보유|분실).{0,12}(?:나요|까요|을까|는지|여부|인지)/.test(clause));
}
function targetAuthorization(message,state,target,kind,positive) {
  let permitted=false;
  for(const {clause,targets} of authorizationClauses(message,state)) {
    const negative=negativeActions[kind].test(clause);
    if(negative&&(!targets.length||targets.includes(target))) return false;
    if(targets.length!==1||targets[0]!==target) continue;
    // 부정 부사를 동작 직전에 둔 "안 문의해 줘"도 긍정 요청으로 해석하지 않는다.
    if(kind==='retry'&&/안\s*(?:재시도|다시\s*(?:문의|연락|시도))/.test(clause)) return false;
    if(kind==='inquiry'&&/안\s*(?:문의|확인)/.test(clause)) return false;
    if(positive(clause)) permitted=true;
    else if(actionMentions[kind].test(clause)) return false;
  }
  return permitted;
}
function recipientScopeMatches(state,target) {
  const previous=state.callRecovery?.targets[target]?.recipientId;
  return previous===null||previous===undefined||previous===callRecipientId(state,target);
}
// 전체 숫자 토큰만 캡처한다. 부호·소수·구분자·시간/지수 표기의 일부를 양수로 읽지 않는다.
const POLICY_INTEGER = String.raw`(?<![\p{N}A-Za-z_.,:/+−\p{Pd}])((?:[+−-]\s*)?\d+)(?![\p{N}A-Za-z_.,:/+−\p{Pd}])`;
const RETRY_RANGE = String.raw`${POLICY_INTEGER}\s*분\s*(?:안(?:에)?|이내(?:에)?)\s*(?:최초\s*(?:시도\s*)?포함\s*)?(?:최대|총)\s*${POLICY_INTEGER}\s*(?:회|번)`;
function policyInteger(value,max) {
  if(!/^[1-9]\d*$/.test(value)) return null;
  const parsed=Number(value);
  return Number.isSafeInteger(parsed)&&parsed<=max?parsed:null;
}
function explicitRetryPolicy(message,input,state) {
  const expression=new RegExp(String.raw`${RETRY_RANGE}(?:까지|만|로만|로)?\s*${RETRY_ACTION}${REQUEST_ENDING}`,'gu');
  return targetAuthorization(message,state,input.target,'retry',clause=>{
    const policies=[...clause.matchAll(expression)],ranges=[...clause.matchAll(new RegExp(RETRY_RANGE,'gu'))];
    return policies.length===1&&ranges.length>0&&ranges.every(match=>!/(?:[\p{N}A-Za-z_.,:/+−\p{Pd}]|마이너스|음수)\s*$/u.test(clause.slice(0,match.index))&&policyInteger(match[1],120)===input.windowMinutes&&policyInteger(match[2],3)===input.maxAttempts);
  });
}
function alternativeDatesPermitted(message,target,state) {
  const expression=new RegExp(String.raw`(?:다른|대체)\s*(?:날짜|일자|일정)(?:로|에|를|도|는|만|도\s*한번)?\s*${INQUIRY_ACTION}${REQUEST_ENDING}`);
  return targetAuthorization(message,state,target,'inquiry',clause=>expression.test(clause));
}
async function runCallRecoveryScenario(scenarioId) {
  const fixedClock = () => Date.parse('2026-10-31T12:00:00Z');
  const phoneAdapter = { isSimulation:true,
    async hospital({target}) { return {isSimulation:true,outcome:'unreachable',failureReason:scenarioId === 'call_identity_required' ? 'identity_required' : target === 'mainland' ? 'missing_documents' : 'no_slots'}; },
    async support() { return {isSimulation:true,outcome:'unreachable',failureReason:scenarioId === 'call_ai_declined' ? 'ai_declined' : 'no_answer'}; },
  };
  const dispatch = createToolDispatcher({phoneAdapter,clock:fixedClock});
  let state = createDemoCase(); const events=[],pendingActions=[];
  const message = `${CALL_RECOVERY_SCENARIOS.find(item=>item.id===scenarioId).label} 상황을 고정 합성 시연으로 실행해 줘. 택시가 무응답이면 15분 안에 최대 2회까지 재시도해 줘.`;
  const steps = scenarioId === 'call_documents_or_schedule' ? [['request_hospital_contact',{target:'mainland'}],['request_hospital_contact',{target:'jeju'}],['request_hospital_contact',{target:'jeju'}]]
    : scenarioId === 'call_identity_required' ? [['request_hospital_contact',{target:'mainland'}],['request_hospital_contact',{target:'mainland'}]]
    : [['prepare_inquiries',{kind:'taxi'}],...(scenarioId === 'call_no_answer' ? [['update_call_retry_policy',{target:'taxi',maxAttempts:2,windowMinutes:15}]] : []),['request_support_contact',{kind:'taxi'}],['request_support_contact',{kind:'taxi'}],...(scenarioId === 'call_no_answer' ? [['request_support_contact',{kind:'taxi'}]] : [])];
  for (const [name,input] of steps) { const result=await dispatch({name,input,state,userMessage:message,requestId:'fixed-call-recovery-001'});state=result.state;events.push(...result.events);pendingActions.push(...result.pendingActions); }
  if (scenarioId === 'call_documents_or_schedule') {
    const result=await dispatch({name:'request_hospital_contact',input:{target:'jeju'},state,userMessage:'제주 병원에 예약이 안 되면 다른 날짜도 문의해 줘. 날짜 선택·예약은 하지 말고 안내만 확인해 줘.',requestId:'fixed-call-recovery-alt-002'});
    state=result.state;events.push(...result.events);pendingActions.push(...result.pendingActions);
  }
  return {state,events,pendingActions};
}

function journeyPreviewAdapter(scenarioId) {
  return Object.freeze({ isSimulation:true,
    async hospital({target}) { return { outcome:target === 'mainland' ? 'referral' : scenarioId === 'jeju_unavailable' ? 'not_participating' : 'documents',isSimulation:true }; },
    async support() { return { outcome:'available',isSimulation:true,wheelchairConfirmed:true,eligibilityConfirmed:true }; },
  });
}
async function runJourneyScenario(scenarioId) {
  const scenario = JOURNEY_SCENARIOS.find(item => item.id === scenarioId);
  const dispatch = createToolDispatcher({phoneAdapter:journeyPreviewAdapter(scenarioId)});
  let state = applyAction(createDemoCase(),{type:'JOURNEY_START_SCENARIO',scenarioId});
  const userMessage = `제주우리병원을 문의 대상으로 하는 ${scenario.label} 상황을 고정 합성 시연으로 실행해 줘.`;
  const steps = [
    ['get_case',{}], ['update_visit',{appointmentTime:'10:00',wheelchair:true,caregiverAvailable:0}],
    ['search_hospital_contacts',{name:'제주우리병원'}], ['select_hospital_contact',{hospitalId:'hospital-4'}],
    ['request_records',{source:'nhis'}], ['request_hospital_contact',{target:'mainland'}], ['request_hospital_contact',{target:'jeju'}],
  ];
  if (scenarioId === 'jeju_unavailable') steps.push(['search_hospital_contacts',{area:'제주시'}],['find_support',{kind:'taxi'}],['find_support',{kind:'companion'}]);
  else steps.push(['prepare_inquiries',{kind:'taxi'}],['request_support_contact',{kind:'taxi'}],['prepare_inquiries',{kind:'companion'}],['request_support_contact',{kind:'companion'}]);
  if (scenarioId === 'time_changed') steps.push(['update_visit',{appointmentTime:'14:00'}]);
  steps.push(['prepare_review',{}],['get_care_journey',{}]);
  const events = [], pendingActions = [];
  for (const [name,input] of steps) {
    const result = await dispatch({name,input,state,userMessage});
    state=result.state; events.push(...result.events); pendingActions.push(...result.pendingActions);
  }
  return {state,events,pendingActions};
}

/** 검증된 순수 reducer만 상태를 변경한다. 인자에 source/clinical text/action을 받지 않는다. */
export function createToolDispatcher({phoneAdapter = createPhoneSimulationAdapter(),clock = () => Date.now()} = {}) {
  if (phoneAdapter !== null && phoneAdapter.isSimulation !== true) throw new TypeError('실제 발신 어댑터는 아직 지원하지 않습니다.');
  return async function executeTool({name,input,state,userMessage = '',preferences,signal,requestId = 'direct-tool-request'}) {
    const spec = toolMap.get(name);
    fail(spec, 'UNKNOWN_TOOL', '지원하지 않는 도구입니다.');
    validateSchema(input, spec.inputSchema);
    if (signal?.aborted) throw new AgentError('AGENT_TIMEOUT', '요청 처리를 중단했습니다.', 504);
    let next = state, data = {}, item, events = [], pendingActions = [];
    if (PUBLIC_DATA_TOOL_NAMES.has(name)) {
      const result=executePublicDataTool({name,input,state});
      for (const item of result.events) if(item.source?.startsWith('https:'))assertSourceUrl(item.source);
      return result;
    }

    const callAt = () => new Date(clock()).toISOString();
    let attemptedAt;
    const checkCallGate = target => {
      attemptedAt=callAt();
      if (recipientScopeMatches(next,target) && alternativeDatesPermitted(userMessage,target,next) && next.callRecovery?.targets[target].reason === 'no_slots') next=applyAction(next,{type:'CALL_ALLOW_ALTERNATIVE_DATES',target,requestId});
      next=applyAction(next,{type:'CALL_CHECK_GATE',target,at:attemptedAt});
      const gate=getCallAttemptGate(next,target,attemptedAt);
      if (!gate.allowed) {
        const handoff=getCallRecoveryHandoffs(next).find(item=>item.target===target);
        data={status:gate.status,...realCallStatus,handoff:handoff ?? null,callPlan:buildCallPlan(next,target)};
        events.push(event(name,'자동 문의 중단·사람 인계 확인',gate.detail,{status:'needs_input',isSimulation:true,source:'합성 문의의 횟수·시간·실패 인계 gate'}));
        pendingActions.push(pending(`call-recovery-${target}`,handoff?.title ?? '전화 문의 허용 범위 확인',gate.detail));
      }
      return gate.allowed;
    };
    switch (name) {
      case 'update_call_retry_policy':
        fail(recipientScopeMatches(next,input.target) && explicitRetryPolicy(userMessage,input,next),'EXPLICIT_RETRY_POLICY_REQUIRED','재시도할 문의 대상과 N분 안에 최초 포함 최대 M회 재시도해 달라는 긍정 요청을 같은 문장에 명시해 주세요.');
        next=applyAction(next,{type:'CALL_SET_RETRY_POLICY',...input,at:callAt()});
        data={retryPolicy:{configured:true,...next.callRecovery.targets[input.target].retryPolicy,scheduled:false},handoffs:getCallRecoveryHandoffs(next),...realCallStatus};
        events.push(event(name,'명시한 합성 재시도 범위 반영',`최초 포함 총 ${input.maxAttempts}회·${input.windowMinutes}분입니다. 기존 시도·시작/종료 시각과 AI거절·본인확인 중단은 보존하며 실제 발신 예약은 하지 않았습니다.`,{isSimulation:true,source:'이번 요청에 명시한 합성 문의 범위'}));
        break;
      case 'run_call_recovery_demo': {
        fail(explicitJourneyDemo(userMessage,input.scenarioId),'EXPLICIT_DEMO_REQUIRED','실행할 전화 실패 상황의 합성 시연을 명시적으로 요청해 주세요.');
        const result=await runCallRecoveryScenario(input.scenarioId);next=result.state;data=getCareJourneySummary(next);
        events.push(event(name,'고정 합성 전화 실패·인계 시연','고정 합성 시계·응답과 공통 어댑터 gate로 실패 사유·시도·다음 담당자를 보존했습니다. 실제 발신·인증·예약·재시도 예약은 없습니다.',{isSimulation:true,source:'서버 고정 합성 전화 실패 시연'}),...result.events);pendingActions.push(...result.pendingActions);
        break;
      }
      case 'get_care_journey':
        data = {...getCareJourneySummary(next),preparationWorkflow:preparationWorkflowContext(next)};
        events.push(event(name,'진료 연결 근거와 다음 할 일 확인','요구 자료·발급과 제출 문의·휠체어·이동·동행의 의존 작업과 조건 변경을 정리했습니다. 진료 연결 결과는 의료진 근거가 없으면 미확인입니다.',{isSimulation:true,source:'합성 사례·고정 합성 안내·공개 snapshot'}));
        break;
      case 'run_journey_demo': {
        fail(explicitJourneyDemo(userMessage,input.scenarioId),'EXPLICIT_DEMO_REQUIRED','자료 누락·제주 접수 거절·진료 시각 변경 중 실행할 상황의 합성 시연을 명시적으로 요청해 주세요. 일반 방문 준비에는 고정 예시를 덮어쓰지 않습니다.');
        const result = await runJourneyScenario(input.scenarioId);
        next = result.state; data = getCareJourneySummary(next);
        events.push(event(name,'명시적으로 요청한 고정 합성 상황 실행',`${data.activeScenario.label} · 서버 고정 조건을 사용했습니다. 실제 환자 기록·의료진 확인·발신·예약은 수행하지 않았습니다.`,{isSimulation:true,source:'서버 고정 합성 진료 연결 상황'}),...result.events);
        pendingActions.push(...result.pendingActions);
        break;
      }
      case 'get_case':
        data = caseFacts(next);
        events.push(event(name,'기존 합성 사례 확인',`${next.patient.nextVisit} 방문 준비 합성 사례와 서버의 현재 상태를 확인했습니다. 실제 환자 기록은 조회하지 않았습니다.`,{isSimulation:true,source:'서버 합성 사례'}));
        break;
      case 'update_visit': {
        const patient = {}, requirements = {};
        if (input.date !== undefined) patient.nextVisit = input.date;
        if (input.area !== undefined) patient.area = input.area;
        if (Object.keys(patient).length) next = applyAction(next,{type:'UPDATE_PATIENT',values:patient});
        for (const key of ['appointmentTime','transportNeeded','companionNeeded','wheelchair']) if (input[key] !== undefined) requirements[key] = input[key];
        if (Object.keys(requirements).length) next = applyAction(next,{type:'SUPPORT_UPDATE_REQUIREMENTS',values:requirements});
        if (input.caregiverAvailable !== undefined) next = applyAction(next,{type:'UPDATE_PLAN',values:{caregiverAvailable:input.caregiverAvailable}});
        data = caseFacts(next);
        events.push(event(name,'방문 조건 반영','명시한 날짜·행정지역·시각·지원 필요만 반영했습니다. 조건이 바뀐 이전 문의 응답은 다시 확인해야 합니다.',{isSimulation:true,source:'합성 사례의 정규화된 방문 조건'}));
        break;
      }
      case 'search_hospital_contacts': {
        const found = filterHospitals(hospitalData.records,{department:input.department ?? '',area:input.area ?? ''}).filter(record => !input.name || record.companyName.includes(input.name));
        data = {records:found.slice(0,5),total:found.length,registeredRecords:13,previewRows:20,source:HOSPITAL_SOURCE,collectedAt:'2024-10-17 13:53',capacityVerified:false,clinicalSuitabilityVerified:false};
        events.push(event(name,'공개 기관 등록정보 조회',`공개13개 기관에서 문의 조건에 맞는 ${found.length}개 등록 정보를 찾았습니다. 현재 수용·협진 참여·진료 적합성은 미확인입니다.`,{source:HOSPITAL_SOURCE}));
        data.publicDataEvidence=preparationDataEvidence(next,'hospital');
        break;
      }
      case 'select_hospital_contact': {
        const hospital = hospitalData.records.find(record => record.id === input.hospitalId);
        fail(hospital, 'UNKNOWN_HOSPITAL', '공개 자료에 있는 문의 기관을 확인해 주세요.');
        const normalize = value => value.normalize('NFKC').replace(/\s+/g,'');
        if (!normalize(userMessage).includes(normalize(hospital.companyName))) {
          events.push(event(name,'문의 기관 확인 필요','이번 요청에서 기관명을 확인하지 못했습니다. 원하시는 병원 이름을 알려 주세요.',{status:'needs_input',source:HOSPITAL_SOURCE}));
          pendingActions.push(pending('hospital-name','문의할 병원 이름 확인','등록정보만으로 환자에게 맞는 병원을 선택할 수 없습니다.'));
          break;
        }
        next = applyAction(next,{type:'SELECT_LOCAL_HOSPITAL',hospital});
        data = {hospital:next.selectedHospital,capacityVerified:false,clinicalSuitabilityVerified:false};
        events.push(event(name,'지정한 병원 문의 준비',`${hospital.companyName}의 공개 등록정보를 문의 준비에 연결했습니다. 협진·예약·진료 가능은 미확인입니다.`,{source:HOSPITAL_SOURCE}));
        break;
      }
      case 'request_records':
        if (input.source === 'nhis') {
          data = {status:'not_connected',provider:'NHIS',authenticationRequired:true,approvedAdapterConfigured:false};
          events.push(event(name,'건강보험공단 기록 연계 미설정','승인된 인증·동의 연계가 설정되지 않아 실제 기록을 가져오지 않았습니다.',{status:'not_connected',source:NHIS_SOURCE}));
          pendingActions.push(pending('health-records','실제 진료기록 확인 필요','지금은 합성 자료를 사용합니다. 실제 기록은 본인인증·동의를 거친 연계가 필요합니다.'));
        } else {
          next = applyAction(next,{type:'ADD_DOCUMENT',id:'report',content:recordsTemplate.report,source:'서버 고정 합성 판독문 보유 예시 · 실제 진료기록 아님'});
          data = {isSimulation:true,documents:next.documents.map(({id,label,status,source}) => ({id,label,status,source})),physicianExamCreated:false};
          events.push(event(name,'합성 자료 정리','서버의 고정 합성 치료 이력·판독문 보유 예시를 정리했습니다. 대면 진찰 소견과 의뢰서는 의료진 확인이 필요합니다.',{isSimulation:true,source:'서버 고정 합성 자료'}));
        }
        break;
      case 'mark_document_missing': {
        fail(explicitMissingDocument(userMessage,next,input.documentId),'EXPLICIT_DOCUMENT_UPDATE_REQUIRED','이번 요청에서 해당 자료를 보유하지 않는다는 내용을 확인해 주세요. 질문·인용·가정만으로 보유 상태를 바꾸지 않습니다.');
        const document=next.documents.find(item=>item.id===input.documentId);
        if(document.status!=='missing')next=applyAction(next,{type:'REMOVE_DOCUMENT',id:input.documentId});
        data={isSimulation:true,document:next.documents.find(item=>item.id===input.documentId),actualRecordDeleted:false,physicianExamCreated:false};
        events.push(event(name,'자료 미보유 반영','보호자가 명시한 자료 미보유를 합성 준비 목록과 후속 할 일에 반영했습니다. 실제 의료기록을 삭제하거나 발급한 것은 아닙니다.',{isSimulation:true,source:'보호자 요청 · 합성 보유 현황'}));
        pendingActions.push(pending('document-issuance','미보유 자료 발급·제출 절차 확인','기존 병원의 발급 창구·본인/대리 절차와 제주 기관의 제출 형식·수신 방법을 확인해 주세요.'));
        break;
      }
      case 'request_hospital_contact': {
        const plan = buildCallPlan(next,input.target);
        if (!phoneAdapter) {
          data = {status:'not_connected',...realCallStatus,callPlan:plan};
          events.push(event(name,'병원 전화 연결 미설정','전화 사업자 어댑터가 없어 발신하지 않았습니다.',{status:'not_connected'}));
          pendingActions.push(pending('phone','전화 연결 설정','발신 사업자·위임·수신처 검증이 필요합니다.'));
          break;
        }
        fail(next.permissions.inquiry === true, 'PERMISSION_REQUIRED', '합성 전화 문의 시연의 허용 범위를 먼저 확인해 주세요. 실제 환자 위임은 미검증입니다.');
        if (!checkCallGate(input.target)) break;
        item = await phoneAdapter.hospital({target:input.target,plan,signal});
        fail(item?.isSimulation === true && ['documents','referral','unreachable','not_participating'].includes(item.outcome) && (item.failureReason === undefined || item.outcome === 'unreachable' && CALL_FAILURE_REASONS.includes(item.failureReason)), 'INVALID_ADAPTER_RESPONSE', '시연 어댑터 응답을 확인해 주세요.', 502);
        const failureReason=item.failureReason ?? (item.outcome === 'unreachable' ? 'no_answer' : item.outcome === 'not_participating' ? 'not_participating' : 'answered');
        next = applyAction(next,{type:'RECORD_CALL',target:input.target,outcome:item.outcome});
        next = applyAction(next,{type:'CALL_RECORD_ATTEMPT',target:input.target,outcome:failureReason,at:attemptedAt});
        if (failureReason === 'missing_documents' && next.documents.find(doc=>doc.id==='report')?.status === 'ready') next=applyAction(next,{type:'REMOVE_DOCUMENT',id:'report'});
        if (input.target === 'jeju' && next.inquiries.jeju.status === 'not_participating') next=applyAction(next,{type:'JOURNEY_RECORD_FINDING',findingId:'jeju_unavailable'});
        if (next.inquiries[input.target].status === 'confirmed') {
          if (!next.careJourney?.guidance.some(item => item.id === 'preparation')) next = applyAction(next,{type:'JOURNEY_RECORD_GUIDANCE',guidanceId:'preparation'});
          if (input.target === 'mainland' && next.documents.find(doc => doc.id === 'report')?.status !== 'ready') next = applyAction(next,{type:'JOURNEY_RECORD_FINDING',findingId:'report_issuance'});
          if (input.target === 'jeju') {
            if (next.careJourney?.findings.some(item => item.id === 'report_issuance')) next = applyAction(next,{type:'JOURNEY_RECORD_FINDING',findingId:'report_submission'});
            if (next.visitSupport.requirements.wheelchair) next = applyAction(next,{type:'JOURNEY_RECORD_FINDING',findingId:'hospital_wheelchair'});
          }
        }
        data = {...next.inquiries[input.target],isSimulation:true,...realCallStatus,callPlan:buildCallPlan(next,input.target)};
        events.push(event(name,`${input.target === 'mainland' ? '기존 도외' : '제주'} 병원 접수 문의 시연`,`${next.inquiries[input.target].response} 기관 역할의 고정 합성 응답이며 실제 발신·수용 확인은 하지 않았습니다.`,{isSimulation:true,source:'기관 역할의 합성 전화 시뮬레이터'}));
        break;
      }
      case 'find_support': {
        const candidates = supportCandidates(next,input.kind).map(publicProvider);
        data = {candidates:candidates.slice(0,5),total:candidates.length,scope:'등록 지역·서비스 유형에 따른 문의 우선순위',availabilityVerified:false,datasets:registry.datasets};
        const source = candidates[0]?.source.url;
        events.push(event(name,`${input.kind === 'taxi' ? '택시' : '동행'} 문의 경로 조회`,`${next.patient.area}의 문의 후보 ${candidates.length}곳을 확인했습니다. 택시327 최신34개·돌봄254 과거19개와 별도 공식서비스2건을 구분합니다. 현재 제공·시간·비용은 미확인입니다.`,{source}));
        break;
      }
      case 'prepare_inquiries': {
        if (!next.visitSupport.requirements[input.kind === 'taxi' ? 'transportNeeded' : 'companionNeeded']) {
          data = {status:'not_needed',...realCallStatus,callPlan:buildCallPlan(next,input.kind)};
          events.push(event(name,'현재 조건에서는 지원 필요 없음','이동·동행 필요 조건에 따라 해당 문의 초안은 준비하지 않았습니다.'));
          break;
        }
        const candidates = supportCandidates(next,input.kind);
        let carePreferences;
        if (preferences !== undefined) {
          try { carePreferences = normalizeCarePreferences(preferences,{strict:true}); }
          catch { throw new AgentError('INVALID_PREFERENCES','공개 택시 문의처와 이동 조건을 확인해 주세요.'); }
        }
        const preferredId = input.kind === 'taxi' ? carePreferences?.taxiProviderId ?? 'auto' : 'auto';
        const preferred = candidates.find(record => record.id === preferredId);
        const current = candidates.find(record => record.id === next.visitSupport[input.kind].provider?.id);
        const accessible = input.kind === 'taxi' && next.visitSupport.requirements.wheelchair ? candidates.find(record => record.serviceType === 'accessible_transport') : undefined;
        let provider = input.providerId ? candidates.find(record => record.id === input.providerId) : preferred ?? current ?? candidates[0];
        let preferenceNotice;
        if (!input.providerId && preferredId !== 'auto' && !preferred) preferenceNotice = {code:'PREFERENCE_AREA_MISMATCH',message:'선호 택시는 현재 출발 지역의 문의 후보가 아니어서 지역에 맞는 문의처를 사용했습니다.'};
        if (accessible && provider && provider.id !== accessible.id) {
          provider = accessible;
          preferenceNotice = {code:'WHEELCHAIR_SUPPORT_FIRST',message:'휠체어 탑승 지원 확인이 우선이어서 일반 호출택시 선호 대신 교통약자 이동지원센터를 문의 경로로 정리했습니다. 이용자격·차량·예약은 확인 전입니다.'};
        }
        if (!provider) {
          events.push(event(name,'문의 경로 추가 확인 필요','현재 행정지역에서 확인한 공개 문의처가 없습니다.',{status:'needs_input'}));
          pendingActions.push(pending('support-region','지원 지역 확인','담당 지역·문의 경로를 추가 확인해야 합니다.'));
          break;
        }
        next = applyAction(next,{type:'SUPPORT_SELECT_PROVIDER',kind:input.kind,provider});
        next = applyAction(next,{type:'SUPPORT_PREPARE_INQUIRY',kind:input.kind});
        data = {provider:publicProvider(provider),draft:buildSupportInquiry(next,input.kind),...realCallStatus,callPlan:buildCallPlan(next,input.kind),...(preferenceNotice ? {preferenceNotice} : {})};
        if (preferenceNotice) events.push(event(name,'선호 택시 적용 조건 확인',preferenceNotice.message,{status:'needs_input',source:provider.source.url}));
        events.push(event(name,`${input.kind === 'taxi' ? '택시' : '동행'} 문의 초안 준비`,`${provider.name}에 날짜·지역·지원 범위를 확인할 초안을 준비했습니다. 환자 실명·진단·의료기록은 포함하지 않았습니다.`,{source:provider.source.url}));
        data.publicDataEvidence=preparationDataEvidence(next,input.kind);
        break;
      }
      case 'request_support_contact': {
        if (!phoneAdapter) {
          events.push(event(name,'지원 전화 연결 미설정','전화 사업자 어댑터가 없어 실제 문의하지 않았습니다.',{status:'not_connected'}));
          data = {status:'not_connected',...realCallStatus,callPlan:buildCallPlan(next,input.kind)};
          break;
        }
        fail(next.permissions.inquiry === true, 'PERMISSION_REQUIRED', '합성 전화 문의 시연의 허용 범위를 먼저 확인해 주세요. 실제 환자 위임은 미검증입니다.');
        if (!checkCallGate(input.kind)) break;
        const entry = next.visitSupport[input.kind];
        fail(entry.provider, 'INQUIRY_REQUIRED', '먼저 해당 지원의 문의 초안을 준비해 주세요.');
        if (entry.status !== 'prepared') next = applyAction(next,{type:'SUPPORT_PREPARE_INQUIRY',kind:input.kind});
        item = await phoneAdapter.support({kind:input.kind,providerId:entry.provider.id,plan:buildCallPlan(next,input.kind),signal});
        fail(item?.isSimulation === true && ['available','unavailable','unreachable'].includes(item.outcome) && (item.failureReason === undefined || item.outcome === 'unreachable' && CALL_FAILURE_REASONS.includes(item.failureReason)), 'INVALID_ADAPTER_RESPONSE', '시연 어댑터 응답을 확인해 주세요.', 502);
        for (const key of ['wheelchairConfirmed','eligibilityConfirmed']) fail(item[key] === undefined || typeof item[key] === 'boolean', 'INVALID_ADAPTER_RESPONSE', '시연 어댑터 응답을 확인해 주세요.', 502);
        next = applyAction(next,{type:'SUPPORT_RECORD_RESPONSE',kind:input.kind,outcome:item.outcome,wheelchairConfirmed:item.wheelchairConfirmed,eligibilityConfirmed:item.eligibilityConfirmed});
        next=applyAction(next,{type:'CALL_RECORD_ATTEMPT',target:input.kind,outcome:item.failureReason ?? (item.outcome === 'unreachable' ? 'no_answer' : item.outcome === 'unavailable' ? 'no_slots' : 'answered'),at:attemptedAt});
        if (item.outcome === 'available') next = applyAction(next,{type:'JOURNEY_RECORD_FINDING',findingId:input.kind === 'taxi' ? 'taxi_conditions' : 'companion_conditions'});
        const summary = getVisitSupportSummary(next)[input.kind];
        data = {...summary,isSimulation:true,...realCallStatus,callPlan:buildCallPlan(next,input.kind)};
        events.push(event(name,`${input.kind === 'taxi' ? '택시' : '동행'} 합성 전화 응답`,next.visitSupport[input.kind].response,{isSimulation:true,source:entry.provider.source.url,status:item.outcome === 'available' ? 'completed' : 'needs_input'}));
        break;
      }
      case 'prepare_review': {
        const missing = next.documents.filter(doc => ['history','report','exam',...Object.values(next.inquiries).flatMap(item => item.requestedDocuments)].includes(doc.id) && doc.status !== 'ready');
        data = {packet:next.packet,missingDocuments:missing.map(({id,label,status}) => ({id,label,status})),sharePermission:next.permissions.share,
          careJourney:getCareJourneySummary(next),procedureStatus:Object.fromEntries(Object.entries(next.inquiries).map(([target,inquiry]) => [target,inquiry.status])),actualTransferMade:false,clinicalAcceptanceConfirmed:false,reservationConfirmed:false};
        events.push(event(name,'의료진 검토 준비 상태 정리','보유 자료와 빠진 자료를 정리했습니다. 실제 진찰 소견·의뢰서·자료 공유 동의와 의료진 검토가 필요하며 기관 전송은 하지 않았습니다.',{status:'needs_input',isSimulation:true,source:'합성 사례의 자료 준비 상태'}));
        pendingActions.push(pending('physician-exam','제주 대면 진찰·의료진 기록 확인','Agent는 진찰 소견이나 임상 판단을 대신 작성하지 않습니다.'));
        break;
      }
      case 'build_report':
        data = {report:buildReport(next),isSynthetic:true};
        events.push(event(name,'준비 결과와 미확인 사항 정리','합성 사례의 자료·문의·이동·동행 상태를 정리했습니다. 임상 판단이나 예약 확정이 아닙니다.',{isSimulation:true,source:'합성 사례·공개 snapshot 기반 보고서'}));
        break;
    }
    return {state:next,data,events,pendingActions};
  };
}
