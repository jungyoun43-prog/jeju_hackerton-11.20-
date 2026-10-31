import { randomUUID } from 'node:crypto';
import { applyAction, getTasks, buildReport } from '../app/domain.js';
import { getVisitSupportSummary, buildSupportInquiry } from '../app/visit-support.js';
import { filterHospitals } from '../app/hospitals.js';
import { getSupportCandidates, validateSupportRegistry } from '../app/support-data.js';
import hospitalData from '../app/data/hospital-candidates.json' with {type:'json'};
import supportData from '../app/data/visit-support-providers.json' with {type:'json'};
import { AgentError, fail } from './errors.mjs';
import { validateSchema } from './validation.mjs';

const registry = validateSupportRegistry(supportData);
const HOSPITAL_SOURCE = 'https://jejudatahub.net/data/view/data/859';
const NHIS_SOURCE = 'https://www.nhis.or.kr/';
const SOURCE_URLS = new Set([HOSPITAL_SOURCE, NHIS_SOURCE, ...registry.providers.flatMap(item => [item.source.url, item.source.hubUrl]).filter(Boolean)]);
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
  {name:'get_case', description:'서버에 있는 합성 사례의 현재 조건, 공공 기관, 준비 상태와 빠진 작업을 확인한다.', inputSchema:objectSchema()},
  {name:'update_visit', description:'보호자가 명시한 방문일·행정지역·시각·이동/동행 필요만 변경한다. 실명·의료기록·주소 상세는 받지 않는다.', inputSchema:objectSchema({
    date:{type:'string',format:'date',maxLength:10}, area:{type:'string',enum:ADMIN_AREAS}, appointmentTime:{type:'string',format:'time',maxLength:5},
    transportNeeded:{type:'boolean'}, companionNeeded:{type:'boolean'}, wheelchair:{type:'boolean'}, caregiverAvailable:{type:'integer',minimum:0,maximum:100},
  }, [], {minProperties:1})},
  {name:'search_hospital_contacts', description:'허브859 공개13개 기관의 등록 사실을 검색한다. 현재 수용·협진·환자 적합성을 판단하지 않는다.', inputSchema:objectSchema({name:shortText(100),department:shortText(100),area:shortText(100)})},
  {name:'select_hospital_contact', description:'보호자가 현재 요청에서 이름을 명시한 공개 기관을 문의 대상으로 설정한다. 임상 장소 추천은 하지 않는다.', inputSchema:objectSchema({hospitalId:{type:'string',pattern:'^hospital-[0-9]{1,2}$',maxLength:20}}, ['hospitalId'])},
  {name:'request_records', description:'demo는 서버의 고정 합성 자료만 정리한다. nhis는 승인된 기록 연계가 미설정인 상태를 반환한다. 진찰 소견을 작성하지 않는다.', inputSchema:objectSchema({source:{type:'string',enum:['demo','nhis']}}, ['source'])},
  {name:'request_hospital_contact', description:'지정한 기관 역할에 접수·필요 자료를 묻는 합성 전화 시연을 실행한다. 실제 발신이나 환자 수용 확인이 아니다.', inputSchema:objectSchema({target:{type:'string',enum:['mainland','jeju']}}, ['target'])},
  {name:'find_support', description:'택시327·돌봄254·별도 공식서비스에서 현재 행정지역과 지원 유형의 문의 후보를 찾는다. 가능 시간·예약은 미확인이다.', inputSchema:objectSchema({kind:kindSchema}, ['kind'])},
  {name:'prepare_inquiries', description:'현재 조건에 맞는 공개 문의처를 선택하고 택시 또는 동행 문의 초안을 자동 준비한다. 의료기록을 포함하지 않는다.', inputSchema:objectSchema({kind:kindSchema,providerId:{type:'string',maxLength:100,pattern:'^[a-z0-9_-]+$'}}, ['kind'])},
  {name:'request_support_contact', description:'현재 초안으로 서버가 정한 합성 전화 응답을 실행·해석한다. 사용자가 가능/불가를 고르지 않는다. 실제 예약·배차·배정은 하지 않는다.', inputSchema:objectSchema({kind:kindSchema}, ['kind'])},
  {name:'prepare_review', description:'현재 보유 자료와 접수 조건으로 의료진 검토 준비 상태를 정리한다. 미시행 대면진찰과 공유 동의는 대신 만들지 않는다.', inputSchema:objectSchema()},
  {name:'build_report', description:'확인된 준비 상태·근거와 미확인 사항을 보고서로 정리한다. 의료적 결론을 내리지 않는다.', inputSchema:objectSchema()},
]);
const toolMap = new Map(AGENT_TOOLS.map(tool => [tool.name, tool]));

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
export function getPendingActions(state) {
  const tasks = getTasks(state).slice(0, 8).map(task => pending(task.id,task.title,task.description));
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
    nextActions:getPendingActions(state),
  };
}
function supportCandidates(state,kind) { return getSupportCandidates(registry,{kind,area:state.patient.area,wheelchair:state.visitSupport.requirements.wheelchair}); }
function publicProvider(item) { return {...item,source:{...item.source,url:assertSourceUrl(item.source.url)}}; }

