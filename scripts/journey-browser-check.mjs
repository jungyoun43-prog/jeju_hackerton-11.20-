import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFingerprint } from '../orchestration/checks.mjs';

// 실제 localhost keyless preview만 검사한다. 일반 요청·공급자 응답 fixture는 쓰지 않는다.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const servedRoot=process.env.QA_SERVED_SOURCE_ROOT?resolve(process.env.QA_SERVED_SOURCE_ROOT):root;
const require=createRequire(import.meta.url);
const directory='.impeccable/review/chat-rail/product-redesign/journey';
const scenarioIds=['missing_record','jeju_unavailable','time_changed'];
const recoveryScenarioIds=['call_no_answer','call_ai_declined','call_identity_required','call_documents_or_schedule'];
const allowedScenarioIds=[...scenarioIds,...recoveryScenarioIds];
const viewports=[{label:'desktop',width:1440,height:900},{label:'mobile',width:390,height:844}];
const checks=[],errors=[],allPosts=[];
const proof={
  result:'fail',checkedAt:new Date().toISOString(),url:'',sourceHash:'',checks,errors,
  apiLive:false,modelInvoked:false,phoneInvoked:false,healthRecordsQueried:false,scenarioIds,recoveryScenarioIds,
  desktop:{width:1440,height:900,noOverflow:false,screenshot:null},mobile:{width:390,height:844,noOverflow:false,screenshot:null},
  continuationScenarios:[],lazyDialogScenarios:[],scenarios:[],recoveryScenarios:[],recoveryCoverage:{desktop:false,mobile:false},screenshots:[],shortViewport:[],
  scope:{localhostKeylessOnly:true,fixtures:false,modelInvoked:false,phone:false,externalRecords:false,normalAgentPostAttempts:0,previewRequests:0,retryGate:'고정 preview 상태·표시만 확인하며 시간/횟수 초과 gate는 별도 단위 검사 범위'},
  runtimeAssets:[],sourceHashScope:process.env.QA_SERVED_SOURCE_ROOT?'explicit QA_SERVED_SOURCE_ROOT; served UI assets compared below':'invoking checkout; served UI assets compared below',
};
let base,browser;
const normalized=value=>String(value??'').replace(/\s+/g,' ').trim();
const includes=(text,value)=>!value || normalized(text).includes(normalized(value));
const record=(name,ok,detail='')=>{
  checks.push({name,status:ok?'pass':'fail',detail});
  console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' · '+detail:''}`);
};
const settle=page=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1 && scrollY===0);
const boundarySafe=summary=>['actualCallPlaced','reservationConfirmed','clinicalAcceptanceConfirmed','externalRecordsConnected'].every(key=>summary.boundary?.[key]===false);
const summaryText=summary=>[
  summary.pathway?.detail,...(summary.tasks??[]).map(task=>`${task.title} ${task.detail}`),
  ...(summary.findings??[]).map(finding=>`${finding.label} ${finding.detail}`),
  ...(summary.dataImpact??[]).map(item=>`${item.title} ${item.detail} ${(item.questions??[]).join(' ')}`),
  ...(summary.nextActions??[]).map(action=>`${action.title} ${action.detail}`),
].join(' ');

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
  try {await run();}
  catch(error) {errors.push(`${name}: ${error.message}`);record(name,false,error.message);}
}

async function screenshot(page,name) {
  await settle(page);
  const path=`${directory}/${name}.png`;
  await page.screenshot({path:resolve(root,path),fullPage:true});
  proof.screenshots.push(path);
  return path;
}

async function open(width,height,label) {
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',locale:'ko-KR',serviceWorkers:'block'});
  const posts=[];
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base.origin)return route.abort('blockedbyclient');
    if(!['GET','HEAD'].includes(request.method())) {
      let scenarioId;
      try {scenarioId=JSON.parse(request.postData()??'{}').scenarioId;} catch {}
      const post={path:url.pathname,method:request.method(),scenarioId};
      posts.push(post);allPosts.push(post);
      if(url.pathname==='/api/agent') {
        proof.scope.normalAgentPostAttempts++;
        return route.abort('blockedbyclient');
      }
      if(request.method()!=='POST' || url.pathname!=='/api/agent/preview' || !allowedScenarioIds.includes(scenarioId)) {
        errors.push(`${label}: 허용하지 않은 변경 요청 ${request.method()} ${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      proof.scope.previewRequests++;
    }
    return route.continue();
  });
  const page=await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(`${label}: ${error.message}`));
  try {
    await page.goto(base.href,{waitUntil:'networkidle'});
    await page.locator('#request-input').waitFor();
    await page.waitForFunction(()=>document.querySelector('#connection-state')?.textContent==='AI 모델 미연결');
    await page.evaluate(()=>document.fonts.ready);
    return {page,context,posts};
  } catch(error) {await context.close();throw error;}
}

async function openJourney(page) {
  if(await page.locator('#open-care-menu').isVisible())await page.locator('#open-care-menu').click();
  await page.locator('#nav-care-journey').click();
  const panel=page.locator('#care-journey-dialog');
  await panel.waitFor();await page.evaluate(()=>document.fonts.ready);
  return panel;
}

async function closeJourney(page,{escape=false}={}) {
  if(escape)await page.keyboard.press('Escape');
  else await page.locator('#close-care-journey').click();
  await page.locator('#care-journey-dialog').waitFor({state:'hidden'});
  const expected=await page.locator('#open-care-menu').isVisible()?'open-care-menu':'nav-care-journey';
  await page.waitForFunction(id=>document.activeElement?.id===id,expected);
}

async function openContact(page) {
  if(await page.locator('#open-care-menu').isVisible())await page.locator('#open-care-menu').click();
  await page.locator('#nav-contact-plan').click();
  const panel=page.locator('#contact-plan-dialog');await panel.waitFor();await page.evaluate(()=>document.fonts.ready);return panel;
}

async function closeContact(page,{escape=false}={}) {
  if(escape)await page.keyboard.press('Escape');else await page.locator('#close-contact-plan').click();
  await page.locator('#contact-plan-dialog').waitFor({state:'hidden'});
  const expected=await page.locator('#open-care-menu').isVisible()?'open-care-menu':'nav-contact-plan';
  await page.waitForFunction(id=>document.activeElement?.id===id,expected);
}

