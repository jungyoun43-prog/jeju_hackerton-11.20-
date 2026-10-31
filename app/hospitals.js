/** 제주데이터허브 병·의원 정보(859) 필드용 변환기. 실제 데이터 접근·권한은 별도다. */
const FIELDS = {
  companyName: ['companyName', '사업장명'], addressDoro: ['addressDoro', '도로명주소'],
  addressJibun: ['addressJibun', '지번주소'], medicalSubject: ['medicalSubject', '진료과목'],
  openStatus: ['openStatus', '영업상태명'], updateAt: ['updateAt', '데이터갱신일시'],
  collectedAt: ['collectedAt', 'collectAt', '데이터수집일시'],
};
const clean = value => value === null || value === undefined ? '' : String(value).trim();

function resolve(row, field) {
  return FIELDS[field].map(key => clean(row[key])).find(Boolean) || '';
}

export function normalizeHospitals(rows, metadata = {}) {
  if (!Array.isArray(rows)) throw new Error('병·의원 자료는 행 배열로 입력해 주세요.');
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('자료 출처 정보를 확인해 주세요.');
  let records = rows;
  if (Array.isArray(rows[0])) {
    const [headers, ...values] = rows;
    if (headers.some(header => typeof header !== 'string')) throw new Error('미리보기의 첫 행에 항목명이 필요합니다.');
    records = values.map(row => {
      if (!Array.isArray(row)) throw new Error('미리보기 행 형식을 확인해 주세요.');
      return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
    });
  }
  const normalized = [];
  const seen = new Set();
  for (const row of records) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('병·의원 행은 객체로 입력해 주세요.');
    const companyName = resolve(row, 'companyName');
    if (!companyName) continue;
    const openStatus = resolve(row, 'openStatus');
    if (/폐업|휴업|취소|말소/.test(openStatus)) continue;
    const addressDoro = resolve(row, 'addressDoro');
    const addressJibun = resolve(row, 'addressJibun');
    const address = addressDoro || addressJibun;
    const departments = [...new Set(resolve(row, 'medicalSubject').split(/[,;、\n]/).map(clean).filter(Boolean))];
    const updatedAt = resolve(row, 'updateAt');
    const collectedAt = resolve(row, 'collectedAt');
    const identity = `${companyName}\u0000${address}\u0000${updatedAt}\u0000${collectedAt}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    normalized.push({
      id: `hospital-${normalized.length + 1}`, companyName, address, addressDoro, addressJibun,
      departments, openStatus, updatedAt, collectedAt,
      source: {
        datasetId: clean(metadata.datasetId || '859'),
        url: clean(metadata.url || 'https://jejudatahub.net/data/view/data/859'),
        retrievedAt: clean(metadata.retrievedAt), license: clean(metadata.license || '이용·재배포 조건 미확인'),
        isSynthetic: metadata.isSynthetic === true,
      },
      inquiryStatus: 'unverified',
    });
  }
  return normalized;
}

export function filterHospitals(records, { department = '', area = '' } = {}) {
  if (!Array.isArray(records) || typeof department !== 'string' || typeof area !== 'string') throw new Error('후보 검색 조건을 확인해 주세요.');
  const queryDepartment = department.trim().toLocaleLowerCase('ko-KR');
  const queryArea = area.trim().toLocaleLowerCase('ko-KR');
  return records.filter(record => !/폐업|휴업|취소|말소/.test(record.openStatus)
    && (!queryDepartment || record.departments.some(item => item.toLocaleLowerCase('ko-KR').includes(queryDepartment)))
    && (!queryArea || record.address.toLocaleLowerCase('ko-KR').includes(queryArea)));
}
