import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHospitals, filterHospitals } from '../app/hospitals.js';

const metadata = { retrievedAt: '2026-10-31', isSynthetic: true, license: '합성 fixture' };
const fixture = [
  { companyName: '가상 애월 병원', addressDoro: '제주특별자치도 제주시 애월읍 가상길', medicalSubject: '내과, 외과, 내과', openStatus: '영업/정상', updateAt: '2024-10-01', collectedAt: '2024-10-17', phone: '허위 번호', latitude: 1 },
  { companyName: '가상 폐업 병원', addressDoro: '제주시', medicalSubject: '내과', openStatus: '폐업' },
  { companyName: '가상 휴업 병원', addressDoro: '제주시', medicalSubject: '내과', openStatus: '휴업' },
  { companyName: '가상 서귀포 병원', addressJibun: '제주특별자치도 서귀포시 가상동', medicalSubject: '정형외과', openStatus: '정상' },
];

test('행별 날짜·원본 진료과·출처를 보존하고 폐업·휴업 행을 제외한다', () => {
  const normalized = normalizeHospitals(fixture, metadata);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].companyName, '가상 애월 병원');
  assert.equal(normalized[0].updatedAt, '2024-10-01');
  assert.equal(normalized[0].collectedAt, '2024-10-17');
  assert.equal(normalized[0].source.retrievedAt, '2026-10-31');
  assert.equal(normalized[0].source.isSynthetic, true);
  assert.deepEqual(normalized[0].departments, ['내과', '외과']);
  assert.equal(normalized[1].address, fixture[3].addressJibun);
});

test('행정 정상 상태를 수용·현재 진료·협진 상태로 바꾸지 않는다', () => {
  const record = normalizeHospitals(fixture, metadata)[0];
  assert.equal(record.inquiryStatus, 'unverified');
  for (const field of ['phone', 'latitude', 'longitude', 'acceptingPatients', 'collaborationAvailable', 'openNow']) assert.equal(Object.hasOwn(record, field), false, field);
});

test('공개 미리보기 같은 한글 헤더 행 배열도 처리한다', () => {
  const rows = [
    ['사업장명', '도로명주소', '진료과목', '영업상태명', '데이터갱신일시', '데이터수집일시'],
    ['가상 의원', '제주특별자치도 제주시 가상길', '내과; 외과', '정상', '2020-01-01', '2024-10-17'],
    ['가상 폐업 의원', '', '내과', '폐업', '', ''],
  ];
  const records = normalizeHospitals(rows, metadata);
  assert.equal(records.length, 1);
  assert.equal(records[0].companyName, '가상 의원');
  assert.deepEqual(records[0].departments, ['내과', '외과']);
  assert.equal(records[0].collectedAt, '2024-10-17');
});

test('중복 행과 이름 없는 행을 제거하며 원본 배열을 변경하지 않는다', () => {
  const rows = [fixture[0], fixture[0], { companyName: '' }];
  const before = structuredClone(rows);
  assert.equal(normalizeHospitals(rows, metadata).length, 1);
  assert.deepEqual(rows, before);
});

test('진료과·주소 검색은 등록 사실에 따른 후보 필터일 뿐 점수나 임상 판단을 생성하지 않는다', () => {
  const records = normalizeHospitals(fixture, metadata);
  const candidates = filterHospitals(records, { department: '내과', area: '애월' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].companyName, '가상 애월 병원');
  assert.equal(filterHospitals(records, { department: '심장내과' }).length, 0);
  assert.equal(filterHospitals(records, { area: '서귀포' }).length, 1);
  assert.equal(Object.hasOwn(candidates[0], 'score'), false);
});

test('이용조건을 제공하지 않으면 미확인으로 남기며 빈 결과도 반환한다', () => {
  assert.match(normalizeHospitals([fixture[0]])[0].source.license, /미확인/);
  assert.deepEqual(normalizeHospitals([]), []);
  assert.deepEqual(filterHospitals([]), []);
});

test('등록 진료과 내과를 고르면 한방내과·심장내과만 등록한 기관을 섞지 않는다', () => {
  const records = normalizeHospitals([
    { companyName: '가상 내과', medicalSubject: '내과', openStatus: '정상' },
    { companyName: '가상 한의원', medicalSubject: '한방내과', openStatus: '정상' },
    { companyName: '가상 전문의원', medicalSubject: '심장내과', openStatus: '정상' },
  ], metadata);
  assert.deepEqual(filterHospitals(records, { department: ' 내과 ' }).map(row => row.companyName), ['가상 내과']);
  assert.deepEqual(filterHospitals(records, { department: '한방내과' }).map(row => row.companyName), ['가상 한의원']);
});

test('지원하지 않는 입력은 명시적으로 거부한다', () => {
  for (const rows of [null, {}, 'rows', [null], [true], [[1, 2], [3, 4]]]) assert.throws(() => normalizeHospitals(rows), /자료|행|항목/);
  assert.throws(() => normalizeHospitals([], null), /출처/);
  assert.throws(() => filterHospitals(null), /검색/);
});
