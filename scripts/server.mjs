import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--dist');
const root = resolve(project, production ? 'dist' : 'app');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const mime = {'.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json',
  '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.txt':'text/plain'};

const server = createServer(async (req, res) => {
  const json = (status, value) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!['GET','HEAD'].includes(req.method)) return json(405, {error:'지원하지 않는 요청입니다.'});
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    if (path === '/api/health') return json(200, {ok:true, mode:'simulation', runtime:'node', phoneConnected:false, medicalRecordTransfer:false});
    if (path === '/api/config') return json(200, {mode:'simulation', tileUrl:process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'});
    let base = root;
    let relative = path === '/' ? 'index.html' : path.slice(1);
    if (!production && path.startsWith('/vendor/leaflet/')) {
      base = resolve(project, 'node_modules/leaflet/dist');
      relative = path.slice('/vendor/leaflet/'.length);
    }
    const target = resolve(base, relative);
    if (target !== base && !target.startsWith(base + sep)) return json(403, {error:'접근할 수 없는 경로입니다.'});
    const extension = extname(target);
    if (!mime[extension] || !(await stat(target)).isFile()) return json(404, {error:'파일을 찾을 수 없습니다.'});
    const contents = await readFile(target);
    res.writeHead(200, {'Content-Type':`${mime[extension]}${['.html','.css','.js','.json'].includes(extension) ? '; charset=utf-8' : ''}`, 'Cache-Control': extension === '.html' || !production ? 'no-cache' : 'public, max-age=3600'});
    res.end(req.method === 'HEAD' ? undefined : contents);
  } catch (error) {
    if (error instanceof URIError) return json(400, {error:'주소 형식이 올바르지 않습니다.'});
    if (['ENOENT','ENOTDIR'].includes(error.code)) return json(404, {error:'파일을 찾을 수 없습니다.'});
    console.error('요청 처리 실패:', error.code || error.name);
    json(500, {error:'파일을 불러오지 못했습니다.'});
  }
});
server.listen(port, host, () => console.log(`제주 진료 나침반 · 시연 모드\nLocal: http://${host}:${server.address().port}\n${production ? '빌드 결과' : '개발 화면'} · 실제 전화·의료기관 전송 없음`));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `${port}번 포트가 사용 중입니다. PORT 환경변수로 변경하세요.` : error.message); process.exitCode = 1; });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
