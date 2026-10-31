import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseSupportCsv} from '../app/support-data.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const auditDate = '2026-10-31';
const files = {
  hub: 'research/datahub_catalog_screening_2026-10-31.csv',
  center: 'research/center_schema_index_2026-10-31.csv',
  health: 'research/health_catalog_screening_2026-10-31.csv',
};
const usage = '사용법: node scripts/public-data-catalog.mjs [--check] [--output 출력.json] (기존 감사 CSV의 오프라인 재색인; API·원자료 갱신 아님)';
const options = {check: false, output: resolve(root, 'app/data/public-data-catalog.json')};
for (let index = 0; index < process.argv.slice(2).length; index++) {
  const args = process.argv.slice(2), arg = args[index];
  if (arg === '--help') { console.log(usage); process.exit(0); }
  if (arg === '--check' && !options.check) options.check = true;
  else if (arg === '--output' && args[index + 1] && !args[index + 1].startsWith('--')) options.output = resolve(args[++index]);
  else throw new Error(usage);
}

function officialUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'jejudatahub.net' || url.username || url.password) throw new Error('기존 감사 CSV의 공식 출처를 확인하세요.');
  return url.href;
}

function classify(row) {
  const title = row.title.trim(), group = row.screening_group || row.group || '', category = row.category || '';
  let folder = '기타';
  if (/의료기관·|의료이용·|약국·/.test(group) || (row.catalog === 'center' && /의료|병원|보건/.test(title))) folder = '의료';
  else if (/노인·장애·|여성·아동·/.test(group) || (row.catalog === 'center' && /돌봄|복지/.test(title))) folder = '돌봄';
  else if (/교통|도로|택시/.test(category) && !/관광지 무장애/.test(group)) folder = '이동';
  else if (!category && !group) folder = '미분류';
  const tags = [folder];
  if (/의료|병원|의원|보건/.test(title)) tags.push('의료기관');
  if (/돌봄|노인|요양/.test(title)) tags.push('돌봄문의');
  if (/장애|교통약자|무장애/.test(title + group)) tags.push('접근지원');
  if (/택시/.test(title)) tags.push('택시');
  if (/도로|교통량|속도|소요시간/.test(title)) tags.push('이동시간');
  if (group === '관광지 무장애 자료') tags.push('관광무장애');
  if (row.catalog === 'center') tags.push('항목명세');
  return {folder, tags: [...new Set(tags)]};
}

try {
  const [hub, center, health] = await Promise.all(Object.values(files).map(async file => parseSupportCsv(await readFile(resolve(root, file), 'utf8'))));
  if (hub.length !== 1259 || center.length !== 70 || health.length !== 198) throw new Error('2026-10-31 감사 CSV의 범위(허브1,259·센터70·보건복지198)가 다릅니다. 새 감사 범위는 별도 확인하세요.');
  const healthById = new Map(health.map(row => [row.id, row]));
  const records = [...hub, ...center].map(row => {
    if (!/^\d+$/.test(row.id) || !row.title.trim() || !['hub', 'center'].includes(row.catalog)) throw new Error('목록 식별자·제목·출처를 확인하세요.');
    const review = row.catalog === 'hub' ? healthById.get(row.id) : undefined;
    return {
      id: `${row.catalog}:${row.id}`, title: row.title.trim(), ...classify(row), sourceSystem: row.catalog,
      sourceUrl: officialUrl(row.source_url),
      columns: row.columns ? row.columns.split('|').map(value => value.trim()).filter(Boolean) : [],
      metadataUpdated: row.metadata_updated || null,
      detailChecked: row.detail_checked === 'True' || review?.detailChecked === 'True',
      latestLinkedFileChecked: row.latest_linked_file_checked === 'True' || review?.linkedLatestCsvChecked === 'True',
    };
  });
  records.push({
    id: 'official:areum-escort', title: '제주시니어클럽 아름동행', folder: '돌봄', tags: ['돌봄', '병원동행', '공식서비스안내'],
    sourceSystem: 'official', sourceUrl: 'https://www.jjcsc.co.kr/Business/Market', columns: ['서비스 소개', '대표문의처'], metadataUpdated: null, detailChecked: true, latestLinkedFileChecked: false,
  }, {
    id: 'official:jeju-accessible-transport', title: '제주 교통약자 이동지원센터', folder: '이동', tags: ['이동', '교통약자', '휠체어', '공식서비스안내'],
    sourceSystem: 'official', sourceUrl: 'https://www.jejuhappycall.com/?mcode=guide01', columns: ['이용대상 안내', '회원등록 안내', '대표문의처'], metadataUpdated: null, detailChecked: true, latestLinkedFileChecked: false,
  });
  records.sort((a, b) => a.id.localeCompare(b.id, 'en', {numeric: true}));
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error('출처별 카탈로그 식별자가 중복되었습니다.');
  const catalog = {
    version: 1, indexedMetadataCount: hub.length + center.length, sourceCounts: {hub: hub.length, center: center.length},
    supplementaryOfficialSourceCount: 2, auditedAt: auditDate, reindexMode: 'offline-audit-csv', metadataSourceFiles: files,
    limitations: [
      '기존 감사 CSV를 오프라인으로 재색인한 목록이며 실API·원자료를 갱신하지 않았습니다.',
      '목록 수정일·최신 연결 파일 확인 여부는 현재 정제 저장소의 원자료 보유·기준일·행 수와 다릅니다.',
      '의료·돌봄·이동 폴더와 태그는 진료 준비용 목록 분류이며 기관의 서비스 관할·수용·예약 확인이 아닙니다.',
    ], records,
  };
  const output = JSON.stringify(catalog, null, 2) + '\n';
  if (options.check) {
    if (await readFile(options.output, 'utf8') !== output) throw new Error('카탈로그가 기존 감사 CSV와 다릅니다. 오프라인 재색인 명령으로 다시 생성하세요.');
    console.log(`오프라인 색인 일치: 허브 ${hub.length} + 센터 ${center.length} = ${catalog.indexedMetadataCount}개, 별도 공식 안내 2건. API·원자료 갱신 없음.`);
  } else {
    await mkdir(dirname(options.output), {recursive: true});
    await writeFile(options.output, output);
    console.log(`오프라인 색인 생성: 허브 ${hub.length} + 센터 ${center.length} = ${catalog.indexedMetadataCount}개, 별도 공식 안내 2건. API·원자료 갱신 없음.`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
