import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PUBLIC_DATA_SOURCE_URLS, searchPublicDataCatalog, analyzePublicData, getPreparationDataEvidence} from '../app/public-data-skill.js';
import {getSupportCandidates,getSupportInquiryCandidates} from '../app/support-data.js';

const exec = promisify(execFile);
const root = new URL('../', import.meta.url);
const [catalog, hospitals, registry, publicHealth] = await Promise.all(['public-data-catalog.json', 'hospital-candidates.json', 'visit-support-providers.json', 'public-health-contacts.json'].map(async file => JSON.parse(await readFile(new URL(`../app/data/${file}`, import.meta.url), 'utf8'))));
const context = {area: '제주시 애월읍', wheelchair: true, hospitalName: '합성 목적기관'};
const realFlagsFalse = value => {
  for (const key of ['actualCallPlaced', 'reservationConfirmed', 'clinicalAcceptanceConfirmed', 'caseMutation']) assert.equal(value[key], false, key);
};

test('카탈로그1,329개 색인과 정제 snapshot6개를 구분하고 감사 CSV 재색인을 재현한다', async () => {
  assert.equal(catalog.records.filter(row => row.sourceSystem === 'hub').length, 1259);
  assert.equal(catalog.records.filter(row => row.sourceSystem === 'center').length, 70);
  assert.equal(catalog.records.filter(row => row.sourceSystem === 'official').length, 2);
  assert.equal(new Set(catalog.records.map(row => row.id)).size, 1331);
  const result = searchPublicDataCatalog({purpose: 'hospital'});
  assert.equal(result.indexedMetadataCount, 1329);
  assert.deepEqual(result.usableSnapshotIds.sort(), ['hub:859', 'hub:327', 'hub:254', 'hub:1304', 'official:areum-escort', 'official:jeju-accessible-transport'].sort());
  const checked = await exec(process.execPath, ['scripts/public-data-catalog.mjs', '--check'], {cwd: root});
  assert.match(checked.stdout, /오프라인 색인 일치.*1329/);
  assert.match(checked.stdout, /API·원자료 갱신 없음/);
});

test('목적·폴더·병원 동의어로 소수 관련 자료를 고르고 결과 변경은 저장소를 바꾸지 않는다', () => {
  const result = searchPublicDataCatalog({purpose: 'hospital', query: '병원', limit: 3});
  assert.equal(result.results.length, 3);
  assert.equal(result.results[0].id, 'hub:859');
  assert.ok(result.results.every(row => row.folder === '의료'));
  assert.ok(searchPublicDataCatalog({purpose: 'hospital', query: '의료', limit: 8}).results.every(row => row.folder === '의료'));
  assert.ok(searchPublicDataCatalog({purpose: 'companion', query: '동행'}).results.some(row => row.id === 'hub:254'));
  assert.ok(!searchPublicDataCatalog({purpose: 'taxi'}).results.some(row => /사고/.test(row.title)));
  assert.equal(searchPublicDataCatalog({purpose: 'taxi', query: '없는데이터명'}).results.length, 0);
  result.results[0].tags.push('변경 fixture'); result.results[0].coverage.rowCount = -1;
  assert.equal(searchPublicDataCatalog({purpose: 'hospital'}).results[0].coverage.rowCount, 13);
  assert.ok(!searchPublicDataCatalog({purpose: 'hospital'}).results[0].tags.includes('변경 fixture'));
});