async function expandDetails(panel) {
  const details=panel.locator('details');
  for(let i=0;i<await details.count();i++) {
    const item=details.nth(i);
    if(!await item.evaluate(node=>node.open))await item.locator('summary').first().click();
  }
}

async function clickWithConfirm(page,locator,accept) {
  const dialogs=[];
  const handler=async dialog=>{
    dialogs.push({type:dialog.type(),message:dialog.message()});
    if(accept)await dialog.accept();else await dialog.dismiss();
  };
  page.on('dialog',handler);
  try {await reveal(locator);await locator.click();await settle(page);}
  finally {page.off('dialog',handler);}
  return dialogs;
}

async function verifyMainContinuation(page,state,posts,prefix) {
  const input=page.locator('#request-input'),before=posts.length,existing='결과를 읽으며 직접 작성한 다음 요청입니다.';
  await input.fill(existing);
  await reveal(page.locator('#return-to-request'));await page.locator('#return-to-request').click();
  const focusedVisible=()=>input.evaluate(node=>{const r=node.getBoundingClientRect();return document.activeElement===node && r.top>=0 && r.bottom<=innerHeight && r.width>0;});
  record(`${prefix} 결과의 입력 복귀는 기존 초안·focus·viewport를 보존하며 POST 없음`,await input.inputValue()===existing && await focusedVisible() && posts.length===before);
  const task=await page.evaluate(async state=>(await import('/preparation-workflow.js')).getPreparationWorkflow(state).currentTask,state),titles=await Promise.all(['#current-task-title','#care-journey-next'].map(selector=>page.locator(selector).textContent())),sameTitle=titles.every(title=>normalized(title)===normalized(task?.title||'현재 방문 준비와 남은 일을 확인해 주세요.'));
  record(`${prefix} 중앙과 대화 기록의 다음 작업은 같은 workflow.currentTask`,sameTitle);
  const samples=[];
  for(const selector of ['#current-task-draft','#next-request-draft']){
    const button=page.locator(selector);await input.fill(existing);
    if(!task?.requestDraft){const hidden=await button.isHidden();record(`${prefix} ${selector}는 실행 가능한 초안이 없으면 숨김`,hidden&&posts.length===before);samples.push({selector,hidden,noExtraPost:posts.length===before});continue;}
    const denied=await clickWithConfirm(page,button,false),cancelPreserved=denied.length===1&&denied[0].type==='confirm'&&await input.inputValue()===existing&&posts.length===before;
    record(`${prefix} ${selector} 초안 교체 취소는 기존 입력과 요청 수 유지`,cancelPreserved);
    const accepted=await clickWithConfirm(page,button,true),draftMatches=accepted.length===1&&accepted[0].type==='confirm'&&normalized(await input.inputValue())===normalized(task.requestDraft.trim().slice(0,1600))&&await focusedVisible()&&await input.isEditable()&&posts.length===before;
    record(`${prefix} ${selector}는 같은 현재 작업 초안만 채우고 바로 입력 가능`,draftMatches);
    samples.push({selector,cancelPreserved,draftMatches,noExtraPost:posts.length===before});
  }
  proof.continuationScenarios.push({prefix,sameTitle,buttons:samples});
}

async function readConversation(page) {
  await showView(page,'chat');
  const history=page.locator('#conversation-history');
  if(!await history.evaluate(node=>node.open))await history.locator(':scope>summary').click();
  await page.locator('.chat-workspace #conversation-scroll').waitFor({state:'visible'});
}

async function runPreview(page,button,id,posts,prefix) {
  const [preview]=await Promise.all([
    page.waitForResponse(response=>new URL(response.url()).pathname==='/api/agent/preview' && response.request().method()==='POST'),
    clickWithConfirm(page,button,true),
  ]);
  const data=await preview.json(),request=preview.request();
  await page.waitForFunction(()=>document.querySelector('#conversation-form')?.getAttribute('aria-busy')==='false');
  const body=JSON.parse(request.postData()??'{}');
  const hash=createHash('sha256').update(request.postDataBuffer()).digest('hex');
  const actual=preview.status()===200 && data.isPreview===true && data.capabilities?.llm===false && body.scenarioId===id && request.headers()['x-amz-content-sha256']===hash && posts.length===1 && posts[0].path==='/api/agent/preview';
  record(`${prefix} 실제 keyless preview API·정확한 scenarioId·요청 해시`,actual,`HTTP ${preview.status()} · 응답 fixture 없음`);
  if(!actual)throw new Error('실제 preview 응답 계약이 맞지 않습니다.');
  await readConversation(page);
  const answer=page.locator('.chat-workspace #conversation-scroll .message.assistant:not(.greeting)');
  record(`${prefix} 미리보기 원문 답변1개는 중앙 보조 기록에서 읽고 단계 본문과 분리`,await answer.count()===1 && await answer.isVisible() && includes(await answer.innerText(),data.reply) && await page.locator('#conversation-scroll').evaluate(node=>node.closest('.chat-workspace')!==null && !node.closest('#preparation-board') && /auto|scroll/.test(getComputedStyle(node).overflowY) && node.clientHeight>0) && await page.locator('#preparation-board .message,#preparation-board #message-list').count()===0 && !includes(await page.locator('[data-stage-id="plan"]').textContent(),data.reply));
  const workflow=await page.evaluate(async state=>(await import('/preparation-workflow.js')).getPreparationWorkflow(state),data.caseState);
  record(`${prefix} 실제 상태의 현재 업무·기관 대기·남은 일과 준비 미완료 보존`,workflow.visitReady===false && await page.locator('#preparation-board').getAttribute('data-current-stage')===workflow.currentStageId && await page.locator('#stage-navigation>button[data-open-stage]').evaluateAll((nodes,stages)=>nodes.length===4 && stages.every(stage=>nodes.some(node=>node.dataset.openStage===stage.id&&node.dataset.workflowStatus===stage.status)),workflow.stages));
  const summary=await page.evaluate(async state=>(await import('/care-journey.js')).getCareJourneySummary(state),data.caseState);
  return {preview,data,summary};
}

