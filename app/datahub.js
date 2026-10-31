import { normalizeHospitals } from './hospitals.js';

export const DATASET = Object.freeze({ id: '859', name: '병·의원 정보', provider: 'LOCALDATA', sourceUrl: 'https://jejudatahub.net/data/view/data/859', previewUrl: 'https://jejudatahub.net/api/data/view?id=859&userId=' });
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 10000;
const FIELDS = {
  companyName: '사업장명', bizLargeType: '업종구분대분류', bizSmallType: '업종구분소분류', licensingDate: '인허가일자', licensingCancelDate: '인허가취소일자', openStatus: '영업상태명', closeDate: '폐업일자', holidayStartDate: '휴업시작일자', holidayEndDate: '휴업종료일자', reopenDate: '재개업일자', areaSize: '소재지면적', addressJibun: '지번주소', addressDoro: '도로명주소', postcodeDoro: '도로명우편번호', medicalWorkerCount: '의료인수', patientRoomCount: '입원실수', hospitalBedCount: '병상수', medicalSubject: '진료과목', updateAt: '데이터갱신일시', collectedAt: '데이터수집일시',
};
const aliases = new Map(Object.entries(FIELDS).flatMap(([key, label]) => [[key, key], [label, key]]));
aliases.set('collectAt', 'collectedAt');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const active = value => /^(영업\s*\/\s*정상|정상|영업중)$/.test(value);
const closed = value => /폐업/.test(value);
const sensitive = key => /api.?key|project.?key|access.?token|refresh.?token|authorization|password|secret|인증키|비밀번호|계정/i.test(key);

function tableRows(rows) {
  ensure(Array.isArray(rows) && rows.length > 0, '기관 행 배열이 필요합니다.');
  let objects = rows;
  if (Array.isArray(rows[0])) {
    const [headers, ...values] = rows;
    ensure(headers.every(header => typeof header === 'string'), '항목명은 문자열이어야 합니다.');
    ensure(new Set(headers.map(header => aliases.get(header.trim()) || header.trim())).size === headers.length, '중복 항목명이 있습니다.');
    objects = values.map(row => {
      ensure(Array.isArray(row) && row.length === headers.length, 'CSV 행의 항목 수가 헤더와 다릅니다.');
      return Object.fromEntries(headers.map((header, index) => [header.trim(), row[index]]));
    });
  }
  ensure(objects.length > 0 && objects.length <= MAX_ROWS, `자료는 1~${MAX_ROWS.toLocaleString('ko-KR')}행까지 가져올 수 있습니다.`);
  return objects.map(row => {
    ensure(isObject(row), '기관 행은 객체여야 합니다.');
    const keys = Object.keys(row);
    ensure(!keys.some(sensitive), '계정·인증키와 유사한 열은 가져올 수 없습니다.');
    ensure(keys.length <= 40 && keys.every(key => aliases.has(key)), '지원하지 않는 기관 항목이 있습니다. 병·의원 스키마를 확인해 주세요.');
    ensure(new Set(keys.map(key => aliases.get(key))).size === keys.length, '한글·영문 항목이 중복되었습니다.');
    const result = {};
    for (const [key, value] of Object.entries(row)) {
      ensure(value === null || ['string', 'number'].includes(typeof value), '기관 항목에는 문자열이나 숫자만 사용할 수 있습니다.');
      const cleaned = value === null ? '' : String(value).trim();
      ensure(cleaned.length <= 4000, '기관 항목의 길이가 너무 깁니다.');
      result[aliases.get(key)] = cleaned;
    }
    ensure(result.companyName && typeof result.openStatus === 'string' && result.openStatus, '사업장명과 영업상태명 항목이 필요합니다.');
    ensure('addressDoro' in result || 'addressJibun' in result, '도로명주소 또는 지번주소 항목이 필요합니다.');
    return result;
  });
}

function timestamp(value) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value || '');
  if (!match) return null;
  const normalized = `${match[1]}T${(match[2] || '00').padStart(2, '0')}:${match[3] || '00'}:${match[4] || '00'}Z`;
  const date = new Date(normalized);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === match[1] ? date.getTime() : null;
}

