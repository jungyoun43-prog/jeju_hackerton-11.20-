import catalog from './data/public-data-catalog.json' with {type: 'json'};
import hospitalSnapshot from './data/hospital-candidates.json' with {type: 'json'};
import supportRegistry from './data/visit-support-providers.json' with {type: 'json'};
import publicHealthSnapshot from './data/public-health-contacts.json' with {type: 'json'};
import {getSupportCandidates} from './support-data.js';
import {PUBLIC_HEALTH_COLUMNS, getPublicHealthContacts, validatePublicHealthSnapshot} from './public-health-data.js';

const PURPOSES = ['hospital', 'taxi', 'companion', 'travel'];
const ANALYSES = ['facility_compare', 'support_candidates', 'travel_time', 'public_health_contacts'];
const SNAPSHOT_IDS = ['hub:859', 'hub:327', 'hub:254', 'hub:1304', 'official:areum-escort', 'official:jeju-accessible-transport'];
const SNAPSHOTS = new Set(SNAPSHOT_IDS);
const publicHealth = validatePublicHealthSnapshot(publicHealthSnapshot);
const sourceById = new Map(catalog.records.map(record => [record.id, record]));
const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const canonicalUrl = value => new URL(value).href;
const normalizeText = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
const flags = () => ({actualCallPlaced: false, reservationConfirmed: false, clinicalAcceptanceConfirmed: false, caseMutation: false});
const BASE_LIMITATIONS = [
  '공개 등록정보·공식 안내의 읽기 전용 조회이며 현재 수용·차량·동행인력·예약·임상 적합성 확인이 아닙니다.',
  '카탈로그 수는 원자료 접근·계산 가능한 자료 수가 아닙니다. 실제 보유 snapshot과 미접근 자료·운영 API를 구분합니다.',
];
const NORTH = ['애월읍', '한림읍', '한경면', '구좌읍', '조천읍', '우도면', '추자면', '일도1동', '일도2동', '이도1동', '이도2동', '삼도1동', '삼도2동', '용담1동', '용담2동', '건입동', '화북동', '삼양동', '봉개동', '아라동', '오라동', '연동', '노형동', '외도동', '이호동', '도두동'];
const SOUTH = ['대정읍', '남원읍', '성산읍', '안덕면', '표선면', '송산동', '정방동', '중앙동', '천지동', '효돈동', '영천동', '동홍동', '서홍동', '대륜동', '대천동', '중문동', '예래동'];
const aliases = new Map([['제주시', '제주시'], ['서귀포', '서귀포시'], ['서귀포시', '서귀포시']]);
for (const [city, places] of [['제주시', NORTH], ['서귀포시', SOUTH]]) {
  for (const place of places) {
    const canonical = `${city} ${place}`;
    for (const alias of [place, place.replace(/[읍면]$/, ''), canonical, `${city} ${place.replace(/[읍면]$/, '')}`]) aliases.set(alias.replace(/\s/g, ''), canonical);
  }
}
aliases.set('중문', '서귀포시 중문동');
const addressAliases = value => value.replace(/(일도|이도|삼도|용담)(일|이)동/g, (_, place, number) => `${place}${number === '일' ? '1' : '2'}동`)
  .replace(/(아라|오라|화북|삼양|외도|이호|도두)(?:일|이|삼|[123])동/g, '$1동');

function text(value, label, max = 100, optional = false) {
  ensure(typeof value === 'string' && value.length <= max && (optional || value.trim()), `${label}을 확인해 주세요.`);
  return value.trim();
}

function areaOf(value, optional = false) {
  const cleaned = text(value, '제주 행정지역', 100, optional);
  if (!cleaned && optional) return '';
  const key = addressAliases(cleaned.replace(/^제주특별자치도\s*/, '')).replace(/\s/g, '');
  const found = aliases.get(key);
  ensure(found, '제주시·서귀포시 또는 제주 읍면동 지역을 지정해 주세요.');
  return found;
}

function operationalContext(context) {
  if (!object(context)) return {area: '', wheelchair: false, hospitalName: ''};
  let area = '';
  if (typeof context.area === 'string' && context.area.trim()) area = areaOf(context.area);
  return {area, wheelchair: context.wheelchair === true, hospitalName: typeof context.hospitalName === 'string' ? context.hospitalName.trim().slice(0, 100) : ''};
}

