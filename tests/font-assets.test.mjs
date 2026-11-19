import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, readdir, lstat, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { pythonCli } from '../scripts/python-cli.mjs';

const app = new URL('../app/', import.meta.url);
const directory = new URL('assets/pretendard/', app);
const cssName = 'pretendardvariable-dynamic-subset.css';
const fontNames = Array.from({length:92}, (_, index) => `woff2-dynamic-subset/PretendardVariable.subset.${index}.woff2`);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));

test('공식 패키지·OFL과 CSS 원문을 고정하고 family 별칭만 바꾼다', async () => {
  assert.deepEqual(manifest.package, {
    name:'pretendard', version:'1.3.9', url:'https://registry.npmjs.org/pretendard/-/pretendard-1.3.9.tgz',
    sha256:'0ffc240cee83be02520fb4ac1b2a0a51052b9d13506ade0ba90c591dbbb3bd53',
  });
  assert.equal(manifest.source.cssSha256, '2973bcae80262dcb630cfb793fbf6af29bd986c769ee54953fb3e5b3e32323ca');
  const css = await readFile(new URL(cssName, directory), 'utf8');
  assert.equal(sha256(css.replaceAll("font-family: 'Pretendard'", "font-family: 'Pretendard Variable'")), manifest.source.cssSha256);
  assert.equal((css.match(/font-family: 'Pretendard';/g) || []).length, 92);
  const faces = [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)];
  assert.equal(faces.length, 92);
  assert.deepEqual(faces.map(([, face]) => /src: url\(\.\/([^)]*)\)/.exec(face)?.[1]), fontNames);
  for (const [, face] of faces) {
    assert.match(face, /font-display: swap;/);
    const range = /unicode-range: ([^;]+);/.exec(face)?.[1];
    assert.ok(range);
    for (const token of range.split(',')) {
      const match = /^U\+([\da-f]+)(?:-([\da-f]+))?$/i.exec(token.trim());
      assert.ok(match);
      const low = parseInt(match[1], 16), high = parseInt(match[2] || match[1], 16);
      assert.ok(low >= 0 && low <= high && high <= 0x10ffff);
    }
  }
  assert.equal(manifest.license.path, '../Pretendard-LICENSE.txt');
  assert.equal(sha256(await readFile(new URL(manifest.license.path, directory))), 'b04538c9abec39a3db75108cf0af0fd9c77032fe8aa2cf38345b4d250e98e38e');
});

test('92개 WOFF2는 공식 원본의 파일명·바이너리와 일치한다', async () => {
  assert.deepEqual(manifest.files.map(file => file.path), [cssName, ...fontNames]);
  assert.deepEqual((await readdir(new URL('woff2-dynamic-subset/', directory))).sort(), fontNames.map(name => name.split('/').at(-1)).sort());
  const hashes = new Map();
  await Promise.all(manifest.files.map(async file => {
    const url = new URL(file.path, directory);
    assert.ok((await lstat(url)).isFile());
    const bytes = await readFile(url);
    assert.equal(bytes.length, file.bytes);
    assert.equal(sha256(bytes), file.sha256);
    if (file.path.endsWith('.woff2')) assert.equal(bytes.subarray(0, 4).toString(), 'wOF2');
    hashes.set(file.path, sha256(bytes));
  }));
  const originalSetSha256 = '21039a354646232cbc09c8177491579bbeb7aa888ec51c709abe749a1cdcd786';
  assert.equal(manifest.source.woff2SetSha256, originalSetSha256);
  assert.equal(sha256(fontNames.map(name => `${name}\0${hashes.get(name)}\n`).join('')), originalSetSha256);
});

test('첫 화면은 자체 호스팅 분할 CSS를 쓰고 전체 폰트 preload·참조를 남기지 않는다', async () => {
  const html = await readFile(new URL('index.html', app), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="\/assets\/pretendard\/pretendardvariable-dynamic-subset\.css"\s*\/>/);
  for (const [link] of html.matchAll(/<link\b[^>]*>/g)) assert.ok(!(/rel="preload"/.test(link) && /as="font"/.test(link)));
  for (const name of (await readdir(app)).filter(name => /\.(?:html|css|js)$/.test(name))) {
    assert.doesNotMatch(await readFile(new URL(name, app), 'utf8'), /\/assets\/PretendardVariable\.woff2/);
  }
  await assert.rejects(access(new URL('assets/PretendardVariable.woff2', app)));
  const css = await readFile(new URL('conversation.css', app), 'utf8');
  assert.match(css, /@font-face\{font-family:MaruBuri;src:url\('\/assets\/MaruBuri-SemiBold\.woff2'\)[^}]*font-display:swap\}/);
});

test('재현 도구는 다른 패키지를 자산 쓰기 전에 거부한다', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'hondi-font-assets-'));
  t.after(() => rm(temporary, {recursive:true, force:true}));
  const archive = join(temporary, 'untrusted.tgz'), output = join(temporary, 'assets');
  await writeFile(archive, 'synthetic invalid font package');
  await mkdir(output);
  await writeFile(join(output, cssName), '기존 자산');
  const result = spawnSync(pythonCli(), [fileURLToPath(new URL('../scripts/prepare-fonts.py', import.meta.url)), archive, '--output', output], {encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'},windowsHide:true});
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /공식 pretendard 1\.3\.9 패키지 해시가 아닙니다/);
  assert.deepEqual(await readdir(output), [cssName]);
  assert.equal(await readFile(join(output, cssName), 'utf8'), '기존 자산');
});
