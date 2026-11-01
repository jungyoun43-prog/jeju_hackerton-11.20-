import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseSupportCsv} from '../app/support-data.js';
import {createPublicHealthSnapshot} from '../app/public-health-data.js';

export const VERIFIED_PUBLIC_HEALTH_FILE = Object.freeze({
  url: 'https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003623925&fileDetailSn=1&dataNm=%EC%A0%9C%EC%A3%BC%ED%8A%B9%EB%B3%84%EC%9E%90%EC%B9%98%EB%8F%84_%EC%A0%9C%EC%A3%BC%EC%8B%9C_%EB%B3%B4%EA%B1%B4%EC%A7%80%EC%86%8C%EB%93%B1%ED%98%84%ED%99%A9_20260323',
  fileName: '제주특별자치도_제주시_보건지소등현황_20260323.csv',
  sha256: 'e2ac77a972f8cde38ee4cfb46c149f9f495fe5739eff0d8343563ddb93aab510', rowCount: 35,
});

export function snapshotFromPublicHealthFile(bytes, retrievedAt) {
  if (bytes.length > 2 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== VERIFIED_PUBLIC_HEALTH_FILE.sha256) throw new Error('확인한 공식 파일의 SHA-256과 다릅니다. 원출처·기준일·이용조건을 다시 검토한 뒤 수집 설정을 갱신하세요.');
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { text = new TextDecoder('euc-kr', {fatal: true}).decode(bytes); }
  const rows = parseSupportCsv(text);
  if (rows.length !== VERIFIED_PUBLIC_HEALTH_FILE.rowCount) throw new Error('확인한 공개 파일의 행수와 다릅니다.');
  return createPublicHealthSnapshot({rows, retrievedAt, fileName: VERIFIED_PUBLIC_HEALTH_FILE.fileName, fileSha256: VERIFIED_PUBLIC_HEALTH_FILE.sha256});
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--fetch', '--input', '--retrieved-at', '--output'].includes(key) || Object.hasOwn(options, key)) throw new Error('공공보건기관 수집 옵션을 확인하세요.');
    if (key === '--fetch') options[key] = true;
    else {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('수집 옵션의 값이 필요합니다.');
      options[key] = args[++index];
    }
  }
  if (Boolean(options['--fetch']) === Boolean(options['--input']) || options['--fetch'] && options['--retrieved-at'] || options['--input'] && !options['--retrieved-at']) throw new Error('node scripts/public-health-data.mjs --fetch [--output 출력.json] 또는 --input 공식CSV --retrieved-at 실제조회시각 [--output 출력.json]');
  let bytes, retrievedAt;
  if (options['--fetch']) {
    const response = await fetch(VERIFIED_PUBLIC_HEALTH_FILE.url, {redirect: 'error', signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`공식 공개 파일 조회 실패: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    retrievedAt = new Date().toISOString();
  } else {
    if (basename(options['--input']) !== VERIFIED_PUBLIC_HEALTH_FILE.fileName) throw new Error('확인한 원본 파일명이 필요합니다.');
    bytes = await readFile(resolve(options['--input'])); retrievedAt = options['--retrieved-at'];
  }
  const snapshot = snapshotFromPublicHealthFile(bytes, retrievedAt);
  const destination = resolve(options['--output'] || 'app/data/public-health-contacts.json');
  await mkdir(dirname(destination), {recursive: true});
  await writeFile(destination, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`공공보건기관 ${snapshot.records.length}개 최소 사실 변환 완료: ${destination}`);
  console.log('확인한 2026-03-23 파일을 재취득한 결과입니다. 원문 CSV·환자정보·실시간 운영/수용 정보는 저장하지 않습니다.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {console.error(error.message); process.exitCode = 1;});