function snapshotCoverage(id) {
  if (id === 'hub:1304') return {
    kind: publicHealth.dataset.scope, label: '연결 원출처 공개 CSV 35행의 제주시 공공보건 등록 문의처; 현재 운영·진료·담당 확인 아님',
    asOf: publicHealth.dataset.asOf, collectedAt: publicHealth.retrievedAt, rowCount: publicHealth.records.length, complete: false,
  };
  if (id === 'hub:859') return {
    kind: 'public-preview',
    label: `공개 ${hospitalSnapshot.totalPreviewRows}행 중 정상 등록 ${hospitalSnapshot.records.length}행; 원자료 수집 ${(hospitalSnapshot.time?.collectedAt || []).join(', ') || '미상'}; 행별 갱신 ${hospitalSnapshot.time?.earliestRowUpdate || '미상'} ~ ${hospitalSnapshot.time?.latestRowUpdate || '미상'}`,
    asOf: null, collectedAt: hospitalSnapshot.retrievedAt || null, rowCount: hospitalSnapshot.records.length, complete: false,
  };
  if (id === 'hub:327' || id === 'hub:254') {
    const dataset = supportRegistry.datasets.find(record => `hub:${record.id}` === id);
    return {kind: dataset.scope, label: id === 'hub:327' ? '연결 원출처 공개 CSV의 업체 등록 문의처; 실시간 배차 자료 아님' : '공개 미리보기의 과거 돌봄 등록 문의처; 병원동행 제공 미확인', asOf: dataset.asOf || null, collectedAt: supportRegistry.retrievedAt || null, rowCount: dataset.rowCount, complete: false};
  }
  return {kind: 'official-service-page', label: '공식 서비스 소개·대표문의 1건; 운영시간·인력·차량·자격은 별도 문의', asOf: null, collectedAt: supportRegistry.retrievedAt || null, rowCount: 1, complete: false};
}

function datasetRef(recordOrId) {
  const record = typeof recordOrId === 'string' ? sourceById.get(recordOrId) : recordOrId;
  ensure(record, '등록된 공공데이터 출처를 확인해 주세요.');
  const snapshot = SNAPSHOTS.has(record.id);
  const center = record.sourceSystem === 'center';
  const columns = record.id === 'hub:859' ? ['사업장명', '도로명주소', '지번주소', '진료과목', '영업상태명', '데이터갱신일시', '데이터수집일시']
    : record.id === 'hub:327' ? ['지역별', '호출(콜)택시명', '전화번호', '데이터기준일자']
      : record.id === 'hub:254' ? ['구분', '읍면동', '기관명', '소재지', '전화번호', '데이터기준일자'] : record.id === 'hub:1304' ? PUBLIC_HEALTH_COLUMNS : record.columns;
  const availabilityReason = snapshot ? (record.id === 'hub:859' ? `정제된 공개 표본 정상 등록 ${hospitalSnapshot.records.length}개 보유; 전체 운영 자료 아님` : record.id === 'hub:1304' ? `연결 원출처 ${publicHealth.dataset.asOf} 기준 ${publicHealth.records.length}개 최소 기관 사실 보유; 공공보건 행정·관할 문의용` : '기등록 정제 문의처·공식 안내 보유; 실제 제공 여부는 미확인')
    : center ? '항목 명세를 확인했으나 센터 원자료는 미접근이며 현재 정제 저장소에 미탑재'
      : `${record.latestLinkedFileChecked ? '감사에서 연결 최신 파일을 확인했으나 ' : record.detailChecked ? '상세를 확인했으나 ' : '목록만 색인했으며 '}원자료는 현재 정제 저장소에 미탑재${record.metadataUpdated ? `; 목록 수정일 ${record.metadataUpdated}는 원자료 기준일이 아님` : ''}`;
  return {
    id: record.id, title: record.title, folder: record.folder, tags: [...record.tags], sourceSystem: record.sourceSystem,
    sourceUrl: record.id === 'hub:327' ? canonicalUrl(supportRegistry.datasets.find(row => row.id === '327').sourceUrl) : record.id === 'hub:1304' ? publicHealth.dataset.sourceUrl : canonicalUrl(record.sourceUrl),
    ...(record.id === 'hub:1304' ? {hubUrl: publicHealth.dataset.hubUrl} : {}),
    availability: snapshot ? 'snapshot' : 'metadata_only', availabilityReason, columns: [...columns],
    coverage: snapshot ? snapshotCoverage(record.id) : {kind: 'metadata_only', label: center ? '센터 데이터 항목 명세; 원자료 행·기준일 미확인' : '허브 목록 메타데이터; 원자료 행·기준일 미확인', asOf: null, collectedAt: catalog.auditedAt, rowCount: null, complete: false},
    usableFor: !snapshot ? ['필요 자료·항목 탐색'] : record.id === 'hub:859' ? ['등록기관 문의 후보', '주소 기준 표본 비교'] : record.id === 'hub:254' ? ['돌봄 등록 문의처', '주소 기준 표본 비교'] : record.id === 'hub:1304' ? ['공공보건 행정·관할 확인 문의처', '등록 관할과 소재지의 구분'] : ['이동·병원동행 문의 준비'],
    notUsableFor: !snapshot ? ['행 집계·평균·소요시간 계산', '예약·배차·임상 판단'] : ['현재 수용·인력·차량·예약 확정', '제주 전체 시설 밀도·인구당 비교·질적 우열·임상 판단'],
  };
}

