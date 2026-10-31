import { cp, mkdir, rm, access, writeFile, mkdtemp, rename, lstat } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultTileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** 정적 호스팅용 공개 데이터만 생성한다. 인증·환자 데이터는 읽지 않는다. */
export async function buildSite({
  projectRoot = root,
  outputDirectory,
  tileUrl = process.env.MAP_TILE_URL || defaultTileUrl,
  revision = process.env.APP_REVISION || process.env.GITHUB_SHA || 'local',
  builtAt = new Date().toISOString(),
} = {}) {
  const project = resolve(projectRoot);
  const output = resolve(outputDirectory || resolve(project, 'dist'));
  if (output !== resolve(project, 'dist')) throw new Error('빌드 출력은 해당 프로젝트의 dist 디렉터리만 사용할 수 있습니다.');
  let tile;
  try { tile = new URL(tileUrl); } catch { throw new Error('공개 지도 타일 URL 형식을 확인해 주세요.'); }
  if (tile.protocol !== 'https:' || tile.username || tile.password || !['{x}', '{y}', '{z}'].every(token => tileUrl.includes(token))) {
    throw new Error('지도 타일은 인증정보 없는 HTTPS 템플릿 URL이어야 합니다.');
  }
  if (typeof revision !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(revision)) throw new Error('공개 빌드 버전 형식을 확인해 주세요.');
  if (typeof builtAt !== 'string' || Number.isNaN(Date.parse(builtAt))) throw new Error('빌드 시각 형식을 확인해 주세요.');
  await access(resolve(project, 'app/index.html'));
  await access(resolve(project, 'node_modules/leaflet/dist/leaflet.js'));
  await access(resolve(project, 'node_modules/leaflet/LICENSE'));
  const staging = await mkdtemp(resolve(project, '.jeju-build-'));
  try {
    const filter = async source => {
      const name = basename(source);
      if (name.startsWith('.env') || ['.git', 'node_modules'].includes(name)) return false;
      if ((await lstat(source)).isSymbolicLink()) throw new Error('빌드 입력의 심볼릭 링크는 허용하지 않습니다.');
      return true;
    };
    await cp(resolve(project, 'app'), staging, { recursive: true, filter });
    await cp(resolve(project, 'node_modules/leaflet/dist'), resolve(staging, 'vendor/leaflet'), { recursive: true, filter });
    await cp(resolve(project, 'node_modules/leaflet/LICENSE'), resolve(staging, 'vendor/leaflet/LICENSE.txt'));
    const config = { mode: 'simulation', tileUrl };
    // S3에 저장된 상태 객체다. 실제 Node 서버·의료기관 상태 점검 결과가 아니다.
    const health = { ok: true, mode: 'simulation', runtime: 'static', phoneConnected: false, medicalRecordTransfer: false };
    const deployment = { revision, builtAt: new Date(builtAt).toISOString(), mode: 'simulation' };
    await mkdir(resolve(staging, 'api'), { recursive: true });
    for (const [name, value] of [['api/config', config], ['api/health', health], ['deployment.json', deployment]]) {
      await writeFile(resolve(staging, name), JSON.stringify(value, null, 2) + '\n');
    }
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
    return { directory: output, config, health, deployment };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildSite();
  console.log('정적 빌드 완료: dist/ (공개 시연 JSON·Leaflet 및 라이선스 포함)');
}