test('최신 파일 확인·목록수정일을 원자료 보유·기준일·행수로 바꾸지 않는다', () => {
  const hospitalResult = searchPublicDataCatalog({purpose: 'hospital'});
  const metadataOnly = hospitalResult.results.find(row => row.id === 'hub:229');
  assert.equal(metadataOnly.availability, 'metadata_only');
  assert.match(metadataOnly.availabilityReason, /최신 파일.*정제 저장소에 미탑재/);
  assert.match(metadataOnly.availabilityReason, /목록 수정일.*원자료 기준일이 아님/);
  assert.equal(metadataOnly.coverage.asOf, null);
  assert.equal(metadataOnly.coverage.rowCount, null);
  const hospital = hospitalResult.results[0];
  assert.equal(hospital.coverage.asOf, null);
  assert.equal(hospital.coverage.collectedAt, hospitals.retrievedAt);
  assert.match(hospital.coverage.label, /2024-10-17.*2018-08-31.*2024-08-10/);
  const taxi = searchPublicDataCatalog({purpose: 'taxi'}).results[0];
  assert.equal(taxi.coverage.asOf, '2026-03-19');
  assert.equal(taxi.coverage.rowCount, 34);
  assert.equal(taxi.sourceUrl, 'https://www.data.go.kr/data/15056321/fileData.do');
});

test('1304만 최신 연결 파일 snapshot으로 표시하고 카탈로그와 기존 후보 수는 유지한다', () => {
  const found = searchPublicDataCatalog({purpose: 'hospital', query: '보건지소'});
  const ref = found.results.find(row => row.id === 'hub:1304');
  assert.ok(ref); assert.equal(found.indexedMetadataCount, 1329);
  assert.equal(ref.availability, 'snapshot'); assert.equal(ref.coverage.rowCount, 35);
  assert.equal(ref.coverage.asOf, '2026-03-23'); assert.equal(ref.coverage.collectedAt, publicHealth.retrievedAt);
  assert.equal(ref.sourceUrl, 'https://www.data.go.kr/data/15056141/fileData.do');
  assert.equal(ref.hubUrl, 'https://jejudatahub.net/data/view/data/1304');
  assert.ok(ref.columns.includes('관할구역') && ref.columns.includes('전화번호'));
  assert.ok(found.suggestedAnalysis.includes('public_health_contacts'));
  assert.equal(hospitals.records.length, 13); assert.equal(registry.providers.length, 55);
});

test('공공보건 문의는 지역에 따라 후보·질문을 바꾸며 소재지와 담당 확인을 구분한다', () => {
  const before = structuredClone(context);
  const aewol = analyzePublicData({analysis: 'public_health_contacts'}, context);
  const jocheon = analyzePublicData({analysis: 'public_health_contacts', area: '조천읍'}, context);
  assert.equal(aewol.inputs.area, '제주시 애월읍');
  assert.equal(aewol.candidates[0].name, '애월보건지소');
  assert.equal(aewol.candidates[0].phone, '064-728-1514');
  assert.equal(aewol.metrics[0].value, 9);
  assert.deepEqual(aewol.metrics[0].matchCounts, {registered_jurisdiction: 1, registered_address: 7, city_contact: 1});
  assert.equal(jocheon.candidates[0].name, '조천 보건지소');
  assert.equal(jocheon.candidates[0].phone, '064-728-1516');
  assert.match(aewol.candidates[0].questions[0], /애월읍.*등록 관할.*애월읍 일원/);
  assert.match(jocheon.candidates[0].questions[0], /조천읍.*등록 관할.*조천읍 일원/);
  assert.equal(aewol.candidates[0].availabilityVerified, false);
  assert.ok(aewol.candidates.length <= 5);
  assert.ok(aewol.candidates.some(row => row.matchLevel === 'registered_address'));
  assert.match(aewol.limitations.join(' '), /소재지.*실제 담당지역/);
  const nohyung = analyzePublicData({analysis: 'public_health_contacts', area: '노형동'});
  assert.match(nohyung.candidates[0].questions[1], /건강생활지원 프로그램/);
  for (const value of [aewol, jocheon, nohyung]) {
    assert.deepEqual(value.preparationActions, []);
    assert.ok(value.candidates.every(row => row.source.datasetId === '1304'));
    realFlagsFalse(value);
  }
  assert.match(jocheon.missingData.join(' '), /사례.*변경하지 않았/);
  assert.deepEqual(context, before);
});