export const PUBLIC_DATA_SOURCE_URLS = Object.freeze([...new Set([
  ...catalog.records.map(record => canonicalUrl(record.sourceUrl)),
  ...supportRegistry.datasets.flatMap(record => [canonicalUrl(record.sourceUrl), canonicalUrl(record.hubUrl)]),
  publicHealth.dataset.sourceUrl, publicHealth.dataset.hubUrl,
  canonicalUrl('https://jejudatahub.net/center/data'),
])]);

const PREFERRED = {
  hospital: ['hub:859', 'hub:229', 'hub:208', 'hub:207', 'hub:1304'],
  taxi: ['hub:327', 'official:jeju-accessible-transport', 'hub:326'],
  companion: ['official:areum-escort', 'hub:254', 'hub:1321'],
  travel: ['center:10', 'center:7', 'center:8'],
};
function relevance(record, purpose, query) {
  const preferred = PREFERRED[purpose].indexOf(record.id);
  const haystack = normalizeText(`${record.title} ${record.folder} ${record.tags.join(' ')} ${record.columns.join(' ')}`);
  const topical = purpose === 'hospital' ? record.folder === '의료'
    : purpose === 'companion' ? record.folder === '돌봄' && /돌봄|재가|복지시설|장애인.*지원/.test(record.title)
      : purpose === 'taxi' ? /택시|교통약자/.test(haystack) && !/사고/.test(record.title)
        : record.folder === '이동' && /도로|교통량|소요시간/.test(record.title) && !/사고|어린이|관광/.test(record.title);
  if (preferred < 0 && !topical) return -1;
  const tokens = normalizeText(query).split(/[\s,·/]+/).filter(Boolean);
  const matches = tokens.filter(token => haystack.includes(token)
    || (purpose === 'hospital' && /^(병원|병의원|의원|hospital)$/.test(token) && record.tags.includes('의료기관'))
    || (purpose === 'companion' && /^(병원동행|동행|companion)$/.test(token) && record.folder === '돌봄')).length;
  if (tokens.length && !matches) return -1;
  return (preferred >= 0 ? 100 - preferred * 5 : 5) + matches * 20 + (SNAPSHOTS.has(record.id) ? 10 : 0);
}

export function searchPublicDataCatalog(input = {}) {
  ensure(object(input) && Object.keys(input).every(key => ['purpose', 'query', 'limit'].includes(key)), '공공데이터 검색 조건을 확인해 주세요.');
  const {purpose, limit = 5} = input, query = text(input.query ?? '', '검색어(200자 이내)', 200, true);
  ensure(PURPOSES.includes(purpose), '진료·택시·동행·이동시간 검색 목적을 지정해 주세요.');
  ensure(Number.isInteger(limit) && limit >= 1 && limit <= 8, '검색 결과 수는 1~8개로 지정해 주세요.');
  const results = catalog.records.map(record => ({record, score: relevance(record, purpose, query)}))
    .filter(item => item.score >= 0).sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id, 'en', {numeric: true})).slice(0, limit).map(item => datasetRef(item.record));
  return {
    version: 1, purpose, query, indexedMetadataCount: catalog.indexedMetadataCount, usableSnapshotIds: [...SNAPSHOT_IDS], results,
    limitations: [...catalog.limitations, ...BASE_LIMITATIONS],
    suggestedAnalysis: purpose === 'hospital' ? ['facility_compare', ...(results.some(row => row.id === 'hub:1304') ? ['public_health_contacts'] : [])] : purpose === 'travel' ? ['travel_time'] : ['support_candidates'],
  };
}

