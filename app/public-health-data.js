export const PUBLIC_HEALTH_DATASET = Object.freeze({
  id: '1304', name: '제주특별자치도_제주시_보건지소등현황',
  hubUrl: 'https://jejudatahub.net/data/view/data/1304',
  sourceUrl: 'https://www.data.go.kr/data/15056141/fileData.do',
  scope: 'linked-public-file',
});
export const PUBLIC_HEALTH_COLUMNS = Object.freeze(['구분', '명칭', '위치', '관할구역', '전화번호', '데이터기준일자']);
const TYPES = new Set(['보건소', '보건지소', '보건진료소', '건강생활지원센터']);
const MATCH_ORDER = {registered_jurisdiction: 0, registered_address: 1, city_contact: 2};
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const field = (value, label, optional = false) => {
  ensure(typeof value === 'string' && !/[\u0000-\u001f\u007f]/u.test(value) && value.length <= 300 && (optional || value.trim()), `${label} 항목을 확인해 주세요.`);
  return clean(value);
};
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const phone = value => value === '' || /^064-\d{3}-\d{4}$/.test(value);
const missing = records => ({
  missingAddressRows: records.filter(row => !row.address).length,
  missingJurisdictionRows: records.filter(row => !row.jurisdiction).length,
  missingPhoneRows: records.filter(row => !row.phone).length,
});

/** 공개 파일의 최소 기관 사실만 정제한다. 전화 응대·진료·서비스 제공 여부는 만들지 않는다. */
export function createPublicHealthSnapshot({rows, retrievedAt, fileName, fileSha256}) {
  ensure(Array.isArray(rows) && rows.length > 0 && rows.length <= 1000, '공공보건기관 원자료 행을 확인해 주세요.');
  const records = [], identities = new Map();
  let asOf = '', duplicateRows = 0;
  for (const row of rows) {
    ensure(object(row) && Object.keys(row).length === PUBLIC_HEALTH_COLUMNS.length && PUBLIC_HEALTH_COLUMNS.every(key => Object.hasOwn(row, key)), '공공보건기관의 공개 항목만 사용할 수 있습니다.');
    const record = {
      type: field(row['구분'], '구분'), name: field(row['명칭'], '명칭'),
      address: field(row['위치'], '위치', true), jurisdiction: field(row['관할구역'], '관할구역', true),
      phone: field(row['전화번호'], '전화번호', true),
    };
    const rowDate = field(row['데이터기준일자'], '데이터기준일자');
    ensure(date(rowDate) && (!asOf || asOf === rowDate), '공공보건기관 자료의 기준일을 확인해 주세요.');
    asOf = rowDate;
    ensure(TYPES.has(record.type) && phone(record.phone), '공공보건기관 구분·전화번호 형식을 확인해 주세요.');
    const identity = `${record.name}\u0000${record.address || `주소미상:${records.length + duplicateRows}`}`;
    if (identities.has(identity)) {
      ensure(identities.get(identity) === JSON.stringify(record), '동일 기관의 관할·전화번호가 충돌합니다. 원출처를 확인해 주세요.');
      duplicateRows++;
      continue;
    }
    identities.set(identity, JSON.stringify(record));
    records.push({id: `public-health1304-${records.length + 1}`, ...record});
  }
  return validatePublicHealthSnapshot({
    schemaVersion: 1, retrievedAt, dataset: {...PUBLIC_HEALTH_DATASET, asOf, sourceRows: rows.length, rowCount: records.length, fileName, fileSha256},
    quality: {duplicateRows, ...missing(records)}, records, rawDataStored: false,
    rights: {label: '이용허락범위 제한 없음', sourceUrl: PUBLIC_HEALTH_DATASET.sourceUrl, checkedAt: retrievedAt, included: '최소 기관 사실 정제본; 원문 CSV 미포함'},
  });
}

