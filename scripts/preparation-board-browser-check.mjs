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
const directory='.impeccable/review/reading/board',checks=[],errors=[];
const ids=['records','hospitals','support','plan'];
const summaryIds=ids.slice(0,3);
const viewports=[[1440,900],[1280,800],[390,844],[360,780],[390,500],[768,512]];
const caps={llm:true,model:'gpt-6.1-sol',phone:'simulation',healthRecords:'demo',voiceInput:'browser',progress:'poll'};
const fixtureSession='b'.repeat(43);
const proof={
  result:'fail',checkedAt:new Date().toISOString(),url:base.href,sourceHash:await runtimeFingerprint(servedRoot),
  apiLive:false,modelInvoked:false,phoneInvoked:false,healthRecordsQueried:false,apiProgress:{unregistered:null,invalid:null},
  invokingSourceHash:await runtimeFingerprint(root),sourceHashScope:process.env.QA_SERVED_SOURCE_ROOT?'explicit QA_SERVED_SOURCE_ROOT; served UI assets compared below':'invoking checkout; served UI assets compared below',
  checks,errors,screenshots:[],viewports:[],runtimeAssets:[],progressScenarios:[],
  scope:{localhostKeylessOnly:true,modelInvoked:false,phoneInvoked:false,healthRecordsQueried:false,unmockedNormalPostAttempts:0,blockedPostAttempts:0,actualProgressReads:0,actualPreviewRequests:0,fixtureMainRequests:0,fixtureProgressReads:0,microphone:'not exercised; conversation browser fixtures cover transcript review',progress:'fixed safe DTO/browser fetch fixtures; actual keyless endpoint read only'},
};
const hash=value=>createHash('sha256').update(value).digest('hex');
const record=(name,ok,detail='')=>{checks.push({name,status:ok?'pass':'fail',detail});console.log((ok?'PASS':'FAIL')+' '+name+(detail?' · '+detail:''));};
const normalize=value=>String(value??'').replace(/\s+/g,' ').trim();
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
let browser,previewEvidence;
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
  if(id==='plan')await page.locator('[data-stage-id="plan"] #conversation-scroll').waitFor({state:'visible'});
  else await page.locator('#stage-navigation [data-open-stage="'+id+'"]').click();
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
  const button=page.locator('#stage-navigation [data-open-stage="'+id+'"]');
  return await page.locator('[data-stage-id="'+id+'"]').getAttribute('data-live')==='true' && await button.getAttribute('data-live')==='true' && await button.locator('[data-navigation-live]').isVisible() && /확인 중|진행/.test(await button.locator('[data-navigation-live]').innerText()) && await page.locator('#board-activity').isVisible();
}
async function readingPosition(page) {
  return page.evaluate(()=>{
    const anchors=[...document.querySelectorAll('.message,[data-stage-facts]>div,[data-stage-gaps] li,.stage-pane-header,#request-input')].map((node,index)=>({index,visible:node.checkVisibility(),rect:node.getBoundingClientRect()}));
    const reading=anchors.find(item=>item.visible && item.rect.top>=-2 && item.rect.bottom<=innerHeight+2)||anchors.find(item=>item.visible && item.rect.bottom>0 && item.rect.top<innerHeight);
    return {open:document.getElementById('preparation-details').open,focus:document.activeElement?.id||document.activeElement?.dataset.openStage||document.activeElement?.tagName,x:scrollX,y:scrollY,anchor:reading?{index:reading.index,top:reading.rect.top,left:reading.rect.left}:null};
  });
}
// 펼친 내용이 늘면 브라우저가 scrollY를 보정한다. 독자가 보던 문장의 화면 위치를 비교한다.
const samePosition=(before,after)=>before.open===after.open && before.focus===after.focus && Math.abs(before.x-after.x)<=1 && before.anchor && after.anchor && before.anchor.index===after.anchor.index && Math.abs(before.anchor.top-after.anchor.top)<=2 && Math.abs(before.anchor.left-after.anchor.left)<=1;
async function documentReading(page) {
  return page.locator('#preparation-board,#preparation-details,[data-stage-id],.stage-pane-body,[data-stage-facts],[data-stage-gaps],[data-stage-sources],[data-stage-events],#conversation-scroll,#message-list,.message-body,.tool-records,#visit-summary,#case-summary,#case-content').evaluateAll(nodes=>{
    const containers=nodes.filter(node=>node.checkVisibility()).map(node=>{
      const style=getComputedStyle(node);
      return {id:node.id||node.className,height:node.computedStyleMap().get('height').toString(),maxHeight:style.maxHeight,overflowY:style.overflowY,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,scrollTop:node.scrollTop};
    });
    return {containers,documentHeight:document.scrollingElement.scrollHeight,documentY:scrollY,flow:containers.length>0 && containers.every(item=>item.height==='auto' && item.maxHeight==='none' && item.overflowY==='visible' && item.scrollHeight<=item.clientHeight+2 && item.scrollTop===0)};
  });
}
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
      const button=document.querySelector('#stage-navigation [data-open-stage="'+stage.id+'"]');
      return section?.dataset.signal===stage.signal && status?.dataset.signal===stage.signal && labels[stage.signal]?.test(status.textContent) && shapeMatches(status,stage.signal) && (!button || button.dataset.signal===stage.signal && labels[stage.signal]?.test(button.querySelector('[data-navigation-status]')?.textContent) && shapeMatches(button,stage.signal));
    });
  },{state,responseCount,events});
}
async function contrast(page) {
  return page.locator('#stage-navigation [data-navigation-status],#stage-navigation .signal-mark,.stage-status,#composer-disclosure,.privacy-note,.message-body').evaluateAll(nodes=>{
    const rgba=value=>(value.match(/[\d.]+/g)||[]).map(Number);
    const luminance=color=>color.slice(0,3).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    return nodes.filter(node=>node.checkVisibility()).map(node=>{
      const foreground=rgba(getComputedStyle(node).color);let background=[255,255,255],layers=[];
      for(let parent=node;parent;parent=parent.parentElement) {
        const color=rgba(getComputedStyle(parent).backgroundColor);
        if(color.length<4)color.push(1);
        if(color[3]>0)layers.push(color);
        if(color[3]===1)break;
      }
      for(const color of layers.reverse())background=background.map((value,index)=>color[index]*color[3]+value*(1-color[3]));
      const a=luminance(foreground),b=luminance(background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      return {id:node.id||node.className.baseVal||node.className,signal:node.dataset.signal||null,color:getComputedStyle(node).color,ratio,minimum:node.matches('.signal-mark')?3:4.5};
    });
  });
}
async function confirmedFacts(page) {
  return page.locator('#preparation-board [data-stage-facts],#patient-records-dialog [data-patient-field],#patient-records-dialog [data-record-status],#patient-records-dialog [data-record-source],#patient-records-dialog [data-record-content]').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,status:node.dataset.status??null})));
}
async function flush(page) {await page.clock.runFor(40);}
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
async function open(width,height,{fixture=false,capabilities=fixture?caps:null}={}) {
  const context=await browser.newContext({viewport:{width,height},locale:'ko-KR',reducedMotion:'reduce',serviceWorkers:'block'});
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
    await page.locator('#preparation-board').waitFor();
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
    return {reachable:r.width>0 && r.height>0 && s.visibility!=='hidden' && r.top>=top-2 && r.bottom<=bottom+2 && r.left>=left-2 && r.right<=right+2 && !hiddenScroll && !selfClipped,hiddenScroll,selfClipped};
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
  for(const path of ['conversation.js','conversation.css','preparation-board-view.js','preparation-stages.js']) {
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
      const panes=page.locator('#preparation-board [data-stage-id]');
      const structure=await panes.evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.stageId,visible:node.checkVisibility(),x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));
      const visible=structure.filter(item=>item.visible && item.width>0 && item.height>0);
      const collapsed=await page.locator('#preparation-details').evaluate(node=>node instanceof HTMLDetailsElement && !node.open);
      const geometry=structure.map(item=>item.id).join(',')===ids.join(',') && visible.length===1 && visible[0].id==='plan' && collapsed && await page.locator('[data-stage-id="plan"]').evaluate(node=>!node.closest('#preparation-details')) && await page.locator('#preparation-details [data-stage-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.stageId).join(',')==='records,hospitals,support');
      record(width+'x'+height+' 접힌 준비 내역과 항상 읽는 답변 본문',geometry,JSON.stringify(structure));
      record(width+'x'+height+' 공통 입력1개·본문의 실제 대화·접힌 방문 상세',await page.locator('#conversation-form').count()===1 && await page.locator('#request-input').count()===1 && await page.locator('[data-stage-id="plan"] #conversation-scroll').count()===1 && await page.locator('#visit-summary').evaluate(node=>node instanceof HTMLDetailsElement && !node.open));
      const statuses=await allStatus(page);
      record(width+'x'+height+' 초기 자료 미확인과 병원·이동·답변 대기',statuses[0]==='needs_input' && statuses.slice(1).every(status=>status==='waiting') && await page.locator('[data-stage-summary]').count()===4 && await page.locator('[data-stage-events]').count()===4 && actualPosts.length===0);
      const initialSignalSummary=await page.locator('#stage-navigation [data-open-stage]').evaluateAll(nodes=>nodes.map(node=>node.dataset.openStage).join(',')==='records,hospitals,support') && await checkSignals(page,createDemoCase());
      record(width+'x'+height+' 세 요약의 기호·뜻은 실제 준비 상태와 일치',initialSignalSummary);
      record(width+'x'+height+' 가로 넘침·읽기 글자·중요 고지',await noOverflow(page) && await page.locator('#request-input').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=(innerWidth>1050?15:16)) && await page.locator('#composer-disclosure').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=14) && /실제.*(?:연락|발신).*예약/.test(await page.locator('#composer-disclosure').innerText()));
      const controls=page.locator('#stage-navigation [data-open-stage],#preparation-details>summary,#visit-summary>summary,#expand-answer,#voice-request,#preview-button,#send-request');
      record(width+'x'+height+' 주요 조작44px·감소 모션',await controls.evaluateAll(nodes=>nodes.filter(node=>node.checkVisibility()).every(node=>{const r=node.getBoundingClientRect();return r.width>=44 && r.height>=44;})) && await panes.evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).transitionDuration.split(',').every(value=>parseFloat(value)===0))));
      const path=await shot(page,width+'x'+height+'-initial');
      const closedHeight=await page.evaluate(()=>document.scrollingElement.scrollHeight);
      const draft='내역을 펼쳐도 보존할 요청';await page.locator('#request-input').fill(draft);
      let keyboard=true;
      for(const id of summaryIds) {
        const button=page.locator('#stage-navigation [data-open-stage="'+id+'"]');
        await button.focus();await page.keyboard.press('Enter');
        keyboard &&=await page.locator('[data-stage-id="'+id+'"]').isVisible() && await page.locator('[data-stage-id="plan"]').isVisible() && await page.locator('#preparation-details').evaluate(node=>node.open) && await button.evaluate(node=>{const target=document.getElementById(node.getAttribute('aria-controls'));return target?.dataset.stageId===node.dataset.openStage && (document.activeElement===node || document.activeElement===target) && node.getAttribute('aria-expanded')==='true';});
      }
      record(width+'x'+height+' 키보드 요약은 내역을 펼치고 focus·초안 유지·POST0',keyboard && await page.locator('#request-input').inputValue()===draft && actualPosts.length===0);
      for(const id of ['visit-summary','case-summary']) {
        const details=page.locator('#'+id);
        if(!await details.evaluate(node=>node.open))await details.locator(':scope>summary').click();
      }
      const reading=await documentReading(page),documentFlow=reading.flow && reading.documentHeight>closedHeight+20 && await panes.evaluateAll(nodes=>nodes.every(node=>node.checkVisibility()));
      record(width+'x'+height+' 펼친 자료·병원·이동·답변·방문 상세는 문서 높이로 읽음',documentFlow,JSON.stringify(reading));
      const colors=await contrast(page);
      record(width+'x'+height+' 기호3:1·설명/본문/중요 고지4.5:1 대비',colors.length>0 && colors.every(item=>item.ratio>=item.minimum),JSON.stringify(colors));
      await shot(page,width+'x'+height+'-expanded');
      await page.locator('#preparation-details>summary').click();
      record(width+'x'+height+' 내역을 다시 접어도 답변·요청은 남음',!await page.locator('#preparation-details').evaluate(node=>node.open) && await page.locator('[data-stage-id="plan"]').isVisible() && await page.locator('#request-input').inputValue()===draft);
      proof.viewports.push({width,height,geometry,documentFlow,initialSignalSummary,noOverflow:await noOverflow(page),screenshot:path});
    } finally {await context.close();}
  });

  await scenario('진행 변화·무자료·순서 역전',async()=>{
    const {page,context,actualPosts}=await open(1440,900,{fixture:true});
    try {
      const before=await allStatus(page),factsBefore=await confirmedFacts(page),call=await begin(page,'병원 문의와 자료·이동 준비를 확인해 주세요.');
      const body=JSON.parse(call.body),first=await advancePoll(page,0);
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
      record('실제 형식 진행의 병원 도구 시작은 접힌 내역 밖 요약에 표시',/병원|문의/.test(hospitalActivity) && /확인 중|진행/.test(hospitalActivity) && await liveSummary(page,'hospitals'));
      const updatedClosedPosition=await readingPosition(page);
      record('진행 갱신은 접힌 내역·focus·문서 읽기 위치를 바꾸지 않음',samePosition(closedPosition,updatedClosedPosition),JSON.stringify({before:closedPosition,after:updatedClosedPosition}));
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
      record('모바일 진행은 펼침·focus·문서 읽기 위치를 보존하며 다른 내역을 숨기지 않음',samePosition(openPosition,updatedOpenPosition) && await page.locator('#preparation-details').evaluate(node=>node.open) && await page.locator('[data-stage-id="records"]').isVisible() && await page.locator('[data-stage-id="support"]').isVisible() && await page.locator('[data-stage-id="plan"]').isVisible(),JSON.stringify({before:openPosition,after:updatedOpenPosition}));
      const supportActivity=normalize(await page.locator('[data-stage-id="support"] [data-stage-events]').textContent());
      await release(page,firstPoll,progress('hospitals',100));
      await release(page,firstMain,response(firstMain,createDemoCase(),'이전 토큰의 늦은 답변은 보이면 안 됩니다.'));
      record('이전 토큰의 늦은 진행·main 성공은 새 요청을 덮지 않음',normalize(await page.locator('[data-stage-id="support"] [data-stage-events]').textContent())===supportActivity && await page.locator('#conversation-form').getAttribute('aria-busy')==='true' && !(await page.locator('#message-list').innerText()).includes('이전 토큰의 늦은 답변'));
      await finish(page,secondMain,createDemoCase(),'새 문의의 합성 최종 답변입니다.');
      record('최종 답변도 사용자가 펼친 자료 내역과 본문을 함께 유지',await page.locator('#preparation-details').evaluate(node=>node.open) && await page.locator('[data-stage-id="records"]').isVisible() && await page.locator('[data-stage-id="plan"]').isVisible());
      await readStage(page,'plan');
      record('상시 답변 본문에서 새 답변과 취소 이력을 함께 읽음',(await page.locator('[data-stage-id="plan"] #message-list').innerText()).includes('새 문의의 합성 최종 답변') && /중지/.test(await page.locator('[data-stage-id="plan"] .request-error').first().innerText()) && await page.locator('.message.user').count()===2);
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

  for(const [width,height] of viewports)await scenario(width+'x'+height+' 긴 답변·표·확대',async()=>{
    const {page,context,actualPosts}=await open(width,height,{fixture:true});
    try {
      const reply='# 긴 기관별 준비 답변\n\n'+Array.from({length:24},(_,i)=>'확인 '+(i+1)+'. 제주 지역의 긴 이름을 가진 문의 기관과 기존 도외 전문 진료 기관의 자료 전달 절차를 확인합니다. 실제 진료 수락과 예약은 미확정입니다.').join('\n\n')+
        '\n\n| 기관 | 문의 내용 | 필요한 자료 | 시점 | 담당 | 예약 |\n| --- | --- | --- | --- | --- | --- |\n| 제주 지역의 긴 기관 이름 | 협진 접수·의뢰 회송 준비 질문 | 판독문·진찰 소견·의뢰서 | 방문 시각 확인 전 | 기관 담당자 | 미확정 |\n\n마지막 확인: 실제 발신·예약·배차는 하지 않았습니다.';
      const call=await begin(page,'표를 포함한 긴 합성 답변을 읽겠습니다.');
      await finish(page,call,createDemoCase(),reply);
      await readStage(page,'plan');
      const answer=page.locator('[data-stage-id="plan"] .message.assistant:not(.greeting) .message-body').last();
      record(width+'x'+height+' 새 답변의 시작은 별도 창 선택 없이 페이지에 표시',await answer.locator('h3').first().evaluate(node=>{const rect=node.getBoundingClientRect();return rect.top>=0 && rect.bottom<=innerHeight;}));
      const start=await accessible(answer.locator('h3').first()),startY=await page.evaluate(()=>scrollY);
      const end=await accessible(answer.locator('p').last()),endY=await page.evaluate(()=>scrollY),reading=await documentReading(page);
      record(width+'x'+height+' 긴 답변 첫 문장부터 끝까지 문서 스크롤로 읽음',start.reachable && end.reachable && endY>startY+100 && reading.flow,JSON.stringify({start,end,startY,endY,reading}));
      const tableScroll=answer.locator('.message-table-scroll');
      await tableScroll.focus();await tableScroll.press('ArrowRight');await page.clock.runFor(200);
      record(width+'px 표는 키보드로 가로 스크롤 가능',await tableScroll.evaluate(node=>node.scrollWidth<=node.clientWidth+1 || node.scrollLeft>0));
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
      const composer=await accessible(input),send=await accessible(page.locator('#send-request')),disclosure=await accessible(page.locator('#composer-disclosure'));
      record(width+'x'+height+' 긴 입력·보내기·고지 재접근',composer.reachable && send.reachable && disclosure.reachable && await input.evaluate(node=>node.value.split('\n').length===12 && node.scrollTop+node.clientHeight>=node.scrollHeight-3));
      await shot(page,width+'x'+height+'-answer-table');
      const originalTextSize=await answer.evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
      await page.evaluate(()=>{
        const nodes=[document.body,...document.body.querySelectorAll('*')].filter(node=>node instanceof HTMLElement && !['SCRIPT','STYLE'].includes(node.tagName));
        const sizes=nodes.map(node=>parseFloat(getComputedStyle(node).fontSize));
        nodes.forEach((node,index)=>{if(sizes[index]>0)node.style.fontSize=sizes[index]*2+'px';});
      });
      await input.press('Control+End');
      const enlargedStart=await accessible(answer.locator('h3').first()),enlargedEnd=await accessible(answer.locator('p').last()),enlargedComposer=await accessible(input),enlargedSend=await accessible(page.locator('#send-request')),enlargedDisclosure=await accessible(page.locator('#composer-disclosure')),enlargedReading=await documentReading(page);
      record(width+'x'+height+' 실제 글자200%에서도 답변·입력·고지는 문서로 접근',await answer.evaluate((node,size)=>parseFloat(getComputedStyle(node).fontSize)>=size*1.95,originalTextSize) && [enlargedStart,enlargedEnd,enlargedComposer,enlargedSend,enlargedDisclosure].every(item=>item.reachable) && enlargedReading.flow && await noOverflow(page),JSON.stringify({enlargedStart,enlargedEnd,enlargedComposer,enlargedSend,enlargedDisclosure,reading:enlargedReading}));
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
      const second=await begin(page,'출처를 읽는 동안 다음 준비를 확인합니다.',1);
      await readStage(page,'records');
      for(const id of summaryIds) {
        const log=page.locator('[data-stage-id="'+id+'"] [data-stage-log]');
        if(!await log.evaluate(node=>node.open))await log.locator(':scope>summary').click();
      }
      const link=await page.locator('#preparation-details [data-stage-id="hospitals"] [data-stage-events] [data-tool-status="completed"] a[href^="https://"]').first().elementHandle();
      if(!link)throw new Error('실제 preview의 확정 처리 기록에 공개 출처 링크가 없습니다.');
      await link.scrollIntoViewIfNeeded();await link.focus();
      await page.evaluate(()=>{
        window.__qaSourceScrollCalls=[];
        for(const [target,names] of [[Element.prototype,['scrollIntoView','scrollIntoViewIfNeeded','scrollTo','scrollBy']],[window,['scrollTo','scrollBy']]])for(const name of names) {
          const original=target[name];
          if(typeof original==='function')target[name]=function(...args){window.__qaSourceScrollCalls.push(name);return original.apply(this,args);};
        }
      });
      const snapshot=()=>link.evaluate(node=>{const rect=node.getBoundingClientRect();return {connected:node.isConnected,active:document.activeElement===node,stage:node.closest('[data-stage-id]')?.dataset.stageId,top:rect.top,left:rect.left,documentY:scrollY,scrollCalls:window.__qaSourceScrollCalls.length};});
      const before=await snapshot();
      record(width+'px 실제 preview 근거를 normal 응답 fixture로 표시·병원 출처 focus',before.connected && before.active && before.stage==='hospitals' && actualPosts.length===0,'preview→일반 요청 초기화 경계는 기존 검사로 별도 보존');
      let focusPreserved=before.connected && before.active;
      for(const [index,sequence] of [4,8].entries()) {
        const stage=['records','hospitals'][index],poll=await advancePoll(page,index);await release(page,poll,progress(stage,sequence));
        const after=await snapshot();
        const preserved=after.connected && after.active && after.stage===before.stage && after.scrollCalls===0 && Math.abs(after.top-before.top)<=2 && Math.abs(after.left-before.left)<=1;
        focusPreserved &&=preserved;
        record(width+'px '+stage+' 진행'+sequence+'는 같은 병원 출처 노드·focus·화면 위치를 보존',preserved,JSON.stringify({before,after}));
      }
      await shot(page,width+'-static-source-live');
      await finish(page,second,previewEvidence.caseState,'출처를 읽은 뒤 받은 합성 최종 답변입니다.');
      record(width+'px 출처 focus 회귀는 일반 실제 POST 없이 기존 답변 경로 유지',actualPosts.length===0 && (await calls(page,'/api/agent')).length===2 && (await page.locator('#message-list').innerText()).includes('출처를 읽은 뒤'));
      proof.progressScenarios.push({id:'static-source-focus-'+width,mainRequests:2,progressReads:2,sourceIdentityAndFocus:focusPreserved,rawTokensStored:false});
    } finally {await context.close();}
  });

  for(const id of ['aewol-parent-visit','time_changed','call_ai_declined'])await scenario(id+' 실제 keyless preview 창별 사실',async()=>{
    const {page,context,actualPosts}=await open(390,844);
    try {
      const {result,data}=await preview(page,id);
      record(id+'는 실제 고정 preview·LLM/실발신 없음',result.status()===200 && data.isPreview===true && data.capabilities.llm===false && data.events.length>0 && actualPosts.length===1 && actualPosts[0].path==='/api/agent/preview');
      const records=await stageText(page,'records'),hospitals=await stageText(page,'hospitals'),support=await stageText(page,'support'),plan=await stageText(page,'plan');
      record(id+' 자료·병원·이동·답변이 같은 실제 caseState를 읽음',/자료|판독|진찰/.test(records) && /병원|접수/.test(hospitals) && /이동|동행/.test(support) && normalize(plan).includes(normalize(data.reply)) && await page.locator('[data-stage-id="plan"] #conversation-scroll').count()===1);
      record(id+' 기호·설명은 actual caseState의 준비 projection과 일치',await checkSignals(page,data.caseState,{responseCount:1,events:data.events}));
      const colors=await contrast(page);
      record(id+' 준비 기호·설명·본문·고지 대비 유지',colors.length>0 && colors.every(item=>item.ratio>=item.minimum),JSON.stringify(colors));
      if(id==='aewol-parent-visit')record('○·△·×는 세 가지 다른 상태색과 뜻을 함께 제공',new Set(['available','attention','blocked'].map(signal=>colors.find(item=>item.signal===signal)?.color)).size===3 && ['available','attention','blocked'].every(signal=>colors.some(item=>item.signal===signal)) && /실제 진료.*예약.*배차.*확정.*아닙니다/.test(await page.locator('.preparation-note').innerText()));
      if(id==='aewol-parent-visit')record('기본 preview의 병원·공개 택시·동행 실패는 올바른 창에 표시',hospitals.includes(data.caseState.patient.localHospital) && support.includes('애월콜') && /연락|인계|확인/.test(support) && await statusOf(page,'support')==='needs_input' && /진료 수락.*미확인/.test(hospitals));
      if(id==='time_changed')record('진료 시각 변경은 휠체어 이동·동행 재확인',await statusOf(page,'support')==='needs_recheck' && ['휠체어','10:00','14:00'].every(term=>(records+' '+support).includes(term)) && /재확인/.test(support) && ['taxi','companion'].every(kind=>data.caseState.visitSupport[kind].status==='needs_recheck'));
      if(id==='call_ai_declined')record('AI 응대 거절은 이동 창의 보호자 인계·자동 반복 중단',await statusOf(page,'support')==='needs_input' && ['AI','거절','보호자'].every(term=>support.includes(term)) && /중단|이어/.test(support) && /발신|예약|배차/.test(plan));
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
} catch(error) {errors.push(error.message);record('단일 페이지 읽기 브라우저 검사 완료',false,error.message);}
finally {
  try {await browser?.close();} catch(error) {errors.push(error.message);proof.result='fail';}
  await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
  await writeFile(resolve(root,'orchestration/runs/preparation-board-browser.json'),JSON.stringify(proof,null,2)+'\n');
  console.log('단일 페이지 읽기 브라우저 검증: '+checks.filter(check=>check.status==='pass').length+'/'+checks.length+' · 실제 LLM/전화/개인기록 조회 없음');
  if(proof.result!=='pass')process.exitCode=1;
}

