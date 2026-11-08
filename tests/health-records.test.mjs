import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoCase, applyAction } from '../app/domain.js';
import { getDemoHealthRecords, getDemoDocument, getDemoFhirJson } from '../app/health-records.js';
import { createToolDispatcher } from '../agent/tools.mjs';

test('고정 FHIR 원본의 환자·기관·외래 참조가 자체 Bundle 안에서 연결된다',()=>{
  const bundle=JSON.parse(getDemoFhirJson());
  assert.equal(bundle.resourceType,'Bundle');assert.equal(bundle.type,'collection');
  const identities=new Set(bundle.entry.map(({resource})=>`${resource.resourceType}/${resource.id}`));
  const references=[];
  const collect=value=>{
    if(Array.isArray(value))for(const item of value)collect(item);
    else if(value && typeof value==='object')for(const [key,item] of Object.entries(value))if(key==='reference')references.push(item);else collect(item);
  };
  collect(bundle);
  assert.equal(identities.size,bundle.entry.length);
  const patient=bundle.entry.find(({resource})=>resource.resourceType==='Patient').resource;
  for(const {resource} of bundle.entry)if(!['Patient','Organization'].includes(resource.resourceType))assert.equal(resource.subject.reference,`Patient/${patient.id}`);
  for(const reference of references)assert.ok(identities.has(reference),`해결되지 않는 FHIR 참조: ${reference}`);
});

test('FHIR 예제에 판독문이 있어도 초기 준비 목록에는 미보유로 남는다',()=>{
  const records=getDemoHealthRecords(createDemoCase());
  assert.equal(records.documents.find(record=>record.id==='history').prepared,true);
  assert.deepEqual(records.documents.find(record=>record.id==='report'),{
    id:'report',resourceType:'DiagnosticReport',resourceId:'demo-report',authoredAt:'2026-10-21T00:00:00Z',
    status:'missing',prepared:false,content:'',source:'혼디 고정 합성 FHIR 예제',
  });
});

test('사례 조회 도구가 모델에 합성 출처·작성일·종료된 복약과 현재 보유 상태를 전달한다',async()=>{
  const result=await createToolDispatcher()({name:'get_case',input:{},state:createDemoCase()});
  const records=result.data.healthRecords;
  assert.equal(records.source.format,'FHIR R4');assert.equal(records.source.isSynthetic,true);
  assert.equal(records.source.healthwayConnected,false);assert.equal(records.source.nhisConnected,false);
  assert.ok(records.records.every(record=>record.recordedAt));
  const medication=records.records.find(record=>record.resourceType==='MedicationStatement');
  assert.match(medication.detail,/종료된 가상 이력/);assert.match(medication.detail,/현재 복용.*의미하지 않습니다/);
  assert.equal(records.documents.find(record=>record.id==='report').content,'');
});

test('합성 기록 도구가 FHIR 치료이력·판독문을 복구하고 진찰·의뢰서는 만들지 않는다',async()=>{
  const state=applyAction(createDemoCase(),{type:'REMOVE_DOCUMENT',id:'history'});
  const before=structuredClone(state);
  const result=await createToolDispatcher()({name:'request_records',input:{source:'demo'},state});
  assert.deepEqual(state,before);
  const bundle=JSON.parse(getDemoFhirJson());
  const report=bundle.entry.find(({resource})=>resource.resourceType==='DiagnosticReport').resource;
  assert.equal(result.state.documents.find(record=>record.id==='report').content,report.conclusion);
  assert.equal(result.state.documents.find(record=>record.id==='history').status,'ready');
  assert.equal(result.data.healthRecords.documents.find(record=>record.id==='report').authoredAt,report.issued);
  assert.equal(result.state.documents.find(record=>record.id==='exam').status,'not_performed');
  assert.equal(result.state.documents.find(record=>record.id==='referral').status,'missing');
  assert.equal(result.data.healthRecords.source.healthwayConnected,false);
});

test('미보유 정정 이후 같은 FHIR 원본이 있어도 현재 판독문 본문을 반환하지 않는다',async()=>{
  const {state}=await createToolDispatcher()({name:'request_records',input:{source:'demo'},state:createDemoCase()});
  const missing=applyAction(state,{type:'REMOVE_DOCUMENT',id:'report'});
  const records=getDemoHealthRecords(missing);
  const report=records.documents.find(record=>record.id==='report');
  assert.equal(report.prepared,false);assert.equal(report.content,'');assert.equal(report.status,'missing');
});

test('다른 준비 대상에는 고정 합성 FHIR 기록을 연결하거나 반환하지 않는다',async()=>{
  const state=createDemoCase();state.patient.name='다른 합성 대상';
  const summary=getDemoHealthRecords(state);
  assert.deepEqual(summary.records,[]);assert.deepEqual(summary.documents,[]);
  await assert.rejects(createToolDispatcher()({name:'request_records',input:{source:'demo'},state}),error=>error.code==='DEMO_PATIENT_MISMATCH');
});

test('FHIR 보유 자료가 임의 진찰 소견·의뢰서 원본으로 사용되지 않는다',()=>{
  for(const id of ['exam','referral','__proto__'])assert.throws(()=>getDemoDocument(id),error=>error.code==='INVALID_DEMO_FHIR');
});
