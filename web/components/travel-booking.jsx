'use client';
import { ExternalLink, Phone } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useAppointment, Action, Note } from './appointment-context';
import { flightSearch, BOOKING_SOURCES, bookingCallHref } from '../../app/appointment-booking-links.js';
import { dateLabel } from './appointment-calendar';

export function BookingLink({href,children,primary=false}) {
  return <a className={`booking-link${primary?' booking-link-primary':''}`} href={href} target={href.startsWith('tel:')?undefined:'_blank'} rel="noopener noreferrer" referrerPolicy="no-referrer">{children}{href.startsWith('tel:')?<Phone aria-hidden="true"/>:<ExternalLink aria-hidden="true"/>}<span className="sr-only">{href.startsWith('tel:')?'전화 연결':'새 창'}</span></a>;
}
export function FlightSearch() {
  const {state,onAction}=useAppointment(),search=flightSearch(state);
  return <section className="flight-search" aria-labelledby="flight-search-title"><div className="flight-search-heading"><h3 id="flight-search-title">항공권 찾기</h3><span>제주 CJU – 김포 GMP</span></div>
    {state.date?<div className="flight-clinic-date"><p>희망 진료 <strong>{dateLabel(state.date)} {state.time}</strong></p><div><Action action="flight_dates" value="previous" variant="link">진료 전날 출발</Action><Action action="flight_dates" value="same" variant="link">진료 당일 출발</Action></div></div>:<Note>항공권 날짜를 직접 입력하거나 먼저 진료 일정을 골라 주세요.</Note>}
    <div className="flight-search-fields">{[['outbound','가는 날'],['inbound','오는 날 · 선택']].map(([field,label])=><label key={field} className="trip-field" htmlFor={`flight-${field}`}><span>{label}</span><Input id={`flight-${field}`} type="date" value={search[field]} min={field==='inbound'?search.outbound:undefined} onChange={event=>onAction('flight_field',{field,value:event.target.value},event.target)}/></label>)}<label className="trip-field"><span>성인</span><Select value={search.adults} onValueChange={value=>onAction('flight_field',{field:'adults',value},document.getElementById('flight-adults'))}><SelectTrigger id="flight-adults" aria-label="항공권 성인 인원"><SelectValue/></SelectTrigger><SelectContent>{['1','2','3','4'].map(n=><SelectItem key={n} value={n}>{n}명</SelectItem>)}</SelectContent></Select></label></div>
    <Note>{state.date&&state.travel.departure==='unknown'&&state.travel.flightSearch?.outbound===undefined?'진료 전날을 출발일로 제안해요. ':''}가는 날을 바꾸면 제주공항행 차량 날짜도 바뀌어요. 오는 날을 비우면 편도로 검색해요. 검사 종료·추가 방문 여부를 확인한 뒤 귀가편을 정하세요.</Note>
    {search.needsDateReview&&!search.issues.length&&<p className="booking-error" role="alert">항공 검색 날짜와 희망 진료 날짜가 맞지 않아요. 출발·귀가일을 다시 확인해 주세요.</p>}
    {search.issues.length>0&&<p className="booking-error" role="status">{search.issues.join(' ')}</p>}
    <div className="flight-search-action">{search.url?<BookingLink href={search.url} primary>스카이스캐너에서 가격 비교</BookingLink>:<Button type="button" disabled>날짜를 선택해 항공권 검색</Button>}<span>가격·편명 선택과 결제는 외부 사이트에서 진행</span></div>
    <details className="booking-details"><summary>검색에 전달하는 정보</summary><Note>공항·날짜·성인 수·일반석 조건만 전달해요. 환자 이름·병원·진료과는 보내지 않습니다. 혼디에 운임이나 예약 결과가 자동으로 돌아오지는 않아요. 유소아·수하물·이동 지원은 검색 사이트와 항공사에서 확인해 주세요.</Note></details>
  </section>;
}
export function GroundBooking({leg,prep}) {
  const {state}=useAppointment(),jeju=leg==='jeju',local=state.region==='jeju',accessible=prep.wheelchair || state.travel[jeju?'jejuMode':'seoulMode']==='accessible';
  if(!['jeju','seoul'].includes(leg))return null;
  const mode=state.travel[jeju?'jejuMode':'seoulMode'];
  if(mode==='family')return <Note>가족 차량의 픽업 시각·{local?'병원':'공항'} 승하차 위치·귀가편을 맞춰 주세요.</Note>;
  if(!accessible && ['bus','transit'].includes(mode))return <div className="ground-booking"><BookingLink href={jeju?'https://bus.jeju.go.kr/':'https://www.airport.co.kr/gimpo/index.do'}>{jeju?'제주 버스 노선·운행시간표':'김포공항 대중교통 안내'}</BookingLink><Note>출발 정류장·환승·첫차와 막차를 확인해 주세요.</Note></div>;
  const candidate=jeju&&prep.candidate?.id!=='jeju-accessible-transport'?prep.candidate:null;
  return <div className="ground-booking">
    {accessible?<><h4>휠체어 탑승 차량 접수</h4><p>{jeju?'제주 교통약자 이동지원센터 · 사전 회원등록 후 당일 즉시콜 접수':'서울 장애인콜택시 · 이용대상·등록·공항 운행 조건 확인 필요'}</p><div className="booking-actions"><BookingLink href={jeju?BOOKING_SOURCES.jejuAccessible:BOOKING_SOURCES.seoulAccessible}>{jeju?'제주 즉시콜 접수':'서울 인터넷 콜접수'}</BookingLink><BookingLink href={bookingCallHref(jeju?'1899-6884':'1588-4388')}>{jeju?'1899-6884':'1588-4388'} 문의</BookingLink></div><BookingLink href={jeju?BOOKING_SOURCES.jejuAccessibleGuide:BOOKING_SOURCES.seoulAccessibleGuide}>이용자격·등록 안내</BookingLink><Note>접수와 배차 확정은 달라요. 휠체어 종류·앉은 채 탑승·동행인·{local?'병원':'공항'} 승하차 지원을 확인하세요.{!local&&' 제주 등록·접수는 서울 서비스에 자동 적용되지 않습니다.'}</Note></>:<><h4>택시 호출·예약</h4><p>카카오 T 앱에서 해당 지역·차종의 호출 또는 예약 가능 여부를 확인해요.</p><div className="booking-actions"><BookingLink href={BOOKING_SOURCES.taxi}>카카오 T 예약·앱 안내</BookingLink>{candidate&&bookingCallHref(candidate.phone)&&<BookingLink href={bookingCallHref(candidate.phone)}>{candidate.name} 전화 문의</BookingLink>}</div><Note>예약 지원 차종·지역은 앱에서 확인해요. 일반 택시를 휠체어에 앉은 채 탈 수 있는 차량으로 보지는 않습니다.</Note></>}
  </div>;
}