// overflow:hidden인 조상을 강제로 스크롤해야만 나타나는 버튼은 접근 가능으로 보지 않는다.
async function reachable(locator) {
  await reveal(locator);
  const before=await locator.evaluate(node=>{
    const ancestors=[];
    for(let parent=node.parentElement;parent;parent=parent.parentElement)ancestors.push({top:parent.scrollTop,left:parent.scrollLeft,locked:/^(hidden|clip)$/.test(getComputedStyle(parent).overflowY)});
    return ancestors;
  });
  try {await locator.scrollIntoViewIfNeeded({timeout:3000});}
  catch(error) {return {reachable:false,reason:error.message};}
  return locator.evaluate((node,before)=>{
    const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
    let top=0,bottom=innerHeight,left=0,right=innerWidth,hiddenScroll=false,index=0;
    for(let parent=node.parentElement;parent;parent=parent.parentElement,index++) {
      const s=getComputedStyle(parent),r=parent.getBoundingClientRect(),old=before[index];
      if(old?.locked && (Math.abs(parent.scrollTop-old.top)>1 || Math.abs(parent.scrollLeft-old.left)>1))hiddenScroll=true;
      if(/^(hidden|clip|auto|scroll)$/.test(s.overflowY)){top=Math.max(top,r.top+parent.clientTop);bottom=Math.min(bottom,r.top+parent.clientTop+parent.clientHeight);}
      if(/^(hidden|clip|auto|scroll)$/.test(s.overflowX)){left=Math.max(left,r.left+parent.clientLeft);right=Math.min(right,r.left+parent.clientLeft+parent.clientWidth);}
    }
    const selfClipped=/^(hidden|clip)$/.test(style.overflowY) && node.scrollHeight>node.clientHeight+2;
    return {reachable:style.display!=='none' && style.visibility!=='hidden' && rect.width>0 && rect.height>0 && (rect.top>=top-2 && rect.bottom<=bottom+2 || !node.matches('button,input,select,textarea,summary,a') && rect.height>bottom-top && rect.bottom>top && rect.top<bottom && bottom-top>=parseFloat(style.fontSize)*1.2) && rect.left>=left-2 && rect.right<=right+2 && !hiddenScroll && !selfClipped,hiddenScroll,selfClipped};
  },before);
}

async function verifyModal(page,panel,prefix) {
  const native=await panel.evaluate(node=>node instanceof HTMLDialogElement && node.open && node.matches(':modal') && node.contains(document.activeElement) && Boolean(document.getElementById(node.getAttribute('aria-labelledby'))?.textContent.trim()));
  await page.locator('#request-input').evaluate(node=>node.focus());
  const backgroundBlocked=await panel.evaluate(node=>node.contains(document.activeElement));
  const mobile=await page.locator('#open-care-menu').isVisible();
  const railReleased=!mobile || await page.locator('#care-rail').evaluate(node=>node.inert && node.getAttribute('role')!=='dialog');
  await page.locator('#close-care-journey').focus();
  await page.keyboard.press('Shift+Tab');
  const backwards=await panel.evaluate(node=>node.contains(document.activeElement) && document.activeElement.id!=='close-care-journey');
  await page.keyboard.press('Tab');
  const forwards=await page.locator('#close-care-journey').evaluate(node=>document.activeElement===node);
  await closeJourney(page,{escape:true});
  record(`${prefix} 이름·focus·배경 inert·양방향 Tab·Escape 복원`,native && backgroundBlocked && railReleased && backwards && forwards);
}

