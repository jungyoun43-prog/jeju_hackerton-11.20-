'use client';
import {ArrowLeft,ArrowRight,CalendarDays,Check,Clock3,CircleAlert,Minus,Download,Pencil} from 'lucide-react';
import {Button} from './ui/button';
import {reservationOverview} from '../../app/reservation-overview.js';

function continueLabel(view) {
  if(view.vehicleRecovery)return view.vehicleRecovery.offers.length?'차량 대안 보기':'차량 문의 방법 보기';
  if(view.done)return '예약 결과 보기';
  return view.stopped?'중지한 조율 이어보기':'준비 이어보기';
}

function rowStatusLabel(status,view) {
  if(status==='confirmed')return '예약 완료 · 시연';
  if(status==='handoff')return '직접 확인 필요';
  if(status==='not_needed')return '요청하지 않음';
  if(view.stopped)return '조율 재개 대기';
  if(view.running)return '조율 중';
  return view.changed?'재확인 필요':'준비 중';
}

function ConsultationSummary({visit,onAction}) {
  const {region,label,status,state,selectedName}=visit;
  return <section className="reservation-visit" data-reservation-region={region}>
    <header className="reservation-visit-header">
      <div><h3>{label}<span>{status}</span></h3>
        <p><CalendarDays/><strong>희망 {state.preferredFrom||'날짜 미정'}{state.preferredTo&&state.preferredFrom!==state.preferredTo&&` ~ ${state.preferredTo}`}</strong></p>
        <p className="reservation-selected">{selectedName} · {state.department}</p>
      </div>
      <div className="reservation-visit-actions">
        <Button variant="outline" onClick={()=>onAction('consultation_memo',region)}>상담 메모 보기</Button>
        <Button variant="ghost" onClick={()=>onAction('consultation_dates',region)}>다른 날짜 찾기<ArrowRight/></Button>
      </div>
    </header>
  </section>;
}

export function ReservationsOverview({drafts,caseState,onAction}) {
  const overview=reservationOverview(drafts,caseState);
  return <div className="hondi-react care-entry reservations-page">
    <header className="entry-page-header"><div><h2 id="care-region-title" tabIndex={-1}>내 예약 현황</h2><p className="entry-lead">병원·차량·동행 일정을 한곳에서 확인하세요.</p></div><Button variant="ghost" onClick={()=>onAction('home')}><ArrowLeft/>처음으로 돌아가기</Button></header>
    {overview.visits.length? <>
      <div className="reservations-summary"><span><strong>진료 준비 {overview.visits.length}건</strong><span className="reservations-total">병원·차량·동행 {overview.confirmed}건 완료 · 시연</span>{overview.handoffs>0&&` · ${overview.handoffs}건 직접 확인 필요`}</span><small>현재 탭에서 준비한 일정</small></div>
      <div className="reservation-visits">{overview.visits.map(visit=>{
        const {region,label,view,status,selectedName}=visit;
        if(visit.consultation)return <ConsultationSummary key={region} visit={visit} onAction={onAction}/>;
        return <section key={region} className="reservation-visit" data-reservation-region={region}>
        <header className="reservation-visit-header">
          <div>
            <h3>{label}<span data-attention={Boolean(view.handoffs||view.changed||view.stopped)}>{status}</span></h3>
            <p><CalendarDays aria-hidden="true"/><strong>{view.date||'희망 날짜 미정'}{view.date&&view.time?` · ${view.time}`:''}</strong></p>
            <p className="reservation-selected">{[selectedName,view.department,view.doctor].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="reservation-visit-actions">
            <Button variant="outline" aria-label={`${label} 예약 수정`} onClick={()=>onAction('reservation_edit',region)}><Pencil/>예약 수정</Button>
            <Button variant="outline" onClick={()=>onAction(view.done?'reservation_detail':'resume_region',region)}>{continueLabel(view)}<ArrowRight/></Button>
            {view.done&&<Button variant="ghost" aria-label={`${label} 결과표 저장`} onClick={()=>onAction('reservation_save',region)}><Download/></Button>}
          </div>
        </header>
        <details className="reservation-breakdown" open={overview.visits.length===1||Boolean(view.handoffs||view.changed||view.stopped)}><summary>병원·차량·동행 내역</summary><ol className="reservation-status-list" aria-label={`${label} 예약 항목`}>{view.rows.map(row=>{
          const complete=row.status==='confirmed',handoff=row.status==='handoff',excluded=row.status==='not_needed';
          const Icon=complete?Check:handoff?CircleAlert:excluded?Minus:Clock3;
          return <li key={row.id} data-result={row.status}><Icon aria-hidden="true"/><div><strong>{row.title}</strong><p>{row.result?.detail||(excluded?'이번 요청에서 제외했어요.':view.changed?'바뀐 조건으로 다시 조율해야 해요.':row.detail)}</p>{row.result&&<small>{row.result.provider} · 가상 회신</small>}</div><span>{rowStatusLabel(row.status,view)}</span></li>;
        })}</ol></details>
      </section>;})}</div>
      <p className="reservations-note">가상 회신으로 보여주는 예약 시연입니다. 실제 전화·예약·배차는 하지 않았어요. 새로고침하면 이 탭의 현황은 초기화됩니다.</p>
    </>:<section className="reservations-empty"><CalendarDays aria-hidden="true"/><h3>아직 준비한 예약이 없어요</h3><p>진료 지역을 고르고 병원과 일정을 준비해 보세요.</p><Button onClick={()=>onAction('home')}>진료 준비 시작<ArrowRight/></Button></section>}
  </div>;
}