export function summarizeHospitalRecords(rows, metadata = {}) {
  const records = tableRows(rows);
  const departments = new Map();
  let addressRows = 0, departmentRows = 0, invalidUpdateRows = 0;
  const updates = [];
  for (const row of records) {
    if (row.addressDoro || row.addressJibun) addressRows++;
    const subjects = [...new Set((row.medicalSubject || '').split(/[,;、\n]/).map(item => item.trim()).filter(Boolean))];
    if (subjects.length) departmentRows++;
    for (const name of subjects) departments.set(name, (departments.get(name) || 0) + 1);
    if (row.updateAt) {
      const at = timestamp(row.updateAt);
      if (at === null) invalidUpdateRows++; else updates.push({ raw: row.updateAt, at });
    }
  }
  updates.sort((a, b) => a.at - b.at);
  const totalRows = records.length;
  const activeRegistrationRows = records.filter(row => active(row.openStatus)).length;
  const closedRows = records.filter(row => closed(row.openStatus)).length;
  return {
    schemaVersion: 1, dataset: metadata.scope === 'public-preview-aggregates' ? { ...DATASET } : { id: '859', name: '사용자 제공 기관 자료 (859 스키마)', provider: '사용자 제공 · 원출처 미검증', sourceUrl: '', previewUrl: '' }, scope: metadata.scope === 'public-preview-aggregates' ? 'public-preview-aggregates' : 'user-import',
    fetchedAt: typeof metadata.fetchedAt === 'string' ? metadata.fetchedAt : new Date().toISOString(),
    totalRows, activeRegistrationRows, closedRows, otherRows: totalRows - activeRegistrationRows - closedRows,
    departments: [...departments].sort(([a], [b]) => a.localeCompare(b, 'ko')).map(([name, count]) => ({ name, count })),
    completeness: { addressRows, departmentRows, missingDepartmentRows: totalRows - departmentRows, addressRate: addressRows / totalRows, departmentRate: departmentRows / totalRows },
    time: { collectedAt: [...new Set(records.map(row => row.collectedAt).filter(Boolean))].sort(), earliestRowUpdate: updates[0]?.raw || null, latestRowUpdate: updates.at(-1)?.raw || null, missingUpdateRows: records.filter(row => !row.updateAt).length, invalidUpdateRows },
    missingCapabilities: ['전화번호', '실시간 수용', '예약 가능일', '협진 참여', '좌표'],
    rights: { rawRedistribution: 'unverified', aggregateRedistribution: 'unverified', publicationStatus: 'rights-review-required', termsUrl: 'https://jejudatahub.net/signup/step1', basis: '데이터 이용약관 제7조 출처·지침 준수, 제8조 통계정보 상업적 활용 허용을 확인했다. 일반약관 복제·제공 제한 및 센터 산출물 공표승인 규정과의 적용범위가 불명확해 미리보기 집계의 공개 재배포 허락은 미확인이다.' },
    limitations: ['공개 미리보기 표본이며 전체 제주 의료기관 현황이 아닙니다.', '행정상 영업/정상은 현재 진료·예약·협진 수락을 뜻하지 않습니다.', '전체 운영 API·인증키·실시간 정보는 검증하지 않았습니다.'],
    rawDataStored: false,
  };
}

function parseCsv(text) {
  const rows = []; let row = [], value = '', quoted = false, afterQuote = false;
  const cell = () => { row.push(value); value = ''; afterQuote = false; };
  const line = () => { cell(); if (row.some(item => item !== '')) rows.push(row); row = []; ensure(rows.length <= MAX_ROWS + 1, '입력 행 수가 너무 많습니다.'); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; afterQuote = true; } }
      else value += char;
    } else if (char === ',') cell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; line(); }
    else if (char === '"') { ensure(value === '' && !afterQuote, 'CSV 따옴표 위치가 올바르지 않습니다.'); quoted = true; }
    else { ensure(!afterQuote, 'CSV 닫는 따옴표 뒤에는 쉼표 또는 줄바꿈이 필요합니다.'); value += char; }
  }
  ensure(!quoted, 'CSV 따옴표가 닫히지 않았습니다.');
  if (value !== '' || row.length || afterQuote) line();
  return rows;
}

