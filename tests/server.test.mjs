import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createAgentService } from '../agent/service.mjs';
import { createMemorySessionStore } from '../agent/store.mjs';
import { createToolDispatcher } from '../agent/tools.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

test('로컬 서버는 시연 상태만 공개하고 비밀 파일·경로 이탈·쓰기 요청을 차단한다',async t=>{
 const child=spawn(process.execPath,['scripts/server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0',OPENAI_API_KEY:'',GOOGLE_MAPS_EMBED_KEY:''},stdio:['ignore','pipe','pipe']});
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
 const capabilities=await fetch(base+'/api/agent/capabilities');
 assert.equal(capabilities.status,200);
 assert.equal((await capabilities.json()).llm,false);
 assert.equal(capabilities.headers.get('cache-control'),'no-store');
 const unavailableProgress=await fetch(base+'/api/agent/progress',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({progressToken:'p'.repeat(43)})});
 assert.equal(unavailableProgress.status,200);assert.deepEqual(await unavailableProgress.json(),{available:false,progress:null});
 const post=body=>fetch(base+'/api/agent',{method:'POST',headers:{'content-type':'application/json'},body});
 const disconnected=await post(JSON.stringify({message:'애월 부모님 진료 준비를 부탁합니다.',requestId:'server-disconnected-001'}));
 assert.equal(disconnected.status,503);
 assert.equal((await disconnected.json()).error.code,'MODEL_NOT_CONNECTED');
 const preview=await fetch(base+'/api/agent/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scenarioId:'aewol-parent-visit',requestId:'server-fixed-preview-001'})});
 assert.equal(preview.status,200);
 const result=await preview.json();
 assert.equal(result.isPreview,true);
 assert.equal(result.capabilities.llm,false);
 assert.equal(result.caseState.visitSupport.taxi.provider.name,'애월콜');
 assert.equal(result.events.length,15);
 for(const scenarioId of ['missing_record','jeju_unavailable','time_changed','call_no_answer','call_ai_declined','call_identity_required','call_documents_or_schedule']) {
  const preview=await fetch(base+'/api/agent/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scenarioId,requestId:'server-journey-'+scenarioId})});
  assert.equal(preview.status,200);const payload=await preview.json();assert.equal(payload.isPreview,true);assert.equal(payload.capabilities.llm,false);assert.equal(payload.sessionId,'');
  assert.equal(payload.careJourney.pathway.outcome,'unconfirmed');assert.equal(payload.careJourney.boundary.actualCallPlaced,false);
  if(scenarioId.startsWith('call_')) assert.ok(payload.careJourney.handoffs.length);
 }
 const injected=await fetch(base+'/api/agent/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scenarioId:'call_no_answer',requestId:'server-injected-001',now:'2099-01-01',outcome:'answered'})});assert.equal(injected.status,400);
 for(const asset of ['/care-journey.js','/call-recovery.js']) {const module=await fetch(base+asset);assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);}
 for(const asset of ['/data/hospital-candidates.json','/data/visit-support-providers.json']) {const module=await fetch(base+asset);assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/application\/json/);}
 assert.equal((await post('{')).status,400);
 assert.equal((await post('x'.repeat(40000))).status,413);
 for(const path of ['/.env','/README.md','/.git/config']) assert.equal((await fetch(base+path)).status,404);
 assert.equal((await fetch(base+'/%2E%2F..%2FREADME.md')).status,403);
 assert.equal((await fetch(base+'/api/health',{method:'POST'})).status,405);
 const page=await fetch(base+'/');
 assert.equal(page.status,200);
 assert.match(page.headers.get('content-type'),/text\/html/);
 assert.equal(page.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
 assert.match(await page.text(),/conversation\.js/);
 assert.match(await (await fetch(base+'/workspace.html')).text(),/app\.js/);
 const leaflet=await fetch(base+'/vendor/leaflet/leaflet.js');
 assert.equal(leaflet.status,200);
 assert.match(leaflet.headers.get('content-type'),/javascript/);
});

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {resolve,promise};};
async function fixtureServer(t,service) {
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const result=await service.handleAgentRequest({method:req.method,path:req.url,headers:req.headers,body:Buffer.concat(chunks).toString('utf8')});
    if(!res.destroyed){res.writeHead(result.statusCode,result.headers);res.end(result.body);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return `http://127.0.0.1:${server.address().port}`;
}
const fixturePost=(base,path,body,extra={})=>{
  const serialized=JSON.stringify(body);
  return fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-amz-content-sha256':createHash('sha256').update(serialized).digest('hex')},body:serialized,...extra});
};

test('실제 HTTP 대기 중 provider fixture와 도구 시작·결과·최종 진행을 별도 POST로 관측한다',async t=>{
  const providerEntered=deferred(),providerGate=deferred(),toolEntered=deferred(),toolGate=deferred(),answerEntered=deferred(),answerGate=deferred();
  t.after(()=>{providerGate.resolve();toolGate.resolve();answerGate.resolve();});
  let calls=0;const store=createMemorySessionStore(),dispatch=createToolDispatcher(),progressToken=randomBytes(32).toString('base64url');
  const provider={connected:true,model:'http-progress-fixture',async respond(){
    calls++;
    if(calls===1){providerEntered.resolve();await providerGate.promise;return {content:[{toolUse:{toolUseId:'http-records',name:'request_records',input:{source:'nhis'}}}],stopReason:'tool_use'};}
    answerEntered.resolve();await answerGate.promise;return {content:[{text:'실제 기록 연계는 미설정입니다.'}],stopReason:'end_turn'};
  }};
  const service=createAgentService({provider,store,dispatch:async input=>{toolEntered.resolve();await toolGate.promise;return dispatch(input);}}),base=await fixtureServer(t,service);
  const pending=fixturePost(base,'/api/agent',{message:'현재 자료 준비 상태를 확인해 주세요.',requestId:'http-progress-request-001',progressToken});
  await providerEntered.promise;
  const poll=async()=>{const result=await fixturePost(base,'/api/agent/progress',{progressToken});assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');return result.json();};
  const planning=await poll();assert.equal(planning.progress.status,'running');assert.equal(planning.progress.currentStage,'records');
  providerGate.resolve();await toolEntered.promise;
  const executing=await poll();assert.ok(executing.progress.events.some(item=>item.tool==='request_records'&&item.status==='started'));assert.equal(calls,1);
  toolGate.resolve();await answerEntered.promise;
  const answered=await poll();assert.ok(answered.progress.events.some(item=>item.tool==='request_records'&&item.status==='needs_input'));assert.equal(answered.progress.currentStage,'plan');
  answerGate.resolve();const response=await pending;assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.caseState.packet.status,'draft');assert.equal(body.needsInput,true);assert.equal(calls,2);
  const completed=await poll();assert.equal(completed.progress.status,'completed');assert.equal(store.inspect()[0].turns,1);
  assert.equal(JSON.stringify(completed).includes(progressToken),false);assert.equal(JSON.stringify(completed).includes('김정희'),false);
});

test('HTTP 클라이언트의 기다리기 취소는 서버 모델·상태 저장을 취소하거나 새 진행으로 만들지 않는다',async t=>{
  const entered=deferred(),gate=deferred(),saved=deferred();t.after(()=>gate.resolve());
  const memory=createMemorySessionStore(),store={...memory,async save(...args){await memory.save(...args);saved.resolve();}};
  let calls=0;const provider={connected:true,model:'http-cancel-fixture',async respond(){calls++;entered.resolve();await gate.promise;return {content:[{text:'합성 준비 상태를 확인했습니다.'}],stopReason:'end_turn'};}};
  const base=await fixtureServer(t,createAgentService({store,provider})),progressToken=randomBytes(32).toString('base64url'),controller=new AbortController();
  const pending=fixturePost(base,'/api/agent',{message:'현재 준비를 확인해 주세요.',requestId:'http-cancel-progress-001',progressToken},{signal:controller.signal});
  await entered.promise;controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');
  const running=await (await fixturePost(base,'/api/agent/progress',{progressToken})).json();assert.equal(running.progress.status,'running');
  gate.resolve();await saved.promise;await new Promise(resolve=>setImmediate(resolve));
  const completed=await (await fixturePost(base,'/api/agent/progress',{progressToken})).json();
  assert.equal(completed.progress.status,'completed');assert.equal(memory.inspect()[0].turns,1);assert.equal(calls,1);assert.equal(memory.inspectProgress().length,1);
});
