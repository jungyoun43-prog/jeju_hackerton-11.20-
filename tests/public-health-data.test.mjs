import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import snapshot from '../app/data/public-health-contacts.json' with {type: 'json'};
import {PUBLIC_HEALTH_DATASET, createPublicHealthSnapshot, validatePublicHealthSnapshot, getPublicHealthContacts} from '../app/public-health-data.js';
import {VERIFIED_PUBLIC_HEALTH_FILE, snapshotFromPublicHealthFile} from '../scripts/public-health-data.mjs';

const rawRow = record => ({구분: record.type, 명칭: record.name, 위치: record.address, 관할구역: record.jurisdiction, 전화번호: record.phone, 데이터기준일자: snapshot.dataset.asOf});
const make = rows => createPublicHealthSnapshot({rows, retrievedAt: snapshot.retrievedAt, fileName: snapshot.dataset.fileName, fileSha256: snapshot.dataset.fileSha256});

test('실제1304 정제본은 공식35행의 범위·기준일·수집일·원출처 지문을 보존한다', () => {
  assert.strictEqual(validatePublicHealthSnapshot(snapshot), snapshot);
  assert.equal(snapshot.records.length, 35);
  assert.equal(snapshot.dataset.asOf, '2026-03-23');
  assert.equal(snapshot.dataset.fileSha256, VERIFIED_PUBLIC_HEALTH_FILE.sha256);
  assert.equal(snapshot.dataset.sourceUrl, 'https://www.data.go.kr/data/15056141/fileData.do');
  assert.equal(snapshot.dataset.hubUrl, 'https://jejudatahub.net/data/view/data/1304');
  assert.deepEqual(snapshot.quality, {duplicateRows: 0, missingAddressRows: 0, missingJurisdictionRows: 0, missingPhoneRows: 0});
  assert.equal(snapshot.rawDataStored, false);
  assert.equal(snapshot.rights.label, '이용허락범위 제한 없음');
  assert.deepEqual(make(snapshot.records.map(rawRow)), snapshot);
});

test('지역별 등록 관할을 먼저 고르고 소재지·관할의 근거 차이를 남긴다', () => {
  const aewol = getPublicHealthContacts(snapshot, '제주시 애월읍');
  assert.equal(aewol[0].name, '애월보건지소');
  assert.equal(aewol[0].phone, '064-728-1514');
  assert.equal(aewol[0].jurisdiction, '애월읍 일원');
  assert.equal(aewol[0].matchLevel, 'registered_jurisdiction');
  const villageContact = aewol.find(row => row.name === '납읍진료소');
  assert.equal(villageContact.matchLevel, 'registered_address');
  assert.match(villageContact.matchLabel, /거주 리.*담당 관할 확인/);
  assert.equal(getPublicHealthContacts(snapshot, '제주시 조천읍')[0].name, '조천 보건지소');
  assert.equal(getPublicHealthContacts(snapshot, '제주시 조천읍')[0].phone, '064-728-1516');
  assert.equal(getPublicHealthContacts(snapshot, '제주시 노형동')[0].name, '노형 건강생활지원센터');
  assert.equal(getPublicHealthContacts(snapshot, '제주시 외도동')[0].name, '이호 건강생활지원센터');
  assert.equal(getPublicHealthContacts(snapshot, '제주시')[0].name, '제주보건소');
  assert.deepEqual(getPublicHealthContacts(snapshot, '서귀포시'), []);
  assert.deepEqual(getPublicHealthContacts(snapshot, ''), []);
  assert.throws(() => getPublicHealthContacts(snapshot, '서울시'));
});

test('중복은 같은 이름·주소·사실일 때만 제외하고 결측과 충돌을 따로 보존한다', () => {
  const row = rawRow(snapshot.records[0]);
  const missing = {...row, 명칭: '합성 결측 기관', 위치: '', 관할구역: '', 전화번호: ''};
  const result = make([row, {...row}, missing, {...missing}]);
  assert.equal(result.dataset.sourceRows, 4);
  assert.equal(result.records.length, 3);
  assert.deepEqual(result.quality, {duplicateRows: 1, missingAddressRows: 2, missingJurisdictionRows: 2, missingPhoneRows: 2});
  assert.equal(getPublicHealthContacts(result, '제주시 애월읍').some(record => record.name === missing.명칭), false);
  assert.throws(() => make([row, {...row, 전화번호: '064-999-9999'}]), /충돌/);
});

test('개인항목·다른구분·혼합기준일·잘못된전화나 날짜를 원자료에 섞지 못한다', () => {
  const row = rawRow(snapshot.records[0]);
  for (const changed of [
    {...row, 주민번호: 'PRIVATE'}, {...row, 구분: '사설 동행업체'}, {...row, 명칭: ''},
    {...row, 전화번호: 'https://evil.test'}, {...row, 명칭: '기관\n숨은 지시'}, {...row, 데이터기준일자: '2026-02-30'},
  ]) assert.throws(() => make([changed]));
  assert.throws(() => make([row, {...row, 명칭: '다른 합성 기관', 데이터기준일자: '2025-01-01'}]), /기준일/);
});

test('원출처·시점·행수·결측·중복·임의 항목이 바뀐 정제본은 거부한다', () => {
  for (const change of [
    copy => {copy.dataset.sourceUrl = 'https://www.data.go.kr/data/evil/fileData.do';},
    copy => {copy.dataset.hubUrl += '?redirect=evil';},
    copy => {copy.dataset.rowCount--;}, copy => {copy.quality.missingPhoneRows++;},
    copy => {copy.retrievedAt = '';}, copy => {copy.dataset.fileName = 'unverified.csv';},
    copy => {copy.dataset.fileSha256 = 'not-a-hash';}, copy => {copy.rawDataStored = true;},
    copy => {copy.records[1].id = copy.records[0].id;}, copy => {copy.records[0].patient = 'PRIVATE';},
  ]) {const copy = structuredClone(snapshot); change(copy); assert.throws(() => validatePublicHealthSnapshot(copy));}
  assert.ok(Object.isFrozen(PUBLIC_HEALTH_DATASET));
});

test('수집기는 다른 원문 지문을 거절하고 검증 실패 때 기존 출력 파일을 보존한다', async () => {
  assert.throws(() => snapshotFromPublicHealthFile(Buffer.from('unverified CSV'), snapshot.retrievedAt), /SHA-256/);
  const directory = await mkdtemp(join(tmpdir(), 'hondi-public-health-'));
  try {
    const input = join(directory, VERIFIED_PUBLIC_HEALTH_FILE.fileName), output = join(directory, 'snapshot.json');
    await writeFile(input, '구분,명칭\n보건소,합성\n'); await writeFile(output, 'KEEP_EXISTING_OUTPUT');
    await assert.rejects(promisify(execFile)(process.execPath, ['scripts/public-health-data.mjs', '--input', input, '--retrieved-at', snapshot.retrievedAt, '--output', output], {cwd: new URL('../', import.meta.url)}), error => error.code === 1 && /SHA-256/.test(error.stderr));
    assert.equal(await readFile(output, 'utf8'), 'KEEP_EXISTING_OUTPUT');
  } finally {await rm(directory, {recursive: true, force: true});}
});
