const REGISTRY_URL = '/data/visit-support-providers.json';
const HUB = 'https://jejudatahub.net/data/view/data/';
const SOURCE_HOSTS = new Set(['jejudatahub.net', 'www.data.go.kr', 'www.jjcsc.co.kr', 'www.jejuhappycall.com']);
const clean = value => String(value ?? '').trim();
const NORTH = ['애월읍', '한림읍', '한경면', '조천읍', '구좌읍', '우도면', '추자면'];
const SOUTH = ['대정읍', '남원읍', '성산읍', '안덕면', '표선면', '중문'];
const LOCAL_NAMES = [...NORTH, ...SOUTH].map(place => place.replace(/[읍면]$/, ''));

function cityOf(value) {
  if (value.includes('서귀포시') || SOUTH.some(place => value.includes(place.replace(/[읍면]$/, '')))) return '서귀포시';
  if (value.includes('제주시') || NORTH.some(place => value.includes(place.replace(/[읍면]$/, '')))) return '제주시';
  return '';
}

export function parseSupportCsv(text) {
  if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw new Error('지원기관 CSV는 2MB 이하 텍스트여야 합니다.');
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(value => value.trim())) rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('CSV의 닫히지 않은 따옴표를 확인하세요.');
  if (cell || row.length) { row.push(cell); if (row.some(value => value.trim())) rows.push(row); }
  const headers = rows[0]?.map(clean), values = rows.slice(1);
  if (!headers?.length || headers.some(header => !header) || new Set(headers).size !== headers.length) throw new Error('CSV 항목명을 확인하세요.');
  return values.map(values => {
    if (values.length !== headers.length) throw new Error('CSV 행의 열 수가 다릅니다.');
    return Object.fromEntries(headers.map((name, index) => [name.trim(), clean(values[index])]));
  });
}

/** 공개 원출처의 최소 사업체 사실만 변환한다. 현재 배차·동행 가능 여부는 생성하지 않는다. */
export function createSupportRegistry({taxiRows, careResponse, retrievedAt = '', taxiFileName = '', taxiFileSha256 = ''}) {
  if (!Array.isArray(taxiRows) || !taxiRows.length || taxiRows.length > 1000) throw new Error('콜택시 원자료 행을 확인하세요.');
  if (careResponse?.id !== 254 || !Array.isArray(careResponse.csvData)) throw new Error('허브254의 공개 미리보기가 필요합니다.');
  const [headers, ...careValues] = careResponse.csvData;
  const requiredCare = ['구분', '읍면동', '기관명', '소재지', '전화번호', '데이터기준일자'];
  if (!requiredCare.every(field => headers.includes(field))) throw new Error('노인돌봄 공개 항목이 다릅니다.');
  const careRows = careValues.map(values => Object.fromEntries(headers.map((name, index) => [name, clean(values[index])])));
  const taxiDates = [...new Set(taxiRows.map(row => clean(row['데이터기준일자'])))];
  const careDates = [...new Set(careRows.map(row => clean(row['데이터기준일자'])))];
  if (taxiDates.length !== 1 || careDates.length !== 1 || !taxiDates[0] || !careDates[0]) throw new Error('자료 기준일을 확인하세요.');
  const source = (datasetId, url, scope, asOf) => ({datasetId, url, hubUrl: datasetId ? HUB + datasetId : '', scope, asOf, retrievedAt});
  const providers = taxiRows.map((row, index) => ({
    id: `taxi327-${index + 1}`, kind: 'taxi', name: clean(row['호출(콜)택시명']), region: clean(row['지역별']), address: '', phone: clean(row['전화번호']),
    serviceType: 'call_taxi', description: '지역별 호출택시 문의처입니다. 현재 차량·배차·운임·휠체어 탑승 가능 여부는 문의가 필요합니다.',
    source: source('327', 'https://www.data.go.kr/data/15056321/fileData.do', 'linked-public-file', taxiDates[0]),
  }));
  providers.push(...careRows.map((row, index) => ({
    id: `care254-${index + 1}`, kind: 'companion', name: row['기관명'], region: row['읍면동'], address: row['소재지'], phone: row['전화번호'],
    serviceType: 'care_contact', description: `${row['구분']} 등록 문의처입니다. 병원 동행 제공·이용대상·담당지역은 확인되지 않았습니다.`,
    source: source('254', HUB + '254', 'public-preview', careDates[0]),
  })));
  providers.push({
    id: 'areum-escort', kind: 'companion', name: '제주시니어클럽 아름동행', region: '제주시', address: '', phone: '064-745-3999',
    serviceType: 'hospital_escort', description: '공식 사업 소개에서 병원동행·이동지원 확인. 기관 대표문의이며 지원지역·자격·날짜·비용은 별도 확인합니다.',
    source: source('', 'https://www.jjcsc.co.kr/Business/Market', 'official-service-page', ''),
  }, {
    id: 'jeju-accessible-transport', kind: 'taxi', name: '제주 교통약자 이동지원센터', region: '제주특별자치도', address: '', phone: '1899-6884',
    serviceType: 'accessible_transport', description: '특별교통수단·임차택시 안내. 이용대상·사전 회원등록·차량을 확인해야 합니다. 병원 동행인 제공 서비스가 아닙니다.',
    source: source('', 'https://www.jejuhappycall.com/?mcode=guide01', 'official-service-page', ''),
  });
  const registry = {
    schemaVersion: 1, retrievedAt,
    datasets: [
      {id: '327', name: '제주특별자치도_콜택시업체현황', hubUrl: HUB + '327', sourceUrl: 'https://www.data.go.kr/data/15056321/fileData.do', scope: 'linked-public-file', asOf: taxiDates[0], rowCount: taxiRows.length, fileName: taxiFileName, fileSha256: taxiFileSha256, hubPreview: {asOf: '2020-04-30', rowCount: 45}, note: '허브의 과거 미리보기 대신 연결 원출처 공개 CSV를 사용. 가입대수·실시간 빈차·운임 정보는 없음.'},
      {id: '254', name: '제주특별자치도_노인돌봄서비스시설현황', hubUrl: HUB + '254', sourceUrl: HUB + '254', scope: 'public-preview', asOf: careDates[0], rowCount: careRows.length, note: '과거 등록 문의처이며 현재 병원동행 제공 여부 미확인.'},
    ], providers,
  };
  return validateSupportRegistry(registry);
}