function addressLocation(address) {
  const value = addressAliases(normalizeText(address));
  if (!value) return {city: '', local: ''};
  const city = value.includes('서귀포시') ? '서귀포시' : value.includes('제주시') ? '제주시' : '';
  const places = [...NORTH.map(local => ({city: '제주시', local})), ...SOUTH.map(local => ({city: '서귀포시', local}))];
  const found = places.find(place => new RegExp(`(?:^|[\\s(,])${place.local}(?=$|[\\s),])`).test(value));
  if (found && city && found.city !== city) return {city: '', local: ''};
  return {city: city || found?.city || '', local: found?.local || ''};
}

function facilities(kind, granularity) {
  const hospital = kind === 'hospital';
  const input = hospital ? hospitalSnapshot.records : supportRegistry.providers.filter(provider => provider.source.datasetId === '254');
  const rows = [], seen = new Set();
  let duplicateRows = 0, closedInLoadedRows = 0, invalidRows = 0;
  for (const record of input) {
    if (hospital && /폐업|휴업|취소|말소/.test(record.openStatus)) { closedInLoadedRows++; continue; }
    const name = hospital ? record.companyName : record.name;
    if (!normalizeText(name)) { invalidRows++; continue; }
    const address = normalizeText(record.address), identity = `${normalizeText(name)}\u0000${address || `주소미상:${record.id || rows.length}`}`;
    if (seen.has(identity)) { duplicateRows++; continue; }
    seen.add(identity);
    rows.push({id: record.id, address, ...addressLocation(address)});
  }
  const located = rows.filter(row => granularity === 'city' ? row.city : row.city && row.local);
  return {rows, located, metrics: {
    datasetId: hospital ? 'hub:859' : 'hub:254', kind, kindLabel: hospital ? '의료기관 등록 표본' : '돌봄 등록 문의처', granularity,
    sourceRows: hospital ? hospitalSnapshot.totalPreviewRows : supportRegistry.datasets.find(record => record.id === '254').rowCount,
    loadedRows: input.length, eligibleRows: rows.length, duplicateRows,
    excludedClosedRows: (hospital ? hospitalSnapshot.excludedClosedRows || 0 : 0) + closedInLoadedRows,
    excludedOtherRows: hospital ? hospitalSnapshot.excludedOtherRows || 0 : 0, excludedInvalidRows: invalidRows,
    addressKnownRows: rows.filter(row => row.address).length, addressMissingRows: rows.filter(row => !row.address).length,
    locatedRows: located.length, unlocatedRows: rows.length - located.length, denominator: located.length,
    denominatorLabel: `이 자료의 중복·폐업 제외 후 주소에서 ${granularity === 'city' ? '시' : '읍면동'}를 확인한 ${located.length}행`,
    addressBasis: granularity === 'city' ? '관측 주소의 시' : '관측 주소에 명시된 읍면동',
    coverage: snapshotCoverage(hospital ? 'hub:859' : 'hub:254'),
  }};
}

function questionsFor(kind, context) {
  const questions = kind === 'taxi' ? [
    '출발 지역에서 방문 기관까지 진료 시각에 맞춰 도착하려면 출발 시각과 예상 소요시간을 어떻게 확인하나요?',
    '교통 지연·진료 종료 지연 시 귀가 차량 재문의 방법과 비용·취소 조건은 무엇인가요?',
  ] : [
    '해당 출발 지역과 방문일에 병원동행을 실제 제공하나요? 이용대상·담당지역·인력·가능시간·비용을 확인해 주세요.',
    '이동·접수·수납·귀가 중 지원 범위와 보호자에게 넘길 일은 무엇인가요?',
  ];
  if (context.wheelchair) questions.push(kind === 'taxi' ? '이용자격·사전 회원등록·휠체어에 앉은 채 탑승·승하차 지원·동행인·차량 가능을 각각 확인해 주세요.' : '휠체어 대여·수령·반납과 승하차·이동 보조의 범위를 확인해 주세요.');
  return questions;
}

