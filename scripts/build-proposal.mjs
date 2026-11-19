import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const htmlPath = join(docs, 'submission-proposal.html');
const pdfPath = join(docs, 'submission-proposal.pdf');
const evidence = join(docs, 'reviews', '2026-11-19-submission');
const run = promisify(execFile);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function browserPath() {
  const configured = process.env.CHROMIUM_PATH;
  if (configured) {
    await access(configured);
    return resolve(configured);
  }
  const candidates = [];
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      candidates.push(join(base, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable', '/usr/bin/microsoft-edge', '/snap/bin/chromium');
  }
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  throw new Error('Chrome, Edge 또는 Chromium의 실행 파일을 CHROMIUM_PATH로 지정해 주세요.');
}

const html = await readFile(htmlPath, 'utf8');
const sheets = Array.from(html.matchAll(/<section\b[^>]*\bclass="sheet(?:\s[^"]*)?"/g)).length;
if (!sheets || sheets > 15) throw new Error('기획서 분량은 1~15쪽이어야 합니다.');
for (const [, file] of html.matchAll(/\b(?:src="([^"]+)")/g)) {
  if (isAbsolute(file) || /^\w+:/.test(file)) throw new Error('이미지에는 제출물 안의 상대 경로만 사용할 수 있습니다.');
  await access(resolve(docs, file));
}
const manifest = JSON.parse(await readFile(join(evidence, 'screenshots.json'), 'utf8'));
for (const shot of manifest.images) {
  const bytes = await readFile(join(evidence, shot.file));
  if (hash(bytes) !== shot.sha256) throw new Error(`검증 화면 해시가 일치하지 않습니다: ${shot.file}`);
}
const fontDir = join(root, 'app', 'assets', 'pretendard');
await access(join(root, 'app', 'assets', 'JejuGothic.ttf'));
const fontCSS = await readFile(join(fontDir, 'pretendardvariable-dynamic-subset.css'), 'utf8');
const fontFiles = Array.from(fontCSS.matchAll(/url\(["']?([^)'"]+)/g), match => match[1]);
await Promise.all(fontFiles.map(file => access(resolve(fontDir, file))));

const browser = await browserPath();
const profile = await mkdtemp(join(tmpdir(), 'hondi-pdf-profile-'));
// The temporary PDF and final PDF share a volume, so a failed render preserves the existing document.
const staging = await mkdtemp(join(docs, '.hondi-proposal-'));
const temporaryPDF = join(staging, 'proposal.pdf');
try {
  await run(browser, [
    '--headless', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', '--disable-component-update',
    '--host-resolver-rules=MAP * ~NOTFOUND', '--allow-file-access-from-files',
    '--run-all-compositor-stages-before-draw', '--virtual-time-budget=3500',
    '--no-pdf-header-footer', `--user-data-dir=${profile}`, `--print-to-pdf=${temporaryPDF}`,
    pathToFileURL(htmlPath).href,
  ], { timeout: 90_000, windowsHide: true });
  const bytes = await readFile(temporaryPDF);
  const data = bytes.toString('latin1');
  const printedPages = Array.from(data.matchAll(/\/Type\s*\/Page\b/g)).length;
  if (!data.startsWith('%PDF-') || printedPages !== sheets) {
    throw new Error(`HTML ${sheets}쪽, PDF ${printedPages}쪽으로 출력 결과를 확인해야 합니다.`);
  }
  await rename(temporaryPDF, pdfPath);
  console.log(`docs/submission-proposal.pdf · ${printedPages}쪽 · SHA-256 ${hash(bytes)}`);
} finally {
  await Promise.all([staging, profile].map(path => rm(path, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })));
}
