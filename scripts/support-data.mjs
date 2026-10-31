import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname, basename} from 'node:path';
import {createHash} from 'node:crypto';
import {createSupportRegistry, parseSupportCsv} from '../app/support-data.js';

const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--taxi-csv', '--care-json', '--output', '--retrieved-at', '--source-file-name'].includes(args[index]) || !args[index + 1]) throw new Error('사용법: node scripts/support-data.mjs --taxi-csv 공식파일.csv --care-json 허브254.json [--retrieved-at 조회일] [--source-file-name 원본파일명] [--output 출력.json]');
  options[args[index]] = args[index + 1];
}
if (!options['--taxi-csv'] || !options['--care-json'] || !options['--retrieved-at']) throw new Error('공식 콜택시 CSV·허브254 공개 응답 JSON·실제 조회일 --retrieved-at을 지정하세요.');
const taxiBytes = await readFile(resolve(options['--taxi-csv']));
let text;
try { text = new TextDecoder('utf-8', {fatal: true}).decode(taxiBytes); }
catch { text = new TextDecoder('euc-kr', {fatal: true}).decode(taxiBytes); }
const registry = createSupportRegistry({
  taxiRows: parseSupportCsv(text), careResponse: JSON.parse(await readFile(resolve(options['--care-json']), 'utf8')),
  retrievedAt: options['--retrieved-at'] || '', taxiFileName: options['--source-file-name'] || basename(options['--taxi-csv']),
  taxiFileSha256: createHash('sha256').update(taxiBytes).digest('hex'),
});
const destination = resolve(options['--output'] || 'app/data/visit-support-providers.json');
await mkdir(dirname(destination), {recursive: true});
await writeFile(destination, JSON.stringify(registry, null, 2) + '\n');
console.log(`이동·동행 문의처 ${registry.providers.length}개 변환: ${destination}`);
console.log('공식 연락처·등록 사실이며 실제 배차·동행 가능·예약 확정 정보가 아닙니다.');