function supportCandidates(kind, context) {
  return getSupportCandidates(supportRegistry, {kind, area: context.area, wheelchair: context.wheelchair}).map(provider => ({
    ...clone(provider), source: {...provider.source, url: canonicalUrl(provider.source.url)}, availabilityVerified: false,
    conditions: [context.area ? `출발 지역: ${context.area}` : '출발 지역 미확인', context.wheelchair ? '휠체어 지원 필요; 자격·탑승·승하차·차량은 미확인' : '휠체어 조건: 현재 입력에서는 필요 없음', '등록 위치·서비스 안내와 실제 지원 관할은 별도 확인'],
    questions: questionsFor(kind, context),
  }));
}

function preparationActions(context, kinds = ['taxi', 'companion']) {
  if (!context.area) return [];
  return kinds.flatMap(kind => {
    const provider = supportCandidates(kind, context)[0];
    if (!provider) return [];
    const questions = questionsFor(kind, context);
    return [{
      kind, title: `${provider.name} 문의 초안 준비`, reason: `${provider.matchLabel}; 실제 제공·자격·시간·비용 미확인`,
      requestDraft: [`공개 문의처: ${provider.name} / ${provider.phone}`, `출발 지역: ${context.area}`, ...(context.hospitalName ? [`방문 기관: ${context.hospitalName}`] : []), ...questions, '실제 발신·예약·배차·동행 배정은 하지 않았습니다.'].join('\n'),
      tool: {name: 'prepare_inquiries', input: {kind, providerId: provider.id}},
    }];
  });
}

function baseAnalysis(analysis, inputs, title, scopeLabel) {
  return {version: 1, analysis, status: 'partial', title, scopeLabel, inputs, datasetRefs: [], rows: [], metrics: [], candidates: [], limitations: [...BASE_LIMITATIONS], missingData: [], preparationActions: [], ...flags()};
}

