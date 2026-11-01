import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=resolve(process.env.QA_SERVED_SOURCE_ROOT||resolve(dirname(fileURLToPath(import.meta.url)),'..'));
const directory='.impeccable/review/chat-rail/reliable-visit/integration',tokenKey='hondi-visit-token-v1';
const firstText='합성 방문을 2026년 11월 19일 오후 2시로 바꾸고 남은 준비를 알려 주세요.';
const nextText='합성 방문을 2026년 11월 26일 오전 11시로 바꾸고 남은 준비를 알려 주세요.';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const revision=()=>{try{return execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return 'archive';}};
const {runtimeFingerprint}=await import(pathToFileURL(resolve(root,'orchestration/checks.mjs')));
const {createAgentService}=await import(pathToFileURL(resolve(root,'agent/service.mjs')));
const {createMemorySessionStore}=await import(pathToFileURL(resolve(root,'agent/store.mjs')));
const proof={checkedAt:new Date().toISOString(),result:'fail',revision:revision(),sourceHash:await runtimeFingerprint(root),checks:[],errors:[],viewports:[],staticFiles:[],actualHttpPostCounts:{agent:0,resume:0,progress:0,preview:0},fixtureProviderRespondCalls:0,fixtureLogicalTurns:0,modelInvoked:false,realModelCalls:0,realAwsCalls:0,phoneInvoked:false,healthRecordsQueried:false,externalHttpAttempts:0,runtimeErrors:0,
  scope:'Actual owned localhost HTTP server, current service/store/dispatcher and static UI. Only the provider is a fixed fixture. The first completed HTTP response is truncated by the server; no local API route is fulfilled or response fixture injected. No real model, AWS durability, phone or personal records. Request bodies and identifiers remain in memory and are excluded from proof and captures.'};
let phase='setup',browser;
function record(name,pass,detail={}){
  proof.checks.push({name,status:pass?'pass':'fail',detail});
  console.log(`${pass?'PASS':'FAIL'} ${name}`);
  if(!pass)throw new Error('CHECK_FAILED');
}
const sideEffects=value=>Object.fromEntries(['providerRespond','logicalTurns','consumeTurn','save','acquire','release','writeProgress'].map(key=>[key,value[key]]));
const sameEffects=(a,b)=>JSON.stringify(sideEffects(a))===JSON.stringify(sideEffects(b));
// 재요청의 고정 진행 완료/실패 표식은 실행·상태 저장과 별도로 관측한다.
const sameExecution=(a,b)=>['providerRespond','logicalTurns','consumeTurn','save','acquire','release'].every(key=>a[key]===b[key]);

