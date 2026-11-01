import {searchPublicDataCatalog, analyzePublicData, getPreparationDataEvidence} from '../app/public-data-skill.js';

const usage = `키·네트워크 없이 기존 정제 snapshot을 조회합니다. 원자료·실시간 API 갱신이 아닙니다.
node scripts/public-data-query.mjs search --purpose hospital [--query 의료] [--limit 5]
node scripts/public-data-query.mjs analyze --analysis facility_compare --areas 제주시,서귀포시
node scripts/public-data-query.mjs analyze --analysis support_candidates --area "제주시 애월읍" [--support-kind taxi|companion|both] [--wheelchair true|false]
node scripts/public-data-query.mjs analyze --analysis travel_time --area "제주시 애월읍"
node scripts/public-data-query.mjs analyze --analysis public_health_contacts --area "제주시 애월읍"
node scripts/public-data-query.mjs evidence --purpose taxi --area "제주시 애월읍" [--wheelchair true|false]`;

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help') { console.log(usage); process.exit(0); }
  if (!['search', 'analyze', 'evidence'].includes(command)) throw new Error(usage);
  const allowed = command === 'search' ? ['--purpose', '--query', '--limit'] : command === 'evidence' ? ['--purpose', '--area', '--wheelchair'] : ['--analysis', '--areas', '--area', '--support-kind', '--wheelchair'];
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!allowed.includes(key) || Object.hasOwn(options, key) || args[index + 1] === undefined || args[index + 1].startsWith('--')) throw new Error(usage);
    options[key] = args[index + 1];
  }
  const bool = value => {
    if (!['true', 'false'].includes(value)) throw new Error('휠체어 조건은 true 또는 false로 지정하세요.');
    return value === 'true';
  };
  let data;
  if (command === 'search') data = searchPublicDataCatalog({purpose: options['--purpose'], ...(options['--query'] !== undefined ? {query: options['--query']} : {}), ...(options['--limit'] !== undefined ? {limit: Number(options['--limit'])} : {})});
  else if (command === 'evidence') data = getPreparationDataEvidence({area: options['--area'] || '', wheelchair: options['--wheelchair'] === undefined ? false : bool(options['--wheelchair'])}, options['--purpose']);
  else data = analyzePublicData({
    analysis: options['--analysis'],
    ...(options['--areas'] !== undefined ? {areas: options['--areas'].split(',').map(value => value.trim())} : {}),
    ...(options['--area'] !== undefined ? {area: options['--area']} : {}),
    ...(options['--support-kind'] !== undefined ? {supportKind: options['--support-kind']} : {}),
    ...(options['--wheelchair'] !== undefined ? {wheelchair: bool(options['--wheelchair'])} : {}),
  });
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
} catch (error) { console.error(error.message); process.exitCode = 1; }
