import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFingerprint } from '../orchestration/checks.mjs';
import { createDemoCase, applyAction } from '../app/domain.js';
import { getVisitSupportSummary } from '../app/visit-support.js';
import supportData from '../app/data/visit-support-providers.json' with {type:'json'};

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
let chromium;
try {({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}
catch {throw new Error('선택 QA 도구 Playwright가 필요합니다. README의 브라우저 검사 절차를 참고하세요.');}
const base=new URL(process.env.BASE_URL||'http://127.0.0.1:4173');
// 이 검사는 실제 503/고정 preview와 주입 응답을 함께 쓴다. 공개 유료 서버에서는 실행하지 않는다.
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname) || !['http:','https:'].includes(base.protocol) || base.username || base.password)throw new Error('BASE_URL은 키를 끈 localhost QA 서버여야 합니다.');
const directory='.impeccable/review';
const storageKey='jeju-care-preferences-v1';
const fixtureSessionId='q'.repeat(43);
const configuredCaps={llm:true,model:'gpt-6.1-sol',phone:'simulation',healthRecords:'demo',voiceInput:'browser'};
await mkdir(resolve(root,directory),{recursive:true});
await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const checks=[],errors=[];
const record=(name,ok,detail='')=>{checks.push({name,status:ok?'pass':'fail',detail});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' · '+detail:''}`);};
const proof={result:'fail',checkedAt:new Date().toISOString(),url:base.href,sourceHash:await runtimeFingerprint(root),checks,errors,apiLive:false,modelInvoked:false,phoneInvoked:false,healthRecordsQueried:false,microphone:'permission-denied and transcript-review fixtures only',fixedPreview:false,normalInputDisconnected:false,desktop:{width:1440,noOverflow:false},mobile:{width:390,noOverflow:false},fixtureCoverage:{preferences:false,markdown:false,recovery:false,voiceReview:false},sourceHashScope:'invoking checkout; rerun after integration when server source differs'};
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const visibleInViewport=locator=>locator.evaluate(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0 && r.top>=0 && r.bottom<=innerHeight;});
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
async function scenario(name,run) {
  try {await run();} catch(error) {errors.push(`${name}: ${error.message}`);record(name,false,error.message);}
}
async function open(width,height,{configured=false,voice,storageSeed,onPost}={}) {
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',locale:'ko-KR'});
  const page=await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(error.message));
  const requests=[];
  page.on('request',request=>{if(request.method()==='POST' && new URL(request.url()).origin===base.origin && new URL(request.url()).pathname.startsWith('/api/agent'))requests.push(request);});
  if(storageSeed!==undefined)await page.addInitScript(({key,value})=>localStorage.setItem(key,value),{key:storageKey,value:storageSeed});
  if(voice)await page.addInitScript(mode=>{
    window.SpeechRecognition=class {
      start(){
        this.onstart?.();
        if(mode==='denied')queueMicrotask(()=>{this.onerror?.({error:'not-allowed'});this.onend?.();});
        else window.__qaFinishSpeech=()=>{const result=[{transcript:'11월 12일 어머니 이동을 준비해 주세요.'}];result.isFinal=true;this.onresult?.({resultIndex:0,results:[result]});this.onend?.();};
      }
      stop(){this.onend?.();}
      abort(){this.onend?.();}
    };
  },voice);
  if(configured)await page.route('**/api/agent/capabilities',route=>route.fulfill({json:configuredCaps}));
  if(onPost)await page.route('**/api/agent',async route=>{
    if(route.request().method()!=='POST')return route.abort();
    const answer=await onPost(route.request());
    await route.fulfill({status:answer.status??200,json:answer.body});
  });
  await page.goto(base.href,{waitUntil:'networkidle'});
  await page.locator('#request-input').waitFor();
  await page.waitForFunction(expected=>document.querySelector('#connection-state')?.textContent===expected,configured?'대화 연결 설정됨':'AI 모델 미연결');
  await page.evaluate(()=>document.fonts.ready);
  return {page,context,requests};
}
async function send(page,text) {
  await page.locator('#request-input').fill(text);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent' && r.request().method()==='POST');
  await page.locator('#send-request').click();
  const result=await response;
  await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(done)));
  return result;
}
async function confirmAction(page,selector,accept=true) {
  let dialogType='',message='';
  page.once('dialog',async dialog=>{dialogType=dialog.type();message=dialog.message();if(accept)await dialog.accept();else await dialog.dismiss();});
  await page.locator(selector).click();
  return {confirmed:dialogType==='confirm',message};
}
async function editPreferences(page,values) {
  const mobile=await page.locator('#open-care-menu').isVisible();
  if(mobile)await page.locator('#open-care-menu').click();
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
  const node=page.locator('#composer-disclosure');
  return await visibleInViewport(node) && /가상/.test(await node.innerText()) && /실제.*(?:연락|발신).*예약/.test(await node.innerText());
}
try {
  const capResponse=await fetch(new URL('/api/agent/capabilities',base));
  const caps=await capResponse.json();
  const keyless=capResponse.status===200 && caps.llm===false && caps.phone!=='connected' && caps.healthRecords!=='connected';
  record('실제 capabilities는 모델·전화·공단 실제 연동을 표시하지 않음',keyless);
  record('API 응답 캐시 금지',capResponse.headers.get('cache-control')==='no-store');
  if(!keyless)throw new Error('실제 모델이 연결됐거나 keyless 상태를 확인하지 못해 POST 검사를 중단합니다.');
  proof.apiLive=true;
  for(const [width,height,label] of [[1440,900,'desktop'],[390,844,'mobile']])await scenario(`${width}px 실제 API 시나리오`,async()=>{
    const {page,context,requests}=await open(width,height);
    try {
      proof[label].noOverflow=await overflow(page);
      proof[label].screenshot=await screenshot(page,`initial-${label}`);
      record(`${width}px 가로 넘침과 첫 화면 입력`,proof[label].noOverflow && await visibleInViewport(page.locator('#request-input')) && await visibleInViewport(page.locator('#send-request')));
      const mobileSummary=await page.locator('#mobile-case-summary').textContent();
      record(`${width}px 병원·자료·택시·동행 읽기 요약`,await page.locator('[data-case-status]').count()===4 && (width>900 || ['병원','자료','택시','동행'].every(term=>mobileSummary.includes(term))));
      record(`${width}px 로고·자가 호스팅 한국어 폰트·가상 사진`,await page.locator('.brand img').first().evaluate(e=>e.complete && e.naturalWidth>0) && await page.locator('.welcome-photo img').evaluate(e=>e.complete && e.naturalWidth>0 && /가상/.test(e.alt)) && /가상|생성/.test(await page.locator('.welcome-photo figcaption').innerText()) && await page.evaluate(()=>['Pretendard','MaruBuri'].every(name=>[...document.fonts].some(font=>font.family.replaceAll('"','')===name && font.status==='loaded'))));
      record(`${width}px 설정은 선택이며 준비 대화에 필수 수동 폼 없음`,await page.locator('#conversation-form select,#conversation-form input[type=checkbox]').count()===0 && await page.locator('#preferences-form [required]').count()===0 && await page.locator('#preferences-form select').count()===1);
      record(`${width}px 입력 가까이 실제 연락·예약 한계 표시`,await disclosure(page));
      const input=page.locator('#request-input');
      await input.fill('어머니 진료 준비를 부탁합니다.');
      await input.dispatchEvent('compositionstart');
      await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});
      await input.dispatchEvent('compositionend');await input.press('Shift+Enter');
      record(`${width}px 한글 조합·줄바꿈 중 미전송`,requests.length===0 && (await input.inputValue()).endsWith('\n'));
      const normal=await send(page,'모델 연결 전 자유 입력입니다.');
      await page.locator('.request-error').waitFor();
      const normalPayload=await normal.json(),disconnected=normal.status()===503 && normalPayload.error?.code==='MODEL_NOT_CONNECTED';
      proof.normalInputDisconnected ||= disconnected;
      record(`${width}px 자유 입력은 실제 503·입력 보존·가짜 응답 없음`,disconnected && await input.inputValue()==='모델 연결 전 자유 입력입니다.' && await page.locator('.message.assistant').count()===1 && await page.locator('.tool-record').count()===0);
      const first=requests.at(-1);
      record(`${width}px 동일 JSON UTF-8 SHA256`,hashMatches(first));
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
      const previewOk=preview.status()===200 && payload.isPreview===true && payload.events.length===15;
      proof.fixedPreview ||= previewOk;
      record(`${width}px 고정 미리보기 실제 도구 15건`,previewOk && await page.locator('.example-label').count()===2 && /고정 시나리오/.test(await page.locator('#mode-notice').textContent()));
      record(`${width}px 처리 기록은 기본 접힘·설정은 preview에 미적용`,await page.locator('.tool-records').evaluateAll(nodes=>nodes.length>0 && nodes.every(node=>!node.open)) && /적용하지/.test(await page.locator('#preferences-status').textContent()) && !Object.hasOwn(json(requests.at(-1)),'preferences'));
      record(`${width}px 실제 공개 기관·애월콜·공식 동행 경로`,payload.caseState.selectedHospital?.source.datasetId==='859' && payload.caseState.visitSupport.taxi.provider.name==='애월콜' && payload.caseState.visitSupport.taxi.provider.source.datasetId==='327' && payload.caseState.visitSupport.companion.provider.id==='areum-escort');
      record(`${width}px 공단 미연결·진찰 미수행·동행 불통 유지`,payload.events.some(e=>e.tool==='request_records' && e.status==='not_connected') && payload.pendingActions.some(a=>a.kind==='physician-exam') && payload.caseState.visitSupport.companion.status==='unreachable_demo');
      await page.locator('.tool-records>summary').click();
      record(`${width}px 펼친 처리 기록 source 링크는 HTTPS`,await page.locator('.tool-source a').evaluateAll(links=>links.length>0 && links.every(a=>a.href.startsWith('https://') && a.target==='_blank' && a.rel.includes('noopener'))));
      if(!await page.locator('#case-summary').evaluate(node=>node.open))await page.locator('#case-summary>summary').click();
      record(`${width}px 동행 재문의와 합성 병원 절차 표시`,(await page.locator('#case-content').innerText()).includes('동행 재문의') && /합성|시연/.test(await page.locator('[data-case-status="병원 문의"]').innerText()));
      const mapLink=page.locator('#case-content a[href^="https://www.google.com/maps/"]');
      record(`${width}px 실제 공개 주소 지도 링크`,await mapLink.count()===1 && new URL(await mapLink.getAttribute('href')).searchParams.get('query').includes(payload.caseState.selectedHospital.address));
      await screenshot(page,`preview-${label}`);
      await page.locator('#conversation-scroll').evaluate(e=>e.scrollTop=e.scrollHeight);await screenshot(page,`tools-${label}`);
      const downloadPromise=page.waitForEvent('download');await page.locator('#save-report').click();
      const download=await downloadPromise,report=await readFile(await download.path(),'utf8');
      record(`${width}px 보고서 시연·데이터 출처`,download.suggestedFilename().endsWith('.md') && /고정 시나리오/.test(report) && ['859','327','애월콜'].every(term=>report.includes(term)));
      await send(page,'미리보기 이후 새 자유 요청');await page.locator('.request-error').waitFor();
      const fresh=json(requests.at(-1));
      record(`${width}px 미리보기 상태를 실제 대화에 섞지 않음`,!fresh.sessionId && fresh.history.length===0 && await page.locator('.example-label').count()===0 && await page.locator('.tool-record').count()===0);
      await confirmAction(page,'#new-conversation');
      record(`${width}px 새 대화 초기화`,await page.locator('.message').count()===1 && await input.inputValue()==='' && await page.locator('#save-report').isDisabled());
    } finally {await context.close();}
  });
  await scenario('설정된 모델의 실제 고정 preview',async()=>{
    const {page,context,requests}=await open(1440,900,{configured:true});
    try {
      const response=page.waitForResponse(item=>new URL(item.url()).pathname==='/api/agent/preview' && item.request().method()==='POST');
      await page.locator('#preview-button').click();
      const actual=await response,payload=await actual.json();
      await page.waitForFunction(()=>document.querySelectorAll('.tool-record').length===15);
      record('연결 설정 fixture에서도 실제 preview 15건만 실행',actual.status()===200 && payload.isPreview===true && payload.capabilities.llm===false && payload.events.length===15 && requests.length===1 && new URL(requests[0].url()).pathname==='/api/agent/preview','GET 연결 설정만 fixture·preview는 실제 keyless API·모델 POST 없음');
      record('고정 예시의 llm:false는 전역 연결 설정을 덮어쓰지 않음',await page.locator('#connection-state').textContent()==='대화 연결 설정됨' && /실제 응답은 요청을 보낼 때/.test(await page.locator('#connection-details').textContent()) && /고정.*미리보기/.test(await page.locator('#mode-notice').textContent()) && /LLM.*없음/.test(await page.locator('#mode-notice').textContent()));
    } finally {await context.close();}
  });
  for(const [width,height] of [[1440,900],[390,844]])await scenario(`${width}px 설정 응답 fixture`,async()=>{
    let state=createDemoCase(),count=0;
    const markdown='# 준비한 내용\n- **택시 문의 초안**을 정리했어요.\n  - 실제 배차는 미확정이에요.\n\n1. 기관에 가능 시간을 확인해 주세요.\n\n[공개 출처](https://jejudatahub.net/data/view/data/327)\n\n<img src=x onerror="window.__qaXss=true"><script>window.__qaXss=true</script>\n\n[실행 금지](javascript:alert(1))\n\n'+Array.from({length:12},(_,i)=>`- 확인할 내용 ${i+1}: 실제 예약은 미확정입니다.`).join('\n');
    const {page,context,requests}=await open(width,height,{configured:true,onPost:request=>{
      count++;
      if(count===3)return {status:503,body:{error:{code:'MODEL_UNAVAILABLE',message:'응답 fixture 실패'},requestId:json(request).requestId}};
      if(count===1 || count===5)state=preparedState(json(request).preferences);
      if(count===2)state=applyAction(state,{type:'UPDATE_PATIENT',values:{nextVisit:'2026-11-20'}});
      return {body:fixtureResponse(request,state,count===1?markdown:'합성 준비 상태를 갱신했습니다.')};
    }});
    try {
      await page.locator('.connection-details>summary').click();
      record(`${width}px 모델 설정과 실제 접근 성공을 구분`,(await page.locator('#connection-details').innerText()).includes('실제 응답은 요청을 보낼 때') && await overflow(page),'capabilities/응답 fixture·실제 모델 API 호출 아님');
      const chosen={taxiProviderId:'taxi327-6',wheelchair:false,companionNeeded:false};
      await editPreferences(page,chosen);
      const saved=await snapshotStorage(page),stored=JSON.parse(saved[storageKey]);
      record(`${width}px 설정 변경은 POST 없이 검증된 세 필드만 저장`,requests.length===0 && Object.keys(saved).length===1 && exactPreferenceShape(stored) && samePreferences(stored,chosen) && /다음 요청/.test(await page.locator('#preferences-status').textContent()));
      // 같은 context의 새 탭만 기기 설정을 공유하고 대화 원문은 공유하지 않는다.
      const reload=await context.newPage();await reload.goto(base.href,{waitUntil:'networkidle'});await reload.locator('#pref-taxi').waitFor({state:'attached'});
      record(`${width}px 같은 기기 재진입은 설정만 복원`,await reload.locator('#pref-taxi').inputValue()===chosen.taxiProviderId && !await reload.locator('#pref-companion').isChecked() && await reload.locator('.message.user').count()===0 && await reload.locator('#request-input').inputValue()==='');await reload.close();
      await send(page,'설정으로 어머니 택시 초안을 준비해 주세요.');
      const first=json(requests[0]);
      record(`${width}px 다음 일반 요청은 preferences·applyPreferences true 전송`,samePreferences(first.preferences,chosen) && first.applyPreferences===true && hashMatches(requests[0]));
      const answer=page.locator('.message.assistant:not(.greeting) .message-body').last();
      record(`${width}px Markdown 제목·목록·강조와 안전한 링크 표시`,await answer.locator('h3').count()===1 && await answer.locator('ul ul').count()===1 && await answer.locator('strong').count()>0 && !(await answer.innerText()).includes('# 준비한 내용') && !(await answer.innerText()).includes('**택시') && await answer.locator('a').evaluateAll(links=>links.length===1 && links.every(a=>a.protocol==='https:' && a.target==='_blank' && a.rel.includes('noopener'))));
      record(`${width}px 모델 HTML·javascript 링크는 실행하지 않음`,await answer.locator('img,script,iframe,a[href^="javascript:"]').count()===0 && await page.evaluate(()=>window.__qaXss===undefined));
      record(`${width}px 새 답변은 처음부터 읽고 도구 기록은 접어 둠`,await answer.locator('h3').evaluate(node=>{const a=node.getBoundingClientRect(),b=document.querySelector('#conversation-scroll').getBoundingClientRect();return a.top>=b.top && a.bottom<=b.bottom;}) && await page.locator('.tool-records').evaluateAll(nodes=>nodes.every(node=>!node.open)));
      const summary=getVisitSupportSummary(state);
      if(!await page.locator('#case-summary').evaluate(node=>node.open))await page.locator('#case-summary>summary').click();
      record(`${width}px fixture caseState와 방문 요약의 실제 상태 일치`,(await page.locator('[data-case-status="택시 이동"]').innerText()).includes(summary.taxi.label) && (await page.locator('[data-case-status="택시 이동"]').innerText()).includes(summary.taxi.providerName) && (await page.locator('[data-case-status="병원 동행"]').innerText()).includes(summary.companion.label));
      await screenshot(page,`configured-${width}`);
      await send(page,'방문일은 11월 20일로 바꿔 주세요.');
      record(`${width}px 성공 뒤 applyPreferences false·대화 세션 유지`,json(requests[1]).applyPreferences===false && json(requests[1]).sessionId===fixtureSessionId && (await page.locator('#case-content').innerText()).includes('11월 20일') && (await page.locator('[data-case-status="택시 이동"]').innerText()).includes(getVisitSupportSummary(state).taxi.label));
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
    const {page,context,requests}=await open(390,844,{configured:true,onPost:request=>++count===1?{status,body:{error:{code,message:'정제된 fixture 오류'},requestId:json(request).requestId}}:{body:fixtureResponse(request,createDemoCase())}});
    try {
      const text=`${code} 뒤에도 남겨야 할 요청`;await send(page,text);const copy=await page.locator('.request-error').innerText();
      record(`${code}은 구분되는 다음 행동·입력 복구 안내`,match.test(copy) && !exclude.test(copy) && (code!=='DAILY_LIMIT' || /9시|09:00/.test(copy)) && await page.locator('#request-input').inputValue()===text && await page.locator('#send-request').isEnabled());
      const before=requests[0].postData(),next=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent' && r.request().method()==='POST');await page.locator('[data-retry]').click();await next;await page.waitForFunction(()=>document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
      record(`${code} 재시도는 같은 요청으로 회복`,requests[1].postData()===before && await page.locator('.request-error').count()===0 && await page.locator('.message.assistant').count()===2);
      proof.fixtureCoverage.recovery=true;
    } finally {await context.close();}
  });
  for(const [width,height] of [[360,780],[390,844],[768,1024]])await scenario(`${width}px 모바일 설정`,async()=>{
    const {page,context,requests}=await open(width,height);
    try {
      record(`${width}px 추가 반응형 가로 넘침·입력·실제 처리 한계`,await overflow(page) && await visibleInViewport(page.locator('#send-request')) && await disclosure(page));
      await page.locator('#open-care-menu').focus();await page.keyboard.press('Enter');
      record(`${width}px 설정 서랍은 이름·focus·배경 비활성 제공`,await page.locator('#care-rail').getAttribute('role')==='dialog' && await page.locator('#care-rail').getAttribute('aria-modal')==='true' && await page.evaluate(()=>document.activeElement.id==='close-care-menu' && document.querySelector('#workspace-shell').inert));
      const targets=page.locator('#open-care-menu,#close-care-menu,#pref-taxi,.preference-toggle,#nav-preparation,#nav-preferences');
      record(`${width}px 서랍과 선택 조작의 터치 영역 44px 이상`,await targets.evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect();return r.width>=44 && r.height>=44;})));
      await page.locator('#pref-companion').focus();await page.keyboard.press('Tab');
      const forward=await page.evaluate(()=>document.querySelector('#care-rail').contains(document.activeElement));await page.keyboard.press('Shift+Tab');
      record(`${width}px 서랍 Tab 경계와 Escape focus 복귀`,forward && await page.evaluate(()=>document.activeElement.id==='pref-companion'));
      await page.keyboard.press('Escape');
      record(`${width}px 서랍 닫기는 대화·포커스 복원, POST 없음`,await page.evaluate(()=>document.activeElement.id==='open-care-menu' && document.querySelector('#care-rail').inert && !document.querySelector('#workspace-shell').inert) && requests.length===0 && await disclosure(page));
    } finally {await context.close();}
  });
  await scenario('음성 거절 fixture',async()=>{
    const {page,context,requests}=await open(390,844,{voice:'denied'});
    try {await page.locator('#voice-request').click();await page.waitForFunction(()=>document.querySelector('#voice-help').textContent.includes('권한'));await page.locator('#request-input').fill('텍스트로 이어가기');record('음성 권한 거절 fixture는 미전송·텍스트 복구',requests.length===0 && await page.locator('#send-request').isEnabled() && await page.locator('#voice-request').getAttribute('aria-pressed')==='false','브라우저 이벤트 fixture·실제 마이크 인식 아님');}
    finally {await context.close();}
  });
  await scenario('음성 인식 검토 fixture',async()=>{
    const {page,context,requests}=await open(390,844,{voice:'transcript',configured:true,onPost:request=>({body:fixtureResponse(request,createDemoCase())})});
    try {
      await page.locator('#request-input').fill('작성 중인 요청');
      await page.locator('#voice-request').click();
      record('음성을 듣는 동안 기존 초안도 자동 전송하지 않음',requests.length===0 && await page.locator('#send-request').isDisabled() && await page.locator('#voice-request').getAttribute('aria-pressed')==='true');
      await page.evaluate(()=>window.__qaFinishSpeech());await page.waitForFunction(()=>document.querySelector('#request-input').value.includes('11월 12일'));
      record('음성 인식 fixture는 검토 가능한 초안으로 남고 자동 전송하지 않음',requests.length===0 && /확인|고친/.test(await page.locator('#voice-help').textContent()) && await page.locator('#send-request').isEnabled());
      await send(page,'11월 20일 어머니 이동을 준비해 주세요.');
      record('인식 내용을 수정한 뒤 보내야 요청됨',requests.length===1 && json(requests[0]).message==='11월 20일 어머니 이동을 준비해 주세요.' && hashMatches(requests[0]),'실제 음성 서비스·모델 호출 아님');proof.fixtureCoverage.voiceReview=true;
    } finally {await context.close();}
  });
  record('브라우저 실행 오류 없음',errors.length===0,errors.join('; '));
  if(checks.every(c=>c.status==='pass') && errors.length===0)proof.result='pass';
} catch(error) {errors.push(error.message);record('대화 브라우저 시나리오 완료',false,error.message);}
finally {
  await browser.close();
  await writeFile(resolve(root,'orchestration/runs/conversation-browser.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(`대화 화면 검증: ${checks.filter(c=>c.status==='pass').length}/${checks.length} · 실제 LLM/전화/공단/마이크 검증 아님`);
  if(proof.result!=='pass')process.exitCode=1;
}
