import { DOCUMENT_DEFINITIONS } from './domain.js';
import { getDemoHealthRecords, getDemoFhirJson } from './health-records.js';
import { icon } from './icons.js';

import { escapeHtml as escape } from './message-format.js';
const dateLabel=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));

function renderFhirRecords(state) {
  const summary=getDemoHealthRecords(state);
  const section=document.getElementById('fhir-demo-records');
  section.querySelector('[data-fhir-notice]').textContent=summary.notice;
  section.querySelector('[data-fhir-source-label]').textContent=`${summary.source.label} · ${dateLabel(summary.source.asOf)} 작성 · ${summary.resourceCount}개 리소스`;
  const records=document.getElementById('fhir-demo-entries');
  if(!summary.matchesCase) {
    records.replaceChildren();
    section.querySelector('[data-fhir-original]').hidden=true;
    return;
  }
  section.querySelector('[data-fhir-original]').hidden=false;
  const entries=[...summary.records,...summary.documents.map(record=>({
    id:record.resourceId,resourceType:record.resourceType,label:record.id==='history'?'치료 이력 원본':'판독문 원본',recordedAt:record.authoredAt,
    value:record.prepared?'현재 준비 목록에 반영됨':'예제에 포함 · 현재 준비 목록에는 미반영',
    detail:record.prepared?record.content:'자료를 준비하거나 미보유 상태를 정정한 결과를 현재 목록에서 확인하세요.',
  }))];
  for(const entry of entries) {
    let node=[...records.children].find(item=>item.dataset.fhirRecordId===entry.id);
    if(!node) {
      node=document.createElement('details');node.className='record-document';node.dataset.fhirRecordId=entry.id;
      node.innerHTML=`<summary><span data-fhir-label></span><span data-fhir-date></span>${icon('chevron')}</summary><dl><div><dt>내용 · 합성</dt><dd data-fhir-value></dd></div><div><dt>설명</dt><dd data-fhir-detail></dd></div><div><dt>원본 항목</dt><dd data-fhir-reference></dd></div></dl>`;
      records.append(node);
    }
    node.querySelector('[data-fhir-label]').textContent=entry.label;
    node.querySelector('[data-fhir-date]').textContent=dateLabel(entry.recordedAt);
    node.querySelector('[data-fhir-value]').textContent=entry.value;
    node.querySelector('[data-fhir-detail]').textContent=entry.detail;
    node.querySelector('[data-fhir-reference]').textContent=`${entry.resourceType}/${entry.id}`;
  }
  const original=section.querySelector('[data-fhir-json]');
  if(!original.textContent)original.textContent=getDemoFhirJson();
}

/** 기존 기록 창의 노드·열림·초점을 보존하며 현재 사례만 읽는다. */
export function renderPatientRecords(state) {
  const patient=state.patient || {};
  const provided=value=>typeof value==='string' && value.trim()?value:'현재 사례에 정보가 제공되지 않았습니다.';
  const fields=[
    ['name','이름',provided(patient.name)],
    ['age','나이',Number.isFinite(patient.age)?`${patient.age}세`:'현재 사례에 정보가 제공되지 않았습니다.'],
    ['area','지역',provided(patient.area)],
    ['caregiver','보호자',provided(patient.caregiver)],
    ['existingHospital','기존 도외 병원',provided(patient.existingHospital)],
    ['localHospital','제주 병원',provided(patient.localHospital)],
    ['nextVisit','방문일 · 시연 일정',provided(patient.nextVisit)],
    ['purpose','준비 목적',provided(patient.purpose)],
  ];
  document.getElementById('patient-basics').innerHTML=fields.map(([key,label,value])=>`<div data-patient-field="${key}" class="${['existingHospital','localHospital','purpose'].includes(key)?'wide':''}"><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('');
  for(const definition of DOCUMENT_DEFINITIONS) {
    const record=state.documents?.find(item=>item.id===definition.id);
    const node=document.querySelector(`[data-record-document-id="${definition.id}"]`);
    const source=typeof record?.source==='string'?record.source:'';
    const content=typeof record?.content==='string'?record.content:'';
    const status=record?.status==='ready' ? source.trim()?'준비됨 표시 · 합성 자료':'준비됨 표시 · 출처 미확인' : record?.status==='missing'?'사례 자료 미준비':record?.status==='not_performed'?'사례상 시행 전':'상태가 제공되지 않았습니다.';
    node.querySelector('[data-record-label]').textContent=record?.label || definition.label;
    node.querySelector('[data-record-status]').textContent=status;
    node.querySelector('[data-record-status]').dataset.status=record?.status || 'unknown';
    node.querySelector('[data-record-status]').classList.toggle('unverified',record?.status==='ready' && !source.trim());
    node.querySelector('[data-record-source]').textContent=source.trim()?source:'출처가 제공되지 않았습니다.';
    node.querySelector('[data-record-content]').textContent=content.trim()?content:'이 사례에 표시할 내용이 제공되지 않았습니다.';
  }
  renderFhirRecords(state);
}