async function verifySummary(page,panel,summary,prefix) {
  await expandDetails(panel);
  const content=page.locator('#care-journey-content'),text=await content.innerText();
  const pathways=await panel.locator('[data-journey-pathway]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.journeyPathway,selected:node.dataset.selected,text:node.innerText})));
  const expectedIds=['local_transfer','shared_care','mainland_continues'];
  record(`${prefix} 세 경로는 추천·임상 확정 없이 미확인`,summary.isSimulation===true && summary.pathway?.status==='unconfirmed' && summary.pathway?.outcome==='unconfirmed' && expectedIds.every(id=>summary.pathways?.some(item=>item.id===id && item.selected===false)) && pathways.length===3 && pathways.every(row=>row.selected==='false' && summary.pathways.some(item=>item.id===row.id && includes(row.text,item.label) && includes(row.text,item.detail))) && /미확인/.test(text) && boundarySafe(summary));

  const rows=await panel.locator('[data-journey-task]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.journeyTask,status:node.dataset.status,text:node.innerText})));
  record(`${prefix} 후속 할 일·담당·상태·조건을 실제 DTO와 대조`,summary.tasks?.length>0 && rows.length===summary.tasks.length && summary.tasks.every(task=>rows.some(row=>row.id===task.id && row.status===task.status && includes(row.text,task.title) && includes(row.text,task.owner) && includes(row.text,task.detail))));

  const evidence=[...(summary.pathway?.evidence??[]),...(summary.tasks??[]).flatMap(task=>task.evidence??[])];
  const evidenceOK=evidence.length>0 && evidence.every(item=>item.isSimulation===true && ['unverified','demo_confirmed'].includes(item.confirmation) && Object.hasOwn(item,'authoredAt') && Object.hasOwn(item,'confirmedAt') && [item.authoredAt,item.confirmedAt].every(value=>value===null || typeof value==='string') && includes(text,item.label) && includes(text,item.excerpt) && [item.authoredAt,item.confirmedAt].filter(Boolean).every(value=>includes(text,value.slice(0,10))));
  record(`${prefix} 원문 발췌·작성일·확인일·합성/미확인 근거 보존`,evidenceOK && /합성|시연/.test(text) && /미확인|미상|제공되지|제공 안/.test(text),`근거 ${evidence.length}건 · 실제 의료기록 조회 아님`);

  const impact=summary.dataImpact??[],hrefs=await content.locator('a[href]').evaluateAll(nodes=>nodes.map(node=>node.href));
  const canonical=value=>{try {return new URL(value).href;} catch {return '';}};
  const publicData=['859','327','254'].every(id=>impact.some(item=>String(item.datasetId)===id));
  const official=['jejuhappycall.com','jjcsc.co.kr'].every(host=>impact.some(item=>{try {return new URL(item.sourceUrl).hostname.endsWith(host);} catch {return false;}}));
  const sources=impact.length>=5 && impact.every(item=>canonical(item.sourceUrl) && hrefs.includes(canonical(item.sourceUrl)) && Number.isInteger(item.candidateCount) && item.candidateCount>=0 && typeof item.detail==='string' && item.detail.trim() && includes(text,item.title) && includes(text,item.detail));
  const contextual=impact.filter(item=>['859','327','254'].includes(String(item.datasetId))).every(item=>/지역|기관|후보|휠체어|거절|조건|애월|등록/.test(item.detail));
  record(`${prefix} 허브3종·공식2건의 출처·후보수·조건별 사용 이유`,publicData && official && sources && contextual && /공개|등록|표본|snapshot/.test(text) && /예약|배차|현재.*(?:차량|인력|수용)/.test(text));

  const questions=summaryText(summary);
  const wheelchair=['휠체어','대여','수령','반납','승하차','동행','지연','귀가'].every(term=>questions.includes(term)) && /앉은\s*채.*탑승|탑승.*앉은\s*채/.test(questions) && /재조정|다시.*(?:동행|귀가)|(?:동행|귀가).*다시/.test(questions);
  record(`${prefix} 휠체어 대여·수령/반납·탑승·지연 재조정 질문`,wheelchair && ['대여','반납','지연'].every(term=>text.includes(term)));
}

function verifyScenario(summary,state,text,prefix,id) {
  const all=summaryText(summary);
  if(id==='missing_record') {
    const tasks=new Map(summary.tasks.map(task=>[task.id,task]));
    const issuance=tasks.get('report-issuance'),obtain=tasks.get('report-obtain'),submission=tasks.get('report-submission'),delivery=tasks.get('report-delivery');
    const issuanceFinding=summary.findings.find(item=>item.target==='mainland' && /판독문.*발급.*절차/.test(item.label));
    const submissionFinding=summary.findings.find(item=>item.target==='jeju' && /제출.*방식/.test(item.label));
    // 방법은 원본 확보 전에 물을 수 있다. 문의 완료를 실제 자료 발급·전달로 읽지 않는다.
    const inquiriesReady=issuance?.status==='ready' && submission?.status==='ready' && issuanceFinding?.isSimulation===true && submissionFinding?.isSimulation===true
      && Date.parse(issuanceFinding.at)<=Date.parse(submissionFinding.at) && /발급.*절차/.test(issuance.detail) && /파일 형식|제출 경로/.test(submission.detail);
    const originalPending=state.documents?.find(document=>document.id==='report')?.status==='missing' && obtain?.status==='todo'
      && /원본/.test(obtain.title) && /작성일/.test(obtain.title) && /절차.*(?:먼저|뒤)/.test(obtain.detail) && /실제 발급.*아니/.test(obtain.detail)
      && summary.nextActions.some(action=>action.id===obtain.id) && includes(text,obtain.detail);
    record(`${prefix} 발급·제출 방법의 합성 문의 완료와 원본·작성일 확보 할 일을 구분`,inquiriesReady && originalPending);
    const deliveryBlocked=delivery?.status==='blocked' && /원본/.test(delivery.detail) && /제출 방식/.test(delivery.detail) && /선행|먼저|필요/.test(delivery.detail)
      && /본인|대리/.test(delivery.detail) && /공유 범위/.test(delivery.detail) && /수신 확인/.test(delivery.detail)
      && summary.nextActions.some(action=>action.id===delivery.id) && includes(text,delivery.detail);
    const unsent=state.packet?.status==='draft' && state.packet.submittedAt===null && boundarySafe(summary) && /실제.*(?:전송|수신).*미실행/.test(submission?.detail??'');
    record(`${prefix} 원본·공유 권한 선행 조건으로 실제 전달은 차단·미전송`,deliveryBlocked && unsent,'절차 문의 ready · 원본 확보 todo · 실제 전달 blocked · packet draft/submittedAt null');
  } else if(id==='jeju_unavailable') {
    const rejection=summary.findings.some(item=>item.target==='jeju' && /거절|미참여|참여하지|접수.*불가/.test(`${item.label} ${item.detail}`));
    const followup=summary.nextActions.some(item=>/다른|다음|대안|후보/.test(`${item.title} ${item.detail}`) && /문의|접수|절차/.test(`${item.title} ${item.detail}`));
    record(`${prefix} 제주 접수 거절은 행정 상태·다음 후보 문의로 연결`,rejection && followup && summary.pathway.status==='unconfirmed' && summary.pathway.outcome==='unconfirmed' && /임상|의료진|진료 판단/.test(`${summary.pathway.detail} ${all}`) && /거절|미참여|접수.*불가/.test(text));
  } else {
    const schedule=summary.schedule,reasons=(schedule.recheckReasons??[]).join(' '),times=new Set(reasons.match(/\b\d{1,2}:\d{2}\b/g)??[]);
    const both=['taxi','companion'].every(kind=>state.visitSupport?.[kind]?.status==='needs_recheck') && ['recheck','needs_recheck'].includes(schedule.taxiStatus) && ['recheck','needs_recheck'].includes(schedule.companionStatus);
    const oldFindings=['taxi','companion'].every(target=>summary.findings.some(item=>item.target===target && item.isSimulation===true));
    const tasks=summary.tasks.filter(task=>task.status==='recheck').map(task=>`${task.title} ${task.detail}`).join(' ');
    record(`${prefix} 시각 변경은 이전 이동·동행 안내를 재확인으로 전환`,both && schedule.revision>0 && times.size>=2 && includes(reasons,schedule.time) && oldFindings && /이동|택시/.test(tasks) && /동행/.test(tasks) && includes(text,reasons),`재확인 이유 ${schedule.recheckReasons?.length??0}건 · 실제 예약 없음`);
  }
}

async function verifyDrafts(page,panel,summary,posts,prefix,{cancelScenario=false}={}) {
  const actions=new Map([...(summary.tasks??[]),...(summary.nextActions??[]),...(summary.handoffs??[])].filter(item=>item.requestDraft).map(item=>[item.id,item.requestDraft]));
  const ids=await panel.locator('[data-journey-draft]').evaluateAll(nodes=>nodes.map(node=>node.dataset.journeyDraft));
  record(`${prefix} 문의 준비 버튼은 DTO의 명시적 초안에 연결`,ids.length>0 && ids.every(id=>actions.has(id)));
  if(!ids.length || !actions.has(ids[0]))throw new Error('검사할 문의 초안 버튼이 없습니다.');
  await closeJourney(page);
  const input=page.locator('#request-input'),existing='보호자가 먼저 적어 둔 요청입니다. 이 내용은 취소하면 보존해 주세요.';
  await input.fill(existing);
  panel=await openJourney(page);await expandDetails(panel);
  const before=posts.length,button=panel.locator('[data-journey-draft]').first();
  const denied=await clickWithConfirm(page,button,false);
  record(`${prefix} 초안 교체 취소는 기존 입력과 dialog를 보존`,denied.length===1 && denied[0].type==='confirm' && await panel.isVisible() && await input.inputValue()===existing && posts.length===before);
  const accepted=await clickWithConfirm(page,button,true);
  await panel.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.id==='request-input');
  const draft=await input.inputValue();
  record(`${prefix} 문의 준비는 수정 가능한 초안만 채우고 POST 없음`,accepted.length===1 && accepted[0].type==='confirm' && normalized(draft)===normalized(actions.get(ids[0]).trim().slice(0,1600)) && await input.isEditable() && posts.length===before);
  if(cancelScenario) {
    panel=await openJourney(page);
    const deniedPreview=await clickWithConfirm(page,panel.locator('[data-journey-scenario]').first(),false);
    record(`${prefix} 상황 preview 교체 취소도 새 초안·현재 상태 보존`,deniedPreview.length===1 && deniedPreview[0].type==='confirm' && await panel.isVisible() && await input.inputValue()===draft && posts.length===before);
    await closeJourney(page);
  }
}

async function handoffRows(panel) {
  return panel.locator('[data-call-handoff]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.callHandoff,status:node.dataset.status,owner:node.dataset.owner,stopAutomatic:node.dataset.stopAutomatic,actualCallPlaced:node.dataset.actualCallPlaced,text:node.innerText,hrefs:[...node.querySelectorAll('a[href]')].map(link=>link.href),attempts:[...node.querySelectorAll('[data-call-attempt]')].map(attempt=>({number:Number(attempt.dataset.callAttempt),at:attempt.dataset.at,outcome:attempt.dataset.outcome,text:attempt.innerText}))})));
}

const attemptsMatch=(item,row)=>row?.attempts.length===item.attempts.length && item.attempts.every((attempt,index)=>{
  const shown=row.attempts[index];
  return shown.number===attempt.number && shown.at===attempt.at && shown.outcome===attempt.outcome && includes(shown.text,attempt.at) && /합성/.test(shown.text);
});

function verifyHandoffs(summary,rows,prefix) {
  const handoffs=summary.handoffs??[];
  const rendered=handoffs.length>0 && rows.length===handoffs.length && handoffs.every(item=>rows.some(row=>
    row.id===item.id && row.status===item.status && row.owner===item.owner && row.stopAutomatic===String(item.stopAutomatic) && row.actualCallPlaced==='false' && [item.title,item.detail,item.owner,item.contact?.name,...item.questions,...item.remainingTasks].every(value=>typeof value==='string' && value.trim() && includes(row.text,value))
    && (item.contact.phone===null ? /번호.*(?:미확인|확인 필요)|(?:미확인|확인 필요).*번호/.test(row.text) : includes(row.text,item.contact.phone))
    && (!item.contact.sourceUrl || row.hrefs.includes(new URL(item.contact.sourceUrl).href))));
  record(`${prefix} 실패 이유·담당·공개 문의처·질문·남은 일을 DTO와 대조`,rendered);
  const attempts=handoffs.every(item=>item.attempts?.length>0 && item.attempts.every((attempt,index)=>attempt.number===index+1 && Number.isFinite(Date.parse(attempt.at)) && attempt.isSimulation===true && typeof attempt.outcome==='string' && attempt.outcome)
    && attemptsMatch(item,rows.find(row=>row.id===item.id)));
  const policies=handoffs.every(item=>{
    const policy=item.retryPolicy,row=rows.find(row=>row.id===item.id);
    if(!policy || policy.scheduled!==false || typeof policy.configured!=='boolean' || !row)return false;
    if(!policy.configured)return /미설정|설정되지/.test(row.text);
    return Number.isInteger(policy.maxAttempts) && policy.maxAttempts>=1 && policy.maxAttempts<=3 && Number.isInteger(policy.windowMinutes) && policy.windowMinutes>=1 && policy.windowMinutes<=120
      && Date.parse(policy.expiresAt)===Date.parse(policy.startsAt)+policy.windowMinutes*60000
      && [String(policy.maxAttempts),String(policy.windowMinutes),policy.startsAt.slice(0,10),policy.expiresAt.slice(0,10)].every(value=>includes(row.text,value));
  });
  record(`${prefix} 합성 시도 번호·시점·횟수/시간 정책·미예약 표시`,attempts && policies && rows.every(row=>/합성|시연/.test(row.text) && /예약.*(?:없|않|미|하지)|(?:미|않|없|하지).*예약/.test(row.text)));
  record(`${prefix} 인계 중 실제 발신·예약·임상 수락·외부 기록 연결 false`,boundarySafe(summary) && summary.pathway.status==='unconfirmed' && handoffs.length>0 && handoffs.every(item=>item.actualCallPlaced===false));
}

function verifyRecoveryScenario(summary,rows,prefix,id) {
  const handoffs=summary.handoffs??[],text=rows.map(row=>row.text).join(' ');
  if(id==='call_no_answer') {
    const item=handoffs.find(item=>item.reason==='no_answer'),policy=item?.retryPolicy;
    const exhausted=item && policy.configured===true && item.attempts.length===policy.maxAttempts && item.attempts.every(attempt=>Date.parse(attempt.at)>=Date.parse(policy.startsAt) && Date.parse(attempt.at)<Date.parse(policy.expiresAt));
    record(`${prefix} 무응답은 명시한 횟수·시간 한도에서 멈추고 인계`,exhausted && item.status==='retry_exhausted' && item.stopAutomatic===true && policy.scheduled===false && /기본.*미설정|미설정.*자동/.test(text) && /중단|한도/.test(text));
  } else if(id==='call_ai_declined') {
    const item=handoffs.find(item=>item.reason==='ai_declined');
    record(`${prefix} AI 응대 거절은 자동 반복 중단·보호자 번호/문의 인계`,item?.stopAutomatic===true && item.status==='handed_off' && /보호자/.test(item.owner) && /AI/.test(text) && /거절/.test(text) && /중단/.test(text) && /공개.*번호|번호.*확인/.test(text) && /직접|사람/.test(item.remainingTasks.join(' ')));
  } else if(id==='call_identity_required') {
    const item=handoffs.find(item=>item.reason==='identity_required');
    record(`${prefix} 본인확인은 환자 직접 단계·Agent 자동 진행 중단`,item?.stopAutomatic===true && item.status==='handed_off' && /환자.*본인/.test(item.owner) && /환자.*직접|직접.*본인확인/.test([item.detail,...item.remainingTasks,...item.questions].join(' ')) && /인증정보.*(?:받|수집).*않|인증정보.*받거나.*않/.test(text));
  } else {
    const documents=handoffs.find(item=>item.reason==='missing_documents'),schedule=handoffs.find(item=>item.reason==='no_slots');
    const tasks=summary.tasks??[];
    record(`${prefix} 서류 부족은 보유 자료·발급·제출 할 일에 연결`,Boolean(documents) && /보유|목록/.test(documents.detail) && ['발급','작성일','제출'].every(term=>documents.remainingTasks.join(' ').includes(term)) && tasks.some(task=>/판독문|자료/.test(task.title)));
    record(`${prefix} 예약 불가는 허용한 다른 날짜 문의·선택 확인으로 연결`,Boolean(schedule) && /허용/.test(schedule.questions.join(' ')) && /다른 날짜/.test(schedule.questions.join(' ')) && /선택/.test(schedule.remainingTasks.join(' ')) && /임의.*(?:선택|예약)|예약.*확정하지/.test(schedule.detail) && schedule.actualCallPlaced===false);
  }
}

async function verifyRecoveryDraft(page,panel,summary,posts,prefix) {
  const handoffs=summary.handoffs??[],actions=new Map(handoffs.map(item=>[item.id,item.requestDraft]));
  const ids=await panel.locator('[data-call-handoff-draft]').evaluateAll(nodes=>nodes.map(node=>node.dataset.callHandoffDraft));
  record(`${prefix} 인계 초안 버튼은 해당 실패 항목에 연결`,ids.length===handoffs.length && ids.length>0 && ids.every(id=>actions.has(id)));
  if(!ids.length || !actions.has(ids[0]))throw new Error('검사할 인계 초안 버튼이 없습니다.');
  await closeContact(page);
  const input=page.locator('#request-input'),existing='실패 후에도 보호자가 작성하던 요청을 그대로 보존해 주세요.';
  await input.fill(existing);panel=await openContact(page);
  await expandDetails(panel);
  const button=panel.locator('[data-call-handoff-draft]').first(),before=posts.length;
  const denied=await clickWithConfirm(page,button,false);
  record(`${prefix} 인계 초안 교체 취소는 기존 입력·인계 상태 보존`,denied.length===1 && denied[0].type==='confirm' && await panel.isVisible() && await input.inputValue()===existing && posts.length===before);
  const accepted=await clickWithConfirm(page,button,true);
  await panel.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.id==='request-input');
  record(`${prefix} 인계 문의도 초안만 채우고 실제 POST 없음`,accepted.length===1 && accepted[0].type==='confirm' && normalized(await input.inputValue())===normalized(actions.get(ids[0]).trim().slice(0,1600)) && await input.isEditable() && posts.length===before);
  const journey=await openJourney(page);await expandDetails(journey);
  const rows=await handoffRows(journey);
  record(`${prefix} 초안·전화창·여정창 전환 후 실패 이유·시도·담당 보존`,rows.length===handoffs.length && handoffs.every(item=>rows.some(row=>row.id===item.id && row.status===item.status && row.owner===item.owner && includes(row.text,item.detail) && attemptsMatch(item,row))) && posts.length===before);
  await closeJourney(page,{escape:true});
}

async function verifyRecoveryShort(page,width,prefix) {
  await page.setViewportSize({width,height:500});await settle(page);
  const panel=await openContact(page);await expandDetails(panel);
  const dimensions=await panel.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=-1 && r.top>=-1 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1 && node.scrollWidth<=node.clientWidth+1;});
  const handoff=await reachable(panel.locator('[data-call-handoff-draft]').last()),close=await reachable(page.locator('#close-contact-plan'));
  const overflow=await noOverflow(page),path=await screenshot(page,`${width}-recovery-short`);
  proof.shortViewport.push({kind:'call-recovery',width,height:500,dimensions,handoff,close,noOverflow:overflow,screenshot:path,...await workspaceEvidence(page)});
  record(`${prefix} 500px 높이에서도 마지막 인계 문의·닫기 접근`,dimensions && handoff.reachable && close.reachable && overflow);
  await closeContact(page,{escape:true});
}

