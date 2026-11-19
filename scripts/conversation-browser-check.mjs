import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFingerprint } from '../orchestration/checks.mjs';
import { createDemoCase, applyAction } from '../app/domain.js';
import { getVisitSupportSummary } from '../app/visit-support.js';
import { getPreparationWorkflow } from '../app/preparation-workflow.js';
import supportData from '../app/data/visit-support-providers.json' with {type:'json'};

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const servedRoot=process.env.QA_SERVED_SOURCE_ROOT?resolve(process.env.QA_SERVED_SOURCE_ROOT):root;
const require=createRequire(import.meta.url);
let chromium;
try {({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}
catch {throw new Error('선택 QA 도구 Playwright가 필요합니다. README의 브라우저 검사 절차를 참고하세요.');}
const base=new URL(process.env.BASE_URL||'http://127.0.0.1:4173');
// 이 검사는 실제 503/고정 preview와 주입 응답을 함께 쓴다. 공개 유료 서버에서는 실행하지 않는다.
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname) || !['http:','https:'].includes(base.protocol) || base.username || base.password)throw new Error('BASE_URL은 키를 끈 localhost QA 서버여야 합니다.');
const directory='.impeccable/review/chat-rail/product-redesign/conversation';
const storageKey='jeju-care-preferences-v1';
const fixtureSessionId='q'.repeat(43);
const configuredCaps={llm:true,model:'gpt-6.1-sol',phone:'simulation',healthRecords:'demo',voiceInput:'browser'};
await mkdir(resolve(root,directory),{recursive:true});
await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--disable-dev-shm-usage']});
const checks=[],errors=[];
const record=(name,ok,detail='')=>{checks.push({name,status:ok?'pass':'fail',detail});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' · '+detail:''}`);};
const proof={result:'fail',checkedAt:new Date().toISOString(),url:base.href,sourceHash:await runtimeFingerprint(servedRoot),invokingSourceHash:await runtimeFingerprint(root),checks,errors,apiLive:false,modelInvoked:false,phoneInvoked:false,healthRecordsQueried:false,microphone:'permission-denied, transcript-review and delayed-abort fixtures only',fixedPreview:false,normalInputDisconnected:false,keylessDisconnectedInitialCheckCount:0,actualHttpPostCounts:{agent:0,preview:0},desktop:{width:1440,height:900,noOverflow:false},mobile:{width:390,height:844,noOverflow:false},interfaceScenarios:[],loadingScenarios:[],lazyRecordScenarios:[],supportReasonScenarios:[],lastAnswerRecovery:[],textDraftScenarios:[],voiceFeedbackScenarios:[],fixtureCoverage:{lastAnswerRecovery:false,preferences:false,markdown:false,recovery:false,voiceReview:false,voiceCancellation:false,exampleDrafts:false,cancellation:false,contactPlan:false,shortViewport:false},shortViewport:[],runtimeAssets:[],sourceHashScope:process.env.QA_SERVED_SOURCE_ROOT?'explicit QA_SERVED_SOURCE_ROOT; served UI assets compared below':'invoking checkout; served UI assets compared below'};
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1 && scrollY===0);
const json=request=>JSON.parse(request.postData());
const hashMatches=request=>request.headers()['x-amz-content-sha256']===createHash('sha256').update(request.postDataBuffer()).digest('hex');
const snapshotStorage=page=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
const samePreferences=(a,b)=>a?.taxiProviderId===b?.taxiProviderId && a?.wheelchair===b?.wheelchair && a?.companionNeeded===b?.companionNeeded;
const exactPreferenceShape=value=>value && Object.keys(value).sort().join(',')==='companionNeeded,taxiProviderId,wheelchair' && typeof value.taxiProviderId==='string' && typeof value.wheelchair==='boolean' && typeof value.companionNeeded==='boolean';
async function screenshot(page,name) {
  const path=`${directory}/conversation-${name}.png`;
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await page.screenshot({path:resolve(root,path),fullPage:true});
  return path;
}
async function showView(page,view) {
  for(const id of ['request-examples','composer-help']){const details=page.locator('#'+id);if(await details.evaluate(node=>node.open))await details.locator(':scope>summary').click();}
  const tab=page.locator('#workspace-tab-'+view);
  if(await tab.isVisible() && await tab.getAttribute('aria-selected')!=='true')await tab.click();
}
async function reveal(locator) {
  const page=locator.page(),{view,stage}=await locator.evaluate(node=>({view:node.closest('#preparation-rail')?'preparation':node.closest('#chat-workspace')?'chat':null,stage:node.closest('#preparation-board>[data-stage-id]')?.dataset.stageId}));
  const target=await locator.elementHandle();
  if(!await page.locator('dialog[open]').count())for(const id of ['request-examples','composer-help']) {
    const popup=page.locator('#'+id);
    if(await popup.evaluate((node,target)=>node.open && !node.contains(target),target))await popup.locator(':scope>summary').click();
  }
  if(stage && await locator.evaluate(node=>node.closest('[data-stage-id]').hidden)) {
    await showView(page,'preparation');
    await page.locator('#stage-navigation>button[data-open-stage="'+stage+'"]').click();
    await showView(page,'chat');
  } else if(view)await showView(page,view);
  for(const details of await locator.locator('xpath=ancestor::details').all())if(!await details.evaluate((node,target)=>node.open || node.querySelector(':scope>summary')?.contains(target),target))await details.locator(':scope>summary').click();
}
async function workspaceEvidence(page) {
  return page.evaluate(()=>{
    const chat=document.getElementById('chat-workspace'),rail=document.getElementById('preparation-rail'),input=document.getElementById('request-input'),form=document.getElementById('conversation-form'),composer=document.getElementById('chat-composer'),compact=matchMedia('(max-width:900px), (max-height:650px)').matches,layout=document.querySelector('.conversation-layout');
    const bounds=node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};},inside=node=>{const r=bounds(node);return r.width>0 && r.height>0 && r.top>=-1 && r.bottom<=innerHeight+1 && r.left>=-1 && r.right<=innerWidth+1;};
    const regions=[document.getElementById('conversation-scroll'),rail].map(node=>({id:node.id,...bounds(node),clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,scrollTop:node.scrollTop,overflowY:getComputedStyle(node).overflowY,fontSize:parseFloat(getComputedStyle(node.querySelector('.message-body')||node).fontSize),active:!node.closest('[hidden],[inert]')}));
    const cards=[...document.querySelectorAll('#preparation-board>[data-stage-id]')],selected=cards.filter(node=>!node.hidden&&!node.inert),navigation=[...document.querySelectorAll('#stage-navigation>button[data-open-stage]')],tabs=[...document.querySelectorAll('[role="tab"][id^="workspace-tab-"]')],active=layout.dataset.activeView==='preparation'?rail:chat,inactive=active===chat?rail:chat;
    const composerBottomAnchored=[innerHeight,bounds(document.querySelector('.page-main')).bottom,bounds(document.querySelector('.app-shell')).bottom].every(bottom=>Math.abs(bounds(composer).bottom-bottom)<=1);
    return {composerBottomAnchored,viewportFit:composerBottomAnchored && document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1 && document.body.scrollHeight<=innerHeight+1 && scrollY===0 && inside(document.querySelector('.app-shell')),sharedComposer:document.querySelectorAll('#request-input,#conversation-form,#chat-composer').length===3 && composer.contains(form) && form.contains(input) && !composer.closest('[hidden],[inert]') && [input,document.getElementById('send-request')].every(inside),scrollRegions:regions.every(region=>/auto|scroll/.test(region.overflowY) && (!region.active || region.clientHeight>=Math.max(44,region.fontSize*1.2))) && cards.length===4 && selected.length===1 && cards.every(node=>! /auto|scroll|hidden|clip/.test(getComputedStyle(node).overflowY) && (node.hidden?node.inert:node.scrollHeight<=node.clientHeight+2)) && navigation.length===4,compactPanels:compact?chat.getAttribute('role')==='tabpanel' && rail.getAttribute('role')==='tabpanel' && tabs.length===2 && tabs.every(node=>node.getAttribute('aria-controls')===(node.id==='workspace-tab-chat'?'chat-workspace':'preparation-rail')) && tabs.filter(node=>node.getAttribute('aria-selected')==='true').length===1 && active.hidden===false && !active.inert && inactive.hidden && inactive.inert && !inactive.contains(document.activeElement) && tabs.every(node=>node.tabIndex===(node.getAttribute('aria-selected')==='true'?0:-1)):!chat.hidden && !rail.hidden && !chat.inert && !rail.inert,regions,compact,activeView:layout.dataset.activeView,selectedStage:selected[0]?.dataset.stageId,currentStage:document.getElementById('preparation-board').dataset.currentStage,navigationCount:navigation.length,composer:bounds(composer),body:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}};
  });
}
async function scenario(name,run) {
  try {await run();} catch(error) {errors.push(`${name}: ${error.message}`);record(name,false,error.message);}
}
async function open(width,height,{configured=false,voice,storageSeed,onPost}={}) {
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',locale:'ko-KR'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base.origin?route.continue():route.abort());
  const page=await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(error.message));
  const requests=[],networkRequests=[];
  page.on('request',request=>{
    if(['fetch','xhr'].includes(request.resourceType()))networkRequests.push(request);
    if(request.method()==='POST' && new URL(request.url()).origin===base.origin && new URL(request.url()).pathname.startsWith('/api/agent')) {
      requests.push(request);const path=new URL(request.url()).pathname;
      if(path==='/api/agent' && !onPost)proof.actualHttpPostCounts.agent++;
      if(path==='/api/agent/preview')proof.actualHttpPostCounts.preview++;
    }
  });
  if(storageSeed!==undefined)await page.addInitScript(({key,value})=>localStorage.setItem(key,value),{key:storageKey,value:storageSeed});
  if(voice)await page.addInitScript(mode=>{
    window.SpeechRecognition=class {
      constructor(){this.stopCalls=0;if(mode==='delayed')(window.__qaSpeech ||= []).push(this);}
      start(){
        this.onstart?.();
        if(mode==='denied')queueMicrotask(()=>{this.onerror?.({error:'not-allowed'});this.onend?.();});
        else window.__qaFinishSpeech=()=>{const result=[{transcript:'11월 12일 어머니 이동을 준비해 주세요.'}];result.isFinal=true;this.onresult?.({resultIndex:0,results:[result]});this.onend?.();};
      }
      stop(){this.stopCalls++;this.onend?.();}
      abort(){if(mode!=='delayed')this.onend?.();}
    };
  },voice);
  if(configured)await page.route('**/api/agent/capabilities',route=>route.fulfill({json:configured===true?configuredCaps:configured}));
  if(onPost)await page.route('**/api/agent',async route=>{
    if(route.request().method()!=='POST')return route.abort();
    const answer=await onPost(route.request());
    await route.fulfill({status:answer.status??200,json:answer.body});
  });
  await page.goto(base.href,{waitUntil:'networkidle'});
  await page.locator('#open-existing-preparation').click();
  await page.locator('#request-input').waitFor();
  await page.waitForFunction(expected=>document.querySelector('#connection-state')?.textContent===expected,configured?'대화 연결 설정됨':'AI 모델 미연결');
  await page.evaluate(()=>document.fonts.ready);
  return {page,context,requests,networkRequests};
}
async function readConversation(page) {
  await showView(page,'chat');
  const history=page.locator('#conversation-history');
  if(!await history.evaluate(node=>node.open))await history.locator(':scope>summary').click();
  await page.locator('.chat-workspace #conversation-scroll').waitFor({state:'visible'});
}
async function openVisitSummary(page) {
  await showView(page,'preparation');
  for(const id of ['visit-summary','case-summary']) {
    const details=page.locator(`#${id}`);
    if(await details.evaluate(node=>node instanceof HTMLDetailsElement && !node.open))await details.locator(':scope>summary').click();
  }
}
async function send(page,text) {
  await page.locator('#request-input').fill(text);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent' && r.request().method()==='POST');
  const [result]=await Promise.all([response,page.locator('#send-request').click()]);
  await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
  await readConversation(page);
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(done)));
  return result;
}
async function confirmAction(page,selector,accept=true) {
  let dialogType='',message='';
  page.once('dialog',async dialog=>{dialogType=dialog.type();message=dialog.message();if(accept)await dialog.accept();else await dialog.dismiss();});
  const target=typeof selector==='string'?page.locator(selector):selector;await reveal(target);await target.click();
  return {confirmed:dialogType==='confirm',message};
}
async function editPreferences(page,values) {
  const mobile=await page.locator('#open-care-menu').isVisible();
  if(mobile)await page.locator('#open-care-menu').click();
  await reveal(page.locator('#pref-taxi'));
  await page.locator('#pref-taxi').selectOption(values.taxiProviderId);
  await page.locator('#pref-wheelchair').setChecked(values.wheelchair);
  await page.locator('#pref-companion').setChecked(values.companionNeeded);
  if(mobile)await page.keyboard.press('Escape');
}
function preparedState(preferences) {
  let state=applyAction(createDemoCase(),{type:'SUPPORT_UPDATE_REQUIREMENTS',values:{wheelchair:preferences.wheelchair,companionNeeded:preferences.companionNeeded}});
  const id=preferences.wheelchair?'jeju-accessible-transport':preferences.taxiProviderId==='auto'?'taxi327-14':preferences.taxiProviderId;
  const provider=supportData.providers.find(item=>item.id===id);
  state=applyAction(state,{type:'SUPPORT_SELECT_PROVIDER',kind:'taxi',provider});
  return applyAction(state,{type:'SUPPORT_PREPARE_INQUIRY',kind:'taxi'});
}
function fixtureResponse(request,state,reply='합성 준비 상태를 확인했습니다.') {
  return {sessionId:fixtureSessionId,requestId:json(request).requestId,reply,caseState:state,events:[{id:'fixture-taxi',tool:'prepare_inquiries',label:'택시 문의 초안 준비',status:'completed',detail:'브라우저 응답 fixture입니다. 실제 발신·예약을 하지 않았습니다.',isSimulation:true,source:'https://jejudatahub.net/data/view/data/327'}],pendingActions:[{id:'fixture-confirm',kind:'support',label:'문의처에 가능 시간 확인',reason:'실제 배차·예약 미확정'}],capabilities:configuredCaps,needsInput:true};
}
async function disclosure(page) {
  const short=page.locator('#composer-disclosure'),full=page.locator('#composer-boundary');
  return (await reachable(short)).reachable && /시연.*실행.*없음/.test(await short.innerText()) && (await reachable(full)).reachable && /가상/.test(await full.innerText()) && /실제.*(?:연락|발신).*예약.*없음/.test(await full.innerText()) && await page.locator('#request-input').evaluate(node=>node.getAttribute('aria-describedby').split(/\s+/).includes('composer-boundary'));
}
async function backgroundLoaded(page) {
  return page.evaluate(async()=>{
    const path='/assets/jeju-workspace-background-v1.webp';
    const nodes=[document.documentElement,document.body,...document.querySelectorAll('.app-shell,.workspace-shell')];
    if(!nodes.some(node=>[null,'::before','::after'].some(pseudo=>getComputedStyle(node,pseudo).backgroundImage.includes(path))))return false;
    const image=new Image();image.src=path;
    try {await image.decode();return image.naturalWidth>0;} catch {return false;}
  });
}
async function openPatientRecords(page) {
  if(await page.locator('#open-care-menu').isVisible())await page.locator('#open-care-menu').click();
  await page.locator('#nav-patient-records').click();
  const panel=page.locator('#patient-records-dialog');await panel.waitFor();await page.evaluate(()=>document.fonts.ready);return panel;
}
async function closePatientRecords(page,{escape=false}={}) {
  if(escape)await page.keyboard.press('Escape');else await page.locator('#close-patient-records').click();
  await page.locator('#patient-records-dialog').waitFor({state:'hidden'});
  const expected=await page.locator('#open-care-menu').isVisible()?'open-care-menu':'nav-patient-records';
  await page.waitForFunction(id=>document.activeElement.id===id,expected);return true;
}
async function recordsMatch(panel,state) {
  const labels={ready:/보유|준비/,missing:/미준비|없|미보유|필요|누락/,not_performed:/미시행|미수행|시행\s*전/};
  if(await panel.locator('[data-record-document-id]').count()!==state.documents.length)return false;
  for(const document of state.documents) {
    const row=panel.locator(`[data-record-document-id="${document.id}"]`);
    if(!await row.evaluate(node=>node.open))await row.locator('summary').click();
    const status=row.locator('[data-record-status]');
    if(await status.getAttribute('data-status')!==document.status || !labels[document.status]?.test(await status.textContent()))return false;
    for(const field of ['source','content'])if(document[field] && (!await row.locator(`[data-record-${field}]`).isVisible() || !(await row.locator(`[data-record-${field}]`).textContent()).includes(document[field])))return false;
  }
  return true;
}
const highwayDisconnected=async panel=>(await panel.locator('#health-highway-status').innerText()).trim()==='미연결' && /불러온 기록 없음/.test(await panel.locator('#health-highway-last-sync').innerText());
const normalizedText=value=>value.replace(/\s+/g,' ').trim();
const previewNotice=text=>/작성된 예시/.test(text) && /합성/.test(text) && /실제.*(?:연락|발신).*예약.*없음/.test(text);
const draftFeedbackState=(page,originalInput)=>page.evaluate(original=>{
  const input=document.getElementById('request-input'),feedback=document.getElementById('draft-feedback'),help=document.getElementById('composer-help'),voice=document.getElementById('voice-help');
  return {sameInput:input===original && document.querySelectorAll('#request-input').length===1,editable:!input.disabled&&!input.readOnly,inputFocused:document.activeElement===input,helpClosed:!help.open,voiceQuiet:voice.hidden&&voice.textContent==='',inlineVisible:feedback.checkVisibility({visibilityProperty:true})&&!feedback.hidden&&Boolean(feedback.textContent.trim()),inlineStatus:feedback.getAttribute('role')==='status'&&feedback.classList.contains('draft-feedback'),inlinePlacement:feedback.previousElementSibling?.id==='conversation-form'&&feedback.nextElementSibling?.classList.contains('composer-notes'),text:feedback.textContent,cleared:feedback.hidden&&feedback.textContent===''};
},originalInput);
const settleUI=page=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
// 화면 아래에 있는 문구는 사용자가 스크롤할 수 있으면 접근 가능하다.
// overflow:hidden 조상을 프로그램으로 움직여서만 보인 경우는 통과시키지 않는다.
async function reachable(locator) {
  await reveal(locator);
  const before=await locator.evaluate(node=>{
    const r=node.getBoundingClientRect(),ancestors=[];
    for(let parent=node.parentElement;parent;parent=parent.parentElement)ancestors.push({top:parent.scrollTop,left:parent.scrollLeft,locked:/^(hidden|clip)$/.test(getComputedStyle(parent).overflowY)});
    return {initial:r.bottom<=0?'above-fold':r.top>=innerHeight?'below-fold':r.top<0 || r.bottom>innerHeight?'partly-in-viewport':'in-viewport',ancestors};
  });
  try {await locator.scrollIntoViewIfNeeded({timeout:3000});}
  catch(error) {return {initial:before.initial,reachable:false,reason:error.message};}
  return locator.evaluate((node,before)=>{
    const r=node.getBoundingClientRect(),s=getComputedStyle(node);
    let top=0,bottom=innerHeight,left=0,right=innerWidth,hiddenScroll=false,index=0;
    for(let parent=node.parentElement;parent;parent=parent.parentElement,index++) {
      const style=getComputedStyle(parent),p=parent.getBoundingClientRect(),old=before.ancestors[index];
      if(old?.locked && (Math.abs(parent.scrollTop-old.top)>1 || Math.abs(parent.scrollLeft-old.left)>1))hiddenScroll=true;
      if(/^(hidden|clip|auto|scroll)$/.test(style.overflowY)){top=Math.max(top,p.top+parent.clientTop);bottom=Math.min(bottom,p.top+parent.clientTop+parent.clientHeight);}
      if(/^(hidden|clip|auto|scroll)$/.test(style.overflowX)){left=Math.max(left,p.left+parent.clientLeft);right=Math.min(right,p.left+parent.clientLeft+parent.clientWidth);}
    }
    const selfClipped=/^(hidden|clip)$/.test(s.overflowY) && node.scrollHeight>node.clientHeight+2;
    const fits=(r.top>=top-2 && r.bottom<=bottom+2 || !node.matches('button,input,select,textarea,summary,a') && r.height>bottom-top && r.bottom>top && r.top<bottom && bottom-top>=parseFloat(s.fontSize)*1.2) && r.left>=left-2 && r.right<=right+2;
    return {initial:before.initial,reachable:s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0 && fits && !hiddenScroll && !selfClipped,hiddenScroll,selfClipped,rect:{top:Math.round(r.top),bottom:Math.round(r.bottom)},visibleRange:{top:Math.round(top),bottom:Math.round(bottom)}};
  },before);
}
async function accessSet(page,selectors) {
  const result={};
  for(const selector of selectors)result[selector]=await reachable(page.locator(selector));
  return result;
}
async function openContactPlan(page) {
  if(await page.locator('#open-care-menu').isVisible())await page.locator('#open-care-menu').click();
  await page.locator('#nav-contact-plan').click();
  const panel=page.locator('#contact-plan-dialog');await panel.waitFor();await page.evaluate(()=>document.fonts.ready);return panel;
}
async function closeContactPlan(page,{escape=false}={}) {
  if(escape)await page.keyboard.press('Escape');else await page.locator('#close-contact-plan').click();
  await page.locator('#contact-plan-dialog').waitFor({state:'hidden'});
  const expected=await page.locator('#open-care-menu').isVisible()?'open-care-menu':'nav-contact-plan';
  await page.waitForFunction(id=>document.activeElement.id===id,expected);return true;
}
// AbortSignal을 일부러 무시한다. 중지 후 늦게 도착한 fetch 결과와 이전 finally의 경합을 검사한다.
async function deferAgentFetch(page) {
  await page.evaluate(()=>{
    const original=window.fetch.bind(window),calls=[],pending=[];
    window.__qaDeferredAgent={calls,settle(index,status,body,errorName){
      if(!pending[index] || pending[index].settled)throw new Error('알 수 없거나 이미 완료한 fixture');
      const request=pending[index];request.settled=true;
      if(errorName)request.reject(new DOMException('지연 응답 fixture',errorName));
      else request.resolve(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}));
    }};
    window.fetch=(input,options={})=>{
      const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
      if(options.method!=='POST' || !['/api/agent','/api/agent/preview'].includes(path))return original(input,options);
      return new Promise((resolve,reject)=>{
        const index=calls.length;
        calls.push({path,body:options.body,headers:Object.fromEntries(new Headers(options.headers)),aborted:options.signal?.aborted===true});
        pending.push({resolve,reject,settled:false});
        options.signal?.addEventListener('abort',()=>{calls[index].aborted=true;},{once:true});
      });
    };
  });
}
async function deferredCall(page,index) {
  await page.waitForFunction(index=>window.__qaDeferredAgent?.calls.length>index,index);
  return page.evaluate(index=>window.__qaDeferredAgent.calls[index],index);
}
async function releaseDeferred(page,index,body,{status=200,errorName}={}) {
  await page.evaluate(({index,status,body,errorName})=>window.__qaDeferredAgent.settle(index,status,body,errorName),{index,status,body,errorName});
  await settleUI(page);
}
const deferredHashMatches=call=>call.headers['x-amz-content-sha256']===createHash('sha256').update(call.body).digest('hex');
const deferredResponse=(call,state,reply)=>fixtureResponse({postData:()=>call.body},state,reply);
try {
  const capResponse=await fetch(new URL('/api/agent/capabilities',base));
  const caps=await capResponse.json();
  const keyless=capResponse.status===200 && caps.llm===false && caps.phone!=='connected' && caps.healthRecords!=='connected';
  record('실제 capabilities는 모델·전화·공단 실제 연동을 표시하지 않음',keyless);
  record('API 응답 캐시 금지',capResponse.headers.get('cache-control')==='no-store');
  if(!keyless)throw new Error('실제 모델이 연결됐거나 keyless 상태를 확인하지 못해 POST 검사를 중단합니다.');
  proof.apiLive=true;
  for(const path of ['conversation.js','conversation.css','patient-records.js','health-records.js','data/fhir-demo-bundle.json','preparation-board-view.js','preparation-stages.js','preparation-workflow.js','visit-support.js','icons.js','assets/pretendard/pretendardvariable-dynamic-subset.css']) {
    const response=await fetch(new URL('/'+path,base),{redirect:'error',signal:AbortSignal.timeout(8000)});
    const expected=await readFile(resolve(servedRoot,'app',path));
    const hash=value=>createHash('sha256').update(value).digest('hex');
    proof.runtimeAssets.push({path,matching:response.status===200 && hash(await response.text())===hash(expected),sourceHash:hash(expected)});
  }
  record('실제 제공 UI 자산은 명시한 runtime source와 동일',proof.runtimeAssets.every(item=>item.matching));
  for(const [width,height,label] of [[1440,900,'desktop'],[390,844,'mobile']])await scenario(`${width}px 실제 API 시나리오`,async()=>{
    const {page,context,requests,networkRequests}=await open(width,height);
    try {
      Object.assign(proof[label],await workspaceEvidence(page));
      proof[label].noOverflow=await overflow(page);
      proof[label].screenshot=await screenshot(page,`initial-${label}`);
      const initialComposer=await page.locator('#request-input,#send-request').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {id:node.id,top:r.top,bottom:r.bottom,inViewport:r.top>=0 && r.bottom<=innerHeight && r.width>0 && r.height>0};}));
      const composerAccess=await accessSet(page,['#request-input','#send-request']);
      record(`${width}px 앱 넘침 없이 하단 공통 입력·보내기에 접근`,proof[label].noOverflow && Object.values(composerAccess).every(item=>item.reachable),JSON.stringify({initialComposer,composerAccess}));
      proof[label].chatLayout=await page.evaluate(()=>{
        const chat=document.getElementById('chat-workspace'),rail=document.getElementById('preparation-rail'),board=document.getElementById('preparation-board'),conversation=document.getElementById('conversation-scroll'),messages=document.getElementById('message-list'),composer=document.getElementById('chat-composer'),form=document.getElementById('conversation-form');
        return Boolean(chat && rail && chat.parentElement===rail.parentElement && chat.parentElement.matches('.conversation-layout') && rail.contains(document.getElementById('stage-navigation')) && chat.contains(conversation) && conversation.contains(board) && conversation.contains(document.getElementById('current-preparation-task')) && conversation.contains(messages) && document.getElementById('conversation-history') instanceof HTMLDetailsElement && document.getElementById('conversation-history').contains(messages) && !board.contains(messages) && composer.parentElement===chat.parentElement && composer.contains(form) && !chat.contains(form) && !rail.contains(form) && document.querySelector('.workspace-tools #expand-answer') && document.querySelectorAll('#message-list,#conversation-scroll,#conversation-form,#request-input').length===4 && !board.querySelector('.message,#conversation-form') && !document.querySelector('.chat-identity,.chat-role,#conversation-title'));
      });
      record(`${width}px 중앙 단일 업무·보조 대화 기록·단계 안내와 공통 입력 분리`,proof[label].chatLayout);
      await showView(page,'preparation');
      record(`${width}px 네 단계 탐색·단일 본문·hidden/inert·보조 기록 DOM 유지`,await page.locator('#preparation-board>[data-stage-id]').evaluateAll(nodes=>nodes.length===4 && nodes.filter(node=>!node.hidden&&!node.inert).length===1 && nodes.every(node=>node.hidden===node.inert)) && await page.locator('#stage-navigation>button[data-open-stage]').count()===4 && await page.locator('#preparation-board>.stage-pane>.stage-pane-header .signal-mark').count()===4 && await page.locator('#preparation-board>.stage-pane>.stage-pane-header .stage-topic-icon').count()===4 && await page.locator('[data-stage-details]').evaluateAll(nodes=>nodes.length===4 && nodes.every(node=>node instanceof HTMLDetailsElement)) && await page.locator('#conversation-history').evaluate(node=>node instanceof HTMLDetailsElement && !node.open) && await page.locator('#preparation-details').count()===0 && await page.locator('[data-case-status]').count()===4);
      const loading=await page.evaluate(()=>{const fonts=performance.getEntriesByType('resource').map(entry=>new URL(entry.name)).filter(url=>url.pathname.endsWith('.woff2')).map(url=>url.pathname),preloads=[...document.querySelectorAll('link[rel="preload"][as="font"]')].map(node=>new URL(node.href).pathname),style=getComputedStyle(document.getElementById('request-input'));return {fonts,preloads,subsetFonts:fonts.length>0&&fonts.every(path=>path.startsWith('/assets/pretendard/woff2-dynamic-subset/')),oldWholeFontAbsent:!fonts.some(path=>path.endsWith('/PretendardVariable.woff2')),maruDeferred:!fonts.some(path=>path.endsWith('/MaruBuri-SemiBold.woff2')),wholeFontPreloadsAbsent:!preloads.some(path=>/PretendardVariable\.woff2$|MaruBuri-SemiBold\.woff2$/.test(path)),inputFamily:style.fontFamily.includes('Pretendard'),inputFontPx:parseFloat(style.fontSize)};});
      record(`${width}px 초기 폰트는 자체 호스팅 분할본·닫힌 창 제목 폰트 지연·입력16px`,loading.subsetFonts&&loading.oldWholeFontAbsent&&loading.maruDeferred&&loading.wholeFontPreloadsAbsent&&loading.inputFamily&&loading.inputFontPx>=16,JSON.stringify(loading));proof.loadingScenarios.push({width,...loading});
      await readConversation(page);
      record(`${width}px 로고·자가 호스팅 Pretendard·제주 배경, 인물사진 비노출`,await page.locator('.brand img').first().evaluate(e=>e.complete && e.naturalWidth>0) && await backgroundLoaded(page) && await page.locator('.welcome-photo').count()===0 && await page.evaluate(()=>getComputedStyle(document.body).fontFamily.includes('Pretendard') && [...document.fonts].some(font=>font.family.replaceAll('"','')==='Pretendard' && font.status==='loaded')));
      const newChatNamed=await page.getByRole('button',{name:'새 대화',exact:true}).count()===1 && await page.locator('#new-conversation').getAttribute('title')==='새 대화',flow=page.locator('#preview-button'),examples=page.locator('#request-examples>summary'),distinctExamples=await page.getByRole('button',{name:'준비 결과 예시 보기',exact:true}).count()===1&&await flow.getAttribute('title')==='선택 없이 준비 결과 예시 보기'&&normalizedText(await flow.innerText())==='결과 예시'&&await examples.getAttribute('aria-label')==='요청 예시'&&await examples.getAttribute('title')==='요청 예시'&&normalizedText(await examples.innerText())==='요청 예시';
      record(`${width}px 새 대화의 이름·title과 체험/요청 예시의 두 동작 명칭 구분`,newChatNamed&&distinctExamples);
      await examples.focus();await page.keyboard.press('Enter');const draftExamplesReadOnly=await page.locator('#request-examples').evaluate(node=>node.open)&&requests.length===0&&await page.locator('#request-input').inputValue()==='';await page.keyboard.press('Enter');
      record(`${width}px 요청 예시 펼치기는 고정 흐름이나 모델 요청을 실행하지 않음`,draftExamplesReadOnly&&requests.length===0);
      const interfaceSample={width,newChatNamed,distinctExamples,draftExamplesReadOnly,actualFixedFlow:false};proof.interfaceScenarios.push(interfaceSample);
      record(`${width}px 설정은 선택이며 준비 대화에 필수 수동 폼 없음`,await page.locator('#conversation-form select,#conversation-form input[type=checkbox]').count()===0 && await page.locator('#preferences-form [required]').count()===0 && await page.locator('#preferences-form select').count()===1);
      record(`${width}px 입력 가까이 실제 연락·예약 한계 표시`,await disclosure(page));
      const input=page.locator('#request-input');
      const initialNetwork=networkRequests.length;
      await input.fill('환자정보를 보기 전 작성한 요청');
      let panel=await openPatientRecords(page);
      record(`${width}px 환자정보는 합성 현재 상태의 읽기 전용 native dialog`,await panel.evaluate(node=>node instanceof HTMLDialogElement && node.open && node.matches(':modal') && node.contains(document.activeElement) && Boolean(document.getElementById(node.getAttribute('aria-labelledby'))?.textContent.trim())) && await panel.locator('[data-patient-field]').count()===8 && (await panel.locator('[data-patient-field="name"]').textContent()).includes(createDemoCase().patient.name) && await recordsMatch(panel,createDemoCase()) && await highwayDisconnected(panel) && await panel.locator('input:not([readonly]),textarea:not([readonly]),select,[contenteditable=true]').count()===0);
      const fhir=panel.locator('#fhir-demo-records'),reportRecord=fhir.locator('[data-fhir-record-id="demo-report"]');
      await reportRecord.locator('summary').click();
      record(`${width}px 합성 FHIR 출처·작성일·미반영 판독문을 실제 준비와 구분`,/혼디 고정 합성 FHIR.*2026.*11.*08.*7개 리소스/.test(await fhir.locator('[data-fhir-source-label]').innerText()) && /미반영/.test(await reportRecord.locator('[data-fhir-value]').innerText()) && !(await reportRecord.locator('[data-fhir-detail]').innerText()).includes('[고정 합성 판독문 보유 예시]') && await fhir.locator('[data-fhir-record-id]').count()===5);
      await fhir.locator('[data-fhir-original]>summary').click();
      const original=JSON.parse(await fhir.locator('[data-fhir-json]').textContent());
      record(`${width}px 읽기 전용 FHIR 원본은 자체 합성 환자의7개 리소스`,original.resourceType==='Bundle' && original.type==='collection' && original.entry.length===7 && original.meta.tag.some(tag=>tag.code==='synthetic') && original.entry.some(({resource})=>resource.resourceType==='Patient' && resource.name[0].text==='김정희') && networkRequests.length===initialNetwork);
      await screenshot(page,`fhir-records-${label}`);
      await fhir.locator('[data-fhir-original]>summary').click();
      const temperature=fhir.locator('[data-fhir-record-id="demo-temperature"]'),medication=fhir.locator('[data-fhir-record-id="demo-medication"]');
      await temperature.locator('summary').click();await medication.locator('summary').click();
      record(`${width}px 합성 체온과 과거 복약은 실제 측정·현재 복용과 구분`,/36\.5 °C/.test(await temperature.locator('[data-fhir-value]').innerText()) && /실제 측정.*나타내지 않습니다/.test(await temperature.locator('[data-fhir-detail]').innerText()) && /아세트아미노펜.*가상 복약/.test(await medication.locator('[data-fhir-value]').innerText()) && /종료된 가상 이력.*현재 복용.*의미하지 않습니다/.test(await medication.locator('[data-fhir-detail]').innerText()));
      await fhir.locator('h3').scrollIntoViewIfNeeded();await screenshot(page,`fhir-summary-${label}`);
      const mobile=await page.locator('#open-care-menu').isVisible();
      record(`${width}px 환자정보 Escape는 초안과 focus를 복원`,(!mobile || await page.locator('#care-rail').evaluate(node=>node.inert && node.getAttribute('role')!=='dialog')) && await closePatientRecords(page,{escape:true}) && await input.inputValue()==='환자정보를 보기 전 작성한 요청');
      panel=await openPatientRecords(page);
      record(`${width}px 환자정보 닫기·다시 열기는 외부 조회나 저장을 만들지 않음`,await closePatientRecords(page) && networkRequests.length===initialNetwork && Object.keys(await snapshotStorage(page)).length===0);
      await input.fill('어머니 진료 준비를 부탁합니다.');
      await input.dispatchEvent('compositionstart');
      await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});
      await input.dispatchEvent('compositionend');await input.press('Shift+Enter');
      record(`${width}px 한글 조합·줄바꿈 중 미전송`,requests.length===0 && (await input.inputValue()).endsWith('\n'));
      const normal=await send(page,'모델 연결 전 자유 입력입니다.');
      await page.locator('.request-error').waitFor();
      const normalPayload=await normal.json(),disconnected=normal.status()===503 && normalPayload.error?.code==='MODEL_NOT_CONNECTED';
      proof.normalInputDisconnected ||= disconnected;if(disconnected)proof.keylessDisconnectedInitialCheckCount++;
      record(`${width}px 자유 입력은 실제 503·입력 보존·가짜 응답 없음`,disconnected && await input.inputValue()==='모델 연결 전 자유 입력입니다.' && await page.locator('.message.assistant:not(.greeting)').count()===0 && await page.locator('.message.user').count()===1 && await page.locator('.tool-record').count()===0);
      const first=requests.at(-1);
      record(`${width}px guided 준비 범위와 동일 JSON UTF-8 SHA256`,json(first).guidedPreparation===true && hashMatches(first));
      const retryResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent' && r.request().method()==='POST');
      await page.locator('[data-retry]').click();await retryResponse;
      await page.waitForFunction(()=>document.querySelector('[data-retry]') && document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
      record(`${width}px 같은 요청 재시도는 ID·본문 보존`,requests.at(-1).postData()===first.postData() && await page.locator('.message.user').count()===1);
      await screenshot(page,`error-${label}`);
      const cancelled=await confirmAction(page,'#new-conversation',false);
      record(`${width}px 새 대화 취소는 초안·처리 이력 보존`,cancelled.confirmed && await input.inputValue()==='모델 연결 전 자유 입력입니다.' && await page.locator('.message.user').count()===1);
      const accepted=await confirmAction(page,'#new-conversation');
      record(`${width}px 새 대화 확인 뒤 초기화`,accepted.confirmed && await page.locator('.message').count()===1 && await input.inputValue()==='' && await page.locator('#save-report').isDisabled());
      const previewResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent/preview');
      await page.locator('#preview-button').click();
      const preview=await previewResponse,payload=await preview.json();
      await page.waitForFunction(()=>document.querySelectorAll('.tool-record').length===15);
      await readConversation(page);
      const previewOk=preview.status()===200 && payload.isPreview===true && payload.capabilities.llm===false && payload.events.length===15;
      const previewFrame=await workspaceEvidence(page);interfaceSample.previewComposerBottomAnchored=previewFrame.composerBottomAnchored;
      record(`${width}px 체험 뒤에도 같은 입력이 화면·작업 영역 바닥에 고정`,previewFrame.composerBottomAnchored&&previewFrame.viewportFit&&previewFrame.sharedComposer,JSON.stringify(previewFrame));
      proof.fixedPreview ||= previewOk;interfaceSample.actualFixedFlow=previewOk&&await flow.getAttribute('aria-label')==='준비 결과 예시 보기'&&normalizedText(await flow.innerText())==='결과 예시';
      record(`${width}px 체험은 실제 고정 API를 실행하고 완료 뒤 같은 명칭으로 복귀`,interfaceSample.actualFixedFlow);
      record(`${width}px 작성된 합성 예시·실제 연락/예약 없음과 고정 미리보기 도구 15건`,previewOk && await page.locator('.example-label').count()===2 && previewNotice(await page.locator('#mode-notice').textContent()));
      record(`${width}px 처리 기록은 기본 접힘·설정은 preview에 미적용`,await page.locator('.tool-records').evaluateAll(nodes=>nodes.length>0 && nodes.every(node=>!node.open)) && /적용하지/.test(await page.locator('#preferences-status').textContent()) && !Object.hasOwn(json(requests.at(-1)),'preferences'));
      record(`${width}px 실제 공개 기관·애월콜·공식 동행 경로`,payload.caseState.selectedHospital?.source.datasetId==='859' && payload.caseState.visitSupport.taxi.provider.name==='애월콜' && payload.caseState.visitSupport.taxi.provider.source.datasetId==='327' && payload.caseState.visitSupport.companion.provider.id==='areum-escort');
      record(`${width}px 공단 미연결·진찰 미수행·동행 불통 유지`,payload.events.some(e=>e.tool==='request_records' && e.status==='not_connected') && payload.pendingActions.some(a=>a.kind==='physician-exam') && payload.caseState.visitSupport.companion.status==='unreachable_demo');
      panel=await openPatientRecords(page);
      record(`${width}px 실제 preview 결과가 환자자료 상태·출처·본문에 반영`,await recordsMatch(panel,payload.caseState) && await highwayDisconnected(panel));
      const preparedReport=panel.locator('[data-fhir-record-id="demo-report"]');
      if(!await preparedReport.evaluate(node=>node.open))await preparedReport.locator('summary').click();
      record(`${width}px 실제 preview가 같은 FHIR 판독문을 준비 목록에 연결`,/반영됨/.test(await preparedReport.locator('[data-fhir-value]').innerText()) && (await preparedReport.locator('[data-fhir-detail]').innerText())===payload.caseState.documents.find(document=>document.id==='report').content && /DiagnosticReport\/demo-report/.test(await preparedReport.locator('[data-fhir-reference]').innerText()) && await highwayDisconnected(panel));
      await preparedReport.scrollIntoViewIfNeeded();await screenshot(page,`fhir-prepared-${label}`);await closePatientRecords(page);
      await page.locator('.tool-records>summary').click();
      record(`${width}px 펼친 처리 기록 source 링크는 HTTPS`,await page.locator('.tool-source a').evaluateAll(links=>links.length>0 && links.every(a=>a.href.startsWith('https://') && a.target==='_blank' && a.rel.includes('noopener'))));
      await openVisitSummary(page);
      record(`${width}px 동행 재문의와 합성 병원 절차 표시`,(await page.locator('#case-content').innerText()).includes('동행 재문의') && /합성|시연/.test(await page.locator('[data-case-status="병원 문의"]').innerText()));
      const mapLink=page.locator('#case-content a[href^="https://www.google.com/maps/"]');
      record(`${width}px 실제 공개 주소 지도 링크`,await mapLink.count()===1 && new URL(await mapLink.getAttribute('href')).searchParams.get('query').includes(payload.caseState.selectedHospital.address));
      await screenshot(page,`preview-${label}`);
      await readConversation(page);
      await page.locator('.tool-records').scrollIntoViewIfNeeded();await screenshot(page,`tools-${label}`);
      await openVisitSummary(page);await reveal(page.locator('#save-report'));
      const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#save-report').click()]);
      const report=await readFile(await download.path(),'utf8');
      record(`${width}px 보고서 시연·데이터 출처`,download.suggestedFilename().endsWith('.md') && /고정 시나리오/.test(report) && ['859','327','애월콜'].every(term=>report.includes(term)));
      await send(page,'미리보기 이후 새 자유 요청');await page.locator('.request-error').waitFor();
      const fresh=json(requests.at(-1));
      record(`${width}px 미리보기 상태를 실제 대화에 섞지 않음`,!fresh.sessionId && fresh.history.length===0 && await page.locator('.example-label').count()===0 && await page.locator('.tool-record').count()===0);
      await confirmAction(page,'#new-conversation');
      record(`${width}px 새 대화 초기화`,await page.locator('.message').count()===1 && await input.inputValue()==='' && await page.locator('#save-report').isDisabled());
    } finally {await context.close();}
  });
  await scenario('설정된 모델의 실제 고정 preview',async()=>{
    const {page,context,requests}=await open(1440,900,{configured:{...configuredCaps,healthRecords:'connected'}});
    try {
      let panel=await openPatientRecords(page);const highwayBefore=await highwayDisconnected(panel);await closePatientRecords(page);
      const response=page.waitForResponse(item=>new URL(item.url()).pathname==='/api/agent/preview' && item.request().method()==='POST');
      await page.locator('#preview-button').click();
      const actual=await response,payload=await actual.json();
      await page.waitForFunction(()=>document.querySelectorAll('.tool-record').length===15);
      record('연결 설정 fixture에서도 실제 preview 15건만 실행',actual.status()===200 && payload.isPreview===true && payload.capabilities.llm===false && payload.events.length===15 && requests.length===1 && new URL(requests[0].url()).pathname==='/api/agent/preview','GET 연결 설정만 fixture·preview는 실제 keyless API·모델 POST 없음');
      record('고정 예시의 llm:false는 전역 연결 설정을 덮어쓰지 않음',payload.isPreview===true && payload.capabilities.llm===false && await page.locator('#connection-state').textContent()==='대화 연결 설정됨' && /실제 응답은 요청을 보낼 때/.test(await page.locator('#connection-details').textContent()) && /체험은 작성된 예시이며 실제 AI 모델의 응답이 아닙니다/.test(await page.locator('#connection-details').textContent()) && previewNotice(await page.locator('#mode-notice').textContent()));
      panel=await openPatientRecords(page);
      record('일반 기록 연계 connected fixture는 특정 건강정보 고속도로 성공으로 표시하지 않음',highwayBefore && await highwayDisconnected(panel));await closePatientRecords(page);
    } finally {await context.close();}
  });
  for(const [width,height] of [[1440,900],[390,844]])await scenario(`${width}px 설정 응답 fixture`,async()=>{
    let state=createDemoCase(),count=0;
    const markdown='# 준비한 내용\n- **택시 문의 초안**을 정리했어요.\n  - 실제 배차는 미확정이에요.\n\n1. 기관에 가능 시간을 확인해 주세요.\n\n[공개 출처](https://jejudatahub.net/data/view/data/327)\n\n<img src=x onerror="window.__qaXss=true"><script>window.__qaXss=true</script>\n\n[실행 금지](javascript:alert(1))\n\n'+Array.from({length:12},(_,i)=>`- 확인할 내용 ${i+1}: 실제 예약은 미확정입니다.`).join('\n');
    const {page,context,requests}=await open(width,height,{configured:true,onPost:request=>{
      count++;
      if(count===3)return {status:503,body:{error:{code:'MODEL_UNAVAILABLE',message:'응답 fixture 실패'},requestId:json(request).requestId}};
      if(count===1 || count===5) {
        state=preparedState(json(request).preferences);
        state=applyAction(state,{type:'ADD_DOCUMENT',id:'report',source:'응답 fixture <b>출처</b> & 합성',content:'합성 자료 <img src=x onerror="window.__qaRecordXss=true"><script>window.__qaRecordXss=true</script> & 확인'});
      }
      if(count===2)state=applyAction(state,{type:'UPDATE_PATIENT',values:{nextVisit:'2026-11-20'}});
      return {body:fixtureResponse(request,state,count===1?markdown:'합성 준비 상태를 갱신했습니다.')};
    }});
    try {
      await openVisitSummary(page);
      await page.locator('.connection-details>summary').click();
      record(`${width}px 모델 설정과 실제 접근 성공을 구분`,(await page.locator('#connection-details').innerText()).includes('실제 응답은 요청을 보낼 때') && await overflow(page),'capabilities/응답 fixture·실제 모델 API 호출 아님');
      const chosen={taxiProviderId:'taxi327-6',wheelchair:false,companionNeeded:false};
      await editPreferences(page,chosen);
      const saved=await snapshotStorage(page),stored=JSON.parse(saved[storageKey]);
      record(`${width}px 설정 변경은 POST 없이 검증된 세 필드만 저장`,requests.length===0 && Object.keys(saved).length===1 && exactPreferenceShape(stored) && samePreferences(stored,chosen) && /다음 요청/.test(await page.locator('#preferences-status').textContent()));
      // 같은 context의 새 탭만 기기 설정을 공유하고 대화 원문은 공유하지 않는다.
      const reload=await context.newPage();await reload.goto(base.href,{waitUntil:'networkidle'});await reload.locator('#pref-taxi').waitFor({state:'attached'});
      record(`${width}px 같은 기기 재진입은 설정만 복원`,await reload.locator('#pref-taxi').inputValue()===chosen.taxiProviderId && !await reload.locator('#pref-companion').isChecked() && await reload.locator('.message.user').count()===0 && await reload.locator('#request-input').inputValue()==='');await reload.close();
      let cachedRecords=await openPatientRecords(page);await recordsMatch(cachedRecords,createDemoCase());await closePatientRecords(page);const closedRecordsHtml=await page.locator('#patient-records-body').innerHTML();
      await send(page,'설정으로 어머니 택시 초안을 준비해 주세요.');
      const closedRecordsUnchanged=await page.locator('#patient-records-dialog').evaluate(node=>!node.open)&&await page.locator('#patient-records-body').innerHTML()===closedRecordsHtml;
      record(`${width}px 닫힌 환자 기록은 응답 적용마다 다시 그리지 않음`,closedRecordsUnchanged);
      const first=json(requests[0]);
      record(`${width}px 다음 일반 요청은 preferences·applyPreferences true 전송`,samePreferences(first.preferences,chosen) && first.applyPreferences===true && hashMatches(requests[0]));
      const answer=page.locator('.message.assistant:not(.greeting) .message-body').last();
      record(`${width}px Markdown 제목·목록·강조와 안전한 링크 표시`,await answer.locator('h3').count()===1 && await answer.locator('ul ul').count()===1 && await answer.locator('strong').count()>0 && !(await answer.innerText()).includes('# 준비한 내용') && !(await answer.innerText()).includes('**택시') && await answer.locator('a').evaluateAll(links=>links.length===1 && links.every(a=>a.protocol==='https:' && a.target==='_blank' && a.rel.includes('noopener'))));
      record(`${width}px 모델 HTML·javascript 링크는 실행하지 않음`,await answer.locator('img,script,iframe,a[href^="javascript:"]').count()===0 && await page.evaluate(()=>window.__qaXss===undefined));
      record(`${width}px 새 답변 시작은 중앙 scroller로 읽고 도구 기록은 접어 둠`,(await reachable(answer.locator('h3'))).reachable && await page.locator('#conversation-scroll').evaluate(node=>/auto|scroll/.test(getComputedStyle(node).overflowY) && node.clientHeight>0) && await page.locator('.tool-records').evaluateAll(nodes=>nodes.every(node=>!node.open)));
      record(`${width}px 응답 뒤 키보드 초점은 화면 밖 입력으로 강제하지 않음`,await page.evaluate(()=>{const node=document.activeElement,r=node?.getBoundingClientRect();return node!==document.body && r?.width>0 && r?.height>0 && r.top<innerHeight && r.bottom>0;}));
      const summary=getVisitSupportSummary(state);
      await openVisitSummary(page);
      record(`${width}px fixture caseState와 방문 요약의 실제 상태 일치`,(await page.locator('[data-case-status="택시 이동"]').innerText()).includes(summary.taxi.label) && (await page.locator('[data-case-status="택시 이동"]').innerText()).includes(summary.taxi.providerName) && (await page.locator('[data-case-status="병원 동행"]').innerText()).includes(summary.companion.label));
      const panel=await openPatientRecords(page);
      const reopenedRecordsLatest=await recordsMatch(panel,state);proof.lazyRecordScenarios.push({width,closedRecordsUnchanged,reopenedRecordsLatest});
      record(`${width}px 지연 렌더한 기록은 열 때 최신 자료·출처·위험문자를 읽기 내용으로 표시`,reopenedRecordsLatest && await panel.locator('[data-record-source] b,[data-record-content] img,[data-record-content] script,[data-record-content] iframe').count()===0 && await page.evaluate(()=>window.__qaRecordXss===undefined));await closePatientRecords(page);
      await screenshot(page,`configured-${width}`);
      await send(page,'방문일은 11월 20일로 바꿔 주세요.');
      record(`${width}px 성공 뒤 applyPreferences false·대화 세션 유지`,json(requests[1]).applyPreferences===false && json(requests[1]).sessionId===fixtureSessionId && (await page.locator('#case-content').innerText()).includes('11월 20일') && (await page.locator('[data-case-status="택시 이동"]').innerText()).includes(getVisitSupportSummary(state).taxi.label));
      record(`${width}px 다음 요청의 history는 성공한 이전 사용자·답변만 전달`,json(requests[1]).history.length===2 && json(requests[1]).history[0].role==='user' && json(requests[1]).history[0].text===first.message && json(requests[1]).history[1].role==='assistant' && markdown.startsWith(json(requests[1]).history[1].text) && json(requests[1]).history[1].text.length<=2000);
      await send(page,'실패 뒤 같은 요청을 확인합니다.');await page.locator('[data-retry]').waitFor();
      const failed=requests[2].postData();
      const changed={taxiProviderId:'taxi327-14',wheelchair:true,companionNeeded:true};
      await editPreferences(page,changed);
      record(`${width}px 실패 뒤 설정 수정만으로 추가 요청 없음`,requests.length===3 && samePreferences(JSON.parse((await snapshotStorage(page))[storageKey]),changed));
      const retryResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent' && r.request().method()==='POST');await page.locator('[data-retry]').click();await retryResponse;await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
      record(`${width}px 설정을 바꿔도 실패 재시도 본문·ID·해시는 보존`,requests[3].postData()===failed && hashMatches(requests[3]) && await page.locator('.message.user').count()===3);
      await send(page,'바꾼 기본 설정으로 다음 준비를 해 주세요.');
      record(`${width}px 이전 스냅샷 재시도 성공도 새 설정을 지우지 않음`,json(requests[4]).applyPreferences===true && samePreferences(json(requests[4]).preferences,changed));
      const finalStorage=await snapshotStorage(page);
      record(`${width}px 대화·응답·세션·권한은 localStorage에 남지 않음`,Object.keys(finalStorage).length===1 && exactPreferenceShape(JSON.parse(finalStorage[storageKey])) && !JSON.stringify(finalStorage).includes('sessionId') && !JSON.stringify(finalStorage).includes('실패 뒤 같은 요청'));
      proof.fixtureCoverage.preferences=true;proof.fixtureCoverage.markdown=true;
    } finally {await context.close();}
  });
  await scenario('진행 중 설정 스냅샷 fixture',async()=>{
    let release,count=0,settled;
    const gate=new Promise(resolve=>{release=resolve;});
    const {page,context,requests}=await open(1440,900,{configured:true,onPost:async request=>{
      if(++count===1)await gate;
      return {body:fixtureResponse(request,preparedState(json(request).preferences))};
    }});
    try {
      const original={taxiProviderId:'taxi327-6',wheelchair:false,companionNeeded:false};
      const changed={taxiProviderId:'taxi327-14',wheelchair:true,companionNeeded:true};
      await editPreferences(page,original);
      const outgoing=page.waitForRequest(request=>request.method()==='POST' && new URL(request.url()).pathname==='/api/agent');
      settled=send(page,'첫 설정으로 준비해 주세요.').then(value=>({value}),error=>({error}));
      await outgoing;await editPreferences(page,changed);
      record('응답 대기 중 설정 수정은 현재 요청·POST 횟수를 바꾸지 않음',requests.length===1 && samePreferences(json(requests[0]).preferences,original) && await page.locator('#send-request').isDisabled());
      release();const result=await settled;if(result.error)throw result.error;
      await send(page,'대기 중 바꾼 설정으로 다음 준비를 해 주세요.');
      record('이전 설정 응답 성공도 대기 중 변경한 기본값은 다음 요청에 적용',requests.length===2 && json(requests[1]).applyPreferences===true && samePreferences(json(requests[1]).preferences,changed));
      await send(page,'변경 없이 현재 상태를 확인해 주세요.');
      record('일치하는 설정 응답 성공 뒤에만 적용 플래그 해제',requests.length===3 && json(requests[2]).applyPreferences===false);
    } finally {release();if(settled)await settled;await context.close();}
  });
  for(const seed of ['{invalid-json',JSON.stringify({taxiProviderId:'taxi327-6',wheelchair:false,companionNeeded:true,share:true}),JSON.stringify({taxiProviderId:'invented-taxi',wheelchair:'true',companionNeeded:true})])await scenario('변조 저장값 복구',async()=>{
    const {page,context,requests}=await open(1440,900,{storageSeed:seed});
    try {record('변조된 저장값은 권한·기관 추가 없이 기본값 복구',await page.locator('#pref-taxi').inputValue()==='auto' && !await page.locator('#pref-wheelchair').isChecked() && await page.locator('#pref-companion').isChecked() && requests.length===0 && await page.evaluate(key=>localStorage.getItem(key)===null,storageKey));}
    finally {await context.close();}
  });
  for(const [code,status,match,exclude] of [['LOOP_LIMIT',429,/나누|확인할 일/,/오늘.*한도|새 대화/],['DAILY_LIMIT',429,/오늘.*한도/,/세션.*만료/],['SESSION_BUSY',409,/앞선.*처리|아직.*처리/,/만료|새 대화/]])await scenario(`${code} 복구 fixture`,async()=>{
    let count=0;
    const reply=`${code} 오류 뒤 합성 준비 상태를 확인했습니다.`;
    const {page,context,requests}=await open(390,844,{configured:true,onPost:request=>++count===1?{status,body:{error:{code,message:'정제된 fixture 오류'},requestId:json(request).requestId}}:{body:fixtureResponse(request,createDemoCase(),reply)}});
    try {
      const text=`${code} 뒤에도 남겨야 할 요청`;await send(page,text);const copy=await page.locator('.request-error').innerText();
      record(`${code}은 구분되는 다음 행동·입력 복구 안내`,match.test(copy) && !exclude.test(copy) && (code!=='DAILY_LIMIT' || /9시|09:00/.test(copy)) && await page.locator('#request-input').inputValue()===text && await page.locator('#send-request').isEnabled());
      const before=requests[0].postData(),next=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent' && r.request().method()==='POST');await page.locator('[data-retry]').click();await next;await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
      record(`${code} 재시도는 같은 요청으로 회복`,requests.length===2 && requests[1].postData()===before && hashMatches(requests[1]) && await page.locator('.request-error').count()===0 && await page.locator('.message.user').count()===1 && await page.locator('.message.assistant:not(.greeting)').count()===1 && (await page.locator('.message.assistant:not(.greeting) .message-body').innerText()).trim()===reply);
      proof.fixtureCoverage.recovery=true;
    } finally {await context.close();}
  });
  for(const [width,height] of [[360,780],[390,844],[768,1024]])await scenario(`${width}px 모바일 설정`,async()=>{
    const {page,context,requests}=await open(width,height);
    try {
      record(`${width}px 추가 반응형 앱 넘침·공통 입력·실제 처리 한계`,await overflow(page) && (await reachable(page.locator('#send-request'))).reachable && await disclosure(page));
      await page.locator('#open-care-menu').focus();await page.keyboard.press('Enter');
      record(`${width}px 설정 서랍은 이름·focus·배경 비활성 제공`,await page.locator('#care-rail').getAttribute('role')==='dialog' && await page.locator('#care-rail').getAttribute('aria-modal')==='true' && await page.evaluate(()=>document.activeElement.id==='close-care-menu' && document.querySelector('#workspace-shell').inert));
      const summary=page.locator('#nav-preferences');
      await summary.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
      record(`${width}px 접힌 설정의 폼을 건너뛰고 메뉴 안에서 순환`,await summary.evaluate(node=>!node.parentElement.open&&document.activeElement===node));
      await page.keyboard.press('Space');
      record(`${width}px 키보드로 설정을 펼치면 초점 유지`,await summary.evaluate(node=>node.parentElement.open&&document.activeElement===node));
      const targets=page.locator('#open-care-menu,#close-care-menu,#pref-taxi,.preference-toggle,#nav-preparation,#nav-preferences');
      record(`${width}px 서랍과 선택 조작의 터치 영역 44px 이상`,await targets.evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect();return r.width>=44 && r.height>=44;})));
      await page.locator('#pref-companion').focus();await page.keyboard.press('Tab');
      const forward=await page.evaluate(()=>document.querySelector('#care-rail').contains(document.activeElement));await page.keyboard.press('Shift+Tab');
      record(`${width}px 서랍 Tab 경계와 Escape focus 복귀`,forward && await page.evaluate(()=>document.activeElement.id==='pref-companion'));
      await page.keyboard.press('Escape');
      record(`${width}px 서랍 닫기는 대화·포커스 복원, POST 없음`,await page.evaluate(()=>document.activeElement.id==='open-care-menu' && document.querySelector('#care-rail').inert && !document.querySelector('#workspace-shell').inert) && requests.length===0 && await disclosure(page));
    } finally {await context.close();}
  });
  for(const [width,height] of [[1440,900],[390,844]])await scenario(`${width}px 음성 거절 fixture`,async()=>{
    const {page,context,requests}=await open(width,height,{voice:'denied'});
    try {
      await page.locator('#voice-request').click();await page.waitForFunction(()=>document.querySelector('#voice-help').textContent.includes('권한'));
      const autoOpen=await page.locator('#composer-help').evaluate(node=>node.open),hint=page.locator('#voice-help'),permissionErrorVisible=await hint.isVisible() && await hint.evaluate(node=>node.getAttribute('role')==='status' && node.classList.contains('error')) && (await reachable(hint)).reachable,noDraftFeedback=await page.locator('#draft-feedback').evaluate(node=>node.hidden&&node.textContent==='');
      record(`${width}px 실제 음성 오류 피드백 경로는 전체 안내를 자동 열고 권한 오류 표시`,autoOpen && permissionErrorVisible && noDraftFeedback && requests.length===0,'브라우저 이벤트 fixture·실제 마이크 인식 아님');
      await page.locator('#request-input').fill('텍스트로 이어가기');
      const textRecovery=requests.length===0 && await page.locator('#send-request').isEnabled() && await page.locator('#voice-request').getAttribute('aria-pressed')==='false';
      record(`${width}px 음성 권한 거절 fixture는 미전송·텍스트 복구`,textRecovery,'브라우저 이벤트 fixture·실제 마이크 인식 아님');
      proof.voiceFeedbackScenarios.push({width,autoOpen,permissionErrorVisible,noDraftFeedback,textRecovery,postCount:requests.length});
    }
    finally {await context.close();}
  });
  await scenario('음성 인식 검토 fixture',async()=>{
    const {page,context,requests}=await open(390,844,{voice:'transcript',configured:true,onPost:request=>({body:fixtureResponse(request,createDemoCase())})});
    try {
      await page.locator('#request-input').fill('작성 중인 요청');
      await page.locator('#voice-request').click();
      record('음성을 듣는 동안 기존 초안도 자동 전송하지 않음',requests.length===0 && await page.locator('#send-request').isDisabled() && await page.locator('#voice-request').getAttribute('aria-pressed')==='true');
      await page.evaluate(()=>window.__qaFinishSpeech());await page.waitForFunction(()=>document.querySelector('#request-input').value.includes('11월 12일'));
      record('음성 인식 fixture는 열린 안내와 검토 가능한 초안으로 남고 자동 전송하지 않음',requests.length===0 && await page.locator('#composer-help').evaluate(node=>node.open) && await page.locator('#voice-help').isVisible() && /확인|고친/.test(await page.locator('#voice-help').textContent()) && await page.locator('#send-request').isEnabled());
      await send(page,'11월 20일 어머니 이동을 준비해 주세요.');
      record('인식 내용을 수정한 뒤 보내야 요청됨',requests.length===1 && json(requests[0]).message==='11월 20일 어머니 이동을 준비해 주세요.' && hashMatches(requests[0]),'실제 음성 서비스·모델 호출 아님');proof.fixtureCoverage.voiceReview=true;
      await page.locator('#return-to-request').click();await page.locator('#voice-request').click();
      record('음성 중 다음 문의 초안도 비활성·추가 전송 없음',await page.locator('#next-request-draft').isDisabled() && requests.length===1);
      await page.locator('#voice-request').click();
      record('음성 중지 후 다음 문의 초안은 다시 사용 가능',await page.locator('#next-request-draft').isEnabled() && requests.length===1);
    } finally {await context.close();}
  });
  await scenario('음성 취소·새 대화 뒤 늦은 이벤트 fixture',async()=>{
    const {page,context,requests}=await open(390,844,{voice:'delayed',configured:true,onPost:request=>({body:fixtureResponse(request,createDemoCase())})});
    try {
      const input=page.locator('#request-input'),voice=page.locator('#voice-request');
      const original='취소할 음성의 기존 초안',draft='새 대화에서 직접 작성한 초안';
      await input.fill(original);await voice.click();await voice.click();
      const cancelledHelp=await page.locator('#voice-help').textContent();
      await page.evaluate(()=>new Promise(resolve=>setTimeout(()=>{
        const old=window.__qaSpeech[0],result=[{transcript:'취소한 음성의 늦은 결과'}];result.isFinal=true;
        old.onstart?.();old.onresult?.({resultIndex:0,results:[result]});old.onerror?.({error:'network'});old.onspeechend?.();old.onend?.();resolve();
      },0)));
      record('음성 대기 중지는 늦은 start·result·error·speechend에도 기존 초안·중지 안내 유지',await input.inputValue()===original && await page.locator('#voice-help').textContent()===cancelledHelp && await voice.getAttribute('aria-pressed')==='false' && await page.evaluate(()=>window.__qaSpeech[0].stopCalls===0) && requests.length===0,'지연 abort 브라우저 fixture · 실제 마이크 서비스 아님');
      await voice.click();
      const reset=await confirmAction(page,'#new-conversation');
      await input.fill(draft);
      const resetHelp=await page.locator('#voice-help').textContent();
      await page.evaluate(()=>new Promise(resolve=>setTimeout(()=>{
        const old=window.__qaSpeech[1],result=[{transcript:'새 대화 이전의 늦은 전사'}];result.isFinal=true;
        old.onstart?.();old.onresult?.({resultIndex:0,results:[result]});resolve();
      },0)));
      record('새 대화 뒤 옛 음성 start·result는 새 초안·버튼·전송 가능 상태를 바꾸지 않음',reset.confirmed && await input.inputValue()===draft && await page.locator('#voice-help').textContent()===resetHelp && await voice.getAttribute('aria-pressed')==='false' && await page.locator('#send-request').isEnabled() && requests.length===0);
      await voice.click();
      const activeHelp=await page.locator('#voice-help').textContent();
      await page.evaluate(()=>new Promise(resolve=>setTimeout(()=>{
        const old=window.__qaSpeech[1];old.onerror?.({error:'network'});old.onspeechend?.();old.onend?.();resolve();
      },0)));
      record('새 음성 시작 뒤 옛 error·speechend·end는 현재 음성을 끝내거나 실패로 바꾸지 않음',await input.inputValue()===draft && await voice.getAttribute('aria-pressed')==='true' && await page.locator('#send-request').isDisabled() && await page.locator('#voice-help').textContent()===activeHelp && await page.evaluate(()=>window.__qaSpeech[1].stopCalls===0) && requests.length===0);
      await page.evaluate(()=>window.__qaFinishSpeech());
      const reviewed=draft+' 11월 12일 어머니 이동을 준비해 주세요.';
      record('늦은 오류 뒤에도 현재 음성은 새 초안에만 이어지고 검토 후 전송 가능',await input.inputValue()===reviewed && await page.locator('#send-request').isEnabled() && /확인|고친/.test(await page.locator('#voice-help').textContent()) && requests.length===0);
      await send(page,reviewed);
      record('취소·새 대화 뒤 음성 fixture는 확인한 새 요청 한 건만 전송',requests.length===1 && json(requests[0]).message===reviewed && hashMatches(requests[0]),'실제 음성 서비스·모델 호출 아님');
      proof.fixtureCoverage.voiceCancellation=true;
    } finally {await context.close();}
  });
  for(const [width,height] of [[1440,900],[390,844]])await scenario(`${width}px 예시 초안 fixture`,async()=>{
    const {page,context,requests}=await open(width,height,{configured:true,onPost:request=>({body:fixtureResponse(request,createDemoCase())})});
    try {
      const input=page.locator('#request-input'),originalInput=await input.elementHandle(),example=page.locator('[data-example]').first(),sample={width,exampleInline:false,exampleCancelPreserves:false,populatedFeedbackCancelPreserves:false,exampleAcceptDraftOnly:false,typingClears:false,currentTaskInline:false,currentTaskCancelPreserves:false,currentTaskAcceptDraftOnly:false,explicitHelpReachable:false,sendClears:false,resetClears:false,sameEditableInput:false};proof.textDraftScenarios.push(sample);await reveal(example);
      const visible=normalizedText(await example.locator('span').innerText());
      await example.click();
      record(`${width}px 예시는 보이는 문구만 초안으로 채우고 POST 없음`,requests.length===0 && normalizedText(await input.inputValue())===visible && !/11월\s*12|오전\s*10/.test(await input.inputValue()) && await page.locator('.message.user').count()===0);
      const exampleState=await draftFeedbackState(page,originalInput);
      sample.exampleInline=exampleState.sameInput&&exampleState.editable&&exampleState.inputFocused&&exampleState.helpClosed&&exampleState.voiceQuiet&&exampleState.inlineVisible&&exampleState.inlineStatus&&exampleState.inlinePlacement&&(await reachable(page.locator('#draft-feedback'))).reachable;
      record(`${width}px 텍스트 예시는 같은 입력창에 초점을 두고 작은 상태 문구만 표시·전체 안내 닫힘`,sample.exampleInline,JSON.stringify(exampleState));
      const examples=page.locator('[data-example]');
      for(let index=1;index<await examples.count();index++) {
        await input.fill('');const other=examples.nth(index);await reveal(other);const copy=normalizedText(await other.locator('span').innerText());await other.click();
        const state=await draftFeedbackState(page,originalInput);
        record(`${width}px 추가 예시 ${index+1}도 보이는 초안·작은 피드백만 입력`,requests.length===0 && normalizedText(await input.inputValue())===copy && !/11월\s*12|오전\s*10/.test(await input.inputValue()) && state.sameInput&&state.editable&&state.inputFocused&&state.helpClosed&&state.inlineVisible);
      }
      const populatedDraft=await input.inputValue(),populatedFeedback=(await draftFeedbackState(page,originalInput)).text;await reveal(example);await example.focus();
      const keepPopulated=await confirmAction(page,example,false),keptState=await draftFeedbackState(page,originalInput);
      sample.populatedFeedbackCancelPreserves=keepPopulated.confirmed&&await input.inputValue()===populatedDraft&&keptState.inlineVisible&&keptState.text===populatedFeedback&&keptState.helpClosed&&await example.evaluate(node=>document.activeElement===node)&&requests.length===0;
      record(`${width}px 교체 취소는 이미 보이는 짧은 피드백·기존 초안·초점도 보존`,sample.populatedFeedbackCancelPreserves);
      const existing='직접 쓰던 요청은 예시를 눌러도 먼저 보호해야 합니다.';await input.fill(existing);
      const typedState=await draftFeedbackState(page,originalInput);await reveal(example);await example.focus();
      const cancelled=await confirmAction(page,example,false);
      const cancelledState=await draftFeedbackState(page,originalInput);
      sample.exampleCancelPreserves=cancelled.confirmed && await input.inputValue()===existing && requests.length===0 && cancelledState.text===typedState.text&&cancelledState.cleared&&cancelledState.helpClosed&&await example.evaluate(node=>document.activeElement===node);
      record(`${width}px 예시 교체 취소는 기존 초안·피드백·선택 버튼 초점 보존`,sample.exampleCancelPreserves);
      const accepted=await confirmAction(page,example);
      const acceptedState=await draftFeedbackState(page,originalInput);
      sample.exampleAcceptDraftOnly=accepted.confirmed && normalizedText(await input.inputValue())===visible && requests.length===0&&acceptedState.sameInput&&acceptedState.editable&&acceptedState.inputFocused&&acceptedState.helpClosed&&acceptedState.inlineVisible;
      record(`${width}px 예시 교체 확인도 전송 없이 같은 입력창·초안·작은 피드백만 변경`,sample.exampleAcceptDraftOnly);
      const edited=visible+' 방문 날짜와 희망 시간은 아직 미정입니다.';await input.fill(edited);
      sample.typingClears=typedState.cleared&&(await draftFeedbackState(page,originalInput)).cleared;
      record(`${width}px 직접 입력을 고치면 지난 초안 피드백을 지움`,sample.typingClears);
      await send(page,edited);
      record(`${width}px 예시를 고친 뒤 보내야 수정한 본문 1건 전송`,requests.length===1 && json(requests[0]).message===edited && hashMatches(requests[0]) && await page.locator('.message.user').count()===1);
      const requestDraft=getPreparationWorkflow(createDemoCase()).currentTask?.requestDraft;if(!requestDraft)throw new Error('현재 업무 초안이 있는 합성 조건이 필요합니다.');
      const taskButton=page.locator('#current-task-draft'),existingTaskDraft='현재 업무 초안을 고르기 전 직접 작성한 요청';await reveal(taskButton);await input.fill(existingTaskDraft);await taskButton.focus();
      const taskCancelled=await confirmAction(page,taskButton,false),taskCancelledState=await draftFeedbackState(page,originalInput);
      sample.currentTaskCancelPreserves=taskCancelled.confirmed&&await input.inputValue()===existingTaskDraft&&requests.length===1&&taskCancelledState.cleared&&taskCancelledState.helpClosed&&await taskButton.evaluate(node=>document.activeElement===node);
      record(`${width}px 현재 업무 초안 교체 취소도 내용·선택 버튼 초점·POST 수 보존`,sample.currentTaskCancelPreserves);
      const taskAccepted=await confirmAction(page,taskButton),taskState=await draftFeedbackState(page,originalInput);
      sample.currentTaskInline=taskState.sameInput&&taskState.editable&&taskState.inputFocused&&taskState.helpClosed&&taskState.voiceQuiet&&taskState.inlineVisible&&taskState.inlineStatus&&taskState.inlinePlacement&&(await reachable(page.locator('#draft-feedback'))).reachable;
      sample.currentTaskAcceptDraftOnly=taskAccepted.confirmed&&await input.inputValue()===requestDraft.trim().slice(0,1600)&&requests.length===1&&sample.currentTaskInline;
      record(`${width}px 현재 업무 초안도 같은 수정 가능한 입력·작은 상태 문구·전체 안내 닫힘·추가 POST0`,sample.currentTaskAcceptDraftOnly,JSON.stringify(taskState));
      sample.capture=await screenshot(page,`text-draft-${width}`);
      await page.locator('#composer-help>summary').click();
      const explicitHelpOpen=await page.locator('#composer-help').evaluate(node=>node.open),boundary=await reachable(page.locator('#composer-boundary')),privacy=await reachable(page.locator('#privacy-note')),end=await reachable(page.locator('#composer-help .pending-note'));
      const paragraphs=[];for(const paragraph of await page.locator('#composer-help .composer-detail-body>p').all())if(await paragraph.isVisible())paragraphs.push(await reachable(paragraph));
      sample.explicitHelpReachable=explicitHelpOpen&&boundary.reachable&&privacy.reachable&&end.reachable&&paragraphs.length>=4&&paragraphs.every(item=>item.reachable)&&/가상 사례.*실제 연락·예약 없음/.test(await page.locator('#composer-boundary').innerText())&&/음성은 인식한 내용을 확인한 뒤 보내요|음성 미지원 브라우저예요. 텍스트로 요청해 주세요/.test(await page.locator('#composer-help').innerText())&&/주민번호·인증정보·실제 의료기록 입력 금지.*대화 원문은 새로고침하면 사라져요/.test(await page.locator('#privacy-note').innerText())&&/이 화면의 대기만 중지해요.*서버 처리는 계속될 수 있습니다/.test(await page.locator('#composer-help .pending-note').innerText())&&await input.inputValue()===requestDraft.trim().slice(0,1600)&&requests.length===1;
      record(`${width}px 전체 안내를 명시적으로 열면 경계·개인정보·중지 원문 끝까지 접근·초안 보존`,sample.explicitHelpReachable,JSON.stringify({boundary,privacy,end,paragraphs}));
      await page.locator('#composer-help>summary').click();
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent'&&r.request().method()==='POST');await page.locator('#send-request').click();await response;await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
      sample.sendClears=(await draftFeedbackState(page,originalInput)).cleared&&requests.length===2&&json(requests[1]).message===requestDraft.trim().slice(0,1600)&&hashMatches(requests[1]);
      record(`${width}px 채운 초안을 직접 보내면 피드백을 지우고 확인한 본문 한 건만 추가`,sample.sendClears);
      await reveal(taskButton);await taskButton.click();const beforeReset=await draftFeedbackState(page,originalInput),reset=await confirmAction(page,'#new-conversation'),afterReset=await draftFeedbackState(page,originalInput);
      sample.resetClears=beforeReset.inlineVisible&&reset.confirmed&&afterReset.cleared&&afterReset.helpClosed&&await input.inputValue()===''&&requests.length===2;
      sample.sameEditableInput=[exampleState,acceptedState,taskState,afterReset].every(state=>state.sameInput&&state.editable);
      record(`${width}px 새 대화도 초안 피드백을 지우고 같은 단일 입력창 유지·추가 POST0`,sample.resetClears&&sample.sameEditableInput);
      proof.fixtureCoverage.exampleDrafts=true;
    } finally {await context.close();}
  });
  for(const width of [390,360])await scenario(`${width}x500 읽기·입력 접근 fixture`,async()=>{
    const reply='# 긴 답변의 시작\n\n'+Array.from({length:24},(_,index)=>`확인 ${index+1}. 제주 병원과 기존 도외 병원의 접수 창구·전달할 자료를 확인합니다. 실제 진료 수락이나 예약은 미확정입니다.`).join('\n\n')+'\n\n긴 답변의 마지막 안내입니다.';
    const {page,context,requests}=await open(width,500,{configured:true,onPost:request=>({body:fixtureResponse(request,createDemoCase(),reply)})});
    const controls=['#request-input','#send-request','#composer-disclosure','#composer-boundary','.privacy-note'];
    try {
      await readConversation(page);
      const initial=await accessSet(page,controls),conversation=await workspaceEvidence(page);
      record(`${width}x500 첫 화면의 공통 입력·펼친 고지는 작업공간에서 접근`,await overflow(page) && Object.values(initial).every(value=>value.reachable) && conversation.viewportFit && conversation.sharedComposer && conversation.scrollRegions && conversation.compactPanels,JSON.stringify(initial));
      const input=page.locator('#request-input'),multiline=Array.from({length:12},(_,index)=>`${index+1}번째 요청 내용: 진료 자료와 이동을 확인해 주세요.`).join('\n');
      await input.fill(multiline);await input.press('Control+End');
      const multiple=await accessSet(page,controls),textarea=await input.evaluate(node=>({lines:node.value.split('\n').length,lastLine:node.scrollTop+node.clientHeight>=node.scrollHeight-3,scrollable:/auto|scroll/.test(getComputedStyle(node).overflowY)}));
      record(`${width}x500 12줄 입력도 마지막 줄·보내기·고지 접근`,textarea.lines===12 && textarea.lastLine && textarea.scrollable && Object.values(multiple).every(value=>value.reachable),JSON.stringify(multiple));
      await send(page,multiline);
      const answer='.message.assistant:not(.greeting) .message-body';
      const longAnswer=await accessSet(page,[`${answer} h3`,`${answer} p:last-child`,...controls]);
      record(`${width}x500 긴 답변은 중앙 scroller로 처음·끝을 읽고 공통 입력 유지`,requests.length===1 && Object.values(longAnswer).every(value=>value.reachable) && await page.locator('#conversation-scroll').evaluate(node=>/auto|scroll/.test(getComputedStyle(node).overflowY) && node.clientHeight>0) && await overflow(page),JSON.stringify(longAnswer));
      const before=await page.locator(answer).last().evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
      // CSS zoom은 화면 전체를 축소·확대하므로 쓰지 않고 실제 텍스트의 계산 크기를 2배로 바꾼다.
      await page.evaluate(()=>{
        const nodes=[document.body,...document.body.querySelectorAll('*')].filter(node=>node instanceof HTMLElement && !['SCRIPT','STYLE'].includes(node.tagName));
        const sizes=nodes.map(node=>parseFloat(getComputedStyle(node).fontSize));
        nodes.forEach((node,index)=>{if(sizes[index]>0)node.style.fontSize=`${sizes[index]*2}px`;});
      });
      await input.fill(multiline);await input.press('Control+End');
      const enlarged=await accessSet(page,[`${answer} h3`,`${answer} p:last-child`,...controls]);
      const answerSize=await page.locator(answer).last().evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
      const inputMetrics=await input.evaluate(node=>{const style=getComputedStyle(node),fontSize=parseFloat(style.fontSize),lineHeight=parseFloat(style.lineHeight);return {fontSize,lineHeight,lines:node.value.split('\n').length,caretAtEnd:node.selectionStart===node.value.length && node.selectionEnd===node.value.length,scrollTop:node.scrollTop,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,bottomGap:node.scrollHeight-node.scrollTop-node.clientHeight,trailingLeading:Math.max(0,(lineHeight-fontSize)/2)};});
      // Ctrl+End는 마지막 글자 아래의 빈 leading 일부를 화면 밖에 남길 수 있다.
      const text200={answerDoubled:answerSize>=before*1.95,inputDoubled:inputMetrics.fontSize>=31,twelveLines:inputMetrics.lines===12,caretAtEnd:inputMetrics.caretAtEnd,lastGlyphVisible:inputMetrics.bottomGap<=Math.max(3,inputMetrics.trailingLeading),controlsReachable:Object.values(enlarged).every(value=>value.reachable),noOverflow:await overflow(page)};
      record(`${width}x500 텍스트 200%에서 대화·입력·전송·고지 접근`,Object.values(text200).every(value=>value===true),JSON.stringify({text200,inputMetrics,answerBefore:before,answerSize,enlarged}));
      proof.shortViewport.push({width,height:500,textScale:2,initial,multiple,longAnswer,enlarged,text200,inputMetrics,...await workspaceEvidence(page)});
      await screenshot(page,`short-${width}-text-200`);proof.fixtureCoverage.shortViewport=true;
    } finally {await context.close();}
  });
  for(const kind of ['normal','preview'])await scenario(`${kind} 대기 중지·늦은 응답 fixture`,async()=>{
    const {page,context,requests}=await open(390,844,{configured:true,onPost:request=>({body:fixtureResponse(request,createDemoCase(),'중지 전에 보존할 세션 응답입니다.')})});
    try {
      await send(page,'기존 합성 세션을 준비해 주세요.');
      const original='중지한 뒤에도 보존할 원문입니다.',input=page.locator('#request-input');
      await input.fill(original);await deferAgentFetch(page);
      if(kind==='normal')await page.locator('#send-request').click();else await confirmAction(page,'#preview-button');
      const first=await deferredCall(page,0),beforeMessages=await page.locator('.message').count();
      record(`${kind} 대기 중 중지 버튼과 진행 상태 제공`,await page.locator('#cancel-request').isVisible() && await page.locator('#conversation-form').getAttribute('aria-busy')==='true' && deferredHashMatches(first));
      record(`${kind} 대기 중 입력·중지는 viewport 안이고 다음 초안은 비활성`,await page.locator('#request-input,#cancel-request').evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && r.height>0;})) && await page.locator('#next-request-draft').isDisabled());
      await page.locator('#cancel-request').click();
      await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
      const stoppedCopy=await page.locator('#conversation-status').innerText(),stopped=await deferredCall(page,0);
      record(`${kind} 중지는 원문 복원·클라이언트 대기와 서버 처리 구분`,await input.inputValue()===original && await input.isEditable() && stopped.aborted && /대기.*중지|중지.*대기/.test(stoppedCopy) && /서버.*(?:계속|확인)|처리.*계속/.test(stoppedCopy) && await page.locator('.message').count()===beforeMessages,stoppedCopy);
      const changed={taxiProviderId:'taxi327-14',wheelchair:true,companionNeeded:true};await editPreferences(page,changed);
      if(kind==='normal')await page.locator('[data-retry]').last().click();else await confirmAction(page,'#preview-button');
      const retry=await deferredCall(page,1);
      record(`${kind} 중지 재시도는 설정 변경 뒤에도 원래 본문·ID·해시 보존`,retry.body===first.body && retry.path===first.path && deferredHashMatches(retry) && (kind!=='normal' || JSON.parse(retry.body).sessionId===fixtureSessionId));
      const stale=deferredResponse(first,createDemoCase(),'늦게 도착해 화면에 보이면 안 되는 응답');
      if(kind==='preview')Object.assign(stale,{isPreview:true,previewMessages:[{role:'user',text:'늦은 예시'},{role:'assistant',text:stale.reply}],capabilities:{...configuredCaps,llm:false}});
      await releaseDeferred(page,0,stale);
      record(`${kind} 늦은 성공과 이전 finally는 새 요청의 대기를 해제하지 않음`,await page.locator('#conversation-form').getAttribute('aria-busy')==='true' && await page.locator('#send-request').isDisabled() && await page.locator('#cancel-request').isVisible() && !(await page.locator('#message-list').innerText()).includes(stale.reply) && await page.locator('.example-label').count()===0);
      await page.locator('#cancel-request').click();await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
      const newDraft='다음 요청으로 직접 고쳐 쓴 새 초안입니다.';await input.fill(newDraft);
      const errorsBefore=await page.locator('.request-error').count();
      await releaseDeferred(page,1,null,{errorName:'AbortError'});
      record(`${kind} 늦은 실패와 이전 finally는 새 초안·오류 상태를 덮지 않음`,await input.inputValue()===newDraft && await input.isEditable() && await page.locator('#send-request').isEnabled() && await page.locator('.request-error').count()===errorsBefore);
      if(kind==='normal') {
        const kept=await confirmAction(page,page.locator('[data-retry]').last(),false);
        record('normal 중지 재시도의 교체 취소는 새 초안 보존',kept.confirmed && await input.inputValue()===newDraft && await page.evaluate(()=>window.__qaDeferredAgent.calls.length)===2);
      }
      await page.locator('#send-request').click();const next=await deferredCall(page,2),payload=JSON.parse(next.body);
      await releaseDeferred(page,2,deferredResponse(next,createDemoCase(),'중지 후 새 요청의 정상 합성 응답'));
      await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
      record(`${kind} 중지 뒤 새 요청도 기존 세션·새 설정으로 회복`,next.path==='/api/agent' && payload.sessionId===fixtureSessionId && payload.message===newDraft && samePreferences(payload.preferences,changed) && payload.applyPreferences===true && deferredHashMatches(next) && (await page.locator('#message-list').innerText()).includes('중지 후 새 요청의 정상 합성 응답') && requests.length===1,'fetch fixture만 사용·서버 취소 또는 실제 발신 중단을 검증하지 않음');
      proof.fixtureCoverage.cancellation=true;
    } finally {await context.close();}
  });
  for(const width of [1440,390])await scenario(`${width}px 지원 실패 이유·현재 문의처 범위`,async()=>{
    const conditions={taxiProviderId:'taxi327-6',wheelchair:false,companionNeeded:true},baseState=preparedState(conditions),at='2026-11-01T12:00:00.000Z',cases=[];
    for(const [reason,pattern] of [['no_answer',/무응답/],['ai_declined',/AI.*거절/],['identity_required',/본인확인/],['missing_documents',/서류 부족/],['no_slots',/예약 불가/]])cases.push({id:reason,state:applyAction(baseState,{type:'CALL_RECORD_ATTEMPT',target:'taxi',outcome:reason,at}),pattern});
    const declined=cases.find(item=>item.id==='ai_declined').state;
    cases.push({id:'recipient-changed',state:applyAction(declined,{type:'SUPPORT_SELECT_PROVIDER',kind:'taxi',provider:supportData.providers.find(item=>item.id==='taxi327-14')}),pattern:/문의처 선택/});
    cases.push({id:'not-needed',state:applyAction(declined,{type:'SUPPORT_UPDATE_REQUIREMENTS',values:{transportNeeded:false}}),pattern:/필요 없음/});
    const recheck=structuredClone(declined);recheck.visitSupport.taxi.status='needs_recheck';cases.push({id:'needs-recheck',state:recheck,pattern:/재확인/});
    let next=0;const {page,context,requests}=await open(width,844,{configured:true,onPost:request=>({body:fixtureResponse(request,cases[next++].state,'지원 실패 이유와 현재 문의처 범위를 읽는 합성 응답입니다. 실제 발신·예약·배차는 하지 않았습니다.')})});
    try {
      for(const item of cases){
        await send(page,`합성 지원 상태 ${item.id}의 이유와 남은 일을 확인해 주세요.`);
        const support=await page.evaluate(async state=>(await import('/visit-support.js')).getVisitSupportSummary(state),item.state),label=support.taxi.label;
        await openVisitSummary(page);const summaryText=await page.locator('[data-case-status="택시 이동"]').textContent();
        await reveal(page.locator('[data-stage-id="support"] [data-stage-facts]'));const facts=await page.locator('[data-stage-id="support"] [data-stage-facts]').textContent();
        const accurate=item.pattern.test(label)&&summaryText.includes(label)&&facts.includes(label)&&(!['recipient-changed','not-needed','needs-recheck'].includes(item.id)||!/AI.*거절/.test(label))&&(item.id!=='ai_declined'||!/불통/.test(label));
        record(`${width}px ${item.id} 지원 요약·단계 상세는 같은 이유와 수신처 범위를 표시`,accurate);
        proof.supportReasonScenarios.push({width,id:item.id,label,accurate,fixtureOnly:true});
      }
      record(`${width}px 실패 이유 조회는 합성 응답 수와 일치하고 추가 자동 요청 없음`,requests.length===cases.length&&next===cases.length);
    } finally {await context.close();}
  });

  for(const width of [1440,390])for(const ending of ['failure','cancel'])await scenario(`${width}px ${ending} 뒤 최근 답변 접근`,async()=>{
    let count=0;
    const previous='# 이전에 성공한 합성 답변\n\n이미 확인한 준비와 기관·의료진에게 남은 일을 안내합니다. 실제 발신·예약·배차는 하지 않았습니다.';
    const {page,context,requests}=await open(width,500,{configured:true,onPost:request=>++count===1?{body:fixtureResponse(request,createDemoCase(),previous)}:{status:503,body:{error:{code:'SESSION_STORE_UNAVAILABLE'}}}});
    try {
      await send(page,'이전에 확인한 준비를 알려 주세요.');
      const answer=await page.locator('#message-list>.message.assistant:not(.greeting)').last().elementHandle();
      if(ending==='failure')await send(page,'연결 실패로 답변을 받지 못할 다음 요청');
      else {await deferAgentFetch(page);await page.locator('#request-input').fill('화면 대기를 중지할 다음 요청');await page.locator('#send-request').click();await deferredCall(page,0);await page.locator('#cancel-request').click();await page.waitForFunction(()=>document.getElementById('conversation-form').getAttribute('aria-busy')==='false');await releaseDeferred(page,0,null,{errorName:'AbortError'});}
      const last=page.locator('#message-list>.message').last(),input=page.locator('#request-input'),draft=await input.inputValue(),before=requests.length;
      const history=page.locator('#conversation-history');if(await history.evaluate(node=>node.open))await history.locator(':scope>summary').click();
      const button=page.locator('#current-task-answer'),access=await reachable(button);await button.click();
      await page.waitForFunction(()=>document.activeElement?.matches('#message-list>.message.assistant:not(.greeting)'));
      const preserved=await answer.evaluate(node=>node.isConnected && document.activeElement===node && node.textContent.includes('이전에 성공한 합성 답변') && !node.classList.contains('failed'));
      const reachesPreviousAnswer=access.reachable && preserved && await history.evaluate(node=>node.open) && await last.evaluate(node=>node.matches('.message.user.failed')) && await page.locator('#message-list>.message.assistant:not(.greeting)').count()===1 && await input.inputValue()===draft && requests.length===before;
      record(`${width}px ${ending} 뒤 최근 답변은 실패한 사용자 글을 건너뛰고 마지막 성공 답변·초안 보존`,reachesPreviousAnswer,'응답 fixture·실제 모델 호출 없음');
      proof.lastAnswerRecovery.push({width,ending,reachesPreviousAnswer,noExtraPost:requests.length===before,draftPreserved:await input.inputValue()===draft});
      proof.fixtureCoverage.lastAnswerRecovery ||= reachesPreviousAnswer;
    } finally {await context.close();}
  });

  for(const [width,height] of [[1440,900],[390,500]])await scenario(`${width}px 전화·협진 계획 fixture`,async()=>{
    let state=preparedState({taxiProviderId:'auto',wheelchair:true,companionNeeded:true});
    for(const target of ['mainland','jeju'])state=applyAction(state,{type:'RECORD_CALL',target,outcome:'documents'});
    const {page,context,requests,networkRequests}=await open(width,height,{configured:true,onPost:request=>({body:fixtureResponse(request,state)})});
    try {
      const input=page.locator('#request-input'),existing='전화 계획을 열기 전에 쓰던 요청입니다.';await input.fill(existing);
      const beforeNetwork=networkRequests.length;let panel=await openContactPlan(page);
      record(`${width}px 전화 계획은 이름·focus를 가진 4대상 native dialog`,await panel.evaluate(node=>node instanceof HTMLDialogElement && node.open && node.matches(':modal') && node.contains(document.activeElement) && Boolean(document.getElementById(node.getAttribute('aria-labelledby'))?.textContent.trim())) && await panel.locator('[data-contact-target]').count()===4);
      const mobile=await page.locator('#open-care-menu').isVisible();
      record(`${width}px 전화 계획 Escape는 기존 초안과 focus 복원`,(!mobile || await page.locator('#care-rail').evaluate(node=>node.inert && node.getAttribute('role')!=='dialog')) && await closeContactPlan(page,{escape:true}) && await input.inputValue()===existing);
      panel=await openContactPlan(page);await page.locator('#close-contact-plan').focus();await page.keyboard.press('Shift+Tab');
      const backwards=await panel.evaluate(node=>node.contains(document.activeElement) && document.activeElement.id!=='close-contact-plan');await page.keyboard.press('Tab');
      const forwards=await page.locator('#close-contact-plan').evaluate(node=>document.activeElement===node),closed=await closeContactPlan(page);
      record(`${width}px 전화 계획 Tab 양방향 경계·닫기 focus 복원`,backwards && forwards && closed);
      record(`${width}px 전화 계획 열기·닫기만으로 조회·전송·추가 저장 없음`,requests.length===0 && networkRequests.length===beforeNetwork && Object.keys(await snapshotStorage(page)).length===0);
      await send(page,'휠체어 이동과 제주·기존 도외 병원의 문의 계획을 준비해 주세요.');
      panel=await openContactPlan(page);
      let contentOK=true;
      for(const target of ['mainland','jeju','taxi','companion']) {
        const row=panel.locator(`[data-contact-target="${target}"]`);
        if(!await row.evaluate(node=>node.open))await row.locator('summary').click();
        for(const field of ['purpose','recipient','questions','disclosure','excluded','opening','records','checks','simulation','next-actions','request-draft'])contentOK &&=await row.locator(`[data-contact-${field}]`).count()===1 && Boolean((await row.locator(`[data-contact-${field}]`).innerText()).trim());
        const disclosed=await row.locator('[data-contact-disclosure]').innerText(),excluded=await row.locator('[data-contact-excluded]').innerText(),opening=await row.locator('[data-contact-opening]').innerText(),recording=await row.locator('[data-contact-records]').innerText(),checks=await row.locator('[data-contact-checks]').innerText(),simulation=await row.locator('[data-contact-simulation]').innerText();
        contentOK &&=![state.patient.name,state.patient.caregiver,state.patient.purpose,state.documents.find(document=>document.id==='history').content].some(value=>value && disclosed.includes(value)) && /이름|실명/.test(excluded) && /나이/.test(excluded) && /진단|병명/.test(excluded) && /주민/.test(excluded) && /주소/.test(excluded) && /AI/.test(opening) && /위임|대행|동의/.test(opening) && ['녹음','전사','보관','미설정'].every(term=>recording.includes(term)) && /국외|해외/.test(recording) && /미확인|미검증/.test(recording) && /위임|권한/.test(checks) && /미확인|미검증|확인 필요/.test(checks) && /합성|시연/.test(simulation);
      }
      record(`${width}px 4대상 목적·최소 공유·제외·AI 고지·위임 미검증·기록 미설정·합성 결과`,contentOK);
      const mainland=await panel.locator('[data-contact-target="mainland"] [data-contact-questions]').innerText(),jeju=await panel.locator('[data-contact-target="jeju"] [data-contact-questions]').innerText(),taxi=await panel.locator('[data-contact-target="taxi"] [data-contact-questions]').innerText(),companion=await panel.locator('[data-contact-target="companion"] [data-contact-questions]').innerText();
      record(`${width}px 협진은 양 기관 접수·의뢰·자료 전달 절차를 구분`,/협진|회송/.test(mainland) && /의뢰|의료진/.test(mainland) && /자료|전달/.test(mainland) && /진찰|검사/.test(jeju) && /창구|전달/.test(jeju) && /참여|협진/.test(jeju));
      record(`${width}px 휠체어 자격·회원·승하차·동행인·시각·차량 질문`,['자격','회원','휠체어','승하차','동행','시각','차량'].every(term=>taxi.includes(term)) && ['지역','역할','비용','휠체어'].every(term=>companion.includes(term)) && /시간|시각/.test(companion));
      const dialogSize=await panel.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0 && r.top>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1 && node.scrollWidth<=node.clientWidth+1;});
      const closeAccess=await reachable(page.locator('#close-contact-plan')),lastDraft=await reachable(panel.locator('[data-contact-target="companion"] [data-contact-draft]'));
      record(`${width}px 전화 계획 내용·마지막 문의 준비·닫기 반응형 접근`,dialogSize && closeAccess.reachable && lastDraft.reachable && await overflow(page),JSON.stringify({closeAccess,lastDraft}));
      await screenshot(page,`contact-plan-${width}`);
      const first=panel.locator('[data-contact-draft="mainland"]');await input.evaluate((node,text)=>{node.value=text;node.dispatchEvent(new Event('input',{bubbles:true}));},existing);
      const rejected=await confirmAction(page,first,false);
      record(`${width}px 문의 준비 교체 취소는 dialog와 기존 초안 보존`,rejected.confirmed && await panel.isVisible() && await input.inputValue()===existing && requests.length===1);
      await closeContactPlan(page);
      for(const target of ['mainland','jeju','taxi','companion']) {
        await input.fill('');panel=await openContactPlan(page);
        const row=panel.locator(`[data-contact-target="${target}"]`);if(!await row.evaluate(node=>node.open))await row.locator('summary').click();
        const visible=normalizedText(await row.locator('[data-contact-request-draft]').innerText());
        await row.locator(`[data-contact-draft="${target}"]`).click();await panel.waitFor({state:'hidden'});
        record(`${width}px ${target} 문의 준비는 보이는 초안만 채우고 POST 없음`,normalizedText(await input.inputValue())===visible && requests.length===1 && await input.evaluate(node=>document.activeElement===node));
      }
      proof.fixtureCoverage.contactPlan=true;
    } finally {await context.close();}
  });
  proof.finalSourceHash=await runtimeFingerprint(servedRoot);
  record('검사 중 runtime source 변경 없음',proof.finalSourceHash===proof.sourceHash);
  record('브라우저 실행 오류 없음',errors.length===0,errors.join('; '));
  if(checks.every(c=>c.status==='pass') && errors.length===0)proof.result='pass';
} catch(error) {errors.push(error.message);record('대화 브라우저 시나리오 완료',false,error.message);}
finally {
  await browser.close();
  await writeFile(resolve(root,'orchestration/runs/conversation-browser.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(`대화 화면 검증: ${checks.filter(c=>c.status==='pass').length}/${checks.length} · 실제 LLM/전화/공단/마이크 검증 아님`);
  if(proof.result!=='pass')process.exitCode=1;
}