export function analyzePublicData(input, context = {}) {
  ensure(object(input) && ANALYSES.includes(input.analysis), '공공데이터 분석 종류를 확인해 주세요.');
  const ctx = operationalContext(context), {analysis} = input;
  const allowed = analysis === 'facility_compare' ? ['analysis', 'areas'] : analysis === 'support_candidates' ? ['analysis', 'area', 'supportKind', 'wheelchair'] : ['analysis', 'area'];
  ensure(Object.keys(input).every(key => allowed.includes(key)), '해당 분석에서 지원하는 조건만 지정해 주세요.');
  if (analysis === 'facility_compare') {
    ensure(Array.isArray(input.areas) && input.areas.length === 2, '비교할 제주 지역을 정확히 두 곳 지정해 주세요.');
    const areas = input.areas.map(value => areaOf(value));
    ensure(areas[0] !== areas[1], '서로 다른 두 지역을 지정해 주세요.');
    const granularities = [...new Set(areas.map(area => area.includes(' ') ? 'local' : 'city'))];
    const data = baseAnalysis(analysis, {areas}, '병원·돌봄 등록 주소의 관측 표본 비교', '의료와 돌봄을 별도 분모로 계산한 과거 공개 snapshot; 제주 전체 현황 아님');
    data.datasetRefs = ['hub:859', 'hub:254'].map(datasetRef);
    for (const kind of ['hospital', 'companion']) {
      const snapshots = new Map(granularities.map(granularity => [granularity, facilities(kind, granularity)]));
      data.metrics.push(...[...snapshots.values()].map(snapshot => snapshot.metrics));
      for (const area of areas) {
        const [city, local] = area.split(' ');
        const granularity = local ? 'local' : 'city', snapshot = snapshots.get(granularity);
        const observed = snapshot.located.filter(row => row.city === city && (!local || row.local === local)).length;
        data.rows.push({
          area, kind, kindLabel: snapshot.metrics.kindLabel, datasetId: snapshot.metrics.datasetId, observedCount: snapshot.metrics.denominator ? observed : null,
          denominator: snapshot.metrics.denominator, denominatorLabel: snapshot.metrics.denominatorLabel, granularity, addressBasis: snapshot.metrics.addressBasis,
          shareOfLocatedSnapshot: snapshot.metrics.denominator ? Number((observed / snapshot.metrics.denominator * 100).toFixed(2)) : null,
          shareUnit: 'percent', addressMissingRows: snapshot.metrics.addressMissingRows, unlocatedRows: snapshot.metrics.unlocatedRows, asOf: snapshot.metrics.coverage.asOf,
          coverageLabel: snapshot.metrics.coverage.label,
        });
      }
    }
    data.limitations.push(`같은 이름·확인된 주소의 중복을 자료별로 제외합니다. 병원 공개 ${hospitalSnapshot.totalPreviewRows}행 표본 중 폐업 ${hospitalSnapshot.excludedClosedRows || 0}행은 정제 단계에서 제외되었고 현재 정제 ${hospitalSnapshot.records.length}행을 조회합니다.`, '비율의 분모는 각 snapshot에서 해당 지역을 판별하는 데 필요한 시 또는 읍면동 주소를 확인한 행입니다. 의료·돌봄 분모를 합치지 않습니다.', '주소 미상·읍면동 미표기는 미관측이며 0개로 배정하지 않습니다. 관측 0행은 실제 시설 부재를 뜻하지 않습니다.', '관측 주소는 등록 위치이며 서비스 관할·현재 운영을 뜻하지 않습니다. 전체 밀도·인구당 수·지역 우열·임상 적합성을 추정할 수 없습니다.', '859의 공통 원자료 기준일은 없으며 행별 갱신범위·원자료 수집시점·snapshot 조회일을 구분합니다. 돌봄은 2020-04-17 기준의 과거 자료입니다.');
    if (granularities.length > 1) data.limitations.push('비교 지역의 행정수준이 시와 읍면동으로 다릅니다. 각 행은 필요한 주소 해상도의 관측수·분모·미표기 행을 별도로 표시하므로 비율이나 지역 우열을 직접 비교할 수 없습니다.');
    if (areas.some((area, index) => area.startsWith(areas[1 - index] + ' '))) data.limitations.push('두 비교지역은 포함 관계로 겹칩니다. 행을 상호 배타적인 두 집단으로 해석하지 않습니다.');
    if (data.metrics.some(metric => metric.unlocatedRows)) data.missingData.push('주소 미상 또는 비교 수준의 행정지역이 주소에 없는 행은 지역에 배정하지 못했습니다.');
    data.preparationActions = preparationActions(ctx);
    return data;
  }
  const area = input.area === undefined ? ctx.area : areaOf(input.area, true);
  const operating = {...ctx, area};
  const differentDeparture = Boolean(ctx.area && area && ctx.area !== area);
  if (analysis === 'public_health_contacts') {
    const contacts = getPublicHealthContacts(publicHealth, area);
    const data = baseAnalysis(analysis, {area}, '공공보건 행정·관할 확인 문의처', '2026-03-23 제주시 공공보건기관 등록 CSV; 실제 진료·협진·담당·운영 응대 확인 아님');
    data.datasetRefs = ['hub:1304'].map(datasetRef);
    const outsideCoverage = !area || area.startsWith('서귀포시');
    if (outsideCoverage) data.status = 'unavailable';
    data.metrics = [{key: 'registeredContactCount', value: outsideCoverage ? null : contacts.length, returned: Math.min(contacts.length, 5), sourceRows: publicHealth.dataset.sourceRows,
      matchCounts: outsideCoverage ? null : Object.fromEntries(['registered_jurisdiction', 'registered_address', 'city_contact'].map(level => [level, contacts.filter(contact => contact.matchLevel === level).length])),
      unit: '등록 문의처', label: '관할 문구·소재지·제주시 일원 등록의 문의 후보 수; 실제 담당/가용 기관 수 아님', ...publicHealth.quality}];
    data.candidates = contacts.slice(0, 5).map(contact => ({
      ...contact, kind: 'public_health', availabilityVerified: false,
      source: {datasetId: '1304', url: publicHealth.dataset.sourceUrl, hubUrl: publicHealth.dataset.hubUrl, scope: publicHealth.dataset.scope, asOf: publicHealth.dataset.asOf, retrievedAt: publicHealth.retrievedAt},
      questions: [
        `조회 지역 ${area}에서 등록 관할 '${contact.jurisdiction || '관할 미기재'}'의 담당 창구가 맞나요? 거주 리/동과 현재 담당지역을 확인해 주세요.`,
        contact.type === '건강생활지원센터' ? '건강생활지원 프로그램 안내·상담의 범위와 운영요일·시간을 확인해 주세요.' : '공공보건 행정·지역 지원 상담의 범위와 운영요일·시간·대리 문의 절차를 확인해 주세요.',
        '병원 진료·검사·의뢰/회송·의무기록 발급 업무를 여기서 처리할 수 있다고 가정하지 않습니다. 필요한 병원 접수 창구가 따로 있는지 확인해 주세요.',
        ...(!contact.phone ? ['원자료에 전화번호가 없어 공식 연락처 확인이 먼저 필요합니다.'] : []),
      ],
    }));
    data.limitations.push('제주시 자료35행의 등록 사실이며 서귀포시·제주 전체 의료기관 명부가 아닙니다. 이 행을 기존 병원13곳이나 돌봄19곳의 집계 분모에 합치지 않습니다.',
      '등록 관할 문구 일치와 등록 소재지 일치를 구분합니다. 소재지가 같아도 실제 담당지역·제공 업무가 확인된 것은 아닙니다. 리 단위 담당은 별도 문의합니다.',
      '공개 전화번호가 있다는 사실은 현재 운영·응대·진료/협진 제공·환자 수용·이용자격 확인이 아닙니다. 병원·택시·동행 도구에 이 문의처를 자동 배정하지 않습니다.');
    if (!area) data.missingData.push('공공보건 행정·관할 문의를 위해 조회할 시·읍면동이 필요합니다.');
    else if (area.startsWith('서귀포시')) data.missingData.push('현재 보유 파일은 제주시 범위입니다. 서귀포시 문의처가 관측되지 않은 것을 실제 기관 부재로 해석하지 않습니다.');
    else if (!contacts.length) data.missingData.push('이 지역과 연결되는 등록 관할·소재지를 현재 파일에서 찾지 못했습니다. 공식 담당 창구를 별도로 확인해야 합니다.');
    if (differentDeparture) data.missingData.push('조회 지역은 현재 방문의 출발지와 다릅니다. 조회만 수행했고 사례·기관 선택·문의 상태는 변경하지 않았습니다.');
    return data;
  }
  if (analysis === 'support_candidates') {
    const supportKind = input.supportKind ?? 'both';
    ensure(['taxi', 'companion', 'both'].includes(supportKind), '택시·병원동행·모두 중 문의 종류를 지정해 주세요.');
    if (input.wheelchair !== undefined) ensure(typeof input.wheelchair === 'boolean', '휠체어 조건은 참·거짓으로 지정해 주세요.');
    operating.wheelchair = input.wheelchair ?? ctx.wheelchair;
    const kinds = supportKind === 'both' ? ['taxi', 'companion'] : [supportKind];
    const groups = kinds.map(kind => ({kind, candidates: supportCandidates(kind, operating)}));
    const candidates = supportKind === 'both' ? Array.from({length: Math.max(...groups.map(group => group.candidates.length))}, (_, index) => groups.map(group => group.candidates[index]).filter(Boolean)).flat() : groups[0].candidates;
    const data = baseAnalysis(analysis, {area, supportKind, wheelchair: operating.wheelchair}, '이동·병원동행 문의 후보', '기존 registry의 지역·휠체어 조건에 따른 문의 우선순위; 현재 지원 확정 아님');
    data.candidates = candidates.slice(0, 5);
    data.metrics = groups.map(group => ({key: 'candidateCount', kind: group.kind, value: group.candidates.length, returned: data.candidates.filter(candidate => candidate.kind === group.kind).length, unit: '문의처', label: '기존 지역·지원 유형 필터의 문의 후보 수; 서비스 제공 수 아님'}));
    data.datasetRefs = [...new Set(kinds.flatMap(kind => kind === 'taxi' ? ['hub:327', 'official:jeju-accessible-transport'] : ['hub:254', 'official:areum-escort']))].map(datasetRef);
    data.limitations.push('후보 순서는 기존 getSupportCandidates와 같고 거리·수용·환자 적합성 점수가 아닙니다.', '돌봄 등록 문의처는 병원동행 제공·현재 인력 확보를 뜻하지 않습니다. 이용자격·회원등록·담당지역·비용은 별도 문의합니다.');
    if (!area) data.missingData.push('지역에 맞는 문의 준비를 위해 출발 읍면동을 확인해야 합니다.');
    if (!candidates.length) data.missingData.push('현재 정제 registry에 이 조건의 문의 후보가 없습니다. 실제 서비스 부재라는 뜻은 아닙니다.');
    const differentWheelchair = typeof context?.wheelchair === 'boolean' && input.wheelchair !== undefined && input.wheelchair !== ctx.wheelchair;
    data.preparationActions = differentDeparture || differentWheelchair ? [] : preparationActions(operating, kinds);
    if (differentDeparture) data.missingData.push('조회 지역과 현재 방문의 출발지가 다릅니다. 문의 준비를 잇기 전에 실제 출발지를 확인해야 합니다. 현재 사례는 변경하지 않았습니다.');
    if (differentWheelchair) data.missingData.push('조회한 휠체어 조건과 현재 방문의 조건이 다릅니다. 문의 준비를 잇기 전에 지원 조건을 확인해야 합니다. 현재 사례는 변경하지 않았습니다.');
    return data;
  }
  const data = baseAnalysis(analysis, {area}, '이동시간 원자료 추가 확인 필요', '센터 교통 명세만 확인; 현재 소요시간·평균·ETA 계산 불가');
  data.status = 'unavailable';
  data.datasetRefs = ['center:7', 'center:8', 'center:10'].map(datasetRef);
  data.limitations.push('센터7·8·10은 항목 명세만 있고 원자료는 미접근·현재 정제 저장소에 미탑재입니다. API 전반의 접근 불가나 권한 없음으로 단정하지 않습니다.', '실제 도로 연결·노드 좌표·날짜/시간대별 구간 소요시간과 단위·결측·노선 조건을 검증하기 전 평균·분 단위 시간·출발시각·ETA를 만들지 않습니다.');
  data.missingData = ['센터7: link_id·start_node_id·end_node_id 등 도로 구간 원자료와 연결 관계', '센터8: node_id·latitude·longitude 등 노드 좌표 원자료', '센터10: base_date·base_hour·link_id·average_speed·average_time 원자료, 시간 단위·집계 기준·기준일·결측', '출발·도착 지점, 방문일·진료시각, 승하차·휠체어·동행 조건과 지연 시 귀가 계획'];
  data.preparationActions = differentDeparture ? [] : preparationActions(operating, ['taxi']);
  if (differentDeparture) data.missingData.push('조회 지역과 현재 방문의 출발지가 다릅니다. 문의 준비를 잇기 전에 실제 출발지를 확인해야 합니다. 현재 사례는 변경하지 않았습니다.');
  return data;
}