test('제주시 파일에서 서귀포·지역 미상을0개 기관으로 설명하지 않는다', () => {
  for (const input of [{analysis: 'public_health_contacts', area: '서귀포시'}, {analysis: 'public_health_contacts'}]) {
    const result = analyzePublicData(input);
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.candidates, []); assert.deepEqual(result.preparationActions, []);
    assert.equal(result.metrics[0].value, null); assert.equal(result.metrics[0].sourceRows, 35);
    assert.ok(result.missingData.length > 0); realFlagsFalse(result);
  }
  for (const extra of [{wheelchair: true}, {supportKind: 'taxi'}, {areas: ['애월', '조천']}, {url: 'https://evil.test'}]) assert.throws(() => analyzePublicData({analysis: 'public_health_contacts', ...extra}));
});

test('반환 출처는 canonical HTTPS 허용목록이며 임의 source URL을 생성하지 않는다', () => {
  assert.ok(Object.isFrozen(PUBLIC_DATA_SOURCE_URLS));
  for (const purpose of ['hospital', 'taxi', 'companion', 'travel']) {
    for (const ref of searchPublicDataCatalog({purpose, limit: 8}).results) {
      assert.equal(new URL(ref.sourceUrl).protocol, 'https:');
      assert.equal(new URL(ref.sourceUrl).href, ref.sourceUrl);
      assert.ok(PUBLIC_DATA_SOURCE_URLS.includes(ref.sourceUrl));
    }
  }
  assert.ok(!PUBLIC_DATA_SOURCE_URLS.includes('https://example.com/patient-records'));
});

test('두 시의 병원·돌봄을 독립 주소 계산과 같은 별도 분모로 비교한다', () => {
  const result = analyzePublicData({analysis: 'facility_compare', areas: ['제주시', '서귀포시']}, context);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.inputs.areas, ['제주시', '서귀포시']);
  assert.equal(result.rows.length, 4);
  for (const [kind, records] of [['hospital', hospitals.records], ['companion', registry.providers.filter(provider => provider.source.datasetId === '254')]]) {
    const metric = result.metrics.find(item => item.kind === kind);
    assert.equal(metric.denominator, records.length);
    assert.equal(metric.addressMissingRows, 0);
    assert.equal(metric.duplicateRows, 0);
    for (const area of ['제주시', '서귀포시']) {
      const row = result.rows.find(item => item.kind === kind && item.area === area);
      const expected = records.filter(record => record.address.includes(area)).length;
      assert.equal(row.observedCount, expected);
      assert.equal(row.denominator, records.length);
      assert.equal(row.shareOfLocatedSnapshot, Number((expected / records.length * 100).toFixed(2)));
    }
  }
  assert.equal(result.metrics.find(item => item.kind === 'hospital').sourceRows, 20);
  assert.equal(result.metrics.find(item => item.kind === 'hospital').excludedClosedRows, 7);
  assert.match(result.limitations.join(' '), /표본/);
  assert.match(result.limitations.join(' '), /밀도·인구당.*우열/);
  realFlagsFalse(result);
});

test('읍면동 비교는 주소 미표기 행을 관할 추정이나 0개로 배정하지 않는다', () => {
  const result = analyzePublicData({analysis: 'facility_compare', areas: ['애월', '조천']});
  assert.deepEqual(result.inputs.areas, ['제주시 애월읍', '제주시 조천읍']);
  const care = result.metrics.find(row => row.kind === 'companion');
  assert.ok(care.unlocatedRows > 0);
  assert.equal(care.denominator + care.unlocatedRows, care.eligibleRows);
  assert.match(care.denominatorLabel, /주소.*읍면동/);
  assert.ok(result.missingData.some(value => /미상|행정지역/.test(value)));
  assert.match(result.limitations.join(' '), /실제 시설 부재를 뜻하지/);
});

