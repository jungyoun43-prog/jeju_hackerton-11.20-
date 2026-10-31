import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

test('로컬 서버는 시연 상태만 공개하고 비밀 파일·경로 이탈·쓰기 요청을 차단한다',async t=>{
 const child=spawn(process.execPath,['scripts/server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0',GOOGLE_MAPS_EMBED_KEY:''},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{child.kill('SIGTERM');await once(child,'exit');});
 const base=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('서버가 5초 안에 시작하지 않았습니다.')),5000);
  child.stdout.on('data',chunk=>{const match=chunk.toString().match(/Local: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('exit',code=>{if(code) {clearTimeout(timeout);reject(new Error('서버 시작 실패'));}});
 });
 const health=await fetch(base+'/api/health');
 assert.equal(health.status,200);
 assert.deepEqual(await health.json(),{ok:true,mode:'simulation',runtime:'node',phoneConnected:false,medicalRecordTransfer:false});
 const config=await fetch(base+'/api/config');
 assert.deepEqual(Object.keys(await config.json()).sort(),['mode','tileUrl']);
 for(const path of ['/.env','/README.md','/.git/config']) assert.equal((await fetch(base+path)).status,404);
 assert.equal((await fetch(base+'/%2E%2F..%2FREADME.md')).status,403);
 assert.equal((await fetch(base+'/api/health',{method:'POST'})).status,405);
 const page=await fetch(base+'/');
 assert.equal(page.status,200);
 assert.match(page.headers.get('content-type'),/text\/html/);
 assert.equal(page.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
 const leaflet=await fetch(base+'/vendor/leaflet/leaflet.js');
 assert.equal(leaflet.status,200);
 assert.match(leaflet.headers.get('content-type'),/javascript/);
});