export function getPreparationDataEvidence(context = {}, purpose) {
  ensure(PURPOSES.includes(purpose), '진료 준비 자료의 목적을 확인해 주세요.');
  const ctx = operationalContext(context);
  let refs, questions, actions = [], limitations = [...BASE_LIMITATIONS];
  if (purpose === 'hospital') {
    refs = ['hub:859'].map(datasetRef);
    questions = ['등록 진료과와 별도로 현재 접수 창구·진료 가능일·의뢰/회송 절차를 확인해 주세요.', '필요 서류·검사 원문·작성일·수신 방법과 수신 확인 담당자를 확인해 주세요. 진찰 소견·진료 수락·치료 판단은 의료진·기관 담당입니다.'];
    limitations.push(...hospitalSnapshot.limitations, '공개859 표본에 전화번호·현재 협진 수락·예약 가능일이 없습니다.');
  } else {
    const data = analyzePublicData(purpose === 'travel' ? {analysis: 'travel_time'} : {analysis: 'support_candidates', supportKind: purpose}, ctx);
    refs = data.datasetRefs; actions = data.preparationActions; limitations = data.limitations;
    questions = questionsFor(purpose === 'companion' ? 'companion' : 'taxi', ctx);
  }
  return {version: 1, purpose, datasetRefs: refs, limitations, questions, preparationActions: actions, ...flags()};
}