export function parseHospitalImport(input, filename, metadata = {}) {
  ensure(typeof input === 'string' && new TextEncoder().encode(input).length <= MAX_BYTES, '파일은 UTF-8 텍스트 2MiB 이하로 가져와 주세요.');
  ensure(!input.includes('\uFFFD'), '파일 인코딩을 UTF-8로 저장한 뒤 다시 가져와 주세요.');
  ensure(typeof filename === 'string' && /\.(json|csv)$/i.test(filename), 'JSON 또는 CSV 파일을 선택해 주세요.');
  ensure(isObject(metadata), '출처 정보를 확인해 주세요.');
  const text = input.replace(/^\uFEFF/, '');
  let rows;
  if (/\.csv$/i.test(filename)) rows = parseCsv(text);
  else {
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('JSON 형식이 올바르지 않습니다.'); }
    ensure(Array.isArray(parsed), 'JSON 파일은 기관 행 배열이어야 합니다.');
    rows = parsed;
  }
  const canonicalRows = tableRows(rows);
  const importedAt = new Date().toISOString();
  let sourceUrl = '';
  if (typeof metadata.url === 'string' && metadata.url) {
    let url;
    try { url = new URL(metadata.url); } catch { throw new Error('출처 URL을 확인해 주세요.'); }
    ensure(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && ![...url.searchParams.keys()].some(sensitive), '출처 URL에 계정·인증정보를 넣을 수 없습니다.');
    sourceUrl = url.href;
  }
  const provenance = { kind: 'user-import', scope: 'user-import', datasetId: '859', url: sourceUrl, retrievedAt: importedAt, license: '사용자가 이용 권한을 확인해 가져온 자료 · 공개 재배포 권한 미검증', isSynthetic: false, apiVerified: false };
  const records = normalizeHospitals(canonicalRows, provenance).map(record => ({ ...record, source: { ...record.source, kind: 'user-import', scope: 'user-import', url: provenance.url, apiVerified: false } }));
  return { records, profile: summarizeHospitalRecords(canonicalRows, { scope: 'user-import', fetchedAt: importedAt }), metadata: provenance };
}

export async function loadDataProfile(fetcher = globalThis.fetch) {
  const response = await fetcher('/data/datahub-profile.json', { credentials: 'omit' });
  ensure(response.ok, '데이터 집계 파일을 불러오지 못했습니다.');
  const profile = await response.json();
  ensure(isObject(profile) && profile.schemaVersion === 1 && profile.dataset?.id === '859' && profile.scope === 'public-preview-aggregates' && profile.rawDataStored === false, '지원하지 않는 데이터 집계입니다.');
  const counts = ['totalRows', 'activeRegistrationRows', 'closedRows', 'otherRows'];
  ensure(counts.every(key => Number.isInteger(profile[key]) && profile[key] >= 0) && profile.totalRows > 0 && profile.totalRows === profile.activeRegistrationRows + profile.closedRows + profile.otherRows, '집계 행 수를 확인해 주세요.');
  ensure(Array.isArray(profile.departments) && profile.departments.every(item => typeof item.name === 'string' && Number.isInteger(item.count) && item.count >= 0 && item.count <= profile.totalRows), '진료과 집계를 확인해 주세요.');
  ensure(isObject(profile.completeness) && ['addressRows', 'departmentRows', 'missingDepartmentRows'].every(key => Number.isInteger(profile.completeness[key]) && profile.completeness[key] >= 0 && profile.completeness[key] <= profile.totalRows) && profile.completeness.departmentRows + profile.completeness.missingDepartmentRows === profile.totalRows, '항목 완전성 집계를 확인해 주세요.');
  ensure(isObject(profile.time) && Array.isArray(profile.time.collectedAt) && Array.isArray(profile.missingCapabilities) && profile.rights?.rawRedistribution === 'unverified' && profile.rights?.aggregateRedistribution === 'unverified', '출처·시점·권리 상태를 확인해 주세요.');
  ensure(!['rows', 'records', 'csvData', 'companyName', 'addressDoro', 'addressJibun'].some(key => key in profile), '집계 파일에 원자료를 넣을 수 없습니다.');
  const allowed = ['schemaVersion', 'dataset', 'scope', 'fetchedAt', 'generatedAt', 'totalRows', 'activeRegistrationRows', 'closedRows', 'otherRows', 'departments', 'completeness', 'time', 'missingCapabilities', 'rights', 'limitations', 'rawDataStored'];
  ensure(Object.keys(profile).every(key => allowed.includes(key)), '지원하지 않는 집계 항목입니다.');
  return profile;
}
