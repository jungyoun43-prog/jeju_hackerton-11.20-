import supportData from './data/visit-support-providers.json' with {type:'json'};
import { getSupportCandidates } from './support-data.js';

/** 기기 기본 설정에는 공개 문의처 ID와 이동 조건만 담는다. */
export const DEFAULT_CARE_PREFERENCES = Object.freeze({taxiProviderId:'auto',wheelchair:false,companionNeeded:true});
const keys = Object.keys(DEFAULT_CARE_PREFERENCES);
const taxiIds = new Set(supportData.providers.filter(provider => provider.kind === 'taxi').map(provider => provider.id));

export function normalizeCarePreferences(value,{strict = false} = {}) {
  const valid = value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key))
    && (value.taxiProviderId === 'auto' || taxiIds.has(value.taxiProviderId))
    && typeof value.wheelchair === 'boolean' && typeof value.companionNeeded === 'boolean';
  if (!valid) {
    if (strict) throw new TypeError('기본 설정은 공개 택시 문의처와 휠체어·동행 필요 여부만 사용할 수 있습니다.');
    return {...DEFAULT_CARE_PREFERENCES};
  }
  return {taxiProviderId:value.taxiProviderId,wheelchair:value.wheelchair,companionNeeded:value.companionNeeded};
}

export function getTaxiPreferenceOptions(area = '') {
  return [{value:'auto',label:'지역에 맞게 찾기'},...getSupportCandidates(supportData,{kind:'taxi',area:typeof area === 'string' ? area : ''})
    .map(provider => ({value:provider.id,label:provider.name}))];
}
