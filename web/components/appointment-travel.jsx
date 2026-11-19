'use client';
import { publicTimeLabel } from '../../app/jeju-appointment-data.js';
import { Bus, Plane, TrainFront, House, ExternalLink, CircleAlert } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { useAppointment, Note } from './appointment-context';
import { TRAVEL_OPTIONS, TRAVEL_TIMES, TRAVEL_SOURCES, assessTravel } from '../../app/appointment-travel.js';
import { appointmentPreparation } from '../../app/appointment-demo.js';
import { GroundBooking } from './travel-booking';

import { publicMonthLimit } from '../../app/jeju-appointment-data.js';

function Choice({field,label}) {
  const {state,onAction}=useAppointment();
  return <label className="trip-field"><span>{label}</span><Select value={state.travel[field]} onValueChange={value=>onAction('travel_field',{field,value},document.getElementById(`trip-${field}`))}><SelectTrigger id={`trip-${field}`} aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{TRAVEL_OPTIONS[field].map(([value,text])=><SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent></Select></label>;
}
function Times({fields}) {
  const {state,onAction}=useAppointment();
  const min=state.usePublicData?`${state.jejuHospital.today}T00:00`:'2026-11-15T00:00';
  const limit=state.usePublicData?publicMonthLimit(state.jejuHospital):'2027-01',last=new Date(Number(limit.slice(0,4)),Number(limit.slice(5)),0).getDate();
  return <details className="trip-time-details"><summary>계획한 시각을 입력해 대조하기</summary><Note>선택 입력 · {state.region==='jeju'?'실제 교통 운행·소요시간':'편명과 실제 운항 시각'}은 조회하지 않았어요.</Note><div className="trip-time-grid">{fields.map(field=><label key={field} className="trip-field" htmlFor={`trip-${field}`}><span>{TRAVEL_TIMES[field]}</span><Input type="datetime-local" id={`trip-${field}`} value={state.travel.times[field] || ''} min={min} max={`${limit}-${last}T23:59`} onChange={event=>onAction('travel_field',{field,value:event.target.value},event.target)} /></label>)}</div></details>;
}
export function Travel() {
  const {state,caseState,onAction}=useAppointment(),local=state.region==='jeju',prep=appointmentPreparation(caseState,state),assessment=assessTravel(state,prep.wheelchair);
  const rows=local?[
    {id:'jeju',title:'집에서 제주 병원까지',Icon:Bus,detail:'병원행 버스·택시·휠체어 차량',fields:['homeDeparture','hospitalArrival']},
    {id:'return',title:'진료·검사를 마치고 집으로',Icon:House,detail:'검사 종료·귀가 차량·막차·동행',fields:['examEnd','returnHome']},
  ]:[{id:'jeju',title:'집에서 제주공항까지',Icon:Bus,detail:'공항행 노선·첫차·환승과 탑승 여유',fields:['airportArrival']},
    {id:'flight',title:'제주와 도외를 잇는 항공편',Icon:Plane,detail:'가는 날·오는 날·수속과 이동 지원',fields:['outDeparture','outArrival']},
    {id:'seoul',title:'도착 공항에서 병원까지',Icon:TrainFront,detail:'병원 도착·초진 접수·영상 등록',fields:['hospitalArrival']},
    {id:'return',title:'진료·검사를 마치고 집으로',Icon:House,detail:'귀가편·막차·지연·숙박 대안',fields:['examEnd','returnAirport','returnDeparture','returnArrival']}];
  return <section className="appointment-section trip-workspace" aria-label="왕복 이동 점검"><div className="trip-heading"><h3>{local?'집 ↔ 제주 병원':'공항·병원 이동'}</h3><span className="trip-progress-text">문의 메모 {assessment.checked}/{assessment.total}</span></div>{local&&<Note>{prep.legs[0].title} · 희망 진료 {state.usePublicData?(state.jejuHospital.from?`${state.jejuHospital.from}${state.jejuHospital.to!==state.jejuHospital.from?` ~ ${state.jejuHospital.to || '종료일 미선택'}`:''}`:'날짜 미선택'):state.date || '날짜 미선택'} {state.usePublicData?`${publicTimeLabel(state.jejuHospital)} · 실제 진료 시각은 병원 확인`:state.time || ''}</Note>}<Note>각 구간에서 공식 접수 창구로 이동할 수 있어요. 체크는 문의 메모이며, 예약·배차 완료 표시는 아닙니다.</Note>
    {(state.recheck||state.travel.recheck)&&<p className="appointment-recheck" role="status">조건 변경 · 기존 계획은 남기고 체크를 해제했어요. {local?'진료·이동':'진료·항공·이동'} 조건을 다시 맞춰 주세요.</p>}
    <Accordion type="multiple" defaultValue={[]} className="trip-legs">{rows.map(({id,title,Icon,detail,fields},index)=>{
      const checks=assessment.items.filter(item=>item.leg===id),source=TRAVEL_SOURCES.find(item=>item.id===id);
      return <AccordionItem key={id} value={id}><AccordionTrigger id={`trip-leg-${id}`}><span className="trip-leg-number">{index+1}</span><Icon aria-hidden="true" /><span className="trip-leg-label"><strong>{title}</strong><small>{detail}</small></span><span className="trip-leg-count">{checks.filter(item=>state.travel.checks.includes(item.id)).length}/{checks.length}</span></AccordionTrigger><AccordionContent>
        {id==='jeju'&&<Choice field="jejuMode" label={local?'제주 병원까지 이동 수단':'제주공항까지 이동 수단'} />}{id==='flight'&&<Choice field="airport" label="도외 도착 공항" />}{id==='seoul'&&<Choice field="seoulMode" label="공항에서 병원까지 이동 수단" />}
        <GroundBooking leg={id} prep={prep}/>
        {id==='return'&&(local?<><GroundBooking leg="jeju" prep={prep}/><Note>진료 지연과 검사 종료에 맞춰 귀가 차량·막차를 확인해요. 다른 이동 수단은 공식 창구에서 따로 확인해 주세요.</Note></>:<><Choice field="returnPlan" label="귀가 계획"/><Note>검사가 다른 날 잡힐 수 있어요. 검사 종료·추가 방문 여부를 병원에 확인한 뒤 귀가편과 숙박을 결정해요.</Note></>)}
        {checks.map(item=><label key={item.id} className="trip-check" htmlFor={`trip-check-${item.id}`}><Checkbox id={`trip-check-${item.id}`} checked={state.travel.checks.includes(item.id)} onCheckedChange={()=>onAction('travel_check',item.id,document.getElementById(`trip-check-${item.id}`))}/><span>{item.label}</span></label>)}
        <Times fields={fields}/>
        {source&&<a className="trip-official-link" href={source.url} target="_blank" rel="noreferrer">{source.label}<ExternalLink aria-hidden="true" /></a>}
        {id==='jeju'&&prep.candidate&&<details className="appointment-source"><summary>제주 차량 문의 후보</summary><p>{prep.candidate.name} · {prep.candidate.phone}</p><Note>{local?'공개자료의 제주 문의처입니다. 병원 운행·이용자격·차량은 미확인입니다.':'공개자료의 제주 문의처입니다. 공항 운행·이용자격·차량은 미확인이고 서울 구간 공급자가 아닙니다.'}</Note><a href={prep.candidate.source.url} target="_blank" rel="noreferrer">공개 출처 보기</a></details>}
      </AccordionContent></AccordionItem>;
    })}</Accordion>
    <div className="trip-assessment" aria-live="polite">{assessment.issues.length>0&&<section className="trip-conflict" role="alert"><h4><CircleAlert aria-hidden="true"/>입력한 일정 확인 필요</h4><ul>{assessment.issues.map(text=><li key={text}>{text}</li>)}</ul></section>}<details className="compact-disclosure"><summary>아직 확인해야 할 일 · {assessment.pending.length}개</summary><ul>{assessment.pending.map(text=><li key={text}>{text}</li>)}</ul><Note>시각을 입력하면 순서 충돌만 대조합니다. 실제 경로 소요시간이나 탑승 가능 여부를 계산한 결과는 아니에요. 모든 시각은 한국 시각입니다.</Note></details></div>
  </section>;
}
