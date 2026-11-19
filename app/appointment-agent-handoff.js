import { appointmentSelection, appointmentRegionLabel } from './appointment-demo.js';
import { publicHospital, publicDoctorLabel, publicTimeLabel, jejuSupportEvidence } from './jeju-appointment-data.js';

/** 현재 선택을 새 요청의 참고 조건으로 옮긴다. 상태 변경·예약·자동 전송은 없다. */
export function buildAppointmentAgentDraft(state, caseState) {
  const evidence=jejuSupportEvidence(state,caseState),hospital=publicHospital(state),plan=state.jejuHospital;
  const chosen=appointmentSelection(state);
  const lines=['예약 준비 화면에서 선택한 아래 조건을 바탕으로, 공개자료를 조회해 문의할 곳과 다음 할 일을 정리해 주세요.'];
  if(state.usePublicData) {
    lines.push(`병원: ${hospital?.companyName || '미선택'} / 진료과: ${plan.visitDepartment || '미선택'}`,
      `희망 일정: ${plan.from || '미정'}${plan.to&&plan.to!==plan.from?` ~ ${plan.to}`:''} / ${publicTimeLabel(plan)}`,
      `희망 의료진: ${publicDoctorLabel(plan)}. 실제 소속·가능 여부는 미확인입니다.`);
    if(hospital)lines.push(`병원 근거: 제주데이터허브 859, 수집 ${hospital.collectedAt.slice(0,10)}. ${hospital.source.url}`);
  } else {
    lines.push(`${appointmentRegionLabel(state)} 가상 예약 체험: ${chosen.hospital?.name || '미선택'} / ${state.department || '미선택'}`,
      `희망 일정: ${state.preferredFrom || state.date || '미정'}${state.preferredTo&&state.preferredTo!==state.preferredFrom?` ~ ${state.preferredTo}`:''} / ${chosen.time || '시간 미정'}`,
      `의료진: ${chosen.doctor?.name || '미선택'}. 병원·의료진·빈자리는 가상이며 실제 기관으로 조회하지 마세요.`);
  }
  lines.push(`이동 문의 지역: ${evidence.area}. 휠체어 지원 우선 조회: ${evidence.wheelchair?'필요':'선택하지 않음'}.`);
  for(const [kind,row] of Object.entries(evidence.selected)) {
    if(row)lines.push(`${{taxi:'차량',companion:'동행·돌봄',health:'공공보건'}[kind]} 문의 후보: ${row.name} (${row.phone || '전화 미수록'}). ${row.matchLabel}. 근거 ${row.source.datasetId?`허브 ${row.source.datasetId}`:'별도 공식 안내'} · ${row.source.asOf || '기준일 미표시'}.`);
  }
  lines.push('기존 합성 사례와 선택 조건을 구분하고, 희망 기간을 임의의 확정일로 바꾸지 마세요. 과거 등록정보로 현재 운영·진료 적합성·이용자격을 판단하지 마세요.',
    '진료의뢰서·초진/재진·희망 의료진/시간 확인, 이동/동행의 남은 질문과 출처·기준일을 정리해 주세요. 실제 전화·예약·배차·개인기록 조회는 하지 마세요.');
  return lines.join('\n');
}

export function mergeAppointmentDraft(existing, next, maxLength=1600) {
  const current=String(existing || '').trim(),draft=String(next || '').trim();
  const text=!current||current===draft?draft:`${current}\n\n${draft}`;
  return text.length<=maxLength?text:null;
}