export function validateSupportRegistry(registry) {
  if (registry?.schemaVersion !== 1 || !Array.isArray(registry.datasets) || !Array.isArray(registry.providers) || registry.providers.length > 2000) throw new Error('이동·동행 문의처 자료 형식이 다릅니다.');
  if (typeof registry.retrievedAt !== 'string' || !registry.retrievedAt || Number.isNaN(Date.parse(registry.retrievedAt))) throw new Error('실제 자료 조회일을 --retrieved-at으로 기록하세요.');
  const ids = new Set();
  for (const provider of registry.providers) {
    if (!provider || !/^[a-z0-9_-]+$/.test(provider.id) || ids.has(provider.id)) throw new Error('지원기관 식별자를 확인하세요.');
    ids.add(provider.id);
    if (!['taxi', 'companion'].includes(provider.kind) || !['call_taxi', 'care_contact', 'hospital_escort', 'accessible_transport'].includes(provider.serviceType)) throw new Error('지원 유형을 확인하세요.');
    if (['name', 'region', 'phone', 'description'].some(key => typeof provider[key] !== 'string' || !provider[key].trim() || provider[key].length > 1000) || typeof provider.address !== 'string') throw new Error('기관명·지역·대표번호를 확인하세요.');
    if (!/^[0-9+() -]{6,40}$/.test(provider.phone)) throw new Error('공개 대표번호 형식을 확인하세요.');
    let url; try { url = new URL(provider.source.url); } catch { throw new Error('지원기관 출처 URL을 확인하세요.'); }
    if (url.protocol !== 'https:' || url.username || url.password || !SOURCE_HOSTS.has(url.hostname)) throw new Error('확인한 공식 출처만 사용할 수 있습니다.');
    const expected = provider.serviceType === 'call_taxi' ? ['327', 'linked-public-file', 'www.data.go.kr']
      : provider.serviceType === 'care_contact' ? ['254', 'public-preview', 'jejudatahub.net']
      : provider.serviceType === 'hospital_escort' ? ['', 'official-service-page', 'www.jjcsc.co.kr'] : ['', 'official-service-page', 'www.jejuhappycall.com'];
    if (provider.source.datasetId !== expected[0] || provider.source.scope !== expected[1] || url.hostname !== expected[2]) throw new Error('허브 자료와 공식 서비스 소개의 출처가 다릅니다.');
    if (typeof provider.source.asOf !== 'string' || typeof provider.source.retrievedAt !== 'string' || !provider.source.retrievedAt || Number.isNaN(Date.parse(provider.source.retrievedAt))) throw new Error('자료 시점을 확인하세요.');
  }
  for (const dataset of registry.datasets) if (!Number.isInteger(dataset.rowCount) || dataset.rowCount !== registry.providers.filter(provider => provider.source.datasetId === dataset.id).length) throw new Error('출처별 행 수가 다릅니다.');
  return registry;
}