async function verifyShortViewport(page,width,prefix) {
  await page.setViewportSize({width,height:500});await settle(page);
  const panel=await openJourney(page);await expandDetails(panel);
  const dimensions=await panel.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=-1 && r.top>=-1 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1 && node.scrollWidth<=node.clientWidth+1;});
  const last=await reachable(panel.locator('[data-journey-draft]').last());
  const close=await reachable(page.locator('#close-care-journey'));
  const overflow=await noOverflow(page);
  await page.locator('#care-journey-content').evaluate(node=>node.scrollTop=0);
  const path=await screenshot(page,`${width}-short-dialog`);
  await closeJourney(page,{escape:true});
  const composer=await reachable(page.locator('#request-input'));
  const disclosure=await reachable(page.locator('#composer-disclosure')),fullDisclosure=await reachable(page.locator('#composer-boundary'));
  const result={width,height:500,dimensions,last,close,composer,disclosure,fullDisclosure,noOverflow:overflow,screenshot:path,...await workspaceEvidence(page)};
  proof.shortViewport.push(result);
  record(`${prefix} 500px 높이에서 마지막 문의·닫기·복귀 입력 접근`,dimensions && last.reachable && close.reachable && composer.reachable && disclosure.reachable && fullDisclosure.reachable && /가상.*실제.*연락.*예약.*없음/.test(await page.locator('#composer-boundary').innerText()) && await page.locator('#request-input').evaluate(node=>node.getAttribute('aria-describedby').split(/\s+/).includes('composer-boundary')) && overflow && await noOverflow(page));
}

