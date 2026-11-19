// 가상 협력 차량의 운행표. 제주 공개 문의처의 배차나 운영 시간을 나타내지 않는다.
const services=[
  {id:'partner-taxi',name:'가상 협력택시',wheelchair:false,first:7*60,last:20*60,interval:30},
  {id:'partner-lift',name:'가상 휠체어 협력차량',wheelchair:true,first:8*60+15,last:17*60+45,interval:30},
];

function minutesOf(time) {
  const [hour,minute]=time.split(':').map(Number);
  return hour*60+minute;
}

function clockText(minutes) {
  return [Math.floor(minutes/60),minutes%60].map(value=>String(value).padStart(2,'0')).join(':');
}

export function plannedPickupDeadline(state) {
  const times=state.travel?.times||{};
  return state.region==='jeju'?times.hospitalArrival:[times.airportArrival,times.outDeparture].filter(Boolean).sort()[0];
}

export function needsWheelchairVehicle(state,caseRequirement=false) {
  return state.travel?.jejuMode==='accessible'||(state.coordination?.preferences?.wheelchair??caseRequirement);
}

export function selectedVehicleService(choice,route,time,wheelchair) {
  if(!choice||choice.route!==route||choice.time!==time)return null;
  const service=services.find(item=>item.id===choice.providerId&&item.wheelchair===wheelchair);
  if(!service)return null;
  const minutes=minutesOf(time);
  return minutes>=service.first&&minutes<=service.last&&(minutes-service.first)%service.interval===0?service:null;
}

export function findVehicleAlternatives(plan,reference,latestPickup) {
  const requested=minutesOf(plan.options.pickupTime);
  const offers=[];
  for(const service of services.filter(item=>item.wheelchair===plan.options.wheelchair)) {
    for(let minutes=service.first;minutes<=service.last;minutes+=service.interval) {
      const difference=minutes-requested;
      if(Math.abs(difference)>60)continue;
      const time=clockText(minutes);
      if(`${plan.pickupDate}T${time}`>=latestPickup)continue;
      offers.push({key:`${reference}|${service.id}|${time}`,providerId:service.id,provider:service.name,time,difference});
    }
  }
  return offers.sort((a,b)=>Math.abs(a.difference)-Math.abs(b.difference)||a.time.localeCompare(b.time)).slice(0,2);
}
