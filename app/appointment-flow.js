import {appointmentSelection,preferredDateReady,availableAppointments,needsScheduleConsultation} from './appointment-demo.js';
import {publicHospital,publicHospitalReady,publicWishReady,publicDoctorLabel,publicTimeLabel} from './jeju-appointment-data.js';
import {coordinationView} from './care-coordination.js';

export const BOOKING_STEPS=['병원·진료과','의료진·시간','요청 확인','AI 예약·결과'];
export const bookingSteps=state=>state?.usePublicData?['병원·진료과','희망 의료진·시간','요청 확인','AI 예약·결과']:BOOKING_STEPS;
export function bookingStep(state) {
  return ['intake','public_find'].includes(state.screen)?1:['availability','schedule','doctors','public_dates'].includes(state.screen)?2:state.screen==='support'?4:3;
}
export function bookingSelectionLabel(state) {
  if(state.usePublicData) {
    const h=publicHospital(state),p=state.jejuHospital;
    return [h?.companyName,p.visitDepartment,p.from?`${p.from}${p.to&&p.to!==p.from?` ~ ${p.to}`:''}`:null,p.from?publicTimeLabel(p):null,p.doctorMode==='named'?publicDoctorLabel(p):null].filter(Boolean).join(' · ');
  }
  const {hospital,doctor,date,time}=appointmentSelection(state);
  return [hospital?.name,state.department,doctor?.name,date,time].filter(Boolean).join(' · ');
}
/** 표시·다음 행동만 계산한다. 기관 접수·예약을 실행하지 않는다. */
export function bookingNext(state,caseState={},coordination) {
  const p=state.jejuHospital;
  switch(state.screen) {
    case 'intake':return {action:'find_dates',label:'다음: 의료진·시간',hint:'병원과 진료과를 확인한 뒤 날짜를 골라 주세요.'};
    case 'public_find':return {action:'public_dates_next',label:'다음: 의료진·시간',disabled:!publicHospitalReady(p),hint:!publicHospital(state)?'아래 목록에서 병원을 선택해 주세요.':!p.visitDepartment?'선택한 병원에서 진료받을 과를 골라 주세요.':'선택한 병원에 문의할 날짜와 의료진을 정해요.'};
    case 'public_dates':
      if(p.from&&p.to&&!p.preferencesOpen)return {action:'public_show_preferences',label:'의료진·시간 선택',hint:'희망 날짜를 골랐어요. 의료진과 시간 조건을 이어서 선택해요.'};
      return {action:'public_prepare',label:'다음: 요청 확인',disabled:!publicWishReady(p),hint:!p.from?'달력에서 희망 날짜를 선택해 주세요.':!p.to?'기간의 종료일을 선택해 주세요.':p.doctorMode==='named'&&!p.doctorName.trim()?'희망 의료진 이름을 입력해 주세요.':p.timeOfDay==='unknown'?'시간대를 선택하거나 시간대 무관을 골라 주세요.':p.timeOfDay==='specific'&&!p.time?'희망 시각을 입력해 주세요.':'희망 조건을 정리해요. 실제 가능 여부는 병원 확인이 필요해요.'};
    case 'availability':
      if(appointmentSelection(state).valid)return {action:'review',label:'다음: 요청 확인',hint:'의료진과 시간을 선택했어요. 방문 유형과 준비 서류를 확인해요.'};
      if(!preferredDateReady(state))return {action:'review',label:'다음: 요청 확인',disabled:true,hint:state.preferredFrom?'기간의 종료일을 선택해 주세요.':'달력에서 하루 또는 희망 기간을 선택해 주세요.'};
      return availableAppointments(state).length?{action:'show_times',label:'의료진·시간 선택',hint:'선택한 날짜의 결과에서 의료진과 진료 시각을 골라 주세요.'}:{action:'consult',label:'일정 상담으로 계속',hint:'선택한 날짜에 시연 빈자리가 없어요. 다른 날짜를 고르거나 상담을 준비해요.'};
    case 'schedule':return {action:'review',label:'다음: 요청 확인',disabled:!appointmentSelection(state).valid,hint:'달력 아래에서 진료 시각을 선택해 주세요.'};
    case 'doctors':return {action:'find_dates',label:'날짜로 의료진 찾기',hint:'희망 날짜에 가능한 의료진을 함께 비교해 보세요.'};
    case 'review':
      if(needsScheduleConsultation(state))return {action:'reservations',label:'내 예약 현황 보기',hint:'희망 날짜와 문의할 내용을 현황에서 다시 열 수 있어요.'};
    case 'public_review':
    case 'result':return {action:'view',value:'support',label:'다음: AI에게 맡길 내용',disabled:false,hint:'차량·동행을 선택한 뒤 예약 진행부터 결과까지 한곳에서 확인해요.'};
    case 'support': {
      const v=coordination??coordinationView(state,caseState);
      if(v.vehicleRecovery)return {action:'coordination_result_open',label:v.vehicleRecovery.offers.length?'차량 대안 보기':'차량 문의 방법 보기',hint:'이미 조율한 병원과 동행 일정은 유지해요.'};
      return v.done?{action:'coordination_save',label:'결과표 저장',hint:v.handoffs?'예약된 내용과 직접 확인할 내용을 함께 저장해요.':'맡긴 예약 시연을 마쳤어요. 일정과 결과를 저장할 수 있어요.'}:v.running?{action:'coordination_start',label:'예약 조율 중',disabled:true,hint:'회신을 받는 순서대로 결과에 체크하고, 모두 끝나면 알려드려요.'}:{action:'coordination_start',label:v.stopped?'남은 예약 이어서 조율':v.changed?'변경한 내용 다시 맡기기':'이 내용으로 예약 시연 시작',disabled:!v.ready,hint:v.issue||'가상 창구에서 병원·차량·동행을 조율해요. 실제 전화나 예약은 하지 않아요.'};
    }
    default:return {action:'resume',label:'진료 준비로 돌아가기',hint:'자료를 확인한 뒤 선택하던 단계로 돌아가요.'};
  }
}