async function fixtureServer(){
  const counts={providerRespond:0,logicalTurns:0,loadOrCreate:0,save:0,acquire:0,release:0,consumeTurn:0,writeProgress:0,readProgress:0,agent:0,resume:0,progress:0,preview:0,truncated:0,requestHashesValid:true,serverErrors:0};
  const memory=createMemorySessionStore(),store={...memory};
  for(const name of ['loadOrCreate','save','acquire','release','consumeTurn','writeProgress','readProgress'])store[name]=async(...args)=>{counts[name]++;return memory[name](...args);};
  let firstBody;
  const provider={connected:true,model:'fixed-integration-fixture',async respond({messages}){
    counts.providerRespond++;
    if(messages.length===1){
      counts.logicalTurns++;
      const current=JSON.parse(messages[0].content[0].text).currentRequest;
      if(![firstText,nextText].includes(current))throw new Error('UNEXPECTED_FIXTURE_REQUEST');
      return {content:[{toolUse:{toolUseId:'fixture-case',name:'get_case',input:{}}},{toolUse:{toolUseId:'fixture-visit',name:'update_visit',input:current===firstText?{date:'2026-11-19',appointmentTime:'14:00'}:{date:'2026-11-26',appointmentTime:'11:00'}}}],stopReason:'tool_use'};
    }
    return {content:[{text:'고정 provider fixture로 합성 방문 일정과 남은 준비를 확인했습니다. 실제 전화·개인 기록 조회·예약·배차는 하지 않았습니다.'}],stopReason:'end_turn'};
  }};
  const service=createAgentService({provider,store,config:{revision:proof.revision,maxRounds:8,maxTools:16}});
  const appRoot=resolve(root,'app'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml','.ico':'image/x-icon'};
  const server=createServer((request,response)=>{
    const handle=async()=>{
      const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
      if(pathname==='/api/agent' || pathname.startsWith('/api/agent/')){
        const chunks=[];let length=0;
        for await(const chunk of request){length+=chunk.length;if(length>24576){response.writeHead(413);response.end();return;}chunks.push(chunk);}
        const bytes=Buffer.concat(chunks),body=bytes.toString('utf8');
        if(request.method==='POST'){
          const kind=pathname==='/api/agent'?'agent':pathname.split('/').at(-1);
          if(Object.hasOwn(proof.actualHttpPostCounts,kind)){counts[kind]++;proof.actualHttpPostCounts[kind]++;}
          counts.requestHashesValid &&= request.headers['x-amz-content-sha256']===hash(bytes);
        }
        if(pathname==='/api/agent' && request.method==='POST' && firstBody===undefined)firstBody=JSON.parse(body);
        const result=await service.handleAgentRequest({method:request.method,path:pathname,headers:request.headers,body});
        if(pathname==='/api/agent' && request.method==='POST' && counts.truncated===0 && result.statusCode===200){
          counts.truncated++;
          // 실제 저장을 완료한 뒤 응답 본문만 유실시키며 POST를 재전송하지 않는다.
          response.writeHead(200,{...result.headers,'content-length':Buffer.byteLength(result.body)+1,connection:'close'});response.end('{');return;
        }
        response.writeHead(result.statusCode,result.headers);response.end(result.body);return;
      }
      if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end();return;}
      const target=resolve(appRoot,pathname==='/'?'index.html':pathname.slice(1));
      if(!target.startsWith(appRoot+sep) || !mime[extname(target)]){response.writeHead(404);response.end();return;}
      const bytes=await readFile(target);
      response.writeHead(200,{'content-type':mime[extname(target)],'cache-control':'no-store','x-content-type-options':'nosniff'});response.end(request.method==='HEAD'?undefined:bytes);
    };
    handle().catch(()=>{counts.serverErrors++;if(!response.headersSent)response.writeHead(500,{'content-type':'application/json'});response.end('{"error":"INTEGRATION_SERVER_ERROR"}');});
  });
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  return {base:`http://127.0.0.1:${server.address().port}`,counts,memory,first:()=>firstBody,async close(){firstBody=undefined;await new Promise(done=>{server.close(done);server.closeAllConnections();});}};
}

