'use client';
import {Check,Home,Download,X,CircleAlert,Minus,CalendarDays,Pencil} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose} from './ui/dialog';
import {Button} from './ui/button';
import {useAppointment,Action} from './appointment-context';
import {bookingCallHref} from '../../app/appointment-booking-links.js';
import {reportedReferralLabel} from '../../app/appointment-demo.js';

function VehicleRecovery({view}) {
  const {requestedTime,offers,contacts}=view.vehicleRecovery;
  return <section className="vehicle-recovery" aria-labelledby="vehicle-recovery-title">
    <h3 id="vehicle-recovery-title">{offers.length?'대체 차량의 출발 시간을 골라 주세요':'조건에 맞는 대체 차량이 없어요'}</h3>
    <p>{view.pickupDate} · {view.options.pickup} 출발 · 요청 {requestedTime}
      {view.options.wheelchair&&' · 휠체어 탑승'}</p>
    {offers.length>0?<><div className="vehicle-offers">
      {offers.map(offer=><Action action="coordination_vehicle_retry" key={offer.key} value={offer.key}
        aria-label={`${offer.provider} ${offer.time} 출발로 차량만 다시 조율`}>
        <strong>{offer.time} 출발</strong><span>{offer.provider}</span></Action>)}
    </div><p>시간을 선택하면 해당 차량만 다시 조율해요. 가상 차량 시간표를 사용해요.</p></>:
      <><p>요청 시각 전후 1시간의 시연 시간표를 확인했어요.</p><Action action="reservation_edit" value="support" variant="link">출발 조건 바꾸기</Action></>}
    {contacts.length>0&&<details open={offers.length===0}>
      <summary>직접 문의할 제주 연락처</summary>
      <p>{view.options.wheelchair?'휠체어 탑승 자격·등록과 배차 가능 여부를 문의하세요.':'출발지의 운행 여부와 차량 가능 시각을 문의하세요.'}</p>
      {contacts.map(contact=><div key={contact.id} className="vehicle-contact">
        <a href={bookingCallHref(contact.phone)}>{contact.name} · {contact.phone}</a>
        <a href={contact.source.url} target="_blank" rel="noreferrer">출처{contact.source.asOf&&` · ${contact.source.asOf}`}</a>
      </div>)}
    </details>}
  </section>;
}

export function CoordinationResult({view:v}) {
  const {state,onAction}=useAppointment();
  return <Dialog open={v.done&&Boolean(state.coordination?.resultOpen)} onOpenChange={open=>onAction(open?'coordination_result_open':'coordination_result_close')}>
    <DialogContent className="hondi-react coordination-result-dialog" showCloseButton={false}
      onOpenAutoFocus={event=>{event.preventDefault();document.getElementById('coordination-result-heading')?.focus({preventScroll:true});}}
      onCloseAutoFocus={event=>{event.preventDefault();[document.querySelector('[data-book-action=coordination_result_open]'),document.getElementById('coordination-title'),document.getElementById('care-region-title'),document.getElementById('appointment-title')].find(n=>n?.checkVisibility()&&!n.closest('[inert]'))?.focus({preventScroll:true});}}>
      <header className="result-window-header"><span>예약 조율 결과</span><div className="result-window-tools"><Action action="reservation_edit" value="schedule" variant="ghost" aria-label="예약 수정"><Pencil/><span>예약 수정</span></Action><Action action="coordination_save" variant="ghost" aria-label="결과표 저장"><Download/><span>결과표 저장</span></Action><DialogClose asChild><Button type="button" variant="ghost" size="icon" aria-label="결과창 닫기"><X/></Button></DialogClose></div></header>
      <div className="result-window-body">
        <div className="result-arrival" data-handoff={Boolean(v.handoffs)}><div className="result-brand-seal" aria-hidden="true"><img src="/assets/hondi-mark-v1.png" alt=""/><span>{v.handoffs?<CircleAlert/>:<Check/>}</span></div><div><DialogTitle id="coordination-result-heading" tabIndex={-1}>{v.handoffs?'조율 결과를 확인해 주세요':'맡기신 예약이 정리됐어요'}</DialogTitle><DialogDescription>{v.confirmed}건 예약 완료{v.handoffs?` · ${v.handoffs}건 직접 확인 필요`:''} · 가상 회신을 이용한 시연 결과입니다.</DialogDescription></div></div>
        <div className="result-visit"><CalendarDays aria-hidden="true"/><span>{v.date} <strong>{v.time}</strong></span><span>{v.hospitalName}</span></div>
        {v.vehicleRecovery&&<VehicleRecovery view={v}/>}
        <ol className="result-reservations" aria-label="맡긴 예약의 결과">{v.rows.map(row=><li key={row.id} data-result={row.status}><span className="result-receipt-mark" aria-hidden="true">{row.status==='confirmed'?<Check/>:row.status==='handoff'?<CircleAlert/>:<Minus/>}</span><div><div className="result-receipt-title"><strong>{row.title}</strong><span>{row.status==='confirmed'?'예약 완료 · 시연':row.status==='handoff'?'직접 확인 필요':'요청하지 않음'}</span></div><p>{row.result?.detail||'이번 요청에서 제외했어요.'}</p><small>{row.result?.provider}</small></div></li>)}</ol>
        <section className="result-before-visit"><h3>출발 전 이것만 챙겨 주세요</h3><p>{reportedReferralLabel(state)?`${reportedReferralLabel(state)} · 제출 방법 확인`:'병원에서 요구하는 의뢰서·영상 등 서류'}{!v.local&&' · 항공권 예약과 도착 공항에서 병원 접수까지의 이동 시간 확인'} · 진료 후 귀가 차량</p></section>
        <p className="result-simulation-note">실제 전화·예약·배차는 하지 않았습니다. 선택한 공개 기관의 실제 회신이 아닙니다.</p>
      </div>
      <footer className="result-window-footer"><Action action="home" variant="ghost" aria-label="처음으로 돌아가기"><Home/>처음으로<span className="result-long-label"> 돌아가기</span></Action><Action action="reservations" primary aria-label="내 예약 현황 보기"><CalendarDays/>내 예약 현황</Action></footer>
    </DialogContent>
  </Dialog>;
}
