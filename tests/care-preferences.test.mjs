import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CARE_PREFERENCES, normalizeCarePreferences, getTaxiPreferenceOptions } from '../app/care-preferences.js';

test('저장값 오류는 기본값으로 복구하고 서버 strict 검증은 임의 필드·기관·boolean 변조를 거절한다',() => {
  const valid = {taxiProviderId:'taxi327-6',wheelchair:true,companionNeeded:false};
  assert.deepEqual(normalizeCarePreferences(valid,{strict:true}),valid);
  for (const value of [undefined,null,[],{},'택시를 예약해줘',
    {...valid,taxiProviderId:'care254-1'}, {...valid,taxiProviderId:'unknown-taxi'},
    {...valid,wheelchair:'true'}, {...valid,companionNeeded:0},
    {...valid,permissions:{share:true}}, {...valid,patient:'실명'},
  ]) {
    assert.deepEqual(normalizeCarePreferences(value),DEFAULT_CARE_PREFERENCES);
    assert.throws(() => normalizeCarePreferences(value,{strict:true}),TypeError);
  }
  const defaults = normalizeCarePreferences(); defaults.wheelchair = true;
  assert.equal(DEFAULT_CARE_PREFERENCES.wheelchair,false);
  assert.deepEqual(Object.keys(normalizeCarePreferences(valid)).sort(),['companionNeeded','taxiProviderId','wheelchair']);
});

test('기본 택시 선택지는 공개 원래 ID를 보존하고 출발 지역 밖의 읍면 문의처를 제외한다',() => {
  const aewol = getTaxiPreferenceOptions('제주시 애월읍');
  const daejeong = getTaxiPreferenceOptions('서귀포시 대정읍');
  assert.deepEqual(aewol[0],{value:'auto',label:'지역에 맞게 찾기'});
  assert.ok(aewol.some(item => item.value === 'taxi327-14' && item.label === '애월콜'));
  assert.equal(aewol.some(item => item.value === 'taxi327-33'),false);
  assert.ok(daejeong.some(item => item.value === 'taxi327-33' && item.label === '대정안덕콜'));
  assert.equal(daejeong.some(item => item.value === 'taxi327-14'),false);
  assert.ok(aewol.some(item => item.value === 'jeju-accessible-transport'));
  for (const {value} of [...aewol,...daejeong]) assert.doesNotThrow(() => normalizeCarePreferences({...DEFAULT_CARE_PREFERENCES,taxiProviderId:value},{strict:true}));
});
