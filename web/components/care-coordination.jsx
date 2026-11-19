'use client';
import {Check,Clock3,PhoneCall,UserRound,CarFront,Hospital,ArrowRight,CircleAlert,Square,ArrowUpRight} from 'lucide-react';
import {useAppointment,Action,Note} from './appointment-context';
import {Checkbox} from './ui/checkbox';
import {Input} from './ui/input';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from './ui/select';
import {reportedReferralLabel} from '../../app/appointment-demo.js';
import {Travel} from './appointment-travel';
import {JejuSupportContacts} from './jeju-support-contacts';
import {FlightSearch} from './travel-booking';
import {CoordinationResult} from './coordination-result';

const icons={hospital:Hospital,taxi:CarFront,companion:UserRound};
const statusLabels={queued:'진행 전',contacting:'가상 창구 연결 중',waiting:'시연 회신 대기',confirmed:'예약 완료 · 시연',handoff:'직접 확인 필요',not_needed:'이번 요청에 없음'};
function Option({field,label,checked,disabled}) {
  const {onAction}=useAppointment();
  return <label className="coordination-option" htmlFor={`coordination-${field}`}><Checkbox id={`coordination-${field}`} checked={checked} disabled={disabled} onCheckedChange={value=>onAction('coordination_option',{field,value:value===true},document.getElementById(`coordination-${field}`))}/><span>{label}</span></label>;
}
function CoordinationOptions({v,edit=false}) {
  const {onAction}=useAppointment();
  return <div className="coordination-request">
    <div className="coordination-request-title"><strong>이번에 맡길 일</strong><span>병원 예약은 기본으로 포함</span></div>
    <div className="coordination-options">
      <Option field="taxi" label="가는 편 차량" checked={v.options.taxi}/>
      <Option field="companion" label="병원 동행" checked={v.options.companion}/>
      {v.options.taxi&&<Option field="wheelchair" label="휠체어 탑승 차량" checked={v.options.wheelchair}/>}
    </div>
    {v.options.taxi&&<details className="coordination-pickup-details" open={edit||undefined}>
      <summary>출발 장소·시각 수정</summary>
      <div className="coordination-pickup">
        <label htmlFor="coordination-pickup"><span>출발 장소</span>
          <Input id="coordination-pickup" maxLength={80} value={v.options.pickup}
            onChange={e=>onAction('coordination_option',{field:'pickup',value:e.target.value},e.currentTarget)}/>
        </label>
        <label htmlFor="coordination-pickup-time"><span>{v.local?'출발 시각':`공항행 ${v.pickupDate||'날짜 선택'}`} · 시연</span>
          <Input id="coordination-pickup-time" type="time" value={v.options.pickupTime}
            onChange={e=>onAction('coordination_option',{field:'pickupTime',value:e.target.value,pickupDay:v.pickupDay},e.currentTarget)}/>
        </label>
        {v.canChoosePickupDay&&<label htmlFor="coordination-pickup-day"><span>차량 출발일 · {v.pickupDate}</span>
          <Select value={v.pickupDay} onValueChange={value=>onAction('coordination_option',{field:'pickupDay',value},document.getElementById('coordination-pickup-day'))}>
            <SelectTrigger id="coordination-pickup-day" aria-label="차량 출발일"><SelectValue/></SelectTrigger>
            <SelectContent><SelectItem value="previous">진료 전날</SelectItem><SelectItem value="same">진료 당일</SelectItem></SelectContent>
          </Select>
        </label>}
      </div>
    </details>}
  </div>;
}
function CoordinationIssue({view,state}) {
  if(!view.issue)return null;
  return <p className="coordination-issue" role="status"><CircleAlert/>{view.issue}
    {view.issueControl?<Action action="coordination_fix_issue" variant="link">{view.issueControl==='flight-outbound'?'가는 날 선택':'출발 조건 수정'}<ArrowRight/></Action>:
      <Action action={state.usePublicData?'public_edit_dates':'find_dates'} variant="link">일정 선택<ArrowRight/></Action>}
  </p>;
}
export function Coordination() {
  const {state,edit,coordination:v}=useAppointment();
  if(edit)return <section className="reservation-support-editor" aria-label="이동·동행 수정"><h3>이동·동행 수정</h3><CoordinationOptions v={v} edit/>{!v.local&&<details className="compact-disclosure"><summary>공항행 차량 날짜·항공권 찾기</summary><FlightSearch/></details>}<p className="appointment-note">진료 날짜·시각을 바꾸면 차량과 동행 시간도 다시 확인해요. 변경 내용을 확인한 뒤 다시 조율합니다.</p></section>;
  return <section className="coordination" aria-label="AI 예약 조율" data-coordination-status={v.running?'running':v.done?'finished':'idle'}>
    {v.done&&<CoordinationResult view={v}/>}
    <div className="coordination-heading"><div><h3 id="coordination-title" tabIndex={-1}>{v.title}</h3><p>{v.done?`${v.confirmed}건 예약 완료${v.handoffs?` · ${v.handoffs}건 직접 확인`:''} · 아래 결과는 모두 시연이에요.`:v.running?'창구의 회신을 받으면 예약 결과에 체크해요.': '원하는 지원을 고르면 전화·연결부터 예약 결과까지 이어가요.'}</p></div>{v.done?<span className="coordination-finish" data-success={!v.handoffs}>{v.handoffs?<CircleAlert/>:<Check/>}{v.handoffs?'조율 종료':'시연 완료'}</span>:<span className="coordination-count">{v.confirmed} / {v.total}</span>}</div>
    <div className="coordination-columns"><div className="coordination-main">
      {(!v.done||state.coordination?.editing)&&!v.running&&<CoordinationOptions v={v}/>}
      <ol className="coordination-results" aria-label="예약 진행과 결과">{v.rows.map(row=>{const Icon=icons[row.id],active=['contacting','waiting'].includes(row.status);return <li key={row.id} data-result={row.status} data-job={row.id}><span className="coordination-result-icon">{row.status==='confirmed'?<Check/>:active?<PhoneCall/>:row.status==='handoff'?<CircleAlert/>:<Icon/>}</span><div><div className="coordination-result-title"><h4>{row.title}</h4><span>{statusLabels[row.status]}</span></div><p>{row.status==='not_needed'?'선택하지 않은 지원은 진행하지 않아요.':row.result?.detail||row.detail}</p>{row.result&&<small>{row.result.provider} · 가상 회신</small>}{row.status==='handoff'&&row.id==='hospital'&&<Action action="edit_intake" variant="link">병원·문의 조건 보기<ArrowRight/></Action>}{row.id==='taxi'&&v.vehicleRecovery&&<Action action="coordination_result_open" variant="link">{v.vehicleRecovery.offers.length?'차량 대안 보기':'차량 문의 방법 보기'}<ArrowRight/></Action>}</div>{active&&<Clock3 className="coordination-active" aria-label="진행 중"/>}</li>;})}</ol>
      {v.done&&<div className="coordination-result-actions"><Action action="coordination_result_open">결과창 다시 보기</Action><Action action="reservation_edit" value="schedule" variant="ghost">예약 수정</Action><Action action="reservation_edit" value="support" variant="ghost">이동·동행 조건 수정</Action></div>}<p className="coordination-live sr-only" role="status" aria-live="polite">{v.running?`${v.rows.find(r=>['contacting','waiting'].includes(r.status))?.title||'예약'} 진행 중`:v.done?v.title:''}</p>
      {!v.running&&!v.done&&<CoordinationIssue view={v} state={state}/>}
      {v.running&&<Action action="coordination_stop" variant="ghost"><Square/>시연 중지</Action>}
    </div><aside className="coordination-context"><section><h4>{v.done?'예약 일정 · 시연':'진행할 일정 · 시연'}</h4><p className="coordination-date">{v.date||'날짜 선택'} <strong>{v.time||'시간 선택'}</strong></p><p>{v.hospitalName}</p>{state.usePublicData&&<details><summary>실제 선택 병원과 시연 구분</summary><small>공개 병원 ‘{v.selectedName||'미선택'}’의 희망 조건을 사용해요. 회신은 별도 가상 병원에서 보여줍니다.</small></details>}</section><section><h4>출발 전 직접 챙길 일</h4><p>{reportedReferralLabel(state)||'병원이 요구하는 진료의뢰서·영상 등 서류'}</p>{!v.local&&<p>항공권 가격 비교·결제, 항공편에 맞춘 차량 시각</p>}<p>검사 종료 후 귀가 차량</p><details><summary>서류·시간 안내</summary><Note>예약 시연은 의뢰서 발급·제출이나 진료 수락을 뜻하지 않아요. 서류가 없으면 담당 의료진과 발급을 상의하고 병원의 제출 방법을 확인해 주세요.</Note><Note>표시 시간은 시연용 제안이며 실제 이동시간을 계산하지 않았어요. 내륙 공항·병원 이동은 항공편 확정 후 다시 맞춰야 합니다.</Note></details></section></aside></div>
    <div className="coordination-tools">{!v.local&&<details className="compact-disclosure"><summary>항공권 가격 비교·예약<ArrowUpRight/></summary><FlightSearch/></details>}<details className="compact-disclosure"><summary>제주 공개 문의처·출처</summary><JejuSupportContacts/></details><details className="compact-disclosure"><summary>왕복 교통 세부 계획</summary><Travel/></details><details className="compact-disclosure"><summary>시연 안내·다른 결과 체험</summary><Note>실제 전화·예약·배차·결제는 하지 않아요. 가상 창구의 고정 응답으로 완료·실패 흐름을 보여줍니다. 입력과 결과는 이 탭에서만 유지되고 새로고침하면 사라집니다.</Note><div className="coordination-scenarios">{[['success','예약되는 경우'],['taxi_unavailable','차량이 없는 경우'],['hospital_identity','병원 본인확인이 필요한 경우']].map(([value,label])=><Action key={value} action="coordination_scenario" value={value} selected={(state.coordination?.scenario||'success')===value} disabled={v.running}>{label}</Action>)}</div></details></div>
  </section>;
}
