import bundle from './data/fhir-demo-bundle.json' with {type:'json'};

const REFERENCE_BASE = 'https://hondi.example/fhir/';
const SOURCE = Object.freeze({
  id:bundle.id,label:'혼디 고정 합성 FHIR 예제',format:'FHIR R4',version:'4.0.1',
  asOf:bundle.timestamp,url:'/data/fhir-demo-bundle.json',isSynthetic:true,
  healthwayConnected:false,nhisConnected:false,profileValidated:false,
});
class DemoRecordsError extends Error {
  constructor(message) {super(message);this.name='DemoRecordsError';this.code='INVALID_DEMO_FHIR';}
}
function resource(type) {
  const records=bundle.entry.filter(entry=>entry.resource.resourceType===type);
  if(records.length!==1)throw new DemoRecordsError(`합성 FHIR의 ${type} 항목을 확인해 주세요.`);
  return records[0].resource;
}
if(bundle.resourceType!=='Bundle' || bundle.type!=='collection' || !bundle.meta.tag.some(tag=>tag.code==='synthetic'))throw new DemoRecordsError('고정 합성 FHIR Bundle이 필요합니다.');
const patient=resource('Patient'),organization=resource('Organization'),encounter=resource('Encounter');
const history=resource('DocumentReference'),report=resource('DiagnosticReport');
const observation=resource('Observation'),medication=resource('MedicationStatement');
const patientReference=`Patient/${patient.id}`;
for(const {fullUrl,resource:record} of bundle.entry) {
  if(fullUrl!==`${REFERENCE_BASE}${record.resourceType}/${record.id}` || record.subject && record.subject.reference!==patientReference)throw new DemoRecordsError('합성 FHIR의 환자·리소스 참조가 일치하지 않습니다.');
}
const DOCUMENTS=Object.freeze({
  history:Object.freeze({id:'history',source:'시연용 합성 치료 이력',content:history.description,resourceType:history.resourceType,resourceId:history.id,authoredAt:history.date}),
  report:Object.freeze({id:'report',source:'서버 고정 합성 판독문 보유 예시 · 실제 진료기록 아님',content:report.conclusion,resourceType:report.resourceType,resourceId:report.id,authoredAt:report.issued}),
});

/** 앱에 포함한 고정 예제만 읽는다. 외부 FHIR·파일·환자 입력을 받지 않는다. */
export function getDemoDocument(id) {
  const document=Object.hasOwn(DOCUMENTS,id)?DOCUMENTS[id]:null;
  if(!document)throw new DemoRecordsError('합성 예제에 없는 자료는 생성하지 않습니다.');
  return {...document};
}

/** 화면·모델이 같은 출처를 읽고, 예제에 존재하는 자료와 현재 준비 상태를 구분한다. */
export function getDemoHealthRecords(state) {
  const matchesCase=state.patient?.name===patient.name[0].text && state.patient?.existingHospital===organization.name;
  const documents=Object.values(DOCUMENTS).map(document=>{
    const current=state.documents?.find(item=>item.id===document.id);
    const prepared=matchesCase && current?.status==='ready' && current.source===document.source && current.content===document.content;
    return {id:document.id,resourceType:document.resourceType,resourceId:document.resourceId,authoredAt:document.authoredAt,
      status:current?.status ?? 'missing',prepared,content:prepared?document.content:'',source:SOURCE.label};
  });
  return {
    source:{...SOURCE},matchesCase,isSimulation:true,resourceCount:bundle.entry.length,
    documents:matchesCase?documents:[],
    records:matchesCase?[
      {id:encounter.id,resourceType:encounter.resourceType,label:'도외 외래 방문 예제',recordedAt:encounter.period.start,value:`${organization.name} · 가상 외래 종료 기록`,detail:'실제 방문·예약·진료 수락을 확인한 기록이 아닙니다.'},
      {id:observation.id,resourceType:observation.resourceType,label:observation.code.text,recordedAt:observation.effectiveDateTime,value:`${observation.valueQuantity.value} ${observation.valueQuantity.unit}`,detail:observation.note[0].text},
      {id:medication.id,resourceType:medication.resourceType,label:'과거 복약 예제',recordedAt:medication.dateAsserted,value:medication.medicationCodeableConcept.text,detail:`${medication.effectivePeriod.start}~${medication.effectivePeriod.end} · 종료된 가상 이력. ${medication.note[0].text}`},
    ]:[],
    notice:matchesCase?'고정 합성 예제입니다. 건강정보 고속도로·공단 조회, 실제 진료·처방·측정·의료진 확인은 수행하지 않았습니다.':'현재 준비 대상이 고정 FHIR 예제와 달라 해당 기록을 연결하지 않았습니다.',
  };
}

export function getDemoFhirJson() {return JSON.stringify(bundle,null,2);}
