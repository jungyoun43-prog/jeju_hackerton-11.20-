import { randomUUID } from 'node:crypto';
import { searchPublicDataCatalog, analyzePublicData, PUBLIC_DATA_SOURCE_URLS } from '../app/public-data-skill.js';
import { AgentError, fail, isObject } from './errors.mjs';
import { validateSchema } from './validation.mjs';

export { PUBLIC_DATA_SOURCE_URLS };

const objectSchema = (properties, required) => ({type:'object',properties,required,additionalProperties:false});
const areaSchema = {type:'string',minLength:1,maxLength:100};
export const PUBLIC_DATA_TOOLS = Object.freeze([
  {
    name:'search_public_data',
    description:'진료·이동·동행 질문에 관련된 제주 공공데이터 분류 메타데이터를 소수 검색한다. 목록·센터 명세와 실제 조회 가능한 공개 snapshot을 구분한다. 개인 기록·실시간 자료는 조회하지 않는다.',
    readOnly:true,
    inputSchema:objectSchema({
      purpose:{type:'string',enum:['hospital','taxi','companion','travel']},
      query:{type:'string',maxLength:200},
      limit:{type:'integer',minimum:1,maximum:8},
    },['purpose']),
  },
  {
    name:'analyze_public_data',
    description:'등록된 공개 snapshot을 코드로 계산한다. facility_compare는 areas 두 지역, support_candidates는 선택 supportKind(taxi/companion/both, 생략시 모두)·area·wheelchair, travel_time은 선택 area만 받는다. 출처·분모·표본·결측을 보존하며 원자료 없는 이동시간은 unavailable로 둔다. 환자 상태·예약을 변경하지 않는다.',
    readOnly:true,
    inputSchema:objectSchema({
      analysis:{type:'string',enum:['facility_compare','support_candidates','travel_time']},
      areas:{type:'array',items:areaSchema,minItems:2,maxItems:2,uniqueItems:true},
      area:areaSchema,
      supportKind:{type:'string',enum:['taxi','companion','both']},
      wheelchair:{type:'boolean'},
    },['analysis']),
  },
]);
const toolMap = new Map(PUBLIC_DATA_TOOLS.map(spec => [spec.name,spec]));
const argumentMessage = '도구 인자의 항목·형식·허용 범위를 확인해 주세요.';
const validArgument = value => fail(value,'INVALID_TOOL_ARGUMENTS',argumentMessage);

/** dispatcher 밖에서 호출해도 같은 입력 경계를 적용한다. 임의 쿼리 실행·경로·URL 주입은 받지 않는다. */
function validateInput(input,spec) {
  const schema=spec.inputSchema;
  validArgument(isObject(input) && Object.keys(input).every(key => Object.hasOwn(schema.properties,key)));
  validArgument(schema.required.every(key => Object.hasOwn(input,key)));
  for (const [key,value] of Object.entries(input)) {
    const property=schema.properties[key];
    if (property.type === 'array') {
      validArgument(Array.isArray(value) && value.length === 2);
      for (const item of value) validateSchema(item,property.items);
      validArgument(new Set(value.map(item => item.normalize('NFKC').replace(/\s+/g,''))).size === 2);
    } else validateSchema(value,property);
  }
  if (spec.name === 'analyze_public_data') {
    const allowed = input.analysis === 'facility_compare' ? ['analysis','areas']
      : input.analysis === 'support_candidates' ? ['analysis','area','supportKind','wheelchair'] : ['analysis','area'];
    validArgument(Object.keys(input).every(key => allowed.includes(key)));
    if (input.analysis === 'facility_compare') validArgument(Array.isArray(input.areas));
    if (input.area !== undefined) validArgument(input.area.trim().length > 0);
    if (input.areas) validArgument(input.areas.every(area => area.trim().length > 0));
  }
}