async function layout(page){
  return page.evaluate(()=>{
    const q=id=>document.getElementById(id),bounds=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const fits=node=>{const r=bounds(node);return r.width>0 && r.height>0 && r.left>=-1 && r.right<=innerWidth+1 && r.top>=-1 && r.bottom<=innerHeight+1;};
    const input=q('request-input'),send=q('send-request'),composer=q('chat-composer'),chat=q('chat-workspace'),rail=q('preparation-rail'),view=document.querySelector('.conversation-layout').dataset.activeView,compact=matchMedia('(max-width:900px),(max-height:650px)').matches;
    const active=view==='preparation'?rail:chat,inactive=active===chat?rail:chat,scroll=view==='preparation'?rail:q('conversation-scroll');
    return {viewportFit:document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1 && scrollY===0 && fits(composer),sharedComposer:document.querySelectorAll('#request-input,#conversation-form,#chat-composer').length===3 && fits(input) && fits(send) && bounds(send).width>=44 && bounds(send).height>=44,scrollRegions:/auto|scroll/.test(getComputedStyle(scroll).overflowY) && scroll.clientHeight>=44,compactPanels:compact?!active.hidden&&!active.inert&&inactive.hidden&&inactive.inert:!chat.hidden&&!rail.hidden,compact,readingHeight:scroll.clientHeight};
  });
}
const fit=value=>['viewportFit','sharedComposer','scrollRegions','compactPanels'].every(key=>value[key]);
async function prep(page){if(await page.locator('#workspace-tab-preparation').isVisible())await page.locator('#workspace-tab-preparation').click();if(!await page.locator('#visit-summary').evaluate(node=>node.open))await page.locator('#visit-summary>summary').click();}
async function chat(page){if(await page.locator('#workspace-tab-chat').isVisible())await page.locator('#workspace-tab-chat').click();}
async function settle(page){await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));}
async function submit(page,text){await chat(page);await page.locator('#request-input').fill(text);await page.locator('#send-request').click();await page.waitForFunction(()=>document.getElementById('conversation-form').getAttribute('aria-busy')==='false');await settle(page);}
async function privateValuesAbsent(page,values){const text=await page.locator('body').textContent();return values.every(value=>!value || !text.includes(value));}
async function capture(page,name){const path=`${directory}/${name}.png`;await page.screenshot({path:resolve(root,path),mask:[page.locator('.message.user'),page.locator('#request-input')]});return path;}
async function apiPost(base,body){const bytes=JSON.stringify(body),response=await fetch(base+'/api/agent',{method:'POST',headers:{'content-type':'application/json','x-amz-content-sha256':hash(bytes),connection:'close'},body:bytes,redirect:'error',signal:AbortSignal.timeout(8000)});return {status:response.status,data:await response.json()};}

