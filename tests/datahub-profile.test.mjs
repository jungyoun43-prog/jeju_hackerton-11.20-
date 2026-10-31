import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHospitalImport, summarizeHospitalRecords, loadDataProfile } from '../app/datahub.js';

const sample = [
  { companyName: '합성기관 A', addressDoro: '합성주소 A', medicalSubject: '내과, 내과;가정의학과', openStatus: '영업/정상', updateAt: '2024-06-27 2:40', collectedAt: '2024-10-17 13:53' },
  { companyName: '합성기관 B', addressDoro: '', medicalSubject: '', openStatus: '폐업', updateAt: '2018-08-31 23:59', collectedAt: '2024-10-17 13:53' },
  { companyName: '합성기관 C', addressJibun: '합성주소 C', medicalSubject: '영상의학과', openStatus: '휴업', updateAt: '잘못된 날짜' },
];

test('집계는 상태·결측·중복 과목·날짜를 분석하고 기관명과 주소를 내보내지 않는다', () => {
  const profile = summarizeHospitalRecords(sample);
  assert.deepEqual([profile.totalRows, profile.activeRegistrationRows, profile.closedRows, profile.otherRows], [3, 1, 1, 1]);
  assert.equal(profile.departments.find(row => row.name === '내과').count, 1);
  assert.equal(profile.completeness.addressRows, 2);
  assert.equal(profile.completeness.missingDepartmentRows, 1);
  assert.equal(profile.time.invalidUpdateRows, 1);
  assert.equal(profile.time.earliestRowUpdate, '2018-08-31 23:59');
  assert.doesNotMatch(JSON.stringify(profile), /합성기관|합성주소|companyName|addressDoro/);
  assert.equal(profile.rights.aggregateRedistribution, 'unverified');
  assert.equal(profile.rawDataStored, false);
});

test('한국어 CSV는 BOM·쉼표·따옴표 이스케이프·셀 줄바꿈을 처리한다', () => {
  const text = '\uFEFF사업장명,도로명주소,진료과목,영업상태명,데이터갱신일시\r\n"합성 ""기관""",합성동,"내과,가정의학과\n영상의학과",영업/정상,2024-06-27\r\n폐업기관,합성동,내과,폐업,2020-01-01';
  const result = parseHospitalImport(text, '기관.csv');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].companyName, '합성 "기관"');
  assert.deepEqual(result.records[0].departments, ['내과', '가정의학과', '영상의학과']);
  assert.equal(result.profile.totalRows, 2);
  assert.equal(result.metadata.kind, 'user-import');
  assert.equal(result.records[0].source.url, '');
  assert.equal(result.records[0].source.apiVerified, false);
});

test('JSON 가져오기는 영문 스키마를 정규화하며 입력과 독립적인 사용자 출처를 반환한다', () => {
  const before = structuredClone(sample);
  const imported = parseHospitalImport(JSON.stringify(sample), 'hospital.json', { scope: 'official', apiVerified: true });
  assert.deepEqual(sample, before);
  assert.equal(imported.records.length, 1);
  assert.equal(imported.profile.scope, 'user-import');
  assert.equal(imported.metadata.apiVerified, false);
  assert.equal(imported.records[0].inquiryStatus, 'unverified');
});

test('잘못된 CSV·스키마·객체형 값·계정키·과도한 입력을 거부한다', () => {
  for (const [text, filename, pattern] of [
    ['사업장명,도로명주소,영업상태명\n"닫히지 않음', 'bad.csv', /따옴표/],
    ['사업장명,도로명주소,영업상태명\na,b', 'bad.csv', /항목 수/],
    ['사업장명,도로명주소,영업상태명\n"a"b,c,영업/정상', 'bad.csv', /따옴표/],
    ['사업장명,companyName,도로명주소,영업상태명\na,a,b,영업/정상', 'bad.csv', /중복/],
    [JSON.stringify([{ ...sample[0], projectKey: 'do-not-import' }]), 'bad.json', /인증키/],
    [JSON.stringify([{ ...sample[0], patientName: '합성인' }]), 'bad.json', /스키마/],
    [JSON.stringify([{ ...sample[0], medicalSubject: {} }]), 'bad.json', /문자열/],
    [JSON.stringify([{ companyName: '합성' }]), 'bad.json', /영업상태/],
    ['{}', 'bad.json', /행 배열/],
    ['[', 'bad.json', /JSON 형식/],
    ['x'.repeat(2 * 1024 * 1024 + 1), 'bad.csv', /2MiB/],
    ['[]', 'bad.txt', /JSON 또는 CSV/],
  ]) assert.throws(() => parseHospitalImport(text, filename), pattern);
});

test('공개 snapshot은 20행 품질 분석만 포함하며 운영 API·원자료 공개를 주장하지 않는다', async () => {
  const profile = JSON.parse(await readFile(new URL('../app/data/datahub-profile.json', import.meta.url)));
  assert.deepEqual([profile.totalRows, profile.activeRegistrationRows, profile.closedRows], [20, 13, 7]);
  assert.equal(profile.completeness.addressRows, 20);
  assert.equal(profile.completeness.departmentRows, 19);
  assert.equal(profile.completeness.missingDepartmentRows, 1);
  assert.deepEqual(profile.time.collectedAt, ['2024-10-17 13:53']);
  assert.equal(profile.time.earliestRowUpdate, '2018-08-31 23:59');
  assert.equal(profile.time.latestRowUpdate, '2024-08-10 2:40');
  assert.doesNotMatch(JSON.stringify(profile), /companyName|addressDoro|addressJibun|csvData|172\.25\.|projectKey/);
  const loaded = await loadDataProfile(async (url, options) => {
    assert.equal(url, '/data/datahub-profile.json'); assert.equal(options.credentials, 'omit');
    return { ok: true, json: async () => structuredClone(profile) };
  });
  assert.equal(loaded.rights.publicationStatus, 'rights-review-required');
  await assert.rejects(loadDataProfile(async () => ({ ok: false })), /불러오지/);
  await assert.rejects(loadDataProfile(async () => ({ ok: true, json: async () => ({ ...profile, activeRegistrationRows: 99 }) })), /행 수/);
  await assert.rejects(loadDataProfile(async () => ({ ok: true, json: async () => ({ ...profile, rows: sample }) })), /원자료/);
});