export async function loadSupportRegistry(fetcher = globalThis.fetch) {
  const response = await fetcher(REGISTRY_URL);
  if (!response.ok) throw new Error('이동·동행 문의처를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.');
  return validateSupportRegistry(await response.json());
}

/** 순서는 지역·서비스 유형의 문의 우선순위다. 거리·수용·환자 적합성 점수가 아니다. */
export function getSupportCandidates(registry, {kind, area = '', wheelchair = false} = {}) {
  if (!['taxi', 'companion'].includes(kind) || typeof area !== 'string' || typeof wheelchair !== 'boolean') throw new Error('지원 유형과 출발 지역을 확인하세요.');
  const query = area.trim(), city = cityOf(query);
  return registry.providers.filter(provider => provider.kind === kind).map(provider => {
    const providerCity = cityOf(`${provider.region} ${provider.address}`);
    const local = provider.region !== city && provider.region !== '제주특별자치도' && query.includes(provider.region.replace(/[읍면동]$/, ''));
    const sameCity = city && providerCity === city;
    const official = ['hospital_escort', 'accessible_transport'].includes(provider.serviceType);
    if (city && providerCity && providerCity !== city && !official) return null;
    if (!local && provider.region !== city && !official && city) return null;
    if (!local && !sameCity && !official && city) return null;
    const matchLevel = local ? 'local' : sameCity ? 'city' : official ? 'island' : 'unverified';
    const matchLabel = local ? '등록 지역 일치 · 서비스 확인 필요' : sameCity ? '같은 시의 문의처 · 담당지역 확인' : official ? '공식 서비스 안내 · 지원지역 확인' : '출발 지역 확인 필요';
    const priority = kind === 'taxi' && wheelchair && provider.serviceType === 'accessible_transport' ? -2
      : kind === 'companion' && provider.serviceType === 'hospital_escort' ? -1 : {local: 0, city: 1, island: 2, unverified: 3}[matchLevel];
    return {...provider, matchLevel, matchLabel, priority};
  }).filter(Boolean).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, 'ko')).map(({priority, ...provider}) => provider);
}

/** 주소록에서 조회한 곳을 실제 문의 대상으로 쓸 수 있는지 현재 방문 조건으로 확인한다. */
export function supportInquiryIssue(provider, {area = '', wheelchair = false} = {}) {
  if (wheelchair && provider.kind === 'taxi' && provider.serviceType !== 'accessible_transport') {
    return '일반 호출택시 등록 자료에는 휠체어 탑승 차량 정보가 없습니다. 교통약자 이동지원 창구와 이용 조건을 확인해 주세요.';
  }
  if (provider.serviceType === 'accessible_transport') return '';
  const region = provider.region.replace(/제주특별자치도|제주도/g, '').trim();
  const places = LOCAL_NAMES.filter(place => region.includes(place));
  const outsideLocal = places.length > 0 && !places.some(place => area.includes(place));
  const originCity = cityOf(area), registeredCity = cityOf(region);
  if (outsideLocal || (originCity && registeredCity && registeredCity !== originCity)) {
    return '출발 지역에 맞는 문의처를 선택해 주세요. 등록 지역 밖의 지원 여부는 확인되지 않았습니다.';
  }
  return '';
}

export function getSupportInquiryCandidates(registry, conditions) {
  return getSupportCandidates(registry, conditions).filter(provider => !supportInquiryIssue(provider, conditions));
}
