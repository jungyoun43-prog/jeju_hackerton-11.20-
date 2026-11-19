import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAgentRequest } from '../agent/handler.mjs';
import { createRealtimeService } from '../agent/realtime-session.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--dist');
const root = resolve(project, production ? 'dist' : 'app');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const realtime=createRealtimeService();
let nextHandler;
if(process.argv.includes('--next')) {
  const {default:next}=await import('next');
  const web=next({dev:true,dir:resolve(project,'web'),hostname:host,port});
  await web.prepare();
  nextHandler=web.getRequestHandler();
}
const mime = {'.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json',
  '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.ttf':'font/ttf', '.txt':'text/plain'};

const server = createServer(async (req, res) => {
  const json = (status, value) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    if(path.startsWith('/api/voice/')) {
      const cancellation=new AbortController();let voiceToken;
      res.once('close',()=>{if(!res.writableFinished){cancellation.abort();if(voiceToken)void realtime.end(voiceToken);}});
      const chunks=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>32768)return json(413,{error:{code:'VOICE_INVALID_REQUEST',message:'음성 연결 요청이 너무 큽니다.'}});chunks.push(chunk);}
      const result=await realtime.handle({method:req.method,path,body:Buffer.concat(chunks).toString('utf8'),headers:req.headers,signal:cancellation.signal});
      if(result.statusCode===200&&path.endsWith('/session'))voiceToken=JSON.parse(result.body).token;
      if(cancellation.signal.aborted||res.destroyed){if(voiceToken)await realtime.end(voiceToken);return;}
      res.writeHead(result.statusCode,result.headers);return res.end(result.body);
    }
    if(path==='/api/agent' || path.startsWith('/api/agent/')) {
      const chunks=[];let length=0;
      for await(const chunk of req) {
        length+=chunk.length;
        if(length>32768) return json(413,{error:{code:'BODY_TOO_LARGE',message:'요청 내용이 너무 깁니다.'},requestId:''});
        chunks.push(chunk);
      }
      const body=Buffer.concat(chunks).toString('utf8');
      const result=await handleAgentRequest({method:req.method,path,body,headers:req.headers});
      res.writeHead(result.statusCode,result.headers);
      if(path==='/api/agent/capabilities' && req.method==='GET' && result.statusCode===200) {
        return res.end(JSON.stringify({...JSON.parse(result.body),realtimeVoice:realtime.availableForHost(req.headers.host)}));
      }
      return res.end(result.body);
    }
    if (!['GET','HEAD'].includes(req.method)) return json(405, {error:'지원하지 않는 요청입니다.'});
    if (path === '/api/health') return json(200, {ok:true, mode:'simulation', runtime:'node', phoneConnected:false, medicalRecordTransfer:false});
    if (path === '/api/config') return json(200, {mode:'simulation', tileUrl:process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'});
    if(nextHandler)return nextHandler(req,res);
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
server.requestTimeout=15000;
server.listen(port, host, () => console.log(`혼디 · 시연 모드\nLocal: http://${host}:${server.address().port}\n${production ? '빌드 결과' : '개발 화면'} · 실제 전화·의료기관 전송 없음`));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `${port}번 포트가 사용 중입니다. PORT 환경변수로 변경하세요.` : error.message); process.exitCode = 1; });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => {await realtime.dispose();server.close(() => process.exit(0));});