try {
  await mkdir(resolve(root,directory),{recursive:true});
  await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
  proof.sourceHash=await runtimeFingerprint(servedRoot);
  proof.invokingSourceHash=await runtimeFingerprint(root);
  base=new URL(process.env.BASE_URL||'http://127.0.0.1:4173');
  if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname) || !['http:','https:'].includes(base.protocol) || base.username || base.password || base.pathname!=='/' || base.search || base.hash)throw new Error('BASE_URL은 키를 끈 localhost QA 서버의 루트 주소여야 합니다.');
  proof.url=base.href;
  const response=await fetch(new URL('/api/agent/capabilities',base),{redirect:'error',signal:AbortSignal.timeout(8000)});
  const caps=await response.json();
  const keyless=response.status===200 && caps.llm===false && ['simulation','not_connected'].includes(caps.phone) && ['demo','not_connected'].includes(caps.healthRecords);
  record('실제 localhost API의 모델 미연결·전화/개인기록 합성 경계',keyless && response.headers.get('cache-control')==='no-store');
  if(!keyless)throw new Error('keyless 상태를 확인하지 못해 preview 검사를 시작하지 않습니다.');
  proof.apiLive=true;
  for(const path of ['conversation.js','conversation.css','preparation-board-view.js','preparation-stages.js','preparation-workflow.js','visit-support.js','icons.js']) {
    const response=await fetch(new URL('/'+path,base),{redirect:'error',signal:AbortSignal.timeout(8000)});
    const expected=await readFile(resolve(servedRoot,'app',path));
    const hash=value=>createHash('sha256').update(value).digest('hex');
    proof.runtimeAssets.push({path,matching:response.status===200 && hash(await response.text())===hash(expected),sourceHash:hash(expected)});
  }
  record('실제 제공 UI 자산은 명시한 runtime source와 동일',proof.runtimeAssets.every(item=>item.matching));
  const moduleResponse=await fetch(new URL('/care-journey.js',base),{redirect:'error',signal:AbortSignal.timeout(8000)});
  const moduleReady=moduleResponse.status===200 && /(?:text|application)\/javascript/.test(moduleResponse.headers.get('content-type')??'');
  record('진료연결 공유 요약 모듈을 실제 서버에서 제공',moduleReady,`HTTP ${moduleResponse.status}`);
  if(!moduleReady)throw new Error('진료연결 backend/UI를 통합한 로컬 서버에서 다시 실행해야 합니다.');
  let chromium;
  try {({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}
  catch {throw new Error('선택 QA 도구 Playwright가 필요합니다. PLAYWRIGHT_MODULE로 기존 설치 경로를 지정할 수 있습니다.');}
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const viewport of viewports)for(const id of scenarioIds)await scenario(`${viewport.width}px ${id}`,async()=>{
    const prefix=`${viewport.width}px ${id}`,{page,context,posts}=await open(viewport.width,viewport.height,prefix);
    try {
      let panel=await openJourney(page);
      record(`${prefix} 상황 버튼3개·열기만으로 요청 없음`,(await panel.locator('[data-journey-scenario]').evaluateAll(nodes=>nodes.map(node=>node.dataset.journeyScenario))).sort().join(',')===[...scenarioIds].sort().join(',') && posts.length===0);
      const closedJourneyHtml=await page.locator('#care-journey-content').innerHTML();
      const {preview,data,summary}=await runPreview(page,panel.locator(`[data-journey-scenario="${id}"]`),id,posts,prefix);
      const closedUnchanged=!await panel.isVisible()&&await page.locator('#care-journey-content').innerHTML()===closedJourneyHtml;
      record(`${prefix} 닫힌 여정 상세는 응답 적용 중 다시 만들지 않음`,closedUnchanged);proof.lazyDialogScenarios.push({prefix,closedUnchanged});
      record(`${prefix} API 상태의 활성 상황·합성 안내가 화면에 반영`,summary.activeScenario?.id===id && data.caseState && /합성|시연/.test(data.reply) && /합성|예시|미리보기/.test(await page.locator('#conversation-status').innerText()));
      if(await panel.isVisible())await closeJourney(page);
      if(id===scenarioIds[0])await verifyMainContinuation(page,data.caseState,posts,prefix);
      panel=await openJourney(page);
      await verifySummary(page,panel,summary,prefix);
      verifyScenario(summary,data.caseState,await page.locator('#care-journey-content').innerText(),prefix,id);
      const overflow=await noOverflow(page),workspace=await workspaceEvidence(page);
      record(`${prefix} 가로 넘침 없이 공통 입력을 작업 영역 바닥에 고정`,overflow&&workspace.composerBottomAnchored,JSON.stringify({composerBottomAnchored:workspace.composerBottomAnchored,composer:workspace.composer}));
      Object.assign(proof[viewport.label],workspace);
      proof[viewport.label].noOverflow=id===scenarioIds[0]?overflow:proof[viewport.label].noOverflow && overflow;
      await page.locator('#care-journey-content').evaluate(node=>node.scrollTop=0);
      const path=await screenshot(page,`${viewport.label}-${id}`);
      if(id===scenarioIds[0])proof[viewport.label].screenshot=path;
      proof.scenarios.push({viewport:viewport.label,width:viewport.width,height:viewport.height,id,status:preview.status(),isPreview:data.isPreview,activeScenario:summary.activeScenario?.id,boundary:summary.boundary,pathway:summary.pathway.status,tasks:summary.tasks.map(task=>({id:task.id,status:task.status})),screenshot:path});
      if(id===scenarioIds[0]) {
        await verifyModal(page,panel,prefix);
        panel=await openJourney(page);await expandDetails(panel);
      }
      await verifyDrafts(page,panel,summary,posts,prefix,{cancelScenario:id===scenarioIds[0]});
      if(id===scenarioIds.at(-1))await verifyShortViewport(page,viewport.width,prefix);
      record(`${prefix} 전체 상호작용의 일반 모델 POST 시도0`,posts.every(post=>post.path==='/api/agent/preview') && posts.length===1);
    } finally {await context.close();}
  });
  record('실제 preview3개를 PC·모바일에서 모두 완료',proof.scenarios.length===6 && viewports.every(viewport=>scenarioIds.every(id=>proof.scenarios.some(item=>item.viewport===viewport.label && item.id===id))));
  for(const viewport of viewports)for(const id of recoveryScenarioIds)await scenario(`${viewport.width}px ${id}`,async()=>{
    const prefix=`${viewport.width}px ${id}`,checkStart=checks.length,errorStart=errors.length;
    const {page,context,posts}=await open(viewport.width,viewport.height,prefix);
    try {
      let panel=await openContact(page);
      const examples=panel.locator('#call-recovery-examples');
      const initiallyClosed=await examples.evaluate(node=>node instanceof HTMLDetailsElement && !node.open);
      if(initiallyClosed)await examples.locator('summary').first().click();
      record(`${prefix} 별도 접힌 복구 예시4개·열기만으로 요청 없음`,initiallyClosed && (await panel.locator('[data-call-recovery-scenario]').evaluateAll(nodes=>nodes.map(node=>node.dataset.callRecoveryScenario))).sort().join(',')===[...recoveryScenarioIds].sort().join(',') && posts.length===0);
      if(id===recoveryScenarioIds[0]) {
        const exported=await page.evaluate(async()=>{const module=await import('/care-journey.js');return {journey:module.JOURNEY_SCENARIOS.map(item=>item.id),recovery:module.CALL_RECOVERY_SCENARIOS.map(item=>item.id)};});
        record(`${prefix} 기존 여정3개와 추가 복구4개 export를 구분`,exported.journey.sort().join(',')===[...scenarioIds].sort().join(',') && exported.recovery.sort().join(',')===[...recoveryScenarioIds].sort().join(','));
      }
      const {preview,data,summary}=await runPreview(page,panel.locator(`[data-call-recovery-scenario="${id}"]`),id,posts,prefix);
      record(`${prefix} 인계는 실제 preview 상태의 합성 결과`,Array.isArray(summary.handoffs) && summary.handoffs.length>0 && /합성|시연/.test(data.reply) && /합성|예시|미리보기/.test(await page.locator('#conversation-status').innerText()));
      if(await panel.isVisible())await closeContact(page);
      if(id===recoveryScenarioIds[0])await verifyMainContinuation(page,data.caseState,posts,prefix);
      panel=await openContact(page);await expandDetails(panel);
      const rows=await handoffRows(panel);
      verifyHandoffs(summary,rows,prefix);
      verifyRecoveryScenario(summary,rows,prefix,id);
      const overflow=await noOverflow(page);
      record(`${prefix} 복구 인계 내용 가로 넘침 없음`,overflow);
      proof[viewport.label].noOverflow&&=overflow;
      await panel.locator('[data-call-handoff]').first().scrollIntoViewIfNeeded();
      const path=await screenshot(page,`${viewport.label}-${id}`);
      await verifyRecoveryDraft(page,panel,summary,posts,prefix);
      if(id===recoveryScenarioIds.at(-1))await verifyRecoveryShort(page,viewport.width,prefix);
      record(`${prefix} 자동 진행·초안 동작의 일반 모델 POST 시도0`,posts.length===1 && posts[0].path==='/api/agent/preview');
      proof.recoveryScenarios.push({viewport:viewport.label,width:viewport.width,height:viewport.height,id,status:preview.status(),isPreview:data.isPreview,boundary:summary.boundary,handoffs:summary.handoffs.map(item=>({id:item.id,reason:item.reason,status:item.status,attempts:item.attempts.length,owner:item.owner,stopAutomatic:item.stopAutomatic,actualCallPlaced:item.actualCallPlaced})),result:checks.slice(checkStart).every(check=>check.status==='pass') && errors.length===errorStart?'pass':'fail',screenshot:path});
    } finally {await context.close();}
  });
  for(const viewport of viewports)proof.recoveryCoverage[viewport.label]=recoveryScenarioIds.every(id=>proof.recoveryScenarios.some(item=>item.viewport===viewport.label && item.id===id && item.result==='pass'));
  record('추가 복구 preview4개를 PC·모바일에서 모두 완료',proof.recoveryScenarios.length===8 && Object.values(proof.recoveryCoverage).every(Boolean));
  const expectedRequests=viewports.length*allowedScenarioIds.length;
  record(`전체 일반 POST /api/agent 시도0·preview${expectedRequests}건만 허용`,proof.scope.normalAgentPostAttempts===0 && allPosts.length===expectedRequests && allPosts.every(post=>post.method==='POST' && post.path==='/api/agent/preview'));
  proof.finalSourceHash=await runtimeFingerprint(servedRoot);
  record('검사 중 runtime source 변경 없음',proof.finalSourceHash===proof.sourceHash);
  record('브라우저 실행 오류 없음',errors.length===0,errors.join('; '));
  if(checks.every(check=>check.status==='pass') && errors.length===0)proof.result='pass';
} catch(error) {
  errors.push(error.message);record('진료연결 브라우저 검사 완료',false,error.message);
} finally {
  try {await browser?.close();} catch(error) {errors.push(error.message);proof.result='fail';}
  await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
  await writeFile(resolve(root,'orchestration/runs/journey-browser.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(`진료연결 브라우저 검증: ${checks.filter(check=>check.status==='pass').length}/${checks.length} · 실제 LLM·전화·개인기록 조회 없음`);
  if(proof.result!=='pass')process.exitCode=1;
}