test('애월과 서귀포 혼합지역은 각 지역에 필요한 주소 해상도로 관측수·분모·미표기를 보존한다', () => {
  const before = structuredClone(context);
  const result = analyzePublicData({analysis: 'facility_compare', areas: ['애월', '서귀포']}, context);
  assert.deepEqual(result.inputs.areas, ['제주시 애월읍', '서귀포시']);
  assert.equal(result.metrics.length, 4);
  assert.equal(result.rows.length, 4);
  const aewol = result.rows.find(row => row.kind === 'companion' && row.area === '제주시 애월읍');
  assert.equal(aewol.granularity, 'local');
  assert.equal(aewol.observedCount, 0);
  assert.equal(aewol.denominator, 7);
  assert.equal(aewol.addressMissingRows, 0);
  assert.equal(aewol.unlocatedRows, 12);
  assert.match(aewol.addressBasis, /읍면동/);
  const seogwipo = result.rows.find(row => row.kind === 'companion' && row.area === '서귀포시');
  const expected = registry.providers.filter(row => row.source.datasetId === '254' && row.address.includes('서귀포시')).length;
  assert.equal(seogwipo.granularity, 'city');
  assert.equal(seogwipo.observedCount, expected);
  assert.equal(seogwipo.observedCount, 9);
  assert.equal(seogwipo.denominator, 19);
  assert.equal(seogwipo.unlocatedRows, 0);
  assert.equal(seogwipo.shareOfLocatedSnapshot, 47.37);
  assert.match(seogwipo.addressBasis, /시/);
  for (const row of result.rows) {
    const metric = result.metrics.find(item => item.datasetId === row.datasetId && item.granularity === row.granularity);
    assert.equal(row.denominator, metric.denominator);
    assert.equal(row.unlocatedRows, metric.unlocatedRows);
    assert.equal(row.asOf, metric.coverage.asOf);
    assert.equal(metric.denominator + metric.unlocatedRows, metric.eligibleRows);
  }
  assert.match(result.limitations.join(' '), /행정수준.*시와 읍면동.*비율.*직접 비교할 수 없/);
  assert.ok(result.preparationActions.length);
  for (const action of result.preparationActions) assert.ok(getSupportCandidates(registry, {kind: action.kind, area: context.area, wheelchair: context.wheelchair}).some(row => row.id === action.tool.input.providerId));
  const reversed = analyzePublicData({analysis: 'facility_compare', areas: ['서귀포', '애월']});
  assert.equal(reversed.rows.find(row => row.kind === 'companion' && row.area === '서귀포시').observedCount, 9);
  assert.equal(reversed.rows.find(row => row.kind === 'companion' && row.area === '제주시 애월읍').denominator, 7);
  assert.deepEqual(context, before);
  realFlagsFalse(result);
});

async function fixtureModule({hospitalData = hospitals, supportData = registry}) {
  // 공개 API에 테스트 전용 원자료/파일 인자를 추가하지 않고 동일 순수 계산에 합성 fixture를 연결한다.
  const source = await readFile(new URL('../app/public-data-skill.js', import.meta.url), 'utf8');
  const miniCatalog = {...catalog, records: catalog.records.filter(row => ['hub:859', 'hub:327', 'hub:254', 'center:7', 'center:8', 'center:10', 'official:areum-escort', 'official:jeju-accessible-transport'].includes(row.id))};
  const fixture = source.replace(/^import catalog .*;$/m, `const catalog = ${JSON.stringify(miniCatalog)};`)
    .replace(/^import hospitalSnapshot .*;$/m, `const hospitalSnapshot = ${JSON.stringify(hospitalData)};`)
    .replace(/^import supportRegistry .*;$/m, `const supportRegistry = ${JSON.stringify(supportData)};`)
    .replace(/^import publicHealthSnapshot .*;$/m, `const publicHealthSnapshot = ${JSON.stringify(publicHealth)};`)
    .replace("'./support-data.js'", JSON.stringify(new URL('../app/support-data.js', import.meta.url).href))
    .replace("'./public-health-data.js'", JSON.stringify(new URL('../app/public-health-data.js', import.meta.url).href));
  return import(`data:text/javascript;base64,${Buffer.from(fixture).toString('base64')}`);
}

