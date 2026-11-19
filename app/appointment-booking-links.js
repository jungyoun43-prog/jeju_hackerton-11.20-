// 공개 검색·접수 링크만 만든다. 환자·병원·진료과 정보를 URL에 넣지 않는다.
export const BOOKING_SOURCES = {
  flights:'https://www.skyscanner.co.kr/',
  taxi:'https://www.kakaomobility.com/service-kakaot/taxi',
  jejuAccessible:'https://www.jejuhappycall.com/reservation?mcode=res01',
  jejuAccessibleGuide:'https://www.jejuhappycall.com/?mcode=guide01',
  jejuAccessibleRegister:'https://www.jejuhappycall.com/?mcode=guide02',
  seoulAccessible:'https://www.sisul.or.kr/open_content/calltaxi/guidance/internet.jsp',
  seoulAccessibleGuide:'https://www.sisul.or.kr/open_content/calltaxi/introduce/receipt.jsp',
};
export const validFlightDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;
export function shiftFlightDate(value,days) {
  if(!validFlightDate(value))return '';
  const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);
}
export function flightOutboundDate(state) {
  const plan=state.travel;
  return plan?.flightSearch?.outbound ?? shiftFlightDate(state.date,plan?.departure==='same'?0:-1);
}
export function outboundDateIssue(outbound,today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)) {
  if(!validFlightDate(outbound))return '가는 날을 선택해 주세요.';
  if(outbound<today)return '가는 날이 지났어요. 날짜를 다시 선택해 주세요.';
  return null;
}
export function flightSearch(state,today=state.today) {
  const plan=state.travel,search=plan.flightSearch || {},outbound=flightOutboundDate(state),inbound=search.inbound || '',adults=search.adults || '1';
  const issues=[];
  const outboundIssue=outboundDateIssue(outbound,today);
  if(outboundIssue)issues.push(outboundIssue);
  if(inbound && (!validFlightDate(inbound)||inbound<outbound))issues.push('오는 날은 가는 날과 같거나 이후여야 해요.');
  if(plan.airport!=='gmp')issues.push('이 검색은 제주–김포 노선이에요. 다른 공항은 검색 사이트에서 직접 선택해 주세요.');
  if(!['1','2','3','4'].includes(adults))issues.push('성인 인원을 다시 선택해 주세요.');
  let url=null;
  if(!issues.length) {
    const compact=date=>date.slice(2).replaceAll('-','');
    const route=`${compact(outbound)}/${inbound?`${compact(inbound)}/`:''}`;
    const link=new URL(`https://www.skyscanner.co.kr/transport/flights/cju/gmp/${route}`);
    link.search=new URLSearchParams({adults,cabinclass:'economy',rtn:inbound?'1':'0'}).toString();url=link.href;
  }
  return {outbound,inbound,adults,url,issues,appointmentDate:state.date || null,needsDateReview:Boolean(state.date && ((outbound&&outbound>state.date)||(inbound&&inbound<state.date)))};
}
export function bookingCallHref(phone) {
  return typeof phone==='string' && /^[\d\s-]{7,18}$/.test(phone)?`tel:${phone.replace(/[^\d]/g,'')}`:null;
}