/** 다른 state 필드는 조회하지 않고 값의 복사본만 순수 모듈에 전달한다. */
function operationalContext(state) {
  const context={};
  const area=state?.patient?.area;
  const wheelchair=state?.visitSupport?.requirements?.wheelchair;
  const hospitalName=state?.selectedHospital?.companyName || state?.patient?.localHospital;
  const safeText=value => typeof value === 'string' && value.trim() && value.length <= 100 && !/[\u0000-\u001f\u007f]/u.test(value);
  if (safeText(area)) context.area=area;
  if (typeof wheelchair === 'boolean') context.wheelchair=wheelchair;
  if (safeText(hospitalName)) context.hospitalName=hospitalName;
  return Object.freeze(context);
}

function verifiedSource(value,allowlist) {
  let url;
  try { url=new URL(value); } catch { throw new AgentError('INVALID_SOURCE','확인된 공식 출처 URL이 필요합니다.'); }
  fail(url.protocol === 'https:' && !url.username && !url.password && !url.port && allowlist.has(url.href),'INVALID_SOURCE','확인된 공식 출처만 사용할 수 있습니다.');
  return url.href;
}

function dataSourceUrls(data,name) {
  const refs=name === 'search_public_data' ? data.results : data.datasetRefs;
  const values=(refs ?? []).flatMap(item => [item.sourceUrl,item.hubUrl]).filter(Boolean);
  for (const candidate of data.candidates ?? []) values.push(...[candidate.source?.url,candidate.source?.hubUrl].filter(Boolean));
  return values;
}

/** 의존성 주입은 독립 검사 전용이다. 모델 인자는 PUBLIC_DATA_TOOLS의 고정 schema만 사용한다. */
export function createPublicDataToolExecutor({search=searchPublicDataCatalog,analyze=analyzePublicData,sourceUrls=PUBLIC_DATA_SOURCE_URLS} = {}) {
  const allowlist=new Set(sourceUrls.map(value => new URL(value).href));
  return function execute({name,input,state}) {
    const spec=toolMap.get(name);
    fail(spec,'UNKNOWN_TOOL','지원하지 않는 도구입니다.');
    validateInput(input,spec);
    const args={...input,...(input.areas ? {areas:[...input.areas]} : {})};
    const data=name === 'search_public_data' ? search(args) : analyze(args,operationalContext(state));
    const sources=dataSourceUrls(data,name).map(value => verifiedSource(value,allowlist));
    const unavailable=name === 'analyze_public_data' && data.status === 'unavailable';
    const label=name === 'search_public_data' ? '진료 준비용 공공데이터 목록 조회'
      : input.analysis === 'facility_compare' ? '공개 표본의 지역별 등록 현황 비교'
      : input.analysis === 'support_candidates' ? '공개 이동·동행 문의 후보 분석' : '이동시간 원자료 접근 범위 확인';
    const detail=name === 'search_public_data'
      ? `분류 메타데이터에서 관련 ${data.results.length}건을 반환했습니다. 목록·명세와 실제 조회 가능한 공개 snapshot을 구분하며 현재 운영정보는 확인하지 않았습니다.`
      : unavailable ? '계산에 필요한 원자료가 없어 수치·평균·ETA를 제공하지 않았습니다. 필요한 자료와 기존 문의 준비로 확인할 질문을 정리했습니다.'
      : '등록된 공개 snapshot의 범위·시점·분모·결측을 보존해 계산했습니다. 문의 준비 제안이며 실제 수용·예약·배차·진료 적합성은 확인하지 않았습니다.';
    const events=[{id:randomUUID(),tool:name,label,detail,status:unavailable ? 'needs_input' : 'completed',isSimulation:false,...(sources[0] ? {source:sources[0]} : {})}];
    // 원문 query·분석 결과를 state나 새 세션 필드에 저장하지 않는다. 준비 제안은 data 안에서만 반환한다.
    return {state,data,events,pendingActions:[]};
  };
}

export const executePublicDataTool=createPublicDataToolExecutor();