test('합성 중복·폐업·주소결측을 제외/미상으로 분리하고 분모0이면 관측수도 null이다', async () => {
  const h = structuredClone(hospitals);
  h.records = [
    {...hospitals.records[0], id: 'fixture-1', companyName: '합성 기관', address: '제주시 애월읍 합성길 1'},
    {...hospitals.records[0], id: 'fixture-2', companyName: '합성 기관', address: '제주시 애월읍  합성길 1', updatedAt: '2099-01-01'},
    {...hospitals.records[0], id: 'fixture-3', companyName: '합성 주소 미상', address: ''},
    {...hospitals.records[0], id: 'fixture-4', companyName: '합성 폐업', address: '서귀포시 합성길', openStatus: '폐업'},
  ];
  h.totalPreviewRows = 4; h.excludedClosedRows = 0;
  const s = structuredClone(registry);
  s.providers = s.providers.filter(row => row.source.datasetId !== '254').concat([{...registry.providers.find(row => row.source.datasetId === '254'), id: 'care-fixture', address: '', region: '제주시'}]);
  s.datasets.find(row => row.id === '254').rowCount = 1;
  const module = await fixtureModule({hospitalData: h, supportData: s});
  const result = module.analyzePublicData({analysis: 'facility_compare', areas: ['제주시', '서귀포시']});
  const hm = result.metrics.find(row => row.kind === 'hospital'), cm = result.metrics.find(row => row.kind === 'companion');
  assert.equal(hm.duplicateRows, 1); assert.equal(hm.excludedClosedRows, 1); assert.equal(hm.addressMissingRows, 1);
  assert.equal(hm.eligibleRows, 2); assert.equal(hm.denominator, 1); assert.equal(hm.unlocatedRows, 1);
  assert.equal(cm.addressMissingRows, 1); assert.equal(cm.denominator, 0); assert.equal(cm.unlocatedRows, 1);
  assert.ok(result.rows.filter(row => row.kind === 'companion').every(row => row.observedCount === null && row.shareOfLocatedSnapshot === null));
  assert.equal(result.rows.find(row => row.kind === 'hospital' && row.area === '제주시').observedCount, 1);
});

test('지역·휠체어별 문의 후보는 기존 registry와 같은 ID·순서·연락처다', () => {
  for (const area of ['제주시 애월읍', '서귀포시 동홍동']) {
    for (const supportKind of ['taxi', 'companion']) {
      for (const wheelchair of [false, true]) {
        const result = analyzePublicData({analysis: 'support_candidates', area, supportKind, wheelchair});
        const expected = getSupportInquiryCandidates(registry, {kind: supportKind, area, wheelchair}).slice(0, 5);
        assert.deepEqual(result.candidates.map(row => [row.id, row.phone]), expected.map(row => [row.id, row.phone]));
        assert.ok(result.candidates.every(row => row.availabilityVerified === false && row.questions.length >= 2));
        realFlagsFalse(result);
      }
    }
  }
  const wheelchairResult = analyzePublicData({analysis: 'support_candidates', supportKind: 'taxi'}, context);
  assert.equal(wheelchairResult.candidates[0].id, 'jeju-accessible-transport');
  assert.match(wheelchairResult.candidates[0].questions.join(' '), /회원등록.*앉은 채.*승하차.*동행인/);
});