try{
  const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  await mkdir(resolve(root,directory),{recursive:true});
  for(const [width,height] of [[1440,900],[390,500]]){
    phase=`${width}x${height}`;
    const fixture=await fixtureServer(),assetChecks=[];let context;
    try{
      context=await browser.newContext({viewport:{width,height},locale:'ko-KR',reducedMotion:'reduce',serviceWorkers:'block'});
      await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==fixture.base){proof.externalHttpAttempts++;return route.abort();}return route.continue();});
      const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',()=>{proof.runtimeErrors++;});page.on('dialog',dialog=>dialog.accept());
      page.on('response',response=>{const url=new URL(response.url());if(url.origin===fixture.base && /\.(?:js|css)$/.test(url.pathname))assetChecks.push((async()=>{const bytes=await response.body(),local=await readFile(resolve(root,'app',url.pathname.slice(1)));return {file:url.pathname.slice(1),matches:response.ok()&&hash(bytes)===hash(local),bytes:bytes.length};})().catch(()=>({file:url.pathname.slice(1),matches:false,bytes:0})));});
      await page.goto(fixture.base,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.getElementById('connection-state')?.textContent==='대화 연결 설정됨');await page.evaluate(()=>document.fonts.ready);
      record(`${width}px 일반 입력과 단일 공통 작업공간`,fit(await layout(page)));
      await submit(page,firstText);await page.locator('.message.user.failed').waitFor();
      const first=fixture.first(),storage=await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage))),recorded=fixture.memory.inspect()[0];
      record(`${width}px 완료 후 HTTP 응답만 유실되고 입력은 복원`,fixture.counts.truncated===1 && fixture.counts.agent===1 && recorded?.state.patient.nextVisit==='2026-11-19' && recorded?.state.visitSupport.requirements.appointmentTime==='14:00' && await page.locator('#request-input').inputValue()===firstText && await page.locator('#request-problem-notice').isVisible());
      record(`${width}px 첫 요청 전 방문 토큰만 저장`,typeof first?.visitToken==='string' && /^[A-Za-z0-9_-]{43}$/.test(first.visitToken) && first.sessionId===undefined && Object.keys(storage).join()===tokenKey && storage[tokenKey]===first.visitToken && !JSON.stringify(storage).includes(firstText));
      record(`${width}px 첫 논리 요청의 fixture 2회·budget 1회`,fixture.counts.logicalTurns===1 && fixture.counts.providerRespond===2 && fixture.counts.consumeTurn===1);
      await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>document.getElementById('visit-recovery-notice')?.textContent.includes('마지막으로 확인된'));await page.waitForFunction(()=>document.getElementById('resume-visit')?.getAttribute('aria-busy')==='false');
      const keptToken=await page.evaluate(key=>sessionStorage.getItem(key),tokenKey);
      record(`${width}px 새로고침은 같은 방문의 실제 읽기만 수행`,keptToken===first.visitToken && fixture.counts.agent===1 && fixture.counts.resume===1 && fixture.counts.providerRespond===2 && fixture.counts.consumeTurn===1);
      record(`${width}px 대화 원문 재생 없이 확인 상태·남은 일 복원`,await page.locator('.message.user,.message.assistant:not(.greeting)').count()===0 && await page.locator('#request-input').inputValue()==='' && /원문.*보관하지/.test(await page.locator('#visit-recovery-notice').textContent()) && await page.locator('#care-journey-summary').isVisible() && (await page.locator('#care-journey-next').textContent()).trim().length>0 && fit(await layout(page)));
      const input=await page.locator('#request-input').elementHandle(),draft='다음 요청 초안';await input.fill(draft);await prep(page);await page.locator('#resume-visit').scrollIntoViewIfNeeded();
      const dateVisible=await page.locator('#case-content .visit-date').innerText();
      record(`${width}px 준비 탭의 실제 방문일·시각과 같은 입력 초안`,/11월 19일/.test(dateVisible) && /14:00/.test(dateVisible) && await input.evaluate((node,draft)=>node===document.getElementById('request-input')&&node.value===draft,draft) && fit(await layout(page)));
      const before={...fixture.counts},expiry=fixture.memory.inspect()[0].expiresAt;
      const read=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/agent/resume'&&response.request().method()==='POST');await page.locator('#resume-visit').click();const response=await read;const restored=await response.json();await page.waitForFunction(()=>document.getElementById('resume-visit').getAttribute('aria-busy')==='false');
      record(`${width}px 실제 복구 POST는 Get만 하고 TTL·모델·budget·쓰기 불변`,response.status()===200 && restored.sessionId===recorded.sessionId && restored.caseState.patient.nextVisit==='2026-11-19' && restored.recovery.request.requestId===first.requestId && restored.recovery.request.status==='completed' && restored.pendingActions.length>0 && fixture.counts.resume===before.resume+1 && fixture.counts.loadOrCreate===before.loadOrCreate+1 && sameEffects(before,fixture.counts) && fixture.memory.inspect()[0].expiresAt===expiry && await input.inputValue()===draft);
      const protectedValues=[first.visitToken,first.progressToken,first.requestId,restored.sessionId];
      record(`${width}px 토큰·세션·요청 식별자는 화면 텍스트에서 비노출`,await privateValuesAbsent(page,protectedValues));
      await input.fill('');const preparationCapture=await capture(page,`preparation-${width}x${height}`);await chat(page);const recoveryCapture=await capture(page,`recovered-${width}x${height}`);
      const prior={...fixture.counts},repeated=await apiPost(fixture.base,first);
      record(`${width}px 최초 body 그대로 재시도는 저장 상태만 재표시`,repeated.status===200 && repeated.data.sessionId===restored.sessionId && repeated.data.caseState.patient.nextVisit==='2026-11-19' && repeated.data.pendingActions.length>0 && /이미 처리/.test(repeated.data.reply) && sameExecution(prior,fixture.counts),{progressWriteAttempts:fixture.counts.writeProgress-prior.writeProgress});
      const beforeConflict={...fixture.counts},conflict=await apiPost(fixture.base,{...first,message:nextText});
      record(`${width}px 같은 ID 다른 본문은 실제 HTTP409·재실행 없음`,conflict.status===409 && conflict.data.error?.code==='REQUEST_CONFLICT' && sameExecution(beforeConflict,fixture.counts),{progressWriteAttempts:fixture.counts.writeProgress-beforeConflict.writeProgress});
      await submit(page,nextText);await page.locator('.message.assistant:not(.greeting)').waitFor();await prep(page);
      const changed=await page.locator('#case-content .visit-date').innerText(),nextStorage=await page.evaluate(key=>sessionStorage.getItem(key),tokenKey),finalState=fixture.memory.inspect()[0];
      record(`${width}px 다음 새 요청은 같은 방문의 날짜·시각 변경`,/11월 26일/.test(changed) && /11:00/.test(changed) && nextStorage===first.visitToken && finalState.sessionId===recorded.sessionId && finalState.turns===2 && fixture.counts.logicalTurns===2 && fixture.counts.providerRespond===4 && fixture.counts.consumeTurn===2 && await page.locator('.message.user.failed').count()===0 && fit(await layout(page)));
      record(`${width}px 최종 화면도 식별자 비노출·정상 공통 입력`,await privateValuesAbsent(page,protectedValues) && await page.locator('#request-input').inputValue()==='' && await page.locator('#send-request').isDisabled());
      const finalCapture=await capture(page,`changed-${width}x${height}`),assets=await Promise.all(assetChecks);
      record(`${width}px 실제 브라우저 JS/CSS 바이트가 현재 root 소스와 동일`,assets.length>0 && assets.every(asset=>asset.matches) && ['conversation.js','conversation.css','preparation-stages.js','preparation-board-view.js'].every(file=>assets.some(asset=>asset.file===file)));
      record(`${width}px 모든 실제 POST의 payload hash 일치·서버 오류 없음`,fixture.counts.requestHashesValid && fixture.counts.serverErrors===0 && fixture.counts.preview===0);
      proof.staticFiles.push(...assets);
      proof.viewports.push({width,height,...await layout(page),completedResponseLost:true,sameTokenRestored:true,transcriptNotReplayed:true,actualResumeReadOnly:true,firstRequestReplayedWithoutEffects:true,bodyConflictRejected:true,nextRequestChangedVisit:true,draftPreserved:true,identifiersAbsent:true,fixtureProviderRespondCalls:fixture.counts.providerRespond,fixtureLogicalTurns:fixture.counts.logicalTurns,budgetConsumptions:fixture.counts.consumeTurn,actualHttpPosts:{agent:fixture.counts.agent,resume:fixture.counts.resume,progress:fixture.counts.progress,preview:fixture.counts.preview},screenshots:[recoveryCapture,preparationCapture,finalCapture]});
    }finally{
      proof.fixtureProviderRespondCalls+=fixture.counts.providerRespond;proof.fixtureLogicalTurns+=fixture.counts.logicalTurns;
      try{if(context)await context.close();}finally{await fixture.close();}
    }
  }
  phase='final-source';proof.finalSourceHash=await runtimeFingerprint(root);proof.finalRevision=revision();
  record('검사 중 실제 runtime 소스 변경 없음',proof.sourceHash===proof.finalSourceHash);
  record('실제 외부 HTTP·LLM·AWS·전화·개인기록 호출과 브라우저 오류 없음',proof.externalHttpAttempts===0&&proof.runtimeErrors===0&&proof.realModelCalls===0&&proof.realAwsCalls===0);
  proof.result='pass';
}catch(error){proof.errors.push({phase,type:['Error','TimeoutError','TypeError','SyntaxError'].includes(error?.name)?error.name:'ExecutionError'});process.exitCode=1;}
finally{
  if(browser)await browser.close();
  if(!proof.finalSourceHash)proof.finalSourceHash=await runtimeFingerprint(root);
  await mkdir(resolve(root,'orchestration/runs'),{recursive:true});await writeFile(resolve(root,'orchestration/runs/visit-recovery-integration.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify({result:proof.result,checks:proof.checks.length,passed:proof.checks.filter(check=>check.status==='pass').length,sourceHash:proof.sourceHash,finalSourceHash:proof.finalSourceHash,viewports:proof.viewports.length,actualHttpPostCounts:proof.actualHttpPostCounts,fixtureProviderRespondCalls:proof.fixtureProviderRespondCalls,fixtureLogicalTurns:proof.fixtureLogicalTurns,externalHttpAttempts:proof.externalHttpAttempts,errors:proof.errors}));
}