/** 검증된 순수 reducer만 상태를 변경한다. 인자에 source/clinical text/action을 받지 않는다. */
export function createToolDispatcher({phoneAdapter = createPhoneSimulationAdapter()} = {}) {
  if (phoneAdapter !== null && phoneAdapter.isSimulation !== true) throw new TypeError('실제 발신 어댑터는 아직 지원하지 않습니다.');
  return async function executeTool({name,input,state,userMessage = '',signal}) {
    const spec = toolMap.get(name);
    fail(spec, 'UNKNOWN_TOOL', '지원하지 않는 도구입니다.');
    validateSchema(input, spec.inputSchema);
    if (signal?.aborted) throw new AgentError('AGENT_TIMEOUT', '요청 처리를 중단했습니다.', 504);
    let next = state, data = {}, item, events = [], pendingActions = [];
    switch (name) {
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
      case 'request_hospital_contact':
        if (!phoneAdapter) {
          data = {status:'not_connected'};
          events.push(event(name,'병원 전화 연결 미설정','전화 사업자 어댑터가 없어 발신하지 않았습니다.',{status:'not_connected'}));
          pendingActions.push(pending('phone','전화 연결 설정','발신 사업자·위임·수신처 검증이 필요합니다.'));
          break;
        }
        fail(next.permissions.inquiry === true, 'PERMISSION_REQUIRED', '전화 문의 위임을 먼저 확인해 주세요.');
        item = await phoneAdapter.hospital({target:input.target,signal});
        fail(item?.isSimulation === true && ['documents','referral','unreachable','not_participating'].includes(item.outcome), 'INVALID_ADAPTER_RESPONSE', '시연 어댑터 응답을 확인해 주세요.', 502);
        next = applyAction(next,{type:'RECORD_CALL',target:input.target,outcome:item.outcome});
        data = {...next.inquiries[input.target],isSimulation:true,actualCallPlaced:false};
        events.push(event(name,`${input.target === 'mainland' ? '기존 도외' : '제주'} 병원 접수 문의 시연`,`${next.inquiries[input.target].response} 기관 역할의 고정 합성 응답이며 실제 발신·수용 확인은 하지 않았습니다.`,{isSimulation:true,source:'기관 역할의 합성 전화 시뮬레이터'}));
        break;
      case 'find_support': {
        const candidates = supportCandidates(next,input.kind).map(publicProvider);
        data = {candidates:candidates.slice(0,5),total:candidates.length,scope:'등록 지역·서비스 유형에 따른 문의 우선순위',availabilityVerified:false,datasets:registry.datasets};
        const source = candidates[0]?.source.url;
        events.push(event(name,`${input.kind === 'taxi' ? '택시' : '동행'} 문의 경로 조회`,`${next.patient.area}의 문의 후보 ${candidates.length}곳을 확인했습니다. 택시327 최신34개·돌봄254 과거19개와 별도 공식서비스2건을 구분합니다. 현재 제공·시간·비용은 미확인입니다.`,{source}));
        break;
      }
      case 'prepare_inquiries': {
        const candidates = supportCandidates(next,input.kind);
        const provider = input.providerId ? candidates.find(record => record.id === input.providerId) : next.visitSupport[input.kind].provider ?? candidates[0];
        if (!provider) {
          events.push(event(name,'문의 경로 추가 확인 필요','현재 행정지역에서 확인한 공개 문의처가 없습니다.',{status:'needs_input'}));
          pendingActions.push(pending('support-region','지원 지역 확인','담당 지역·문의 경로를 추가 확인해야 합니다.'));
          break;
        }
        next = applyAction(next,{type:'SUPPORT_SELECT_PROVIDER',kind:input.kind,provider});
        next = applyAction(next,{type:'SUPPORT_PREPARE_INQUIRY',kind:input.kind});
        data = {provider:publicProvider(provider),draft:buildSupportInquiry(next,input.kind),actualCallPlaced:false};
        events.push(event(name,`${input.kind === 'taxi' ? '택시' : '동행'} 문의 초안 준비`,`${provider.name}에 날짜·지역·지원 범위를 확인할 초안을 준비했습니다. 환자 실명·진단·의료기록은 포함하지 않았습니다.`,{source:provider.source.url}));
        break;
      }
      case 'request_support_contact': {
        if (!phoneAdapter) {
          events.push(event(name,'지원 전화 연결 미설정','전화 사업자 어댑터가 없어 실제 문의하지 않았습니다.',{status:'not_connected'}));
          data = {status:'not_connected'};
          break;
        }
        fail(next.permissions.inquiry === true, 'PERMISSION_REQUIRED', '전화 문의 위임을 먼저 확인해 주세요.');
        const entry = next.visitSupport[input.kind];
        fail(entry.provider, 'INQUIRY_REQUIRED', '먼저 해당 지원의 문의 초안을 준비해 주세요.');
        if (entry.status !== 'prepared') next = applyAction(next,{type:'SUPPORT_PREPARE_INQUIRY',kind:input.kind});
        item = await phoneAdapter.support({kind:input.kind,providerId:entry.provider.id,signal});
        fail(item?.isSimulation === true && ['available','unavailable','unreachable'].includes(item.outcome), 'INVALID_ADAPTER_RESPONSE', '시연 어댑터 응답을 확인해 주세요.', 502);
        for (const key of ['wheelchairConfirmed','eligibilityConfirmed']) fail(item[key] === undefined || typeof item[key] === 'boolean', 'INVALID_ADAPTER_RESPONSE', '시연 어댑터 응답을 확인해 주세요.', 502);
        next = applyAction(next,{type:'SUPPORT_RECORD_RESPONSE',kind:input.kind,outcome:item.outcome,wheelchairConfirmed:item.wheelchairConfirmed,eligibilityConfirmed:item.eligibilityConfirmed});
        const summary = getVisitSupportSummary(next)[input.kind];
        data = {...summary,isSimulation:true,actualCallPlaced:false,reservationConfirmed:false};
        events.push(event(name,`${input.kind === 'taxi' ? '택시' : '동행'} 합성 전화 응답`,next.visitSupport[input.kind].response,{isSimulation:true,source:entry.provider.source.url,status:item.outcome === 'available' ? 'completed' : 'needs_input'}));
        break;
      }
      case 'prepare_review': {
        const missing = next.documents.filter(doc => ['history','report','exam',...Object.values(next.inquiries).flatMap(item => item.requestedDocuments)].includes(doc.id) && doc.status !== 'ready');
        data = {packet:next.packet,missingDocuments:missing.map(({id,label,status}) => ({id,label,status})),sharePermission:next.permissions.share,actualTransferMade:false};
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