test('기본 both는 소수 결과에 택시·동행을 함께 포함하고 검증한 문의 준비 ID만 제안한다', () => {
  const result = analyzePublicData({analysis: 'support_candidates'}, context);
  assert.equal(result.inputs.supportKind, 'both');
  assert.ok(result.candidates.length <= 5);
  assert.ok(result.candidates.some(row => row.kind === 'taxi'));
  assert.ok(result.candidates.some(row => row.kind === 'companion'));
  assert.equal(result.preparationActions.length, 2);
  for (const action of result.preparationActions) {
    assert.equal(action.tool.name, 'prepare_inquiries');
    assert.deepEqual(Object.keys(action.tool.input).sort(), ['kind', 'providerId']);
    assert.ok(getSupportCandidates(registry, {kind: action.kind, area: context.area, wheelchair: context.wheelchair}).some(row => row.id === action.tool.input.providerId));
    assert.match(action.requestDraft, /미확인|확인/);
    assert.match(action.requestDraft, /실제 발신.*하지 않았/);
  }
});

test('조회 지역은 유지하며 다른 지역의 현재 사례에 준비 ID를 넘기지 않는다', () => {
  const result = analyzePublicData({analysis: 'support_candidates', area: '서귀포시 동홍동'}, context);
  assert.equal(result.inputs.area, '서귀포시 동홍동');
  assert.equal(result.preparationActions.length, 0);
  assert.match(result.missingData.join(' '), /현재 방문의 출발지가 다릅니다/);
  assert.ok(!result.candidates.some(row => row.id === 'taxi327-14'));
  const compare = analyzePublicData({analysis: 'facility_compare', areas: ['제주시', '서귀포시']}, context);
  assert.deepEqual(compare.inputs.areas, ['제주시', '서귀포시']);
  assert.ok(compare.preparationActions.every(action => getSupportCandidates(registry, {kind: action.kind, area: context.area, wheelchair: true}).some(row => row.id === action.tool.input.providerId)));
  const differentCondition = analyzePublicData({analysis: 'support_candidates', supportKind: 'taxi', wheelchair: false}, context);
  assert.equal(differentCondition.inputs.wheelchair, false);
  assert.deepEqual(differentCondition.preparationActions, []);
  assert.match(differentCondition.missingData.join(' '), /휠체어 조건과 현재 방문의 조건이 다릅니다/);
});

test('센터 명세만 있으면 이동시간 unavailable이며 숫자·평균·ETA 대신 필요자료와 질문을 남긴다', () => {
  const result = analyzePublicData({analysis: 'travel_time'}, context);
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.datasetRefs.map(row => row.id), ['center:7', 'center:8', 'center:10']);
  assert.ok(result.datasetRefs.every(row => row.availability === 'metadata_only' && row.coverage.rowCount === null && row.coverage.asOf === null));
  assert.deepEqual(result.rows, []); assert.deepEqual(result.metrics, []); assert.deepEqual(result.candidates, []);
  assert.match(result.missingData.join(' '), /link_id.*latitude.*average_time/);
  assert.ok(result.preparationActions.length === 1 && result.preparationActions[0].kind === 'taxi');
  assert.match(result.preparationActions[0].requestDraft, /출발 시각.*예상 소요시간/);
  for (const key of ['eta', 'etaMinutes', 'averageMinutes', 'travelMinutes', 'departureTime']) assert.equal(Object.hasOwn(result, key), false);
  realFlagsFalse(result);
});

test('출발지 미상에는 기관 관할·문의 실행을 확정하지 않고 준비제안을 보류한다', () => {
  const result = analyzePublicData({analysis: 'support_candidates'});
  assert.equal(result.inputs.area, '');
  assert.deepEqual(result.preparationActions, []);
  assert.ok(result.missingData.some(value => /출발 읍면동/.test(value)));
  assert.ok(result.candidates.every(row => row.matchLevel === 'island' || row.matchLevel === 'unverified'));
});

