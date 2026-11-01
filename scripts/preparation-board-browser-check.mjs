import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
import {createDemoCase} from '../app/domain.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const servedRoot=process.env.QA_SERVED_SOURCE_ROOT?resolve(process.env.QA_SERVED_SOURCE_ROOT):root;
const base=new URL(process.env.BASE_URL||'http://127.0.0.1:4173');
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname) || !['http:','https:'].includes(base.protocol) || base.username || base.password || base.pathname!=='/' || base.search || base.hash)throw new Error('BASE_URL은 키를 끈 localhost QA 서버의 루트 주소여야 합니다.');
const directory='.impeccable/review/chat-rail/board',checks=[],errors=[];
const ids=['records','hospitals','support','plan'];
const viewports=[[1800,1125],[1440,900],[1152,720],[960,600],[720,450],[1060,900],[390,844],[390,500],[320,500],[768,512]];
const caps={llm:true,model:'gpt-6.1-sol',phone:'simulation',healthRecords:'demo',voiceInput:'browser',progress:'poll'};
const fixtureSession='b'.repeat(43);
const proof={
  result:'fail',checkedAt:new Date().toISOString(),url:base.href,sourceHash:await runtimeFingerprint(servedRoot),
  apiLive:false,modelInvoked:false,phoneInvoked:false,healthRecordsQueried:false,apiProgress:{unregistered:null,invalid:null},
  invokingSourceHash:await runtimeFingerprint(root),sourceHashScope:process.env.QA_SERVED_SOURCE_ROOT?'explicit QA_SERVED_SOURCE_ROOT; served UI assets compared below':'invoking checkout; served UI assets compared below',
  checks,errors,screenshots:[],viewports:[],runtimeAssets:[],progressScenarios:[],motionScenarios:[],workspaceScenarios:[],viewportScope:'가용 CSS 크기80~200%대응 공간과 텍스트200%; 실제 브라우저 zoom·기기·가상 키보드는 미검증',
  scope:{localhostKeylessOnly:true,modelInvoked:false,phoneInvoked:false,healthRecordsQueried:false,unmockedNormalPostAttempts:0,blockedPostAttempts:0,actualProgressReads:0,actualPreviewRequests:0,fixtureMainRequests:0,fixtureProgressReads:0,microphone:'not exercised; conversation browser fixtures cover transcript review',progress:'fixed safe DTO/browser fetch fixtures; actual keyless endpoint read only'},
};
const hash=value=>createHash('sha256').update(value).digest('hex');
const record=(name,ok,detail='')=>{checks.push({name,status:ok?'pass':'fail',detail});console.log((ok?'PASS':'FAIL')+' '+name+(detail?' · '+detail:''));};
const normalize=value=>String(value??'').replace(/\s+/g,' ').trim();
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1 && scrollY===0);
let browser,previewEvidence;
async function showView(page,view) {
  const tab=page.locator('#workspace-tab-'+view);
  if(await tab.isVisible() && await tab.getAttribute('aria-selected')!=='true')await tab.click();
}
async function reveal(locator) {
  const page=locator.page(),view=await locator.evaluate(node=>node.closest('#preparation-rail')?'preparation':node.closest('#chat-workspace')?'chat':null);
  const target=await locator.elementHandle();
  if(!await page.locator('dialog[open]').count())for(const id of ['request-examples','composer-help']) {
    const popup=page.locator('#'+id);
    if(await popup.evaluate((node,target)=>node.open && !node.contains(target),target))await popup.locator(':scope>summary').click();
  }
  if(view)await showView(page,view);
  for(const details of await locator.locator('xpath=ancestor::details').all())if(!await details.evaluate((node,target)=>node.open || node.querySelector(':scope>summary')?.contains(target),target))await details.locator(':scope>summary').click();
}
async function workspaceEvidence(page) {
  return page.evaluate(()=>{
    const chat=document.getElementById('chat-workspace'),rail=document.getElementById('preparation-rail'),input=document.getElementById('request-input'),form=document.getElementById('conversation-form'),composer=document.getElementById('chat-composer'),compact=matchMedia('(max-width:900px), (max-height:650px)').matches,layout=document.querySelector('.conversation-layout');
    const bounds=node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};},inside=node=>{const r=bounds(node);return r.width>0 && r.height>0 && r.top>=-1 && r.bottom<=innerHeight+1 && r.left>=-1 && r.right<=innerWidth+1;};
    const regions=[document.getElementById('conversation-scroll'),rail].map(node=>({id:node.id,...bounds(node),clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,scrollTop:node.scrollTop,overflowY:getComputedStyle(node).overflowY,fontSize:parseFloat(getComputedStyle(node.querySelector('.message-body')||node).fontSize),active:!node.closest('[hidden],[inert]')}));
    const cards=[...document.querySelectorAll('#preparation-board>[data-stage-id]')],tabs=[...document.querySelectorAll('[role="tab"][id^="workspace-tab-"]')],active=layout.dataset.activeView==='preparation'?rail:chat,inactive=active===chat?rail:chat;
    return {viewportFit:document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1 && document.body.scrollHeight<=innerHeight+1 && scrollY===0 && inside(document.querySelector('.app-shell')),sharedComposer:document.querySelectorAll('#request-input,#conversation-form,#chat-composer').length===3 && composer.contains(form) && form.contains(input) && !composer.closest('[hidden],[inert]') && [input,document.getElementById('send-request')].every(inside),scrollRegions:regions.every(region=>/auto|scroll/.test(region.overflowY) && (!region.active || region.clientHeight>=Math.max(44,region.fontSize*1.2))) && cards.length===4 && cards.every(node=>! /auto|scroll|hidden|clip/.test(getComputedStyle(node).overflowY) && node.scrollHeight<=node.clientHeight+2),compactPanels:compact?chat.getAttribute('role')==='tabpanel' && rail.getAttribute('role')==='tabpanel' && tabs.length===2 && tabs.every(node=>node.getAttribute('aria-controls')===(node.id==='workspace-tab-chat'?'chat-workspace':'preparation-rail')) && tabs.filter(node=>node.getAttribute('aria-selected')==='true').length===1 && active.hidden===false && !active.inert && inactive.hidden && inactive.inert && !inactive.contains(document.activeElement) && tabs.every(node=>node.tabIndex===(node.getAttribute('aria-selected')==='true'?0:-1)):!chat.hidden && !rail.hidden && !chat.inert && !rail.inert,regions,compact,activeView:layout.dataset.activeView,composer:bounds(composer),body:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}};
  });
}
async function scenario(name,run) {
  try {await run();}
  catch(error) {errors.push(name+': '+error.message);record(name,false,error.message);}
}
async function shot(page,name) {
  const path=directory+'/'+name+'.png';
  await page.screenshot({path:resolve(root,path),fullPage:true});
  proof.screenshots.push(path);return path;
}
async function readStage(page,id) {
  await showView(page,'preparation');
  const details=page.locator('[data-stage-id="'+id+'"] [data-stage-details]');
  if(!await details.evaluate(node=>node.open))await details.locator(':scope>summary').click();
}
async function stageText(page,id) {
  await readStage(page,id);
  return page.locator('#preparation-board [data-stage-id="'+id+'"]').innerText();
}
async function statusOf(page,id) {
  return page.locator('[data-stage-id="'+id+'"] [data-stage-status]').getAttribute('data-stage-status');
}
async function allStatus(page) {
  return Promise.all(ids.map(id=>statusOf(page,id)));
}
async function liveSummary(page,id) {
  const pane=page.locator('[data-stage-id="'+id+'"]'),activity=pane.locator('[data-stage-live]');
  return await pane.getAttribute('data-live')==='true' && await activity.isVisible() && /확인 중|진행/.test(await activity.innerText()) && await page.locator('#cancel-request').isVisible() && await page.locator('#board-activity').evaluate(node=>!node.hidden && Boolean(node.textContent.trim()) && Boolean(node.closest('#composer-help')));
}
async function readingPosition(page) {
  return page.evaluate(()=>{
    const anchors=[...document.querySelectorAll('.message,[data-stage-facts]>div,[data-stage-gaps] li,.stage-pane-header,#request-input')].map((node,index)=>({index,visible:node.checkVisibility(),rect:node.getBoundingClientRect()}));
    const reading=anchors.find(item=>item.visible && item.rect.top>=-2 && item.rect.bottom<=innerHeight+2)||anchors.find(item=>item.visible && item.rect.bottom>0 && item.rect.top<innerHeight);
    return {open:[...document.querySelectorAll('#preparation-board details,#visit-summary')].map(node=>node.open),focus:document.activeElement?.id||document.activeElement?.dataset.openStage||document.activeElement?.tagName,x:scrollX,y:scrollY,regions:{chat:document.getElementById('conversation-scroll').scrollTop,preparation:document.getElementById('preparation-rail').scrollTop},anchor:reading?{index:reading.index,top:reading.rect.top,left:reading.rect.left}:null};
  });
}
// 공유 스크롤 영역의 내용이 늘어도 독자가 보던 문장의 화면 위치를 비교한다.
const samePosition=(before,after)=>JSON.stringify(before.open)===JSON.stringify(after.open) && before.focus===after.focus && Math.abs(before.x-after.x)<=1 && before.anchor && after.anchor && before.anchor.index===after.anchor.index && Math.abs(before.anchor.top-after.anchor.top)<=2 && Math.abs(before.anchor.left-after.anchor.left)<=1;
async function checkSignals(page,state,{responseCount=0,events=[]}={}) {
  return page.evaluate(async({state,responseCount,events})=>{
    const board=(await import('/preparation-stages.js')).getPreparationBoard(state,{responseCount,events});
    const labels={available:/결과 있음/,attention:/추가 확인|다시 확인|재확인/,blocked:/실패\s*·\s*인계/,waiting:/확인 전|문의 전/,not_needed:/필요 없음/};
    const shapeMatches=(node,signal)=>{
      const mark=node?.querySelector('.signal-mark[data-signal="'+signal+'"]');
      if(!mark || mark.getAttribute('aria-hidden')!=='true')return false;
      if(signal==='available')return mark.querySelectorAll('circle').length===1;
      const path=[...mark.querySelectorAll('path')].map(item=>item.getAttribute('d')).join(' '),strokes=(path.match(/m/gi)||[]).length+mark.querySelectorAll('line').length;
      if(signal==='attention')return /z/i.test(path) || mark.querySelectorAll('polygon').length===1;
      return signal==='blocked'?strokes===2:strokes===1 && !/z/i.test(path);
    };
    return board.stages.every(stage=>{
      const section=document.querySelector('[data-stage-id="'+stage.id+'"]'),status=section?.querySelector('[data-stage-status]');
      const label=stage.id==='plan' && stage.signal==='available'?/답변 있음/:stage.id==='plan' && stage.signal==='waiting'?/답변 전/:labels[stage.signal];
      return section?.dataset.signal===stage.signal && status?.dataset.signal===stage.signal && label?.test(status.textContent) && shapeMatches(status,stage.signal);
    });
  },{state,responseCount,events});
}
async function contrast(page,selector='.stage-status,.stage-status .signal-mark,#composer-disclosure,#composer-boundary,.privacy-note,.message-body') {
  return page.locator(selector).evaluateAll(nodes=>{
    const rgba=value=>(value.match(/[\d.]+/g)||[]).map(Number);
    const luminance=color=>color.slice(0,3).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    return nodes.filter(node=>node.checkVisibility()).map(node=>{
      const style=getComputedStyle(node),foreground=rgba(style.color);let background=[255,255,255],layers=[];
      for(let parent=node;parent;parent=parent.parentElement) {
        const color=rgba(getComputedStyle(parent).backgroundColor);
        if(color.length<4)color.push(1);
        if(color[3]>0)layers.push(color);
        if(color[3]===1)break;
      }
      for(const color of layers.reverse())background=background.map((value,index)=>color[index]*color[3]+value*(1-color[3]));
      const ratioFor=color=>{const a=luminance(color),b=luminance(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
      return {id:node.id||node.className.baseVal||node.className,signal:node.dataset.signal||null,color:style.color,ratio:ratioFor(foreground),minimum:node.matches('.signal-mark,.icon')?3:4.5,outlineRatio:ratioFor(rgba(style.outlineColor)),outlineVisible:style.outlineStyle!=='none' && parseFloat(style.outlineWidth)>=2};
    });
  });
}
async function confirmedFacts(page) {
  return page.locator('#preparation-board [data-stage-facts],#patient-records-dialog [data-patient-field],#patient-records-dialog [data-record-status],#patient-records-dialog [data-record-source],#patient-records-dialog [data-record-content]').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,status:node.dataset.status??null})));
}
async function flush(page) {await page.clock.runFor(40);}
// CSS compositor는 fixture JS 시계와 독립이므로 Node 시계로 실제 조건을 기다린다.
async function nativeUntil(read,ready,timeout=2500) {
  const started=performance.now();let value;
  do {
    value=await read();if(ready(value))return value;
    await new Promise(resolve=>setTimeout(resolve,20));
  } while(performance.now()-started<timeout);
  throw new Error('브라우저 native 피드백 관측 시간 초과: '+JSON.stringify(value));
}
async function nativeFinished(locator) {
  await locator.evaluate(async node=>{await Promise.all(node.getAnimations({subtree:true}).filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));});
}
async function feedback(locator) {
  return locator.evaluate(node=>{
    const rect=node.getBoundingClientRect(),style=getComputedStyle(node),matrix=new DOMMatrix(style.transform==='none'?undefined:style.transform);
    return {width:rect.width,height:rect.height,x:matrix.e,y:matrix.f,rotation:Math.round(Math.atan2(matrix.b,matrix.a)*180/Math.PI),background:style.backgroundColor,color:style.color};
  });
}
async function calls(page,path) {
  return page.evaluate(path=>window.__boardFixture.calls.filter(call=>!path || call.path===path),path);
}
async function callAt(page,path,n=0) {
  await page.waitForFunction(({path,n})=>window.__boardFixture.calls.filter(call=>call.path===path).length>n,{path,n});
  return (await calls(page,path))[n];
}
async function release(page,call,body,{status=200,errorName}={}) {
  await page.evaluate(({index,status,body,errorName})=>window.__boardFixture.settle(index,status,body,errorName),{index:call.index,status,body,errorName});
  await flush(page);
}
async function advancePoll(page,n) {
  // 실제 시간이 아닌 브라우저 시각을 진행해 최소2.5초 간격과 조회 상한을 확인한다.
  for(let i=0;i<4;i++) {
    const list=await calls(page,'/api/agent/progress');
    if(list.length>n)return list[n];
    await page.clock.runFor(2600);
  }
  throw new Error('진행 조회 fixture '+(n+1)+'건이 시작되지 않았습니다.');
}
function progress(stage,sequence,{status='running',eventStatus='started'}={}) {
  const tools={records:'get_case',hospitals:'search_hospital_contacts',support:'prepare_inquiries',plan:'summarize_preparation'};
  const current=ids.indexOf(stage);
  return {available:true,progress:{version:1,status,sequence,updatedAt:'2026-10-31T12:00:00.000Z',currentStage:stage,
    stages:ids.map((id,index)=>({id,status:index===current?(status==='failed'?'failed':status==='completed'?'observed':'running'):index<current?'observed':'waiting',lastTool:index===current?tools[id]:null})),
    events:[{sequence,stage,tool:tools[stage],status:eventStatus}]}};
}
function response(call,state=createDemoCase(),reply='브라우저 fixture의 합성 준비 결과입니다. 실제 발신·예약·배차는 하지 않았습니다.') {
  return {sessionId:fixtureSession,requestId:JSON.parse(call.body).requestId,reply,caseState:state,
    events:[{id:'board-records',tool:'get_case',label:'합성 사례 확인',status:'completed',detail:'브라우저 응답 fixture이며 실제 환자 기록 조회가 아닙니다.',isSimulation:true}],
    pendingActions:[],capabilities:caps,needsInput:true};
}
async function open(width,height,{fixture=false,capabilities=fixture?caps:null,reducedMotion='reduce'}={}) {
  const context=await browser.newContext({viewport:{width,height},locale:'ko-KR',reducedMotion,serviceWorkers:'block'});
  const actualPosts=[];
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base.origin)return route.abort('blockedbyclient');
    if(url.pathname==='/api/agent/capabilities' && capabilities)return route.fulfill({json:capabilities});
    if(!['GET','HEAD'].includes(request.method())) {
      actualPosts.push({path:url.pathname,method:request.method()});
      if(request.method()==='POST' && url.pathname==='/api/agent/preview') {
        let id;
        try {id=JSON.parse(request.postData()).scenarioId;} catch {}
        if(id===undefined || ['aewol-parent-visit','time_changed','call_ai_declined'].includes(id)) {
          proof.scope.actualPreviewRequests++;
          return route.continue();
        }
      }
      proof.scope.blockedPostAttempts++;
      if(url.pathname==='/api/agent')proof.scope.unmockedNormalPostAttempts++;
      errors.push('허용하지 않은 네트워크 POST 차단: '+url.pathname);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const page=await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(error.message));
  if(fixture)await page.exposeFunction('__qaBoardObserved',path=>{
    if(path==='/api/agent')proof.scope.fixtureMainRequests++;
    if(path==='/api/agent/progress')proof.scope.fixtureProgressReads++;
  });
  if(fixture)await page.addInitScript(()=>{
    const original=window.fetch.bind(window),calls=[],pending=[];
    window.__boardMotion=[];
    const observedAnimations=new WeakMap();
    // compositor가 먼저 끝나 start/end가 함께 배달돼도 추가 직후의 native 참조를 보존한다.
    new MutationObserver(records=>{
      for(const record of records)for(const added of record.type==='attributes'?[record.target]:record.addedNodes)if(added instanceof Element) {
        const nodes=added.matches('.message-meta')?[added]:added.querySelectorAll('.message-meta');
        for(const node of nodes) {const animations=node.getAnimations();if(animations.length)observedAnimations.set(node,animations);}
      }
    }).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','inert']});
    for(const type of ['animationstart','animationiteration','animationend','animationcancel'])document.addEventListener(type,event=>{
      const node=event.target,message=node.closest?.('.message');if(!message)return;
      const animation=[...node.getAnimations(),...(observedAnimations.get(node)||[])].find(item=>item.animationName===event.animationName),timing=animation?.effect?.getTiming();
      window.__boardMotion.push({type,name:event.animationName,replyIndex:[...message.parentElement.querySelectorAll(':scope>.message.assistant:not(.greeting)')].indexOf(message),direct:message.parentElement.id==='message-list',latest:message===document.querySelector('#message-list')?.lastElementChild,greeting:message.classList.contains('greeting'),reader:Boolean(message.closest('#answer-read-view')),meta:node.matches('.message-meta'),duration:timing?.duration,iterations:timing?.iterations,frames:animation?.effect?.getKeyframes().map(frame=>({background:frame.backgroundColor,clip:frame.clipPath,opacity:frame.opacity,transform:frame.transform}))});
    },true);
    window.__boardFixture={calls,settle(index,status,body,errorName){
      const item=pending[index];
      if(!item || item.settled)throw new Error('알 수 없거나 완료한 fixture');
      item.settled=true;
      if(errorName)item.reject(new DOMException('브라우저 진행 fixture',errorName));
      else item.resolve(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}));
    }};
    window.fetch=(input,options={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin!==location.origin || options.method!=='POST' || !['/api/agent','/api/agent/progress'].includes(url.pathname))return original(input,options);
      return new Promise((resolve,reject)=>{
        const index=calls.length;
        window.__qaBoardObserved(url.pathname);
        calls.push({index,path:url.pathname,body:options.body,headers:Object.fromEntries(new Headers(options.headers)),hasSearch:Boolean(url.search),at:performance.now(),aborted:options.signal?.aborted===true});
        pending.push({resolve,reject,settled:false});
        // 의도적으로 signal을 무시해 취소 후 늦은 성공/실패를 재현한다.
        options.signal?.addEventListener('abort',()=>{calls[index].aborted=true;},{once:true});
      });
    };
  });
  try {
    await page.goto(base.href,{waitUntil:'networkidle'});
    await page.locator('#preparation-board').waitFor({state:'attached'});
    await page.waitForFunction(configured=>document.querySelector('#connection-state')?.textContent===(configured?'대화 연결 설정됨':'AI 모델 미연결'),capabilities?.llm===true);
    await page.evaluate(()=>document.fonts.ready);
    if(fixture)await page.clock.install();
    return {page,context,actualPosts};
  } catch(error) {await context.close();throw error;}
}
async function begin(page,text,n=0) {
  await page.locator('#request-input').fill(text);
  await page.locator('#send-request').click();
  return callAt(page,'/api/agent',n);
}
async function finish(page,call,state,reply) {
  await release(page,call,response(call,state,reply));
  await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
}
async function preview(page,id) {
  const settled=page.waitForResponse(item=>new URL(item.url()).pathname==='/api/agent/preview' && item.request().method()==='POST');
  if(id==='aewol-parent-visit')await page.locator('#preview-button').click();
  else {
    if(await page.locator('#open-care-menu').isVisible())await page.locator('#open-care-menu').click();
    await page.locator(id==='call_ai_declined'?'#nav-contact-plan':'#nav-care-journey').click();
    if(id==='call_ai_declined')await page.locator('#call-recovery-examples>summary').click();
    const selector=id==='call_ai_declined'?'[data-call-recovery-scenario="call_ai_declined"]':'[data-journey-scenario="time_changed"]';
    await page.locator(selector).click();
  }
  const result=await settled,data=await result.json();
  await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
  return {result,data};
}
async function accessible(locator) {
  await reveal(locator);
  const before=await locator.evaluate(node=>{
    const ancestors=[];
    for(let parent=node.parentElement;parent;parent=parent.parentElement)ancestors.push({top:parent.scrollTop,left:parent.scrollLeft,locked:/^(hidden|clip)$/.test(getComputedStyle(parent).overflowY)});
    return ancestors;
  });
  try {await locator.scrollIntoViewIfNeeded();}
  catch(error) {return {reachable:false,reason:error.message};}
  return locator.evaluate((node,before)=>{
    const r=node.getBoundingClientRect(),s=getComputedStyle(node);
    let top=0,bottom=innerHeight,left=0,right=innerWidth,hiddenScroll=false,index=0;
    for(let parent=node.parentElement;parent;parent=parent.parentElement,index++) {
      const p=parent.getBoundingClientRect(),style=getComputedStyle(parent),old=before[index];
      if(old?.locked && (Math.abs(parent.scrollTop-old.top)>1 || Math.abs(parent.scrollLeft-old.left)>1))hiddenScroll=true;
      if(/^(auto|scroll|hidden|clip)$/.test(style.overflowY)){top=Math.max(top,p.top+parent.clientTop);bottom=Math.min(bottom,p.top+parent.clientTop+parent.clientHeight);}
      if(/^(auto|scroll|hidden|clip)$/.test(style.overflowX)){left=Math.max(left,p.left+parent.clientLeft);right=Math.min(right,p.left+parent.clientLeft+parent.clientWidth);}
    }
    const selfClipped=/^(hidden|clip)$/.test(s.overflowY) && node.scrollHeight>node.clientHeight+2;
    return {reachable:r.width>0 && r.height>0 && s.visibility!=='hidden' && (r.top>=top-2 && r.bottom<=bottom+2 || !node.matches('button,input,select,textarea,summary,a') && r.height>bottom-top && r.bottom>top && r.top<bottom && bottom-top>=parseFloat(s.fontSize)*1.2) && r.left>=left-2 && r.right<=right+2 && !hiddenScroll && !selfClipped,hiddenScroll,selfClipped};
  },before);
}