export function validatePublicHealthSnapshot(snapshot) {
  ensure(object(snapshot) && snapshot.schemaVersion === 1 && snapshot.rawDataStored === false && object(snapshot.dataset) && object(snapshot.quality), '공공보건기관 자료 형식을 확인해 주세요.');
  const {dataset, records, quality} = snapshot;
  for (const [key, value] of Object.entries(PUBLIC_HEALTH_DATASET)) ensure(dataset[key] === value, '확인된 공공보건기관 원출처가 필요합니다.');
  ensure(date(dataset.asOf) && typeof snapshot.retrievedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(snapshot.retrievedAt) && !Number.isNaN(Date.parse(snapshot.retrievedAt)), '자료 기준일과 실제 수집 시각을 확인해 주세요.');
  ensure(dataset.fileName === `${PUBLIC_HEALTH_DATASET.name}_${dataset.asOf.replaceAll('-', '')}.csv` && /^[a-f0-9]{64}$/.test(dataset.fileSha256), '원본 파일명·SHA-256을 확인해 주세요.');
  ensure(snapshot.rights?.sourceUrl === PUBLIC_HEALTH_DATASET.sourceUrl && snapshot.rights?.label === '이용허락범위 제한 없음' && snapshot.rights?.checkedAt === snapshot.retrievedAt, '해당 파일의 이용조건 출처를 확인해 주세요.');
  ensure(Array.isArray(records) && records.length > 0 && records.length <= 1000 && dataset.rowCount === records.length && Number.isInteger(quality.duplicateRows) && quality.duplicateRows >= 0 && dataset.sourceRows === records.length + quality.duplicateRows, '기관 행수·중복 제외 수가 다릅니다.');
  const ids = new Set(), identities = new Set();
  for (const record of records) {
    ensure(object(record) && Object.keys(record).length === 6 && ['id', 'type', 'name', 'address', 'jurisdiction', 'phone'].every(key => Object.hasOwn(record, key)), '정제된 공개 기관 항목만 사용할 수 있습니다.');
    ensure(/^public-health1304-\d{1,4}$/.test(record.id) && !ids.has(record.id), '기관 식별자가 중복되거나 올바르지 않습니다.');
    ids.add(record.id);
    for (const key of ['type', 'name', 'address', 'jurisdiction', 'phone']) ensure(field(record[key], key, ['address', 'jurisdiction', 'phone'].includes(key)) === record[key], '정제되지 않은 기관 항목입니다.');
    ensure(TYPES.has(record.type) && phone(record.phone), '공공보건기관 구분·전화번호 형식을 확인해 주세요.');
    const identity = `${record.name}\u0000${record.address || `주소미상:${record.id}`}`;
    ensure(!identities.has(identity), '정제 기관이 중복되었습니다.');
    identities.add(identity);
  }
  for (const [key, count] of Object.entries(missing(records))) ensure(quality[key] === count, '주소·관할·전화 결측 집계가 다릅니다.');
  return snapshot;
}

/** 입력은 기존 공공데이터 스킬이 정규화한 시·읍면동이다. 리 단위의 실제 담당은 문의로 남긴다. */
export function getPublicHealthContacts(snapshot, area) {
  validatePublicHealthSnapshot(snapshot);
  ensure(typeof area === 'string' && /^(?:제주시|서귀포시)(?: [가-힣0-9]+[읍면동])?$|^$/.test(area), '정규화된 제주 시·읍면동을 지정해 주세요.');
  if (!area || area.startsWith('서귀포시')) return [];
  const local = area.split(' ')[1], localBase = local?.replace(/[읍면동]$/, '');
  return snapshot.records.map(record => {
    const tokens = record.jurisdiction.replace(/일원/g, '').split(/[\s·,]+/).filter(Boolean);
    const registeredJurisdiction = local ? tokens.some(token => token === local || token === localBase) : /^제주시\s*일원$/.test(record.jurisdiction);
    const registeredAddress = local ? record.address.split(' ').includes(local) : record.address.includes('제주시');
    const cityWide = /^제주시\s*일원$/.test(record.jurisdiction);
    if (!registeredJurisdiction && !registeredAddress && !cityWide) return null;
    const matchLevel = registeredJurisdiction ? 'registered_jurisdiction' : registeredAddress ? 'registered_address' : 'city_contact';
    return {...structuredClone(record), matchLevel,
      matchLabel: registeredJurisdiction ? '등록 관할 문구 일치 · 담당 업무 확인 필요' : registeredAddress ? '등록 소재지 일치 · 거주 리/동의 담당 관할 확인 필요' : '제주시 일원 등록 창구 · 지역 담당 확인 필요',
    };
  }).filter(Boolean).sort((a, b) => MATCH_ORDER[a.matchLevel] - MATCH_ORDER[b.matchLevel] || a.name.localeCompare(b.name, 'ko'));
}
