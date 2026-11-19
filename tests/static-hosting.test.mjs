import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, cp } from 'node:fs/promises';
import { createFixtureLink } from './helpers/fixture-link.mjs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSite } from '../scripts/build.mjs';

async function fixture(t) {
  const project = await mkdtemp(join(tmpdir(), 'jeju-static-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(join(project, 'app'), { recursive: true });
  await mkdir(join(project, 'node_modules/leaflet/dist'), { recursive: true });
  await writeFile(join(project, 'app/index.html'), '<!doctype html><title>합성 시연</title>');
  await writeFile(join(project, 'app/app.js'), 'export const simulation = true;');
  await writeFile(join(project, 'node_modules/leaflet/dist/leaflet.js'), '/* fixture */');
  await writeFile(join(project, 'node_modules/leaflet/LICENSE'), 'fixture license');
  return project;
}

test('정적 호스팅은 시연 설정·상태·동일 커밋 버전과 원 라이선스를 포함한다', async t => {
  const project = await fixture(t);
  await buildSite({ projectRoot: project, revision: 'a'.repeat(40), builtAt: '2026-10-31T00:00:00Z' });
  const read = async path => JSON.parse(await readFile(join(project, 'dist', path), 'utf8'));
  assert.deepEqual(await read('api/config'), { mode: 'simulation', tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' });
  assert.deepEqual(await read('api/health'), { ok: true, mode: 'simulation', runtime: 'static', phoneConnected: false, medicalRecordTransfer: false });
  assert.deepEqual(await read('deployment.json'), { revision: 'a'.repeat(40), builtAt: '2026-10-31T00:00:00.000Z', mode: 'simulation' });
  assert.equal(await readFile(join(project, 'dist/vendor/leaflet/LICENSE.txt'), 'utf8'), 'fixture license');
  assert.match(await readFile(join(project, 'dist/index.html'), 'utf8'), /합성 시연/);
});

test('정적 출력에는 환경의 인증정보나 앱 폴더의 .env가 포함되지 않는다', async t => {
  const project = await fixture(t);
  const privateText = 'test-only-' + 'secret-value';
  await writeFile(join(project, 'app/.env'), privateText);
  const previous = process.env.AWS_SECRET_ACCESS_KEY;
  process.env.AWS_SECRET_ACCESS_KEY = privateText;
  try {
    await buildSite({ projectRoot: project, revision: 'test' });
    await assert.rejects(access(join(project, 'dist/.env')));
    for (const path of ['api/config', 'api/health', 'deployment.json']) assert.ok(!(await readFile(join(project, 'dist', path), 'utf8')).includes(privateText));
  } finally {
    if (previous === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = previous;
  }
});

test('잘못된 출력·비공개 URL·버전 입력은 기존 파일을 지우기 전에 거부한다', async t => {
  const project = await fixture(t);
  await mkdir(join(project, 'dist')); await writeFile(join(project, 'dist/sentinel'), '기존 빌드');
  for (const options of [{ outputDirectory: project }, { outputDirectory: join(project, 'app') }, { tileUrl: 'https://user:password@example.com/{z}/{x}/{y}.png' }, { tileUrl: 'http://example.com/{z}/{x}/{y}.png' }, { revision: 'wrong\nrevision' }]) {
    await assert.rejects(buildSite({ projectRoot: project, ...options }));
    assert.equal(await readFile(join(project, 'dist/sentinel'), 'utf8'), '기존 빌드');
  }
});

test('앱 밖 파일로 향하는 심볼릭 링크를 게시용 빌드에 복사하지 않는다', async t => {
  for (const type of ['file','dir']) {
    await t.test(type,async child=>{
      const project=await fixture(child);
      const privateDirectory=join(project,'private');
      const privateFile=join(privateDirectory,'private.txt');
      await mkdir(privateDirectory);
      await writeFile(privateFile,'fixture only');
      const target=type==='dir'?privateDirectory:privateFile;
      if (!await createFixtureLink(child,target,join(project,'app/linked-entry'),type)) return;
      await assert.rejects(buildSite({projectRoot:project}),/심볼릭 링크/);
      await assert.rejects(access(join(project,'dist/linked-entry')));
    });
  }
});

test('공식 분할 폰트 CSS·92개 WOFF2·명세·OFL을 정적 빌드에 보존한다', async t => {
  const project = await fixture(t);
  await mkdir(join(project, 'app/assets'), {recursive:true});
  await cp(new URL('../app/assets/pretendard/', import.meta.url), join(project, 'app/assets/pretendard'), {recursive:true});
  await cp(new URL('../app/assets/Pretendard-LICENSE.txt', import.meta.url), join(project, 'app/assets/Pretendard-LICENSE.txt'));
  await cp(new URL('../app/index.html', import.meta.url), join(project, 'app/index.html'));
  await buildSite({projectRoot:project, revision:'font-assets'});
  const directory = join(project, 'dist/assets/pretendard');
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files.length, 93);
  for (const file of manifest.files) {
    const bytes = await readFile(join(directory, file.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  const license = await readFile(join(directory, manifest.license.path));
  assert.equal(createHash('sha256').update(license).digest('hex'), manifest.license.sha256);
  assert.match(await readFile(join(project, 'dist/index.html'), 'utf8'), /\/assets\/pretendard\/pretendardvariable-dynamic-subset\.css/);
});
