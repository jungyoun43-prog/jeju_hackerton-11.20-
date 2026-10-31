import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseSupportCsv, createSupportRegistry, loadSupportRegistry, getSupportCandidates, validateSupportRegistry} from '../app/support-data.js';

const registry = JSON.parse(await readFile(new URL('../app/data/visit-support-providers.json', import.meta.url), 'utf8'));

test('택시 최신 연결 원출처와 과거 돌봄 미리보기의 행 수·시점을 분리한다', () => {
  assert.equal(validateSupportRegistry(registry), registry);
  const taxi = registry.datasets.find(dataset => dataset.id === '327');
  assert.equal(taxi.rowCount, 34);
  assert.equal(taxi.asOf, '2026-03-19');
  assert.equal(taxi.scope, 'linked-public-file');
  assert.deepEqual(taxi.hubPreview, {asOf: '2020-04-30', rowCount: 45});
  assert.equal(registry.datasets.find(dataset => dataset.id === '254').rowCount, 19);
  assert.equal(registry.datasets.find(dataset => dataset.id === '254').asOf, '2020-04-17');
  assert.equal(registry.providers.filter(provider => !provider.source.datasetId).length, 2);
  assert.equal(registry.providers.length, 55);
});

test('애월 출발은 애월콜을 먼저 찾고 지역 근거를 표시한다', () => {
  const candidates = getSupportCandidates(registry, {kind: 'taxi', area: '제주시 애월읍'});
  assert.equal(candidates[0].name, '애월콜');
  assert.equal(candidates[0].phone, '064-799-9007');
  assert.equal(candidates[0].matchLevel, 'local');
  assert.match(candidates[0].matchLabel, /확인 필요/);
  assert.ok(!candidates.some(provider => provider.region === '서귀포시'));
  assert.equal(getSupportCandidates(registry, {kind: 'taxi', area: '애월'})[0].name, '애월콜');
});

test('서귀포 출발에 애월 업체를 일치 후보로 표시하지 않는다', () => {
  const candidates = getSupportCandidates(registry, {kind: 'taxi', area: '서귀포시 동홍동'});
  assert.ok(candidates.some(provider => provider.region === '서귀포시'));
  assert.ok(!candidates.some(provider => provider.name === '애월콜'));
});

test('휠체어 요청은 공식 교통약자 문의 경로를 앞세우고 자격 질문을 남긴다', () => {
  const candidates = getSupportCandidates(registry, {kind: 'taxi', area: '애월읍', wheelchair: true});
  assert.equal(candidates[0].serviceType, 'accessible_transport');
  assert.match(candidates[0].description, /회원등록/);
  assert.match(candidates[0].description, /동행인 제공 서비스가 아닙니다/);
  for (const provider of candidates) {
    for (const field of ['availableSeats', 'bookingAvailable', 'wheelchairAvailable', 'etaMinutes', 'fleetCount']) assert.equal(Object.hasOwn(provider, field), false);
  }
});

test('병원동행 공식 소개와 일반 돌봄 등록 문의처를 구분한다', () => {
  const candidates = getSupportCandidates(registry, {kind: 'companion', area: '제주시 애월읍'});
  assert.equal(candidates[0].serviceType, 'hospital_escort');
  assert.equal(candidates[0].source.datasetId, '');
  const care = candidates.find(provider => provider.serviceType === 'care_contact');
  assert.ok(care);
  assert.match(care.description, /병원 동행 제공.*확인되지/);
  assert.equal(care.matchLevel, 'city');
  assert.ok(!candidates.some(provider => provider.region === '조천읍'));
});

test('지역이 없으면 근접 거리나 일치 지역을 생성하지 않는다', () => {
  const candidates = getSupportCandidates(registry, {kind: 'taxi', area: ''});
  assert.ok(candidates.length);
  assert.ok(candidates.every(provider => provider.matchLevel !== 'local' && provider.matchLevel !== 'city'));
});

test('실패 응답과 바뀐 공식 출처를 조용히 성공 처리하지 않는다', async () => {
  await assert.rejects(() => loadSupportRegistry(async () => ({ok: false})), /불러오지 못/);
  const changed = structuredClone(registry);
  changed.providers[0].source.url = 'https://example.com/taxis';
  assert.throws(() => validateSupportRegistry(changed), /공식 출처/);
  changed.providers[0].source.url = 'https://user:password@www.data.go.kr/data/15056321/fileData.do';
  assert.throws(() => validateSupportRegistry(changed), /공식 출처/);
  const loaded = await loadSupportRegistry(async () => ({ok: true, json: async () => structuredClone(registry)}));
  assert.equal(loaded.providers.length, 55);
});

test('CSV의 BOM·인용 쉼표를 처리하고 열 수·따옴표·중복 헤더 오류를 거부한다', () => {
  assert.deepEqual(parseSupportCsv('\uFEFF지역별,명칭\r\n애월읍,"가상, 콜"\r\n'), [{'지역별': '애월읍', '명칭': '가상, 콜'}]);
  for (const input of ['a,a\n1,2', 'a, a\n1,2', 'a,b\n1', 'a,b\n"닫히지 않음']) assert.throws(() => parseSupportCsv(input), /항목|열 수|따옴표/);
});

test('잘못된 원자료의 빈 대표번호와 다른 데이터 ID를 거부한다', () => {
  const taxiRows = [{'지역별': '애월읍', '호출(콜)택시명': '합성 테스트', '전화번호': '', '데이터기준일자': '2026-03-19'}];
  const careResponse = {id: 254, csvData: [['구분', '읍면동', '기관명', '소재지', '전화번호', '데이터기준일자'], ['가상', '제주시', '가상기관', '제주시', '064-000-0000', '2020-04-17']]};
  assert.throws(() => createSupportRegistry({taxiRows, careResponse, retrievedAt: '2026-10-31'}), /기관명·지역·대표번호/);
  assert.throws(() => createSupportRegistry({taxiRows, careResponse: {...careResponse, id: 278}}), /허브254/);
});

test('조회일 미상의 결과를 앱에 연결되는 검증된 출처로 내보내지 않는다', () => {
  const changed = structuredClone(registry); changed.retrievedAt = '';
  assert.throws(() => validateSupportRegistry(changed), /실제 자료 조회일/);
});
