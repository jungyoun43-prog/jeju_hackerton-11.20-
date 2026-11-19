// Assign a clock only within the part of the request that names its purpose.
// Several clocks for the same purpose need the caregiver's choice.
const clockPattern = /(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{2})(?!\d)|\s*시(?!간)(?:\s*(반|\d{1,2}\s*분))?)|(오전|오후)/g;

function readClock(match) {
  const [, period, hourText, clockMinutes, spokenMinutes, periodOnly] = match;
  if (periodOnly) return periodOnly === '오전' ? 'morning' : 'afternoon';
  let hour = Number(hourText);
  const minute = spokenMinutes === '반' ? 30 : Number(clockMinutes ?? spokenMinutes?.match(/\d+/)?.[0] ?? 0);
  if (hour > 23 || minute > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (period === '오후' ? 12 : 0);
  } else if (!clockMinutes && hour >= 1 && hour <= 12) {
    return null;
  }
  return [hour, minute].map(value => String(value).padStart(2, '0')).join(':');
}

export function requestClocks(text) {
  const visit = new Set(), pickup = new Set();
  const clauses = [];
  for (const sentence of text.split(/[.,;!?。\n]|(?:이고요|이고|인데|지만)\s*/u)) {
    let clause = '';
    for (const part of sentence.split(/\s+(?=(?:진료|택시|픽업|차량)(?:는|은)\s*)/u)) {
      if (clause.search(clockPattern) !== -1) {
        clauses.push(clause);
        clause = '';
      }
      clause = clause ? clause + ' ' + part : part;
    }
    clauses.push(clause);
  }
  for (const clause of clauses) {
    const clocks = [...clause.matchAll(clockPattern)].map(readClock);
    if (!clocks.length) continue;
    const ride = /택시|차량|픽업|공항행|출발/.test(clause);
    const clinic = /진료|외래|진찰/.test(clause);
    const other = /귀가|돌아오|돌아가|비행기|항공편|도착|검사\s*종료/.test(clause);
    if (!clinic && /귀가|돌아오|돌아가|비행기|항공편|병원\s*도착|검사\s*종료/.test(clause)) continue;
    if (other && !clinic && !ride) continue;
    if ((ride && clinic) || (other && (clinic || ride)) || /말고|제외|취소/.test(clause)) {
      if (clinic || !ride) visit.add(null);
      if (ride) pickup.add(null);
      continue;
    }
    const target = ride ? pickup : visit;
    for (const clock of clocks) target.add(clock);
  }
  if (/시간(?:대)?\s*(?:는|은)?\s*(?:무관|상관없)/.test(text) && !visit.size) visit.add('any');
  const one = values => values.size === 1 ? [...values][0] : null;
  const visitValue = one(visit), pickupValue = one(pickup);
  return {
    visit: visitValue,
    visitUnclear: visit.size > 0 && !visitValue,
    pickup: pickupValue?.includes(':') ? pickupValue : null,
    pickupUnclear: pickup.size > 0 && !pickupValue?.includes(':'),
  };
}