try {
  await mkdir(resolve(root,directory),{recursive:true});
  await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
  const preflight=await fetch(new URL('/api/agent/capabilities',base),{redirect:'error',signal:AbortSignal.timeout(8000)});
  const actualCaps=await preflight.json();
  const keyless=preflight.status===200 && actualCaps.llm===false && ['simulation','not_connected'].includes(actualCaps.phone) && ['demo','not_connected'].includes(actualCaps.healthRecords);
  record('실제 localhost 서버는 모델 미연결·전화/개인기록 합성 경계',keyless && preflight.headers.get('cache-control')==='no-store');
  if(!keyless)throw new Error('keyless 상태를 확인하지 못해 브라우저 POST 검사를 시작하지 않습니다.');
  proof.apiLive=true;
  for(const path of ['conversation.js','conversation.css','preparation-board-view.js','preparation-stages.js','icons.js']) {
    const served=await fetch(new URL('/'+path,base),{redirect:'error',signal:AbortSignal.timeout(8000)});
    const expected=await readFile(resolve(servedRoot,'app',path));
    const matching=served.status===200 && hash(await served.text())===hash(expected);
    proof.runtimeAssets.push({path,matching,sourceHash:hash(expected)});
  }
  record('실제 제공 UI 자산은 명시한 runtime source와 동일',proof.runtimeAssets.every(item=>item.matching),process.env.QA_SERVED_SOURCE_ROOT?'명시한 별도 worktree · 통합본 검증과 구분':'현재 checkout');
  for(const [label,body,status] of [['미등록 토큰',{progressToken:'n'.repeat(43)},200],['잘못된 토큰',{progressToken:'invalid'},400]]) {
    const payload=JSON.stringify(body);
    const result=await fetch(new URL('/api/agent/progress',base),{method:'POST',headers:{'Content-Type':'application/json','x-amz-content-sha256':hash(payload)},body:payload,redirect:'error',signal:AbortSignal.timeout(8000)});
    const data=await result.json();proof.scope.actualProgressReads++;
    proof.apiProgress[status===200?'unregistered':'invalid']={status:result.status,noStore:result.headers.get('cache-control')==='no-store',...(status===200?{available:data.available,progressNull:data.progress===null}:{})};
    record('실제 keyless 진행 조회 '+label,result.status===status && result.headers.get('cache-control')==='no-store' && (status!==200 || data.available===false && data.progress===null),'HTTP '+result.status+' · 모델/세션 생성 요청 없음');
  }
  const require=createRequire(import.meta.url);
  let chromium;
  try {({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}
  catch {throw new Error('선택 QA 도구 Playwright가 필요합니다. PLAYWRIGHT_MODULE로 기존 설치를 지정하세요.');}
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});

  for(const [width,height] of viewports)await scenario(width+'x'+height+' 첫 화면·구조',async()=>{
    const {page,context,actualPosts}=await open(width,height);
    try {
      const initialWorkspace=await workspaceEvidence(page),compact=initialWorkspace.compact,inputNode=await page.locator('#request-input').elementHandle();
      await showView(page,'preparation');
      const panes=page.locator('#preparation-board>[data-stage-id]');
      const structure=await panes.evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.stageId,visible:node.checkVisibility(),x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));
      const visible=structure.filter(item=>item.visible && item.width>0 && item.height>0);
      const same=(a,b)=>Math.abs(a-b)<=1;
      const ordered=structure.map(item=>item.id).join(',')===ids.join(',') && visible.length===4 && await panes.evaluateAll(nodes=>nodes.every(node=>node.parentElement.id==='preparation-board')) && await page.locator('#preparation-details').count()===0;
      const placement=await page.evaluate(()=>{
        const bounds=selector=>{const node=document.querySelector(selector),r=node?.getBoundingClientRect();return r?{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null;};
        return {chat:bounds('.chat-workspace'),rail:bounds('.preparation-rail'),board:bounds('#preparation-board')};
      });
      const vertical=ordered && structure.every((item,index)=>same(item.x,structure[0].x) && same(item.width,structure[0].width) && (index===0 || item.y>=structure[index-1].y+structure[index-1].height));
      const {chat,rail,board}=placement;
      const positioned=chat && rail && board && board.x>=rail.x-1 && board.right<=rail.right+1 && (!compact?
        rail.x>=chat.right && same(chat.y,rail.y) && rail.width>=280 && rail.width<=340 && chat.width>rail.width:
        rail.x>=-1 && rail.right<=width+1 && rail.y>=0 && rail.bottom<=height+1);
      const layout=vertical && positioned?(!compact?'chat-right-rail':'tabbed-workspace'):null;
      const geometry=layout===(!compact?'chat-right-rail':'tabbed-workspace');
      record(width+'x'+height+' 실제 좌표는 '+(!compact?'중앙 채팅 오른쪽':'준비 탭 안')+' 준비 네 칸 한 열',geometry,JSON.stringify({layout,placement,structure}));
      const chatLayout=await page.evaluate(()=>{
        const chat=document.getElementById('chat-workspace'),rail=document.getElementById('preparation-rail'),board=document.getElementById('preparation-board'),conversation=document.getElementById('conversation-scroll'),messages=document.getElementById('message-list'),examples=document.getElementById('request-examples'),form=document.getElementById('conversation-form'),composer=document.getElementById('chat-composer');
        return Boolean(chat && rail && chat.parentElement===rail.parentElement && chat.parentElement.matches('.conversation-layout') && rail.contains(board) && chat.contains(conversation) && conversation.contains(messages) && !board.contains(messages) && composer.parentElement===chat.parentElement && composer.contains(form) && composer.contains(examples) && !chat.contains(form) && !rail.contains(form) && document.querySelector('.workspace-tools #expand-answer') && document.querySelectorAll('#message-list,#conversation-scroll,#conversation-form,#request-input').length===4 && !rail.querySelector('.message,#conversation-form,#request-input') && rail.contains(document.getElementById('visit-summary')) && !document.querySelector('.chat-identity,.chat-role,#conversation-title'));
      });
      record(width+'x'+height+' 중앙 대화·준비 패널과 단일 하단 입력·도구·접힌 예시 DOM 분리',chatLayout && await page.locator('#visit-summary').evaluate(node=>node instanceof HTMLDetailsElement && !node.open));
      const statuses=await allStatus(page);
      record(width+'x'+height+' 초기 자료 미확인과 병원·이동·답변 대기',statuses[0]==='needs_input' && statuses.slice(1).every(status=>status==='waiting') && await page.locator('[data-stage-summary]').count()===4 && await page.locator('[data-stage-events]').count()===4 && actualPosts.length===0);
      const initialSignalSummary=await page.locator('#stage-navigation').count()===0 && await page.locator('#preparation-board>.stage-pane>.stage-pane-header .signal-mark').count()===4 && await checkSignals(page,createDemoCase());
      const initialComposer=await page.locator('#request-input,#send-request').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {id:node.id,top:r.top,bottom:r.bottom,inViewport:r.top>=0 && r.bottom<=innerHeight && r.width>0 && r.height>0};}));
      const composerAccess={input:await accessible(page.locator('#request-input')),send:await accessible(page.locator('#send-request'))};
      const composerReachable=Object.values(composerAccess).every(item=>item.reachable);
      const compactSummary=await page.locator('#request-examples,#composer-help').evaluateAll(nodes=>nodes.length===2 && nodes.every(node=>node instanceof HTMLDetailsElement && !node.open)) && await page.locator('#preparation-board [data-stage-details]').evaluateAll(nodes=>nodes.length===4 && nodes.every(node=>node instanceof HTMLDetailsElement && !node.open)) && await page.locator('[data-stage-preview]').evaluateAll(nodes=>nodes.length===4 && nodes.every(node=>node.checkVisibility())) && await page.locator('[data-stage-log]:visible').count()===0;
      const categoryIcons=await page.evaluate(async()=>{
        const {icon}=await import('/icons.js'),expected={records:'folder',hospitals:'hospital',support:'car',plan:'calendar'};
        return document.querySelectorAll('#preparation-board .stage-topic-icon').length===4 && Object.entries(expected).every(([id,name])=>{
          const header=document.querySelector('[data-stage-id="'+id+'"]>.stage-pane-header'),svg=header?.querySelector('h2>svg.stage-topic-icon'),template=document.createElement('template');template.innerHTML=icon(name);
          const bounds=svg?.getBoundingClientRect();
          return header?.querySelectorAll('.stage-topic-icon').length===1 && svg?.getAttribute('aria-hidden')==='true' && svg.innerHTML===template.content.firstElementChild.innerHTML && bounds.width>0 && bounds.height>0;
        });
      });
      record(width+'x'+height+' 공통 입력·보내기는 현재 작업공간 안에서 접근',composerReachable,JSON.stringify({initialComposer,composerAccess}));
      record(width+'x'+height+' 네 칸 상세는 접고 핵심 요약·상태를 모두 표시',compactSummary);
      record(width+'x'+height+' 네 제목은 folder·hospital·car·calendar SVG를 사용',categoryIcons);
      record(width+'x'+height+' 네 헤더의 기호·뜻은 실제 준비 상태와 일치',initialSignalSummary);
      const path=await shot(page,width+'x'+height+'-initial');
      const fullNotice=await accessible(page.locator('#composer-boundary')),noticeColors=await contrast(page,'#composer-disclosure,#composer-boundary');
      record(width+'x'+height+' 가로 넘침·읽기 글자·짧은 고지와 펼친 전체 경계·입력 설명',await noOverflow(page) && await page.locator('#request-input').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=16 && node.getAttribute('aria-describedby').split(/\s+/).includes('composer-boundary')) && fullNotice.reachable && await page.locator('#composer-boundary').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=14) && /시연.*실행.*없음/.test(await page.locator('#composer-disclosure').innerText()) && /가상.*실제.*(?:연락|발신).*예약.*없음/.test(await page.locator('#composer-boundary').innerText()) && noticeColors.length===2 && noticeColors.every(item=>item.ratio>=4.5),JSON.stringify({fullNotice,noticeColors}));
      const controls=page.locator('[data-stage-details]>summary,#visit-summary>summary,#expand-answer,#voice-request,#preview-button,#send-request');
      record(width+'x'+height+' 주요 조작44px·감소 모션',await controls.evaluateAll(nodes=>nodes.filter(node=>node.checkVisibility()).every(node=>{const r=node.getBoundingClientRect();return r.width>=44 && r.height>=44;})) && await panes.evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).transitionDuration.split(',').every(value=>parseFloat(value)===0))));
      const closedRail=await page.locator('#preparation-rail').evaluate(node=>({clientHeight:node.clientHeight,scrollHeight:node.scrollHeight}));
      const draft='칸을 이동해도 보존할 요청';await page.locator('#request-input').fill(draft);
      let keyboard=true;const keyboardDetails=[];
      for(const id of ids) {
        const details=page.locator('[data-stage-id="'+id+'"] [data-stage-details]'),summary=details.locator(':scope>summary');
        await reveal(summary);await summary.focus();await page.keyboard.press('Enter');
        const item={id,open:await details.evaluate(node=>node.open),panes:await panes.evaluateAll(nodes=>nodes.every(node=>node.checkVisibility())),focused:await summary.evaluate(node=>document.activeElement===node)};keyboardDetails.push(item);keyboard &&=item.open && item.panes && item.focused;
      }
      record(width+'x'+height+' native 상세는 키보드로 펼치고 네 칸·초안 유지·POST0',keyboard && await page.locator('#request-input').inputValue()===draft && actualPosts.length===0,JSON.stringify(keyboardDetails));
      const completeGaps=await page.evaluate(async()=>{
        const state=(await import('/domain.js')).createDemoCase(),board=(await import('/preparation-stages.js')).getPreparationBoard(state);
        return board.stages.every(stage=>document.querySelector('[data-stage-id="'+stage.id+'"] [data-stage-gaps]').querySelectorAll('li').length===stage.gapCount);
      });
      record(width+'x'+height+' 펼친 전체 누락 목록은 실제 건수와 일치·문의처 중복 없음',completeGaps && !/문의처 선택 전 · 문의처 선택 전/.test(await page.locator('#preparation-board').innerText()));
      for(const id of ['visit-summary','case-summary']) {
        const details=page.locator('#'+id);
        if(!await details.evaluate(node=>node.open))await details.locator(':scope>summary').click();
      }
      const reading=await workspaceEvidence(page),expandedRail=reading.regions.find(item=>item.id==='preparation-rail'),railReading=reading.viewportFit && reading.scrollRegions && expandedRail.scrollHeight>closedRail.scrollHeight+20 && await panes.evaluateAll(nodes=>nodes.every(node=>node.checkVisibility()));
      record(width+'x'+height+' 펼친 자료·병원·이동·방문 상세는 같은 rail 스크롤에서 읽음',railReading,JSON.stringify({closedRail,reading}));
      const colors=await contrast(page);
      record(width+'x'+height+' 기호3:1·설명/본문/중요 고지4.5:1 대비',colors.length>0 && colors.every(item=>item.ratio>=item.minimum),JSON.stringify(colors));
      await shot(page,width+'x'+height+'-expanded');
      await page.locator('#visit-summary>summary').click();
      record(width+'x'+height+' 방문 상세를 접어도 네 칸·답변·요청은 남음',!await page.locator('#visit-summary').evaluate(node=>node.open) && await panes.evaluateAll(nodes=>nodes.every(node=>node.checkVisibility())) && await page.locator('#request-input').inputValue()===draft);
      const draftBeforeSwitch=await page.locator('#request-input').inputValue(),railTop=await page.locator('#preparation-rail').evaluate(node=>node.scrollTop);
      await showView(page,'chat');await showView(page,'preparation');
      const sameComposer=await inputNode.evaluate(node=>node===document.getElementById('request-input')) && await page.locator('#request-input').inputValue()===draftBeforeSwitch && Math.abs(await page.locator('#preparation-rail').evaluate(node=>node.scrollTop)-railTop)<=2;
      let inactiveKeyboard=true;
      if(compact) {
        const blocked=await page.locator('#conversation-scroll').evaluate(node=>{node.focus({preventScroll:true});return !node.contains(document.activeElement);});
        await page.locator('#workspace-tab-preparation').focus();
        for(let step=0;step<10;step++){await page.keyboard.press('Tab');inactiveKeyboard &&=await page.locator('#chat-workspace').evaluate(node=>!node.contains(document.activeElement));}
        inactiveKeyboard &&=blocked;
      }
      const namedTabs=!compact || await page.getByRole('tab',{name:'대화',exact:true}).count()===1 && await page.getByRole('tab',{name:'준비 현황',exact:true}).count()===1;
      const finalWorkspace=await workspaceEvidence(page),viewportFit=initialWorkspace.viewportFit && finalWorkspace.viewportFit,sharedComposer=initialWorkspace.sharedComposer && finalWorkspace.sharedComposer && sameComposer,scrollRegions=initialWorkspace.scrollRegions && finalWorkspace.scrollRegions && railReading,compactPanels=initialWorkspace.compactPanels && finalWorkspace.compactPanels && inactiveKeyboard && namedTabs;
      record(width+'x'+height+' 100dvh·실제 스크롤·같은 입력·비활성 탭 키보드 제외',viewportFit && sharedComposer && scrollRegions && compactPanels,JSON.stringify({initialWorkspace,finalWorkspace,sameComposer,inactiveKeyboard}));
      proof.viewports.push({width,height,geometry,layout,chatLayout,categoryIcons,viewportFit,sharedComposer,scrollRegions,compactPanels,initialSignalSummary,composerReachable,compactSummary,initialComposer,noOverflow:await noOverflow(page),screenshot:path,metrics:{initialWorkspace,finalWorkspace}});
    } finally {await context.close();}
  });

  await scenario('진행 변화·무자료·순서 역전',async()=>{
    const {page,context,actualPosts}=await open(1440,900,{fixture:true});
    try {
      const before=await allStatus(page),factsBefore=await confirmedFacts(page),call=await begin(page,'병원 문의와 자료·이동 준비를 확인해 주세요.');
      const body=JSON.parse(call.body),first=await advancePoll(page,0);
      const pendingControls=await page.locator('#request-input,#cancel-request').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {id:node.id,inViewport:r.top>=0 && r.bottom<=innerHeight && r.height>0};}));
      record('새 요청 대기는 입력·중지를 화면 밖으로 자동 이동하지 않음',pendingControls.every(item=>item.inViewport),JSON.stringify(pendingControls));
      record('일반 요청은 안전한256bit 토큰과 JSON SHA256',/^[A-Za-z0-9_-]{43}$/.test(body.progressToken) && !call.hasSearch && call.headers['x-amz-content-sha256']===hash(call.body));
      const readBody=JSON.parse(first.body);
      record('진행 조회는 토큰 한 필드·POST 본문 해시·원문 미포함',Object.keys(readBody).join(',')==='progressToken' && !first.hasSearch && readBody.progressToken===body.progressToken && first.headers['x-amz-content-sha256']===hash(first.body) && !first.body.includes(body.message));
      await page.clock.runFor(5500);
      record('진행 응답 대기 중에는 다음 조회를 겹쳐 보내지 않음',(await calls(page,'/api/agent/progress')).length===1);
      await release(page,first,{available:false,progress:null});
      await page.clock.runFor(2600);
      const second=await callAt(page,'/api/agent/progress',1);
      record('진행 미등록은 상태를 완료로 만들지 않고 원응답 대기',JSON.stringify(await allStatus(page))===JSON.stringify(before) && await page.locator('#preparation-board').getAttribute('data-active-stage')==='' && await page.locator('#preparation-board [data-live="true"]').count()===0 && await page.locator('#conversation-form').getAttribute('aria-busy')==='true' && await page.locator('.message.assistant:not(.greeting)').count()===0);
      await page.locator('#request-input').focus();
      const closedPosition=await readingPosition(page);
      await release(page,second,progress('hospitals',4));
      const hospitalActivity=await page.locator('[data-stage-id="hospitals"] [data-stage-live]').textContent();
      record('실제 형식 진행의 병원 도구 시작은 병원 칸과 요약에 표시',/병원|문의/.test(hospitalActivity) && /확인 중|진행/.test(hospitalActivity) && await liveSummary(page,'hospitals'));
      const updatedClosedPosition=await readingPosition(page);
      record('진행 갱신은 네 칸 표시·focus·문서 읽기 위치를 바꾸지 않음',samePosition(closedPosition,updatedClosedPosition) && await page.locator('#preparation-board>[data-stage-id]').evaluateAll(nodes=>nodes.every(node=>node.checkVisibility())),JSON.stringify({before:closedPosition,after:updatedClosedPosition}));
      const third=await advancePoll(page,2);
      await release(page,third,progress('records',2));
      record('sequence가 뒤로 간 진행은 병원 상태를 되돌리지 않음',normalize(await page.locator('[data-stage-id="hospitals"] [data-stage-live]').textContent())===normalize(hospitalActivity));
      const fourth=await advancePoll(page,3);
      await page.locator('#request-input').focus();
      const nextPosition=await readingPosition(page);
      await release(page,fourth,progress('support',7));
      const updatedNextPosition=await readingPosition(page);
      record('이동 도구 시작은 이동 요약에서 읽고 focus·읽기 위치 유지',/이동|동행/.test(await page.locator('[data-stage-id="support"] [data-stage-live]').textContent()) && await liveSummary(page,'support') && samePosition(nextPosition,updatedNextPosition),JSON.stringify({before:nextPosition,after:updatedNextPosition}));
      record('진행만 도착해도 마지막 확인 환자·자료·문의 facts는 바뀌지 않음',JSON.stringify(await confirmedFacts(page))===JSON.stringify(factsBefore));
      const progressGuide=await accessible(page.locator('#board-activity'));
      record('공통 진행 원문은 안내를 직접 펼쳐 읽으며 중지는 계속 표시',progressGuide.reachable && await page.locator('#cancel-request').isVisible(),JSON.stringify(progressGuide));
      const completedPoll=await advancePoll(page,4);
      await release(page,completedPoll,progress('plan',10,{status:'completed',eventStatus:'completed'}));
      await page.clock.runFor(5500);
      record('도구 진행 completed만으로 답변·진료 준비 완료를 만들지 않음',await page.locator('#conversation-form').getAttribute('aria-busy')==='true' && await page.locator('.message.assistant:not(.greeting)').count()===0 && await statusOf(page,'plan')==='waiting' && (await calls(page,'/api/agent/progress')).length===5);
      const currentReads=await calls(page,'/api/agent/progress');
      record('진행 읽기는2.5초 이상 간격·동시에 한 개',currentReads.every((item,index)=>index===0 || item.at-currentReads[index-1].at>=2500));
      record('진행 조회는 기존 일반 요청1건만 유지하며 모델 요청을 추가하지 않음',(await calls(page,'/api/agent')).length===1 && actualPosts.length===0);
      await finish(page,call,createDemoCase(),'진행을 본 뒤 도착한 합성 최종 답변입니다.');
      const completedReads=(await calls(page,'/api/agent/progress')).length;
      await page.clock.runFor(9000);
      record('최종 응답 후 진행 조회 중단·대화 답변 유지',await page.locator('.message.assistant:not(.greeting)').count()===1 && (await page.locator('#message-list').innerText()).includes('진행을 본 뒤') && (await calls(page,'/api/agent/progress')).length===completedReads && actualPosts.length===0);
      proof.progressScenarios.push({id:'ordered-progress',mainRequests:1,progressReads:completedReads,minIntervalMs:Math.min(...currentReads.slice(1).map((item,index)=>item.at-currentReads[index].at)),rawTokensStored:false});
      await shot(page,'desktop-progress-final');
    } finally {await context.close();}
  });

  await scenario('모바일 내역 읽기·이전 토큰·취소·최종응답 경합',async()=>{
    const {page,context}=await open(390,844,{fixture:true});
    try {
      const firstMain=await begin(page,'첫 문의는 중지한 뒤 다시 정리합니다.');
      const firstPoll=await advancePoll(page,0);
      await readStage(page,'records');
      await page.locator('#cancel-request').click();await flush(page);
      record('진행 중지는 원문 복원·서버 처리와 화면 대기를 구분',await page.locator('#request-input').inputValue()===JSON.parse(firstMain.body).message && /대기.*중지|중지.*대기/.test(await page.locator('#conversation-status').innerText()) && /서버|처리.*계속/.test(await page.locator('#conversation-status').innerText()));
      const secondMain=await begin(page,'새 문의의 자료를 먼저 읽겠습니다.',1);
      const secondPoll=await advancePoll(page,1);
      record('새 요청은 다른 토큰을 쓰고 이전 조회를 중단',JSON.parse(firstMain.body).progressToken!==JSON.parse(secondMain.body).progressToken && (await calls(page,'/api/agent/progress'))[0].aborted);
      const openPosition=await readingPosition(page);
      await release(page,secondPoll,progress('support',8));
      const updatedOpenPosition=await readingPosition(page);
      record('모바일 진행은 펼침·focus·문서 읽기 위치를 보존하며 다른 내역을 숨기지 않음',samePosition(openPosition,updatedOpenPosition) && await page.locator('#preparation-board>[data-stage-id]').evaluateAll(nodes=>nodes.every(node=>node.checkVisibility())) && await page.locator('[data-stage-id="records"]').isVisible() && await page.locator('[data-stage-id="support"]').isVisible() && await page.locator('[data-stage-id="plan"]').isVisible(),JSON.stringify({before:openPosition,after:updatedOpenPosition}));
      const supportActivity=normalize(await page.locator('[data-stage-id="support"] [data-stage-events]').textContent());
      await release(page,firstPoll,progress('hospitals',100));
      await release(page,firstMain,response(firstMain,createDemoCase(),'이전 토큰의 늦은 답변은 보이면 안 됩니다.'));
      record('이전 토큰의 늦은 진행·main 성공은 새 요청을 덮지 않음',normalize(await page.locator('[data-stage-id="support"] [data-stage-events]').textContent())===supportActivity && await page.locator('#conversation-form').getAttribute('aria-busy')==='true' && !(await page.locator('#message-list').innerText()).includes('이전 토큰의 늦은 답변'));
      await finish(page,secondMain,createDemoCase(),'새 문의의 합성 최종 답변입니다.');
      record('최종 답변도 자료·병원·이동·답변 네 칸을 함께 유지',await page.locator('#preparation-board>[data-stage-id]').evaluateAll(nodes=>nodes.every(node=>node.checkVisibility())) && await page.locator('[data-stage-id="records"]').isVisible() && await page.locator('[data-stage-id="plan"]').isVisible());
      record('중앙 답변 본문에서 새 답변과 취소 이력을 함께 읽음',(await page.locator('.chat-workspace #message-list').innerText()).includes('새 문의의 합성 최종 답변') && /중지/.test(await page.locator('.chat-workspace .request-error').first().innerText()) && await page.locator('.message.user').count()===2 && await page.locator('#preparation-board .message,#preparation-board .request-error').count()===0);
      const oldCount=(await calls(page,'/api/agent/progress')).length;await page.clock.runFor(9000);
      record('취소·최종응답 뒤 유휴 진행 POST가 늘지 않음',(await calls(page,'/api/agent/progress')).length===oldCount);
      proof.progressScenarios.push({id:'cancel-old-token-mobile',mainRequests:2,progressReads:oldCount,rawTokensStored:false});
      await shot(page,'mobile-cancel-final');
    } finally {await context.close();}
  });

  await scenario('빈 진행은 실제 도구 실행을 꾸미지 않음',async()=>{
    const {page,context}=await open(1440,900,{fixture:true});
    try {
      const facts=await confirmedFacts(page),call=await begin(page,'실제 시작한 작업만 표시해 주세요.');
      const first=await advancePoll(page,0);
      const empty={available:true,progress:{version:1,status:'running',sequence:1,updatedAt:'2026-10-31T12:00:00.000Z',currentStage:null,stages:ids.map(id=>({id,status:'waiting',lastTool:null})),events:[]}};
      await release(page,first,empty);
      record('currentStage:null·events:[]는 단계 실행 강조·가짜 답변 없음',await page.locator('#preparation-board [data-live="true"]').count()===0 && await page.locator('#preparation-board [data-stage-live]:visible').count()===0 && await page.locator('.message.assistant:not(.greeting)').count()===0 && await page.locator('#conversation-form').getAttribute('aria-busy')==='true');
      record('빈 진행에서도 마지막 확인 환자·자료·문의 facts 보존',JSON.stringify(await confirmedFacts(page))===JSON.stringify(facts));
      const second=await advancePoll(page,1);await release(page,second,progress('hospitals',4));
      record('실제 도구 시작 뒤에만 병원 요약의 실행 강조',await liveSummary(page,'hospitals'));
      await finish(page,call,createDemoCase(),'빈 진행을 거쳐 받은 합성 답변입니다.');
      proof.progressScenarios.push({id:'empty-progress',mainRequests:1,progressReads:2,rawTokensStored:false});
    } finally {await context.close();}
  });

  await scenario('새 대화 뒤 이전 진행 무시',async()=>{
    const {page,context}=await open(1440,900,{fixture:true});
    try {
      const call=await begin(page,'새 대화 전에 중지할 합성 요청입니다.');
      const poll=await advancePoll(page,0);
      await page.locator('#cancel-request').click();await flush(page);
      page.once('dialog',dialog=>dialog.accept());await page.locator('#new-conversation').click();await flush(page);
      record('진행을 중지하고 새 대화하면 초안·이력·상태 초기화',await page.locator('#request-input').inputValue()==='' && await page.locator('.message').count()===1 && (await allStatus(page)).slice(1).every(status=>status==='waiting'));
      await release(page,poll,progress('support',120));
      await release(page,call,response(call,createDemoCase(),'새 대화 뒤 섞이면 안 되는 이전 답변'));
      await page.clock.runFor(9000);
      record('새 대화는 이전 토큰의 늦은 진행·답변·추가 조회를 차단',await page.locator('.message').count()===1 && !(await page.locator('#message-list').innerText()).includes('섞이면 안 되는') && (await allStatus(page)).slice(1).every(status=>status==='waiting') && (await calls(page,'/api/agent/progress')).length===1);
      proof.progressScenarios.push({id:'new-conversation-old-token',mainRequests:1,progressReads:1,rawTokensStored:false});
    } finally {await context.close();}
  });

  for(const mode of ['http-failure','failed-dto','zero-sequence','cap'])await scenario(mode+' 진행 오류·상한',async()=>{
    const {page,context}=await open(1280,800,{fixture:true});
    try {
      const call=await begin(page,'진행 연결이 안 되어도 최종 답변을 기다려 주세요.'),baseline=await allStatus(page);
      let count=0;
      if(mode==='cap') {
        // 화면 대기 한도65초가 먼저 끝날 수 있다. 조회 상한26회를 강제로 채우지 않는다.
        for(let step=0;step<28;step++) {
          await page.clock.runFor(2500);
          const reads=await calls(page,'/api/agent/progress');
          if(reads.length>count) {await release(page,reads[count],{available:false,progress:null});count++;}
          if(await page.locator('#conversation-form').getAttribute('aria-busy')==='false')break;
        }
        await page.clock.runFor(9000);
      } else {
        const poll=await advancePoll(page,0);
        if(mode==='http-failure')await release(page,poll,{error:{code:'PROGRESS_UNAVAILABLE',message:'진행 fixture 오류'}},{status:503});
        else if(mode==='zero-sequence')await release(page,poll,progress('hospitals',0));
        else await release(page,poll,progress('hospitals',2,{status:'failed',eventStatus:'failed'}));
        count++;await page.clock.runFor(2600);
      }
      const total=(await calls(page,'/api/agent/progress')).length;
      record(mode+'는 단계 완료를 만들지 않고 원응답/복구 상태를 보존',await page.locator('.message.assistant:not(.greeting)').count()===0 && (await allStatus(page)).every((value,index)=>value===baseline[index] || value==='needs_input') && !/준비 완료|진료 확정|배차 완료/.test(await page.locator('#preparation-board').innerText()));
      record(mode+'에서 실제 실행 중 강조를 남기지 않음',await page.locator('#preparation-board [data-live="true"]').count()===0);
      record(mode+' 진행 조회는 최대26번·동시 중복 없음',total<=26 && (mode!=='cap' || total>=24 && total===count),String(total)+'회');
      if(await page.locator('#conversation-form').getAttribute('aria-busy')==='true') {
        await finish(page,call,createDemoCase(),'진행 연결과 무관하게 받은 합성 답변입니다.');
        record(mode+' 진행 실패가 원래 최종 답변을 막지 않음',(await page.locator('#message-list').innerText()).includes('진행 연결과 무관하게'));
      } else {
        await release(page,call,response(call,createDemoCase(),'화면 시간 초과 후 늦은 답변'));
        record(mode+' 화면 대기 종료 뒤 늦은 결과는 안전하게 무시',!(await page.locator('#message-list').innerText()).includes('화면 시간 초과 후 늦은 답변') && await page.locator('#request-input').inputValue()===JSON.parse(call.body).message);
      }
      proof.progressScenarios.push({id:mode,mainRequests:1,progressReads:total,rawTokensStored:false});
    } finally {await context.close();}
  });

  await scenario('legacy capabilities는 진행 조회하지 않음',async()=>{
    const legacy={...caps};delete legacy.progress;
    const {page,context}=await open(1440,900,{fixture:true,capabilities:legacy});
    try {
      const call=await begin(page,'이전 연결 형식으로 요청합니다.');await page.clock.runFor(10000);
      const reads=await calls(page,'/api/agent/progress');
      record('progress 미지정 capabilities는 poll·토큰 생성을 요구하지 않음',reads.length===0 && !Object.hasOwn(JSON.parse(call.body),'progressToken'));
      await finish(page,call,createDemoCase(),'기존 연결의 합성 답변입니다.');
      record('기존 응답 경로는 정상 유지',(await page.locator('#message-list').innerText()).includes('기존 연결의 합성 답변'));
    } finally {await context.close();}
  });

  for(const width of [1440,390])await scenario(width+'px 오른쪽 방문 계획 읽는 중 새 답변',async()=>{
    const {page,context,actualPosts}=await open(width,844,{fixture:true});
    try {
      const first=await begin(page,'방문 준비 상태를 먼저 정리해 주세요.');
      await finish(page,first,createDemoCase(),'방문 계획을 읽기 전 확인한 합성 답변입니다.');
      const second=await begin(page,'방문 계획을 읽는 동안 새 답변을 기다립니다.',1);
      await readStage(page,'plan');
      const summary=page.locator('[data-stage-id="plan"] [data-stage-details]>summary');
      await summary.scrollIntoViewIfNeeded();await summary.focus();
      const readingNode=await summary.elementHandle();
      await page.evaluate(()=>{
        window.__qaPlanScrollCalls=[];
        for(const [target,names] of [[Element.prototype,['scrollIntoView','scrollIntoViewIfNeeded','scrollTo','scrollBy']],[window,['scrollTo','scrollBy']]])for(const name of names) {
          const original=target[name];
          if(typeof original==='function')target[name]=function(...args){if(this?.id!=='preparation-rail' || !['scrollTo','scrollBy'].includes(name))window.__qaPlanScrollCalls.push(name);return original.apply(this,args);};
        }
      });
      const snapshot=()=>readingNode.evaluate(node=>{const r=node.getBoundingClientRect();return {connected:node.isConnected,active:document.activeElement===node,open:node.parentElement.open,top:r.top,left:r.left,scrollCalls:window.__qaPlanScrollCalls.length};});
      const before=await snapshot(),reply='# 방문 계획을 읽는 동안 도착한 답변\n\n'+Array.from({length:8},(_,index)=>'새 답변 '+(index+1)+': 실제 발신·예약·배차를 하지 않은 합성 준비 결과입니다.').join('\n\n');
      await finish(page,second,createDemoCase(),reply);
      const after=await snapshot(),notice=page.locator('#answer-ready-notice');
      const readingPreserved=before.active && before.open && after.connected && after.active && after.open && after.scrollCalls===0 && Math.abs(after.top-before.top)<=2 && Math.abs(after.left-before.left)<=1;
      const unreadNotice=await notice.isVisible();
      record(width+'px 네 번째 준비 상세를 읽는 중에도 자동 이동 없이 focus·위치·펼침과 새 답변 알림 유지',readingPreserved && unreadNotice && await page.locator('.chat-workspace #message-list .message.assistant:not(.greeting)').count()===2 && await page.locator('#preparation-board .message').count()===0,JSON.stringify({before,after,unreadNotice}));
      await shot(page,width+'-plan-reading-new-answer');
      await notice.locator('[data-open-stage="plan"]').click();await flush(page);
      const answer=page.locator('.chat-workspace #message-list .message.assistant:not(.greeting)').last();
      record(width+'px 새 답변 알림을 선택하면 중앙 답변 시작으로 이동·추가 POST 없음',!await notice.isVisible() && await answer.locator('h3').evaluate(node=>{const r=node.getBoundingClientRect();return node.checkVisibility({visibilityProperty:true}) && r.width>0 && r.height>0 && r.top>=0 && r.bottom<=innerHeight;}) && (await calls(page,'/api/agent')).length===2 && actualPosts.length===0);
      proof.progressScenarios.push({id:'plan-reading-new-answer-'+width,mainRequests:2,progressReads:(await calls(page,'/api/agent/progress')).length,readingPreserved,unreadNotice,rawTokensStored:false});
    } finally {await context.close();}
  });

  for(const [width,height] of viewports)await scenario(width+'x'+height+' 긴 답변·표·확대',async()=>{
    const {page,context,actualPosts}=await open(width,height,{fixture:true});
    try {
      const reply='# 긴 기관별 준비 답변\n\n'+Array.from({length:24},(_,i)=>'확인 '+(i+1)+'. 제주 지역의 긴 이름을 가진 문의 기관과 기존 도외 전문 진료 기관의 자료 전달 절차를 확인합니다. 실제 진료 수락과 예약은 미확정입니다.').join('\n\n')+
        '\n\n| 기관 | 문의 내용 | 필요한 자료 | 시점 | 담당 | 예약 |\n| --- | --- | --- | --- | --- | --- |\n| 제주 지역의 긴 기관 이름 | 협진 접수·의뢰 회송 준비 질문 | 판독문·진찰 소견·의뢰서 | 방문 시각 확인 전 | 기관 담당자 | 미확정 |\n\n마지막 확인: 실제 발신·예약·배차는 하지 않았습니다.';
      const beforeReply=await page.locator('.chat-workspace').evaluate(node=>({chatHeight:node.clientHeight,planHeight:document.querySelector('[data-stage-id="plan"]').clientHeight,documentHeight:document.scrollingElement.scrollHeight}));
      const call=await begin(page,'표를 포함한 긴 합성 답변을 읽겠습니다.');
      await finish(page,call,createDemoCase(),reply);
      const answer=page.locator('.chat-workspace #message-list .message.assistant:not(.greeting) .message-body');
      record(width+'x'+height+' 긴 전체 답변은 중앙1개이고 오른쪽 계획은 요약·facts·기록만 표시',await answer.count()===1 && await page.locator('#preparation-board .message,#preparation-board #message-list').count()===0 && await page.locator('[data-stage-id="plan"] [data-stage-summary],[data-stage-id="plan"] [data-stage-facts],[data-stage-id="plan"] [data-stage-events]').count()===3 && !/긴 기관별 준비 답변|확인 24\.|마지막 확인:/.test(await page.locator('.preparation-rail').innerText()));
      record(width+'x'+height+' 새 답변의 시작은 별도 창 선택 없이 페이지에 표시',await answer.locator('h3').first().evaluate(node=>{const rect=node.getBoundingClientRect();return node.checkVisibility({visibilityProperty:true}) && rect.width>0 && rect.height>0 && rect.top>=0 && rect.bottom<=innerHeight;}));
      const start=await accessible(answer.locator('h3').first()),startY=await page.locator('#conversation-scroll').evaluate(node=>node.scrollTop);
      const end=await accessible(answer.locator('p').last()),endY=await page.locator('#conversation-scroll').evaluate(node=>node.scrollTop),reading=await workspaceEvidence(page);
      const afterReply=await page.locator('.chat-workspace').evaluate(node=>({chatHeight:node.clientHeight,planHeight:document.querySelector('[data-stage-id="plan"]').clientHeight,answerHeight:node.querySelector('.message.assistant:not(.greeting) .message-body').clientHeight,documentHeight:document.scrollingElement.scrollHeight}));
      record(width+'x'+height+' 긴 답변은 앱 높이를 유지하며 중앙 스크롤로 처음과 끝까지 읽음',start.reachable && end.reachable && endY>startY+100 && reading.viewportFit && reading.sharedComposer && reading.scrollRegions && afterReply.chatHeight>0 && afterReply.documentHeight<=height+1,JSON.stringify({start,end,startY,endY,beforeReply,afterReply,reading}));
      proof.workspaceScenarios.push({id:'long-answer-table',width,height,...reading,contentReachable:start.reachable && end.reachable});
      const tableScroll=answer.locator('.message-table-scroll');
      await tableScroll.focus();
      const tablePosition=()=>tableScroll.evaluate(node=>({focused:document.activeElement===node,left:node.scrollLeft,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth}));
      const beforeKey=await tablePosition(),scrollStarted=performance.now();
      await tableScroll.press('ArrowRight');
      let afterKey=await tablePosition();
      // 모의 JS 시계와 독립인 브라우저 기본 키보드 스크롤을 Node 시계로 관측한다.
      while(afterKey.focused && afterKey.scrollWidth>afterKey.clientWidth+1 && afterKey.left<=beforeKey.left && performance.now()-scrollStarted<2000) {
        await new Promise(resolve=>setTimeout(resolve,20));afterKey=await tablePosition();
      }
      record(width+'x'+height+' 표는 키보드로 가로 스크롤 가능',beforeKey.focused && afterKey.focused && (afterKey.scrollWidth<=afterKey.clientWidth+1 || afterKey.left>beforeKey.left),JSON.stringify({beforeKey,afterKey,realWaitMs:Math.round(performance.now()-scrollStarted)}));
      proof.workspaceScenarios.at(-1).tableKeyboard=beforeKey.focused && afterKey.focused && (afterKey.scrollWidth<=afterKey.clientWidth+1 || afterKey.left>beforeKey.left);
      record(width+'px 표만 가로 스크롤·키보드 이름 제공',await answer.locator('.message-table-scroll table').count()===1 && await answer.locator('.message-table-scroll').evaluate(node=>node.tabIndex===0 && Boolean(node.getAttribute('aria-label')) && /auto|scroll/.test(getComputedStyle(node).overflowX)) && await noOverflow(page));
      const before=(await calls(page)).length;
      await page.locator('#expand-answer').click();
      const dialog=page.locator('#answer-dialog');await dialog.waitFor();
      record(width+'px 확대 답변은 이름·focus·원문·표를 가진 native dialog',await dialog.evaluate(node=>node instanceof HTMLDialogElement && node.open && node.matches(':modal') && node.contains(document.activeElement) && Boolean(document.getElementById(node.getAttribute('aria-labelledby'))?.textContent.trim())) && normalize(await dialog.innerText()).includes('마지막 확인: 실제 발신') && await dialog.locator('.message-table-scroll table').count()===1);
      const last=await accessible(dialog.locator('.message-body p').last()),close=await accessible(page.locator('#close-answer'));
      record(width+'px 확대 끝문장·닫기·가로 넘침 접근',last.reachable && close.reachable && await noOverflow(page));
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      record(width+'px 확대는 POST 없이 닫기 focus 복원',(await calls(page)).length===before && actualPosts.length===0 && await page.locator('#expand-answer').evaluate(node=>document.activeElement===node));
      const input=page.locator('#request-input');
      await input.fill(Array.from({length:12},(_,i)=>String(i+1)+'번째 긴 요청 문장입니다.').join('\n'));await input.press('Control+End');
      const composer=await accessible(input),send=await accessible(page.locator('#send-request')),disclosure=await accessible(page.locator('#composer-disclosure')),fullDisclosure=await accessible(page.locator('#composer-boundary'));
      const multipleWorkspace=await workspaceEvidence(page);
      record(width+'x'+height+' 긴 입력·보내기·고지 재접근',composer.reachable && send.reachable && disclosure.reachable && fullDisclosure.reachable && multipleWorkspace.viewportFit && multipleWorkspace.sharedComposer && await input.evaluate(node=>node.value.split('\n').length===12 && node.scrollTop+node.clientHeight>=node.scrollHeight-3));
      proof.workspaceScenarios.push({id:'multiline-12',width,height,...multipleWorkspace,contentReachable:composer.reachable && send.reachable && disclosure.reachable && fullDisclosure.reachable});
      await shot(page,width+'x'+height+'-answer-table');
      const originalTextSize=await answer.evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
      await page.evaluate(()=>{
        const nodes=[document.body,...document.body.querySelectorAll('*')].filter(node=>node instanceof HTMLElement && !['SCRIPT','STYLE'].includes(node.tagName));
        const sizes=nodes.map(node=>parseFloat(getComputedStyle(node).fontSize));
        nodes.forEach((node,index)=>{if(sizes[index]>0)node.style.fontSize=sizes[index]*2+'px';});
      });
      await input.press('Control+End');
      const enlargedStart=await accessible(answer.locator('h3').first()),enlargedEnd=await accessible(answer.locator('p').last()),enlargedComposer=await accessible(input),enlargedSend=await accessible(page.locator('#send-request')),enlargedDisclosure=await accessible(page.locator('#composer-disclosure')),enlargedBoundary=await accessible(page.locator('#composer-boundary')),enlargedReading=await workspaceEvidence(page);
      const enlargedTools=[];for(const selector of ['#expand-answer','#preview-button','#workspace-tab-chat','#workspace-tab-preparation'])if(await page.locator(selector).isVisible())enlargedTools.push({selector,...await accessible(page.locator(selector))});
      record(width+'x'+height+' 텍스트200%에서도 답변·입력·고지는 실제 스크롤로 접근',await answer.evaluate((node,size)=>parseFloat(getComputedStyle(node).fontSize)>=size*1.95,originalTextSize) && [enlargedStart,enlargedEnd,enlargedComposer,enlargedSend,enlargedDisclosure,enlargedBoundary,...enlargedTools].every(item=>item.reachable) && enlargedReading.viewportFit && enlargedReading.sharedComposer && enlargedReading.scrollRegions && enlargedReading.compactPanels && await noOverflow(page),JSON.stringify({enlargedStart,enlargedEnd,enlargedComposer,enlargedSend,enlargedDisclosure,enlargedBoundary,enlargedTools,reading:enlargedReading}));
      proof.workspaceScenarios.push({id:'text-200',width,height,textScale:2,...enlargedReading,contentReachable:[enlargedStart,enlargedEnd,enlargedComposer,enlargedSend,enlargedDisclosure,enlargedBoundary,...enlargedTools].every(item=>item.reachable),controls:enlargedTools});
      await shot(page,width+'x'+height+'-text-200');
    } finally {await context.close();}
  });

  await scenario('poll 연결 설정에서도 preview는 조회하지 않음',async()=>{
    const {page,context,actualPosts}=await open(1440,900,{fixture:true});
    try {
      const {result,data}=await preview(page,'aewol-parent-visit');
      await page.clock.runFor(9000);
      record('poll capabilities에서도 preview는 실제 고정 API1건·진행0건',result.status()===200 && data.isPreview===true && (await calls(page)).length===0 && actualPosts.length===1 && actualPosts[0].path==='/api/agent/preview');
      record('preview의 llm:false가 연결 설정을 덮어쓰지 않음',await page.locator('#connection-state').innerText()==='대화 연결 설정됨' && /LLM.*없음/.test(await page.locator('#mode-notice').innerText()));
      if(result.status()===200 && data.isPreview===true)previewEvidence=data;
    } finally {await context.close();}
  });

  for(const width of [1440,390])await scenario(width+'px 확정 출처 focus·DOM 보존',async()=>{
    if(!previewEvidence)throw new Error('실제 keyless preview 근거를 확보하지 못했습니다.');
    const {page,context,actualPosts}=await open(width,844,{fixture:true});
    try {
      const first=await begin(page,'확정 처리 기록을 읽을 합성 요청입니다.');
      const fixture={...response(first,previewEvidence.caseState,previewEvidence.reply),events:previewEvidence.events,pendingActions:previewEvidence.pendingActions};
      await release(page,first,fixture);
      await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
      const previousProgressReads=(await calls(page,'/api/agent/progress')).length;
      const second=await begin(page,'출처를 읽는 동안 다음 준비를 확인합니다.',1);
      await readStage(page,'records');
      for(const id of ids.filter(id=>id!=='plan')) {
        await readStage(page,id);
        const log=page.locator('[data-stage-id="'+id+'"] [data-stage-log]');
        if(!await log.evaluate(node=>node.open))await log.locator(':scope>summary').click();
      }
      const link=await page.locator('[data-stage-id="hospitals"] [data-stage-events] [data-tool-status="completed"] a[href^="https://"]').first().elementHandle();
      if(!link)throw new Error('실제 preview의 확정 처리 기록에 공개 출처 링크가 없습니다.');
      await link.scrollIntoViewIfNeeded();await link.focus();
      await page.evaluate(()=>{
        window.__qaSourceScrollCalls=[];
        for(const [target,names] of [[Element.prototype,['scrollIntoView','scrollIntoViewIfNeeded','scrollTo','scrollBy']],[window,['scrollTo','scrollBy']]])for(const name of names) {
          const original=target[name];
          if(typeof original==='function')target[name]=function(...args){if(this?.id!=='preparation-rail' || !['scrollTo','scrollBy'].includes(name))window.__qaSourceScrollCalls.push(name);return original.apply(this,args);};
        }
      });
      const snapshot=()=>link.evaluate(node=>{const rect=node.getBoundingClientRect();return {connected:node.isConnected,active:document.activeElement===node,stage:node.closest('[data-stage-id]')?.dataset.stageId,top:rect.top,left:rect.left,documentY:scrollY,scrollCalls:window.__qaSourceScrollCalls.length};});
      const before=await snapshot();
      record(width+'px 실제 preview 근거를 normal 응답 fixture로 표시·병원 출처 focus',before.connected && before.active && before.stage==='hospitals' && actualPosts.length===0,'preview→일반 요청 초기화 경계는 기존 검사로 별도 보존');
      let focusPreserved=before.connected && before.active;
      for(const [index,sequence] of [4,8].entries()) {
        const stage=['records','hospitals'][index],poll=await advancePoll(page,previousProgressReads+index);await release(page,poll,progress(stage,sequence));
        const after=await snapshot();
        const sameRequest=JSON.parse(poll.body).progressToken===JSON.parse(second.body).progressToken;
        const preserved=sameRequest && after.connected && after.active && after.stage===before.stage && after.scrollCalls===0 && Math.abs(after.top-before.top)<=2 && Math.abs(after.left-before.left)<=1;
        focusPreserved &&=preserved;
        record(width+'px '+stage+' 진행'+sequence+'는 같은 병원 출처 노드·focus·화면 위치를 보존',preserved,JSON.stringify({sameRequest,before,after}));
      }
      await shot(page,width+'-static-source-live');
      await finish(page,second,previewEvidence.caseState,'출처를 읽은 뒤 받은 합성 최종 답변입니다.');
      record(width+'px 출처 focus 회귀는 일반 실제 POST 없이 기존 답변 경로 유지',actualPosts.length===0 && (await calls(page,'/api/agent')).length===2 && (await page.locator('#message-list').innerText()).includes('출처를 읽은 뒤'));
      proof.progressScenarios.push({id:'static-source-focus-'+width,mainRequests:(await calls(page,'/api/agent')).length,progressReads:(await calls(page,'/api/agent/progress')).length-previousProgressReads,sourceIdentityAndFocus:focusPreserved,rawTokensStored:false});
    } finally {await context.close();}
  });

  await scenario('동일 작업공간 크기 전환·읽기 보존',async()=>{
    if(!previewEvidence)throw new Error('크기 전환에 사용할 실제 keyless preview 근거가 없습니다.');
    const {page,context,actualPosts}=await open(1152,720,{fixture:true});
    try {
      const call=await begin(page,'가용 공간을 바꾸기 전의 합성 준비 요청입니다.');
      await release(page,call,{...response(call,previewEvidence.caseState,previewEvidence.reply),events:previewEvidence.events,pendingActions:previewEvidence.pendingActions});
      await page.waitForFunction(()=>document.getElementById('conversation-form').getAttribute('aria-busy')==='false');
      const input=await page.locator('#request-input').elementHandle(),draft='화면 크기를 바꿔도 보존할 다음 요청';await page.locator('#request-input').fill(draft);
      await readStage(page,'hospitals');
      const log=page.locator('[data-stage-id="hospitals"] [data-stage-log]');if(!await log.evaluate(node=>node.open))await log.locator(':scope>summary').click();
      const source=await page.locator('[data-stage-id="hospitals"] [data-stage-events] a[href^="https://"]').first().elementHandle();
      if(!source)throw new Error('크기 전환 전에 읽을 공개 출처가 없습니다.');
      await source.scrollIntoViewIfNeeded();await source.focus();
      const snapshot=()=>source.evaluate(node=>({sameNode:node.isConnected,focused:document.activeElement===node,details:node.closest('[data-stage-details]').open,log:node.closest('[data-stage-log]').open,scrollTop:document.getElementById('preparation-rail').scrollTop,active:document.querySelector('.conversation-layout').dataset.activeView}));
      const before=await snapshot(),samples=[];
      for(const [width,height] of [[720,450],[1152,720]]) {
        await page.setViewportSize({width,height});await page.clock.runFor(80);
        const position=await snapshot(),workspace=await workspaceEvidence(page),sameComposer=await input.evaluate(node=>node===document.getElementById('request-input')) && await page.locator('#request-input').inputValue()===draft;
        const readingStable=position.sameNode && position.focused && position.details && position.log && Math.abs(position.scrollTop-before.scrollTop)<=2 && (!workspace.compact || position.active==='preparation');
        samples.push({width,height,position,workspace,sameComposer,readingStable});
        record(width+'x'+height+' 같은 context 전환은 출처·focus·열림·rail 읽기·초안 보존',readingStable && sameComposer && workspace.viewportFit && workspace.sharedComposer && workspace.scrollRegions && workspace.compactPanels && actualPosts.length===0,JSON.stringify({before,...samples.at(-1)}));
        proof.workspaceScenarios.push({id:'resize-continuity',width,height,...workspace,sharedComposer:workspace.sharedComposer && sameComposer,readingStable});
      }
    } finally {await context.close();}
  });

  await scenario('준비 탭에서 대기 중지·오류 발견',async()=>{
    const {page,context,actualPosts}=await open(390,500,{fixture:true});
    try {
      const input=page.locator('#request-input'),text='준비 현황에서 중지할 요청';
      await begin(page,text);await readStage(page,'records');
      const pending=await accessible(page.locator('#cancel-request'));
      await page.locator('#cancel-request').click();await flush(page);
      const notice=page.locator('#request-problem-notice');
      const stopped=await input.inputValue()===text && await notice.isVisible();
      await notice.click();await flush(page);
      const stoppedError=await accessible(page.locator('.request-error').last());
      const call=await begin(page,'준비 탭에서 오류를 발견할 요청',1);await readStage(page,'support');
      await release(page,call,{error:{code:'SESSION_BUSY',message:'브라우저 오류 fixture'}},{status:409});
      await page.waitForFunction(()=>document.getElementById('conversation-form').getAttribute('aria-busy')==='false');
      const failureVisible=await notice.isVisible(),noticeAccess=await accessible(notice);
      await notice.click();await flush(page);
      const error=await accessible(page.locator('.request-error').last());
      await showView(page,'preparation');const final=await begin(page,'준비 현황의 공통 입력에서 바로 보낸 요청',2);await finish(page,final,createDemoCase(),'현재 작업 영역에서 발견할 수 있어야 하는 새 합성 답변입니다.');
      const finalView=await workspaceEvidence(page),answerNotice=page.locator('#answer-ready-notice');
      const answerDiscovered=finalView.activeView==='chat' || await answerNotice.isVisible();
      if(finalView.activeView==='preparation' && await answerNotice.isVisible())await answerNotice.locator('button').click();
      const finalAnswer=await accessible(page.locator('#message-list>.message.assistant').last()),workspace=await workspaceEvidence(page);
      record('준비 탭에서도 중지·오류·직접 요청의 새 답변을 발견해 대화로 복귀',pending.reachable && stopped && stoppedError.reachable && failureVisible && noticeAccess.reachable && error.reachable && answerDiscovered && finalAnswer.reachable && await page.locator('#workspace-tab-chat').getAttribute('aria-selected')==='true' && actualPosts.length===0,JSON.stringify({pending,stopped,stoppedError,failureVisible,noticeAccess,error,answerDiscovered,finalAnswer,workspace}));
      proof.workspaceScenarios.push({id:'compact-discovery',width:390,height:500,...workspace});
    } finally {await context.close();}
  });

  for(const width of [1440,390])for(const reducedMotion of ['no-preference','reduce'])await scenario(width+'px '+reducedMotion+' 초록·상호작용',async()=>{
    const evidence={width,reducedMotion,greenSurfaces:false,contrastPassed:false,interactionFeedback:false,replyFeedback:false,readingStable:false,normalPostAttempts:0};
    proof.motionScenarios.push(evidence);
    if(!previewEvidence)throw new Error('motion 검사에 사용할 실제 keyless preview 근거가 없습니다.');
    const {page,context,actualPosts}=await open(width,844,{fixture:true,reducedMotion});
    try {
      const label=width+'px '+reducedMotion,reduce=reducedMotion==='reduce',soft='rgb(237, 246, 239)',secondary='rgb(40, 92, 67)',orange='rgb(168, 77, 22)';
      const input=page.locator('#request-input'),send=page.locator('#send-request'),example=page.locator('[data-example]').first(),details=page.locator('[data-stage-id="records"] [data-stage-details]'),summary=details.locator(':scope>summary');
      const disabled=await send.isDisabled() && await page.locator('#expand-answer').isDisabled();
      if(width<=1050)await page.locator('#open-care-menu').click();
      const surfaces=await page.evaluate(()=>{
        const style=selector=>{const css=getComputedStyle(document.querySelector(selector));return {background:css.backgroundColor,color:css.color};};
        return {tools:style('.workspace-tools'),nav:style('#care-rail'),selected:style('.rail-nav [aria-current]'),icon:style('.stage-topic-icon'),names:[...document.querySelectorAll('.patient-name')].map(node=>getComputedStyle(node).color),cards:[...document.querySelectorAll('.stage-pane')].map(node=>getComputedStyle(node).backgroundColor),identityRemoved:!document.querySelector('.chat-identity,.chat-role,#conversation-title'),chatNamed:Boolean(document.getElementById('chat-workspace').getAttribute('aria-label')),utilities:[...document.querySelectorAll('.workspace-tools button')].map(node=>{const r=node.getBoundingClientRect();return {id:node.id,native:node instanceof HTMLButtonElement,width:r.width,height:r.height};})};
      });
      if(width<=1050) {await page.locator('#close-care-menu').click();await nativeFinished(page.locator('#care-rail'));}
      const utilityNames=await page.getByRole('button',{name:'넓게 읽기',exact:true}).count()===1 && await page.getByRole('button',{name:'예시 보기',exact:true}).count()===1;
      evidence.greenSurfaces=surfaces.identityRemoved && surfaces.chatNamed && utilityNames && surfaces.utilities.length===2 && surfaces.utilities.every(item=>item.native && item.width>=44 && item.height>=44) && surfaces.nav.background==='rgb(244, 248, 244)' && surfaces.selected.background===soft && surfaces.selected.color===secondary && surfaces.icon.color===secondary && surfaces.cards.length===4 && surfaces.cards.every(color=>color==='rgb(255, 255, 255)');
      record(label+' 소개 블록 없이 이름 있는 대화·공통 도구·주변 초록 유지',evidence.greenSurfaces,JSON.stringify(surfaces));
      const previewButton=page.locator('#preview-button');
      await previewButton.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
      const toolbarSelector='.workspace-tools button:not(:disabled),.workspace-tools button:not(:disabled)>.icon';
      const toolbarColors=await contrast(page,toolbarSelector);
      const focus=(await contrast(page,'#preview-button'))[0];
      const keyboardFocus=await previewButton.evaluate(node=>node.matches(':focus-visible') && ['rgb(168, 77, 22)','rgb(40, 92, 67)'].includes(getComputedStyle(node).outlineColor)) && focus?.outlineVisible && focus.outlineRatio>=3;
      await reveal(example);await reveal(summary);
      const closedSummary=await feedback(summary),closedIcon=await feedback(summary.locator(':scope>.icon'));
      await reveal(example);await example.hover();await nativeFinished(example);
      const exampleHover=await feedback(example),exampleIcon=await feedback(example.locator(':scope>.icon'));
      const draft=await example.getAttribute('data-example');await example.click();await page.mouse.move(1,1);await nativeFinished(page.locator('#conversation-form'));
      const draftOnly=await input.inputValue()===draft && (await calls(page)).length===0;
      const inputFocus=await page.locator('#conversation-form').evaluate(node=>node.matches(':focus-within') && getComputedStyle(node).backgroundColor==='rgb(244, 248, 244)' && getComputedStyle(node).outlineStyle!=='none');
      await nativeFinished(send);const sendIdle=await feedback(send);
      await send.hover();await nativeFinished(send);const sendHover=await feedback(send),sendIcon=await feedback(send.locator(':scope>.icon'));
      await page.mouse.down();
      const pressed=await nativeUntil(()=>feedback(send),value=>Math.abs(value.y-(reduce?0:1))<.02);
      await page.mouse.move(1,1);await page.mouse.up();await nativeFinished(send);
      let nativeDetails=closedIcon.rotation===0;
      for(const expanded of [true,false,true,false,true]) {
        await reveal(summary);await summary.focus();await page.keyboard.press('Enter');await nativeFinished(summary);
        const icon=await feedback(summary.locator(':scope>.icon')),surface=await feedback(summary);
        nativeDetails &&=await details.evaluate((node,expanded)=>node instanceof HTMLDetailsElement && node.open===expanded,expanded) && icon.rotation===(expanded?90:0) && surface.width>=44 && surface.height>=44 && (!expanded || surface.background===soft);
      }
      const opened=await feedback(summary),drawerSafe=width>1050 || await page.locator('#care-rail').evaluate(node=>{const style=getComputedStyle(node);return style.visibility==='hidden' && new DOMMatrix(style.transform).e<=-node.getBoundingClientRect().width;});
      evidence.interactionFeedback=disabled && draftOnly && inputFocus && nativeDetails && opened.background!==closedSummary.background && drawerSafe && exampleHover.color==='rgb(27, 70, 49)' && exampleHover.background===soft && exampleHover.width>=44 && exampleHover.height>=44 && exampleIcon.x===(reduce?0:2) && sendIcon.x===(reduce?0:2) && pressed.width===sendIdle.width && pressed.height===sendIdle.height && pressed.width>=44 && pressed.height>=44 && await input.inputValue()===draft && (await calls(page)).length===0;
      record(label+' 실제 hover·누름·44px·반복 native 펼침·입력 초안은 POST 없이 유지',evidence.interactionFeedback,JSON.stringify({exampleHover,exampleIcon,sendIdle,sendHover,sendIcon,pressed,nativeDetails,inputFocus,drawerSafe}));
      const primaryPreserved=surfaces.names.length===2 && surfaces.names.every(color=>color===orange) && sendIdle.background===orange && sendIdle.color==='rgb(255, 255, 255)' && sendHover.background==='rgb(135, 58, 16)';
      const greetingQuiet=await page.locator('#message-list>.greeting>.message-meta').evaluate(node=>getComputedStyle(node).animationName==='none' && node.getAnimations().length===0);
      await showView(page,'chat');
      const first=await begin(page,'초록 화면에서 자료와 문의 준비를 확인합니다.');
      const poll=await advancePoll(page,0);await release(page,poll,progress('hospitals',4));
      const beforeFinal=await page.evaluate(()=>window.__boardMotion.length===0 && document.querySelectorAll('#message-list>.message.assistant:not(.greeting)').length===0);
      const userSoft=await page.locator('#message-list>.message.user>.message-body').evaluate(node=>getComputedStyle(node).backgroundColor=== 'rgb(237, 246, 239)');
      await release(page,first,{...response(first,previewEvidence.caseState,previewEvidence.reply),events:previewEvidence.events,pendingActions:previewEvidence.pendingActions});
      await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
      const motionEvents=()=>page.evaluate(()=>window.__boardMotion);
      let observedAt=performance.now();
      await nativeUntil(motionEvents,events=>reduce?performance.now()-observedAt>=300:events.some(event=>event.type==='animationend' && event.replyIndex===0));
      await nativeFinished(page.locator('#message-list>.message.assistant:last-child>.message-meta'));
      const afterFirst=await motionEvents();
      let readerQuiet=true;
      for(let visit=0;visit<2;visit++) {
        await page.locator('#expand-answer').click();await page.locator('#answer-dialog').waitFor();
        const readerStarted=performance.now();
        await nativeUntil(motionEvents,()=>performance.now()-readerStarted>=280);
        readerQuiet &&=await page.locator('#answer-read-view .message.assistant:not(.greeting)>.message-meta').evaluateAll(nodes=>nodes.length===1 && nodes.every(node=>getComputedStyle(node).animationName==='none' && node.getAnimations().length===0)) && (await motionEvents()).length===afterFirst.length;
        await page.keyboard.press('Escape');await page.locator('#answer-dialog').waitFor({state:'hidden'});
      }
      await nativeFinished(page.locator('.workspace-tools'));
      const conversationColors=await contrast(page),nextDraftContrast=await contrast(page,'#next-request-draft');await showView(page,'preparation');await nativeFinished(page.locator('.workspace-tools'));
      const statusColors=await contrast(page),toolbarAfter=await contrast(page,toolbarSelector+',#next-request-draft');
      const preservedSignals={available:'rgb(38, 113, 73)',attention:'rgb(135, 86, 23)',blocked:'rgb(163, 61, 52)'};
      const signalPreserved=Object.entries(preservedSignals).every(([signal,color])=>statusColors.some(item=>item.signal===signal && item.color===color));
      const nextDraft=await feedback(page.locator('#next-request-draft'));
      evidence.greenSurfaces &&=userSoft;
      const toolbarRoles=[...toolbarColors,...toolbarAfter].filter(item=>!item.id.includes('next-request')).every(item=>[secondary,'rgb(27, 70, 49)'].includes(item.color));
      evidence.contrastPassed=evidence.greenSurfaces && keyboardFocus && primaryPreserved && nextDraft.background==='rgb(255, 241, 231)' && nextDraft.color===orange && signalPreserved && toolbarColors.length>=1 && toolbarAfter.length>=2 && [...toolbarColors,...toolbarAfter,...conversationColors,...nextDraftContrast,...statusColors].every(item=>item.ratio>=item.minimum) && toolbarRoles;
      record(label+' 공통 도구·키보드 focus 대비와 주황·○△×색 유지',evidence.contrastPassed,JSON.stringify({keyboardFocus,focus,toolbarRoles,primaryPreserved,signalPreserved,nextDraft,toolbarColors,toolbarAfter}));
      const second=await begin(page,'출처를 읽는 동안 다음 문의도 준비합니다.',1);
      await readStage(page,'hospitals');
      const log=page.locator('[data-stage-id="hospitals"] [data-stage-log]');if(!await log.evaluate(node=>node.open))await log.locator(':scope>summary').click();
      const source=await page.locator('[data-stage-id="hospitals"] [data-stage-events] [data-tool-status="completed"] a[href^="https://"]').first().elementHandle();
      if(!source)throw new Error('motion 응답의 병원 출처 노드가 없습니다.');
      await source.scrollIntoViewIfNeeded();await source.focus();
      const snapshot=()=>source.evaluate(node=>{const rect=node.getBoundingClientRect();return {connected:node.isConnected,focused:document.activeElement===node,top:rect.top,left:rect.left,open:node.closest('[data-stage-log]').open && node.closest('[data-stage-details]').open,unmoved:[...document.querySelectorAll('.stage-pane,.message,.message-body')].every(item=>getComputedStyle(item).transform==='none')};});
      const before=await snapshot(),pastQuiet=await page.locator('#message-list>.message.assistant>.message-meta').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).animationName==='none' && node.getAnimations().length===0));
      const reply='# 읽던 출처를 유지하는 최종 답변\n\n'+Array.from({length:8},()=> '자료와 문의를 준비하는 합성 응답입니다. 실제 발신·예약·배차는 하지 않았습니다.').join('\n\n');
      await release(page,second,{...response(second,previewEvidence.caseState,reply),events:previewEvidence.events,pendingActions:previewEvidence.pendingActions});
      await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
      const readingSamples=[];observedAt=performance.now();
      const compact=(await workspaceEvidence(page)).compact;
      await nativeUntil(async()=>{readingSamples.push(await snapshot());return motionEvents();},events=>reduce || compact?performance.now()-observedAt>=300:events.filter(event=>event.type==='animationend').length>=2);
      const after=await snapshot();readingSamples.push(after);
      evidence.readingStable=before.connected && before.focused && before.open && before.unmoved && readingSamples.every(item=>item.connected && item.focused && item.open && item.unmoved && Math.abs(item.top-before.top)<=2 && Math.abs(item.left-before.left)<=1);
      if(compact) {
        const waiting=await motionEvents();readerQuiet &&=waiting.length===afterFirst.length;
        await page.locator('#answer-ready-notice [data-open-stage="plan"]').click();await flush(page);
      }
      observedAt=performance.now();
      const finalEvents=await nativeUntil(motionEvents,events=>reduce?performance.now()-observedAt>=280:events.filter(event=>event.type==='animationend').length>=2);
      await nativeFinished(page.locator('#message-list>.message.assistant:last-child>.message-meta'));
      let revisitsQuiet=true;
      for(let visit=0;visit<2;visit++) {await showView(page,'preparation');await showView(page,'chat');const revisitedAt=performance.now();await nativeUntil(motionEvents,()=>performance.now()-revisitedAt>=280);revisitsQuiet &&=(await motionEvents()).length===finalEvents.length;}
      const starts=finalEvents.filter(event=>event.type==='animationstart'),ends=finalEvents.filter(event=>event.type==='animationend');
      const onePerReply=starts.length===2 && ends.length===2 && [0,1].every(index=>starts.filter(event=>event.replyIndex===index).length===1 && ends.filter(event=>event.replyIndex===index).length===1) && finalEvents.length===4;
      const metadataOnly=starts.every(event=>event.name==='hondi-reply-ready' && event.direct && event.latest && !event.greeting && !event.reader && event.meta && event.duration>=200 && event.duration<=300 && event.iterations===1 && event.frames?.some(frame=>frame.background===soft) && new Set(event.frames.map(frame=>frame.clip)).size>1 && event.frames.every(frame=>frame.opacity!=='0' && (!frame.transform || frame.transform==='none')));
      evidence.replyFeedback=greetingQuiet && beforeFinal && readerQuiet && revisitsQuiet && pastQuiet && (reduce?finalEvents.length===0:onePerReply && metadataOnly) && await page.locator('#message-list>.message.assistant:last-child>.message-meta').evaluate(node=>getComputedStyle(node).visibility==='visible' && getComputedStyle(node).opacity==='1' && node.checkVisibility());
      evidence.normalPostAttempts=actualPosts.filter(item=>item.path==='/api/agent').length;
      record(label+' 최종 응답 전/인사/과거/넓게 읽기는 재생 없이 최신 메타만1회',evidence.replyFeedback,JSON.stringify({greetingQuiet,beforeFinal,readerQuiet,revisitsQuiet,pastQuiet,events:await motionEvents()}));
      record(label+' 응답 피드백 중 같은 출처 노드·focus·읽기 위치·카드/본문 고정·일반 POST0',evidence.readingStable && evidence.normalPostAttempts===0 && actualPosts.length===0,JSON.stringify({before,after,samples:readingSamples.length,normalPostAttempts:evidence.normalPostAttempts}));
      await shot(page,width+'-'+reducedMotion+'-green-feedback');
    } finally {await context.close();}
  });

  for(const id of ['aewol-parent-visit','time_changed','call_ai_declined'])await scenario(id+' 실제 keyless preview 창별 사실',async()=>{
    const {page,context,actualPosts}=await open(390,844);
    try {
      const {result,data}=await preview(page,id);
      record(id+'는 실제 고정 preview·LLM/실발신 없음',result.status()===200 && data.isPreview===true && data.capabilities.llm===false && data.events.length>0 && actualPosts.length===1 && actualPosts[0].path==='/api/agent/preview');
      const records=await stageText(page,'records'),hospitals=await stageText(page,'hospitals'),support=await stageText(page,'support'),plan=await stageText(page,'plan');
      record(id+' 자료·병원·이동·방문 계획은 같은 caseState를 읽고 전체 답변은 중앙1개',/자료|판독|진찰/.test(records) && /병원|접수/.test(hospitals) && /이동|동행/.test(support) && !normalize(plan).includes(normalize(data.reply)) && normalize(await page.locator('.chat-workspace #message-list').innerText()).includes(normalize(data.reply)) && await page.locator('.chat-workspace .message.assistant:not(.greeting)').count()===1 && await page.locator('#preparation-board .message,#preparation-board #conversation-scroll').count()===0);
      record(id+' 기호·설명은 actual caseState의 준비 projection과 일치',await checkSignals(page,data.caseState,{responseCount:1,events:data.events}));
      const colors=await contrast(page);
      record(id+' 준비 기호·설명·본문·고지 대비 유지',colors.length>0 && colors.every(item=>item.ratio>=item.minimum),JSON.stringify(colors));
      if(id==='aewol-parent-visit')record('○·△·×는 세 가지 다른 상태색과 뜻을 함께 제공',new Set(['available','attention','blocked'].map(signal=>colors.find(item=>item.signal===signal)?.color)).size===3 && ['available','attention','blocked'].every(signal=>colors.some(item=>item.signal===signal)) && /실제 진료.*예약.*배차.*확정.*아닙니다/.test(await page.locator('.preparation-note').innerText()));
      if(id==='aewol-parent-visit')record('기본 preview의 병원·공개 택시·동행 실패는 올바른 창에 표시',hospitals.includes(data.caseState.patient.localHospital) && support.includes('애월콜') && /연락|인계|확인/.test(support) && await statusOf(page,'support')==='needs_input' && /진료 수락.*미확인/.test(hospitals));
      if(id==='time_changed')record('진료 시각 변경은 휠체어 이동·동행 재확인',await statusOf(page,'support')==='needs_recheck' && ['휠체어','10:00','14:00'].every(term=>(records+' '+support).includes(term)) && /재확인/.test(support) && ['taxi','companion'].every(kind=>data.caseState.visitSupport[kind].status==='needs_recheck'));
      if(id==='call_ai_declined') {
        const journey=await page.evaluate(async state=>(await import('/care-journey.js')).getCareJourneySummary(state),data.caseState);
        const handoff=journey.handoffs.find(item=>item.reason==='ai_declined');
        record('AI 응대 거절은 이동 창의 보호자 인계·자동 반복 중단',await statusOf(page,'support')==='needs_input' && ['AI','거절','보호자'].every(term=>support.includes(term)) && /자동 반복 문의를 중단/.test(support) && handoff?.owner==='보호자' && handoff.status==='handed_off' && handoff.stopAutomatic===true && normalize(support).includes(normalize(handoff.detail)));
        await showView(page,'chat');
        const answerNode=page.locator('.chat-workspace #message-list .message.assistant:not(.greeting) .message-body'),answer=normalize(await answerNode.innerText()),fullBoundary=await accessible(page.locator('#composer-boundary')),disclosure=normalize(await page.locator('#composer-boundary').innerText());
        const activeView=await page.locator('.conversation-layout').getAttribute('data-active-view'),terms=Object.fromEntries(['개인 기록 조회','전화','예약','배차','환자 수락'].map(term=>[term,answer.includes(term)]));
        const boundaryChecks={chatSelected:activeView==='chat',centralRendered:await answerNode.evaluate(node=>node.checkVisibility({visibilityProperty:true})),answerMatches:answer===normalize(data.reply),termsPresent:Object.values(terms).every(Boolean),executionNotPerformed:/실제.*수행하지 않았습니다/.test(answer),fullBoundaryReachable:fullBoundary.reachable,guideOpen:await page.locator('#composer-help').evaluate(node=>node.open),describedBoundary:await page.locator('#request-input').evaluate(node=>node.getAttribute('aria-describedby').split(/\s+/).includes('composer-boundary')),syntheticNotice:/가상 사례/.test(disclosure),contactReservationNotPerformed:/실제.*연락.*예약.*없음/.test(disclosure),handoffCallFalse:handoff?.actualCallPlaced===false,...Object.fromEntries(['actualCallPlaced','reservationConfirmed','clinicalAcceptanceConfirmed','externalRecordsConnected'].map(key=>[key+'False',journey.boundary[key]===false]))};
        record('AI 거절의 실제 실행 미수행 경계는 중앙 API 답변·공통 고지·상태에 일치',Object.values(boundaryChecks).every(value=>value===true),JSON.stringify({activeView,boundaryChecks,terms,fullBoundary}));
        await page.locator('#composer-help>summary').click();
        await showView(page,'preparation');
      }
      const links=page.locator('#preparation-board a[href]');
      record(id+' 공개 출처는 HTTPS·별도 창·44px',await links.evaluateAll(nodes=>nodes.length>0 && nodes.every(node=>node.href.startsWith('https://') && node.target==='_blank' && node.rel.includes('noopener') && (node.getBoundingClientRect().width===0 || node.getBoundingClientRect().height>=44))));
      await shot(page,'preview-'+id);
    } finally {await context.close();}
  });
  record('전체 검사는 유료 일반 POST·전화·개인기록 조회 없이 완료',proof.scope.unmockedNormalPostAttempts===0 && proof.scope.blockedPostAttempts===0 && proof.scope.actualPreviewRequests===4);
  proof.finalSourceHash=await runtimeFingerprint(servedRoot);
  record('검사 중 runtime source 변경 없음',proof.finalSourceHash===proof.sourceHash);
  record('브라우저 실행 오류 없음',errors.length===0,errors.join('; '));
  if(checks.every(check=>check.status==='pass') && errors.length===0)proof.result='pass';
} catch(error) {errors.push(error.message);record('중앙 채팅·오른쪽 준비 현황 브라우저 검사 완료',false,error.message);}
finally {
  try {await browser?.close();} catch(error) {errors.push(error.message);proof.result='fail';}
  await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
  await writeFile(resolve(root,'orchestration/runs/preparation-board-browser.json'),JSON.stringify(proof,null,2)+'\n');
  console.log('중앙 채팅·오른쪽 준비 현황 브라우저 검증: '+checks.filter(check=>check.status==='pass').length+'/'+checks.length+' · 실제 LLM/전화/개인기록 조회 없음');
  if(proof.result!=='pass')process.exitCode=1;
}

