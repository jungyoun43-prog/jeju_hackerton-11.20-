import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
import {createDemoCase,applyAction} from '../app/domain.js';
import registry from '../app/data/visit-support-providers.json' with {type:'json'};

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),servedRoot=process.env.QA_SERVED_SOURCE_ROOT?resolve(process.env.QA_SERVED_SOURCE_ROOT):root;
const base=new URL(process.env.BASE_URL||'http://127.0.0.1:4173');
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname) || !['http:','https:'].includes(base.protocol) || base.username || base.password)throw new Error('키를 끈 localhost QA 서버만 허용합니다.');
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const tokenKey='hondi-visit-token-v1',token='v'.repeat(43),sessionId='q'.repeat(43);
const caps={llm:true,model:'gpt-6.1-sol',phone:'simulation',healthRecords:'demo',voiceInput:'browser',progress:'unavailable',visitRecovery:'token'};
const directory='.impeccable/review/chat-rail/guided-visit/recovery';
await mkdir(resolve(root,directory),{recursive:true});await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
const checks=[],errors=[],proof={checkedAt:new Date().toISOString(),result:'fail',sourceHash:await runtimeFingerprint(servedRoot),checks,errors,guidedScenarios:[],viewports:[],fixturePosts:{agent:0,resume:0,preview:0},actualFixedPreviews:0,unmockedModelPosts:0,modelInvoked:false,phoneInvoked:false,recordsQueried:false,scope:'Actual local static assets; normal and recovery HTTP response fixtures. Successful fixed preview is a real keyless local endpoint; the preview-failure case is a separate fixture. No real model, database durability, phone, microphone or physical-device evidence.'};
const record=(name,pass,detail='')=>{checks.push({name,status:pass?'pass':'fail',detail});console.log(`${pass?'PASS':'FAIL'} ${name}${detail?' · '+detail:''}`);};
let state=applyAction(createDemoCase(),{type:'UPDATE_PATIENT',values:{nextVisit:'2026-11-19'}});
state=applyAction(state,{type:'SUPPORT_UPDATE_REQUIREMENTS',values:{wheelchair:true,companionNeeded:true}});
state=applyAction(state,{type:'SUPPORT_SELECT_PROVIDER',kind:'taxi',provider:registry.providers.find(p=>p.id==='jeju-accessible-transport')});
state=applyAction(state,{type:'SUPPORT_PREPARE_INQUIRY',kind:'taxi'});
const actions=[{id:'recovery-fixture-next',kind:'support',label:'차량·이용자격 확인',reason:'합성 준비이며 실제 배차는 미확인'}];
const recovery=(status='completed',restored=state,id='recover-request-001')=>({sessionId,caseState:restored,pendingActions:actions,recovery:{savedAt:status==='running'?null:new Date().toISOString(),expiresAt:Math.floor(Date.now()/1000)+3600,request:{requestId:id,status}}});
const reply=(request,restored=state)=>({sessionId,requestId:JSON.parse(request.postData()).requestId,caseState:restored,reply:'합성 준비를 정리했습니다. 실제 발신·예약·배차는 하지 않았습니다.',events:[],pendingActions:actions,capabilities:caps,needsInput:true});
const deferred=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};
const settle=page=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
async function scenario(name,run){try{await run();}catch(error){errors.push(`${name}: ${error.message}`);record(name,false,error.message);}}
async function open(width=1440,height=900,{seed,onMessage,onResume,onPreview,blocked=false}={}){
  const context=await browser.newContext({viewport:{width,height},locale:'ko-KR',reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base.origin?route.continue():route.abort());
  if(seed!==undefined)await context.addInitScript(({key,seed})=>sessionStorage.setItem(key,seed),{key:tokenKey,seed});
  if(blocked)await context.addInitScript(()=>Object.defineProperty(window,'sessionStorage',{get(){throw new DOMException('Storage blocked','SecurityError');}}));
  const page=await context.newPage(),messages=[],resumes=[];page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.route('**/api/agent/capabilities',route=>route.fulfill({json:caps}));
  await page.route('**/api/agent',async route=>{
    proof.fixturePosts.agent++;messages.push(route.request());
    const answer=onMessage?await onMessage(route.request(),messages.length):{body:reply(route.request())};
    if(answer.abort)return route.abort('connectionreset');
    await route.fulfill({status:answer.status||200,json:answer.body});
  });
  await page.route('**/api/agent/resume',async route=>{
    proof.fixturePosts.resume++;resumes.push(route.request());
    const answer=onResume?await onResume(route.request(),resumes.length):{body:recovery()};
    try{await route.fulfill({status:answer.status||200,json:answer.body});}
    catch(error){if(!page.isClosed() && !route.request().failure())throw error;}
  });
  if(onPreview)await page.route('**/api/agent/preview',async route=>{proof.fixturePosts.preview++;const answer=await onPreview(route.request());await route.fulfill({status:answer.status||200,json:answer.body});});
  page.on('request',request=>{if(!onPreview && request.method()==='POST' && new URL(request.url()).pathname==='/api/agent/preview')proof.actualFixedPreviews++;});
  await page.goto(base.href,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('connection-state')?.textContent==='대화 연결 설정됨');await page.evaluate(()=>document.fonts.ready);
  return {page,context,messages,resumes};
}
async function submit(page,text){await page.locator('#request-input').fill(text);await page.locator('#send-request').click();await page.waitForFunction(()=>document.getElementById('conversation-form').getAttribute('aria-busy')==='false');await settle(page);}
const storage=page=>page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage)));
const snapshot=page=>page.evaluate(()=>{
  const bounds=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const fits=node=>{const r=bounds(node);return r.left>=-1 && r.right<=innerWidth+1 && r.top>=-1 && r.bottom<=innerHeight+1;};
  const input=document.getElementById('request-input'),send=document.getElementById('send-request'),composer=document.getElementById('chat-composer'),chat=document.getElementById('chat-workspace'),rail=document.getElementById('preparation-rail'),compact=matchMedia('(max-width:900px),(max-height:650px)').matches,view=document.querySelector('.conversation-layout').dataset.activeView;
  const active=view==='preparation'?rail:chat,scroller=view==='preparation'?rail:document.getElementById('conversation-scroll');
  return {viewportFit:document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1 && scrollY===0 && fits(composer),sharedComposer:document.querySelectorAll('#request-input,#conversation-form,#chat-composer').length===3 && fits(input) && fits(send) && bounds(send).width>=44 && bounds(send).height>=44,scrollRegions:/auto|scroll/.test(getComputedStyle(scroller).overflowY) && scroller.clientHeight>=Math.max(44,parseFloat(getComputedStyle(scroller).fontSize)*1.2),compactPanels:compact?!active.hidden && !active.inert && (view==='preparation'?chat:rail).hidden:!chat.hidden&&!rail.hidden,readingHeight:scroller.clientHeight,input:bounds(input),send:bounds(send),compact,view};
});
const fit=data=>['viewportFit','sharedComposer','scrollRegions','compactPanels'].every(key=>data[key]);
async function readHistory(page) {
  if(await page.locator('#workspace-tab-chat').isVisible())await page.locator('#workspace-tab-chat').click();
  const history=page.locator('#conversation-history');if(!await history.evaluate(node=>node.open))await history.locator(':scope>summary').click();
}
async function projectionEvidence(page,state) {
  return page.evaluate(async state=>{
    const workflow=(await import('/preparation-workflow.js')).getPreparationWorkflow(state),board=document.getElementById('preparation-board'),current=document.getElementById('current-preparation-task'),rows=[...document.querySelectorAll('#stage-navigation>button[data-open-stage]')],panes=[...board.querySelectorAll(':scope>[data-stage-id]')];
    return {currentStage:board.dataset.currentStage===workflow.currentStageId,currentTask:current.dataset.taskId===(workflow.currentTask?.id||'') && current.dataset.taskActor===(workflow.currentTask?.actor||'') && current.dataset.taskStatus===(workflow.currentTask?.status||''),stages:rows.length===4 && workflow.stages.every(stage=>rows.some(node=>node.dataset.openStage===stage.id && node.dataset.workflowStatus===stage.status)),oneStage:panes.length===4 && panes.filter(node=>!node.hidden&&!node.inert).length===1 && panes.every(node=>node.hidden===node.inert),visitNotReady:workflow.visitReady===false};
  },state);
}
async function openDetails(page){if(await page.locator('#workspace-tab-preparation').isVisible())await page.locator('#workspace-tab-preparation').click();if(!await page.locator('#visit-summary').evaluate(node=>node.open))await page.locator('#visit-summary>summary').click();await page.locator('#resume-visit').scrollIntoViewIfNeeded();}
try{
  const response=await fetch(new URL('/api/agent/capabilities',base));const actual=await response.json();
  if(!response.ok || actual.llm!==false || actual.phone==='connected' || actual.healthRecords==='connected')throw new Error('실제 서버가 keyless 합성 상태가 아니어서 검사를 중단합니다.');
  for(const file of ['conversation.js','conversation.css','preparation-board-view.js','preparation-stages.js','preparation-workflow.js']){const response=await fetch(new URL('/'+file,base));record(`실제 ${file}는 검사 소스와 동일`,response.ok && Buffer.compare(Buffer.from(await response.arrayBuffer()),await readFile(resolve(servedRoot,'app',file)))===0);}
  for(const [width,height] of [[1440,900],[390,500]])await scenario(`${width}px 첫 응답 유실→새로고침`,async()=>{
    const {page,context,messages,resumes}=await open(width,height,{onMessage:(request,count)=>count===1?{abort:true}:{body:reply(request)},onResume:()=>({body:recovery('completed',state,JSON.parse(messages[0].postData()).requestId)})});
    try{
      await submit(page,'11월19일 어머니의 휠체어 이동을 준비해 주세요.');await page.locator('.message.user.failed').waitFor();
      const first=JSON.parse(messages[0].postData()),saved=await storage(page);
      record(`${width}px 첫 전송 전에 토큰만 저장·guided 의뢰 범위 명시`,first.guidedPreparation===true && /^[A-Za-z0-9_-]{43}$/.test(first.visitToken) && Object.keys(saved).join()===tokenKey && saved[tokenKey]===first.visitToken && !JSON.stringify(saved).includes(first.message));
      await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>document.getElementById('visit-recovery-notice').textContent.includes('마지막으로 확인된'));
      record(`${width}px 복구는 같은 토큰의 읽기1건·모델 재전송 없음`,messages.length===1 && resumes.length===1 && JSON.parse(resumes[0].postData()).visitToken===first.visitToken && Object.keys(JSON.parse(resumes[0].postData())).join()==='visitToken');
      await readHistory(page);
      record(`${width}px 이전 대화 답변을 만들지 않고 확인된 상태·남은 일만 복원`,await page.locator('.message.user,.message.assistant:not(.greeting)').count()===0 && /11월 19일/.test(await page.locator('#case-content').textContent()) && (await page.locator('#care-journey-summary').isVisible()) && /원문.*보관하지/.test(await page.locator('#visit-recovery-notice').textContent()));
      const projection=await projectionEvidence(page,state);record(`${width}px 읽기 복구는 저장된 상태의 현재 할 일·단계를 재계산`,Object.values(projection).every(Boolean) && messages.length===1 && resumes.length===1,JSON.stringify(projection));proof.guidedScenarios.push({id:'resume-projection',width,...projection,automaticPostAbsent:messages.length===1});
      record(`${width}px 복구로 모델 설정을 덮지 않음`,await page.locator('#connection-state').textContent()==='대화 연결 설정됨' && await page.locator('#request-input').inputValue()==='' && !(await page.locator('body').textContent()).includes(first.visitToken));
      await page.locator('#expand-answer').click();record(`${width}px 복구 뒤 넓게 읽기는 빈 답변 대신 원래 복구 설명`,/마지막으로 확인된/.test(await page.locator('#answer-read-view').textContent()) && await page.locator('#answer-read-view .message').count()===0);await page.locator('#close-answer').click();
      await submit(page,'진료 자료도 확인해 주세요.');const second=JSON.parse(messages[1].postData());
      record(`${width}px 다음 요청은 같은 방문·복구 상태·선호 재적용 없음`,second.visitToken===first.visitToken && second.sessionId===sessionId && second.applyPreferences===false && second.history.length===0 && first.requestId!==second.requestId);
      record(`${width}px 모든 요청의 본문 해시 일치`,[...messages,...resumes].every(request=>request.headers()['x-amz-content-sha256']===createHash('sha256').update(request.postDataBuffer()).digest('hex')));
    }finally{await context.close();}
  });
  await scenario('같은 준비 다시 확인의 출처·초안',async()=>{
    const held=deferred(),{page,context,resumes}=await open(1440,900,{seed:token,onResume:(_,count)=>count===1?{body:recovery()}:held.promise});
    try{
      await page.waitForFunction(()=>document.getElementById('visit-recovery-notice').textContent.includes('마지막으로 확인된'));await page.locator('#request-input').fill('확인하는 동안 유지할 초안');await openDetails(page);await page.locator('#resume-visit').click();
      await page.locator('#stage-navigation>button[data-open-stage="support"]').click();if(await page.locator('#workspace-tab-chat').isVisible())await page.locator('#workspace-tab-chat').click();
      const details=page.locator('[data-stage-id="support"] [data-stage-details]');if(!await details.evaluate(node=>node.open))await details.locator(':scope>summary').click();
      const source=page.locator('[data-stage-id="support"] [data-stage-sources] a').first();await source.scrollIntoViewIfNeeded();await source.focus();
      const before=await source.evaluate(node=>{window.__recoverySource=node;return {top:node.getBoundingClientRect().top,scroll:document.getElementById('conversation-scroll').scrollTop};});
      held.release({body:recovery()});await page.waitForFunction(()=>document.getElementById('resume-visit').getAttribute('aria-busy')==='false');
      const after=await source.evaluate(node=>({same:node===window.__recoverySource,connected:node.isConnected,focused:document.activeElement===node,top:node.getBoundingClientRect().top,scroll:document.getElementById('conversation-scroll').scrollTop}));
      record('같은 상태의 수동 복구는 출처 DOM·focus·펼침·읽기 위치 유지',resumes.length===2 && after.same && after.connected && after.focused && Math.abs(after.top-before.top)<=2 && Math.abs(after.scroll-before.scroll)<=2 && await details.evaluate(node=>node.open),JSON.stringify({before,after}));
      record('수동 복구는 입력 초안 유지',await page.locator('#request-input').inputValue()==='확인하는 동안 유지할 초안');
    }finally{held.release({body:recovery()});await context.close();}
  });
  for(const status of ['running','interrupted'])await scenario(`${status} 복구와 초안`,async()=>{
    const held=deferred(),{page,context,messages}=await open(1440,900,{seed:token,onResume:()=>held.promise});
    try{await page.locator('#request-input').fill('작성 중인 새 초안');await page.locator('#pref-wheelchair').check();held.release({body:recovery(status)});await page.waitForFunction(()=>!document.getElementById('resume-visit').getAttribute('aria-busy') || document.getElementById('resume-visit').getAttribute('aria-busy')==='false');
      record(`${status}는 미확인/중단을 안내하고 자동 재전송하지 않음`,messages.length===0 && (status==='running'?/처리 중/:/자동으로 다시 실행하지/).test(await page.locator('#visit-recovery-notice').textContent()));
      record(`${status} 도중 작성한 초안·변경 설정 유지`,await page.locator('#request-input').inputValue()==='작성 중인 새 초안' && await page.locator('#pref-wheelchair').isChecked());
      await submit(page,'사용자가 확인해 보낸 후속 요청');const sent=JSON.parse(messages[0].postData());record(`${status} 복구 중 바꾼 설정은 다음 요청에 반영`,sent.applyPreferences===true && sent.preferences.wheelchair===true);
    }finally{held.release({body:recovery(status)});await context.close();}
  });
  for(const [code,status] of [['SESSION_EXPIRED',404],['SESSION_STORE_UNAVAILABLE',503]])await scenario(`${code} 토큰 처리`,async()=>{
    const held=deferred(),{page,context,messages}=await open(390,500,{seed:token,onResume:()=>held.promise});
    try{await page.locator('#request-input').fill('연결 확인 중 작성한 내용');held.release({status,body:{error:{code}}});await page.waitForFunction(()=>document.getElementById('resume-visit').getAttribute('aria-busy')==='false');const saved=await storage(page);
      record(`${code}는 초안을 유지하고 만료만 참조 정리`,await page.locator('#request-input').inputValue()==='연결 확인 중 작성한 내용' && (code==='SESSION_EXPIRED'?!Object.hasOwn(saved,tokenKey):saved[tokenKey]===token));
      await submit(page,'다음 준비를 확인해 주세요.');const sent=JSON.parse(messages[0].postData());record(`${code} 뒤 새 요청의 방문 범위`,code==='SESSION_EXPIRED'?sent.visitToken!==token && sent.applyPreferences===true:sent.visitToken===token && sent.applyPreferences===false);
    }finally{held.release({status,body:{error:{code}}});await context.close();}
  });
  for(const action of ['request','reset','preview'])await scenario(`늦은 복구와 ${action}`,async()=>{
    const held=deferred(),fresh=createDemoCase(),{page,context,messages}=await open(390,500,{seed:token,onResume:()=>held.promise,onMessage:request=>({body:reply(request,fresh)})});
    try{
      if(action==='request')await submit(page,'사용자가 새로 보낸 요청입니다.');else await page.locator(action==='reset'?'#new-conversation':'#preview-button').click();
      if(action==='preview')await page.waitForFunction(()=>document.getElementById('conversation-form').getAttribute('aria-busy')==='false');
      const before=await page.locator('#case-content').textContent();held.release({body:recovery()});await settle(page);
      record(`늦은 복구는 ${action} 상태를 덮지 않음`,await page.locator('#case-content').textContent()===before && (action==='request'?messages.length===1:messages.length===0));
      if(action!=='request')record(`${action}는 탭의 참조만 정리`,!Object.hasOwn(await storage(page),tokenKey) && !/삭제했|서버.*중단했/.test(await page.locator('#conversation-status').textContent()));
    }finally{held.release({body:recovery()});await context.close();}
  });
  await scenario('이어하기 저장 차단',async()=>{
    const {page,context,messages,resumes}=await open(390,500,{blocked:true});
    try{await submit(page,'현재 탭에서 준비해 주세요.');record('저장이 막혀도 토큰을 가진 현재 요청과 안내 유지',/^[A-Za-z0-9_-]{43}$/.test(JSON.parse(messages[0].postData()).visitToken) && /저장할 수 없/.test(await page.locator('#visit-recovery-notice').textContent()));await page.reload({waitUntil:'networkidle'});record('저장 차단 뒤 새로고침은 원문/준비를 복원한 척하지 않음',resumes.length===0 && await page.locator('.message.user').count()===0);}
    finally{await context.close();}
  });
  await scenario('같은 요청 재시도의 방문 토큰',async()=>{
    const {page,context,messages}=await open(390,500,{onMessage:(request,count)=>count===1?{status:503,body:{error:{code:'SESSION_STORE_UNAVAILABLE'}}}:{body:reply(request)}});
    try{await submit(page,'같은 방문의 원래 요청');await page.locator('[data-retry]').click();await page.waitForFunction(()=>document.getElementById('conversation-form').getAttribute('aria-busy')==='false');record('실패 재시도는 같은 요청·본문·방문 토큰을 보존',messages.length===2 && messages[0].postData()===messages[1].postData() && JSON.parse(messages[0].postData()).visitToken===(await storage(page))[tokenKey]);}
    finally{await context.close();}
  });
  await scenario('미리보기 실패 뒤 방문 보존',async()=>{
    const {page,context,messages}=await open(390,500,{onPreview:()=>({status:503,body:{error:{code:'PREVIEW_UNAVAILABLE'}}})});
    try{await submit(page,'기존 방문 준비');const first=JSON.parse(messages[0].postData());await page.locator('#preview-button').click();await page.waitForFunction(()=>document.getElementById('conversation-form').getAttribute('aria-busy')==='false');record('미리보기 실패는 현재 방문의 이어하기 참조를 보존',first.visitToken===(await storage(page))[tokenKey] && /불러오지 못/.test(await page.locator('#mode-notice').textContent()));await submit(page,'기존 방문의 다음 확인');const second=JSON.parse(messages[1].postData());record('미리보기 실패 뒤 후속 요청도 같은 방문',second.visitToken===first.visitToken && second.sessionId===sessionId);}
    finally{await context.close();}
  });
  await scenario('변조된 이어하기 참조',async()=>{
    const {page,context,messages,resumes}=await open(390,500,{seed:'invalid-token'});
    try{record('잘못된 저장 토큰은 서버로 보내지 않고 정리',resumes.length===0 && !Object.hasOwn(await storage(page),tokenKey));await submit(page,'새 방문을 시작해 주세요.');record('정리 뒤 새 요청은 새 opaque 토큰',/^[A-Za-z0-9_-]{43}$/.test(JSON.parse(messages[0].postData()).visitToken));}
    finally{await context.close();}
  });
  for(const code of ['REQUEST_CONFLICT','REQUEST_IN_PROGRESS','REQUEST_INTERRUPTED'])await scenario(`${code} 사용자 인계`,async()=>{
    const {page,context,messages}=await open(390,500,{onMessage:()=>({status:409,body:{error:{code}}})});
    try{const text='확인이 필요한 같은 요청';await submit(page,text);record(`${code}는 원문 보존·자동 재실행 없음`,await page.locator('#request-input').inputValue()===text && messages.length===1 && await page.locator('.message.user.failed').count()===1 && /실행하지|처리 중/.test(await page.locator('.request-error').textContent()));}
    finally{await context.close();}
  });
  for(const [width,height] of [[1800,1125],[1440,900],[1152,720],[960,600],[720,450],[1060,900],[390,844],[390,500],[320,500],[768,512]])await scenario(`${width}x${height} 복구 작업 공간`,async()=>{
    const {page,context}=await open(width,height,{seed:token});
    try{
      await page.waitForFunction(()=>document.getElementById('visit-recovery-notice').textContent.includes('마지막으로 확인된'));const initial=await snapshot(page),projection=await projectionEvidence(page,state);record(`${width}x${height} 복구 안내도 한 화면·공통 입력·상태 기반 업무`,fit(initial) && Object.values(projection).every(Boolean),JSON.stringify(initial));
      const input=page.locator('#request-input'),draft=Array.from({length:12},(_,i)=>`${i+1}번째 방문 준비 요청입니다.`).join('\n');await input.fill(draft);await input.press('Control+End');
      await openDetails(page);const sameInput=await input.elementHandle();record(`${width}x${height} 준비 패널에서도 같은 초안·44px 읽기 확인`,fit(await snapshot(page)) && await sameInput.evaluate(node=>node===document.getElementById('request-input') && node.value.split('\n').length===12));
      if(await page.locator('#workspace-tab-chat').isVisible())await page.locator('#workspace-tab-chat').click();
      if([720,390,320].includes(width) && height<=500){await page.evaluate(()=>{const nodes=[document.body,...document.body.querySelectorAll('*')].filter(n=>n instanceof HTMLElement && !['SCRIPT','STYLE'].includes(n.tagName));const sizes=nodes.map(n=>parseFloat(getComputedStyle(n).fontSize));nodes.forEach((n,i)=>{if(sizes[i]>0)n.style.fontSize=`${sizes[i]*2}px`;});});await input.press('Control+End');record(`${width}x${height} 복구 뒤 실제32px 글자와12줄 입력 도달`,fit(await snapshot(page)) && await input.evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=32 && node.selectionEnd===node.value.length && node.scrollHeight-node.scrollTop-node.clientHeight<=Math.max(3,(parseFloat(getComputedStyle(node).lineHeight)-parseFloat(getComputedStyle(node).fontSize))/2)));}
      const path=`${directory}/recovery-${width}x${height}.png`;await page.screenshot({path:resolve(root,path)});proof.viewports.push({width,height,...initial,guidedProjection:Object.values(projection).every(Boolean),screenshot:path});
    }finally{await context.close();}
  });
  proof.finalSourceHash=await runtimeFingerprint(servedRoot);record('검사 중 실행 소스 변경 없음',proof.finalSourceHash===proof.sourceHash);record('브라우저 실행 오류 없음',errors.length===0);
  if(checks.every(check=>check.status==='pass') && !errors.length)proof.result='pass';
}catch(error){errors.push(error.message);record('복구 검사 완료',false,error.message);}
finally{await browser.close();await writeFile(resolve(root,'orchestration/runs/visit-recovery-browser.json'),JSON.stringify(proof,null,2)+'\n');console.log(`방문 이어하기 브라우저 검증: ${checks.filter(check=>check.status==='pass').length}/${checks.length}`);if(proof.result!=='pass')process.exitCode=1;}
