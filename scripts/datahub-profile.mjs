import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DATASET, summarizeHospitalRecords } from '../app/datahub.js';

const args = process.argv.slice(2);
const hasFetch = args.includes('--fetch');
const inputAt = args.indexOf('--input');
const outputAt = args.indexOf('--output');
const output = outputAt >= 0 ? args[outputAt + 1] : new URL('../app/data/datahub-profile.json', import.meta.url).pathname;
try {
  if (hasFetch === (inputAt >= 0) || !output || (inputAt >= 0 && !args[inputAt + 1]) || args.some((arg, index) => !['--fetch', '--input', '--output'].includes(arg) && index !== inputAt + 1 && index !== outputAt + 1)) throw new Error('사용법: node scripts/datahub-profile.mjs (--fetch | --input JSON경로) [--output 집계JSON경로]');
  let envelope;
  const fetchedAt = new Date().toISOString();
  if (hasFetch) {
    const response = await fetch(DATASET.previewUrl, { signal: AbortSignal.timeout(20000), credentials: 'omit' });
    if (!response.ok) throw new Error(`공개 메타데이터 조회 실패 (${response.status})`);
    const body = await response.text();
    if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error('공개 미리보기 응답이 허용 크기를 초과했습니다.');
    envelope = JSON.parse(body);
  } else envelope = JSON.parse(await readFile(resolve(args[inputAt + 1]), 'utf8'));
  // 실제 공개 응답은 최상위 id/title/csvData 구조다. 운영 API나 dataApi.url을 호출하지 않는다.
  if (!envelope || envelope.id !== 859 || envelope.title !== DATASET.name || !Array.isArray(envelope.csvData)) throw new Error('허브 859 공개 메타데이터의 id/title/csvData 구조가 아닙니다.');
  const profile = summarizeHospitalRecords(envelope.csvData, { scope: 'public-preview-aggregates', fetchedAt: hasFetch ? fetchedAt : (typeof envelope.fetchedAt === 'string' ? envelope.fetchedAt : '') });
  profile.generatedAt = fetchedAt;
  profile.dataset.pageModifiedAt = envelope.updateAt || null;
  profile.dataset.displayedCollectionPeriod = { start: envelope.startDate || null, end: envelope.endDate || null };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(profile, null, 2)}\n`);
  console.log(`집계 ${profile.totalRows}행 분석 완료: 정상등록 ${profile.activeRegistrationRows}, 폐업 ${profile.closedRows}. 원자료 저장 없음. 집계 공개 재배포 권한은 미확인입니다.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