test('준비 근거는 개인 기록을 사용·저장·변경하지 않고 실제 상태 flags를 유지한다', () => {
  const privateContext = {...context, patient: {name: '비공개 실명 fixture'}, records: ['비공개 검사 원문 fixture'], query: '비공개 원문 fixture'};
  const before = structuredClone(privateContext);
  for (const purpose of ['hospital', 'taxi', 'companion', 'travel']) {
    const evidence = getPreparationDataEvidence(privateContext, purpose);
    assert.equal(evidence.purpose, purpose);
    assert.ok(evidence.datasetRefs.length);
    assert.ok(evidence.questions.length);
    assert.ok(!JSON.stringify(evidence).includes('비공개'));
    realFlagsFalse(evidence);
  }
  for (const input of [{analysis: 'facility_compare', areas: ['제주시', '서귀포시']}, {analysis: 'support_candidates'}, {analysis: 'travel_time'}]) {
    assert.ok(!JSON.stringify(analyzePublicData(input, privateContext)).includes('비공개'));
  }
  assert.deepEqual(privateContext, before);
});

test('임의 SQL·파일·URL·추가필드와 잘못된 조건을 거부한다', () => {
  for (const input of [{purpose: 'other'}, {purpose: 'hospital', limit: 0}, {purpose: 'hospital', limit: 9}, {purpose: 'hospital', limit: 2.2}, {purpose: 'hospital', query: '가'.repeat(201)}, {purpose: 'hospital', url: 'https://example.com'}]) assert.throws(() => searchPublicDataCatalog(input));
  for (const input of [
    {analysis: 'sql', query: 'SELECT *'}, {analysis: 'facility_compare', areas: ['애월']},
    {analysis: 'facility_compare', areas: ['애월', '제주시 애월읍']}, {analysis: 'facility_compare', areas: ['서울', '제주시']},
    {analysis: 'support_candidates', supportKind: 'ambulance'}, {analysis: 'support_candidates', wheelchair: 'true'},
    {analysis: 'support_candidates', file: '/tmp/patient.json'}, {analysis: 'travel_time', url: 'https://example.com'},
  ]) assert.throws(() => analyzePublicData(input));
});

test('조회 CLI는 키·네트워크 없이 공개 API와 같은 계산을 재현한다', async () => {
  const commands = [
    ['search', '--purpose', 'hospital', '--query', '병원', '--limit', '3'],
    ['analyze', '--analysis', 'facility_compare', '--areas', '제주시,서귀포시'],
    ['analyze', '--analysis', 'facility_compare', '--areas', '애월,서귀포'],
    ['analyze', '--analysis', 'support_candidates', '--area', '제주시 애월읍', '--wheelchair', 'true'],
    ['analyze', '--analysis', 'travel_time', '--area', '제주시 애월읍'],
    ['analyze', '--analysis', 'public_health_contacts', '--area', '제주시 애월읍'],
  ];
  const expected = [searchPublicDataCatalog({purpose: 'hospital', query: '병원', limit: 3}), analyzePublicData({analysis: 'facility_compare', areas: ['제주시', '서귀포시']}), analyzePublicData({analysis: 'facility_compare', areas: ['애월', '서귀포']}), analyzePublicData({analysis: 'support_candidates', area: '제주시 애월읍', wheelchair: true}), analyzePublicData({analysis: 'travel_time', area: '제주시 애월읍'}), analyzePublicData({analysis: 'public_health_contacts', area: '제주시 애월읍'})];
  for (let index = 0; index < commands.length; index++) {
    const {stdout} = await exec(process.execPath, ['scripts/public-data-query.mjs', ...commands[index]], {cwd: root, env: {PATH: process.env.PATH, OPENAI_API_KEY: '', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1'}});
    assert.deepEqual(JSON.parse(stdout), expected[index]);
  }
  const directory = await mkdtemp(join(tmpdir(), 'hondi-public-index-'));
  try {
    const destination = join(directory, 'catalog.json');
    await exec(process.execPath, ['scripts/public-data-catalog.mjs', '--output', destination], {cwd: root});
    assert.equal(await readFile(destination, 'utf8'), (await readFile(new URL('../app/data/public-data-catalog.json', import.meta.url), 'utf8')).replaceAll('\r\n', '\n'));
  } finally { await rm(directory, {recursive: true, force: true}); }
});
