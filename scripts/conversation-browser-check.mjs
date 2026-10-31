import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFingerprint } from '../orchestration/checks.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
let chromium;
try {({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}
catch {throw new Error('선택 QA 도구 Playwright가 필요합니다. README의 브라우저 검사 절차를 참고하세요.');}
const base=process.env.BASE_URL||'http://127.0.0.1:4173';
const directory='.impeccable/review';
await mkdir(resolve(root,directory),{recursive:true});
await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const checks=[],errors=[];
const record=(name,ok,detail='')=>checks.push({name,status:ok?'pass':'fail',detail});
const proof={result:'fail',checkedAt:new Date().toISOString(),url:base,sourceHash:await runtimeFingerprint(root),checks,errors,apiLive:true,modelInvoked:false,phoneInvoked:false,healthRecordsQueried:false,microphone:'permission-denied fixture only',fixedPreview:false,normalInputDisconnected:false,desktop:{width:1440,noOverflow:false},mobile:{width:390,noOverflow:false}};
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const screenshot=async(page,name)=>{
  const path=`${directory}/conversation-${name}.png`;
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
  await page.waitForFunction(()=>window.scrollY===0);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:resolve(root,path),fullPage:true});
  return path;
};
async function open(width,height,{denied=false}={}) {
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  if(denied) await page.addInitScript(()=>{
    window.SpeechRecognition=class {
      start(){this.onstart?.();queueMicrotask(()=>{this.onerror?.({error:'not-allowed'});this.onend?.();});}
      abort(){this.onend?.();}
    };
  });
  await page.goto(base,{waitUntil:'networkidle'});
  await page.waitForSelector('#request-input');
  await page.waitForFunction(()=>document.querySelector('#connection-state').textContent==='AI 모델 미연결');
  await page.evaluate(()=>document.fonts.ready);
  return page;
}
try {
  const capResponse=await fetch(new URL('/api/agent/capabilities',base));
  const caps=await capResponse.json();
  record('실제 capabilities는 모델·전화·공단 실제 연동을 표시하지 않음',capResponse.status===200 && caps.llm===false && caps.phone!=='connected' && caps.healthRecords!=='connected');
  record('API 응답 캐시 금지',capResponse.headers.get('cache-control')==='no-store');
  for(const [width,height,label] of [[1440,900,'desktop'],[390,844,'mobile']]) {
    const page=await open(width,height);
    const requests=[];
    page.on('request',request=>{if(request.method()==='POST' && new URL(request.url()).pathname.startsWith('/api/agent'))requests.push(request);});
    proof[label].noOverflow=await overflow(page);
    proof[label].screenshot=await screenshot(page,`initial-${label}`);
    record(`${width}px 가로 넘침과 첫 화면 입력`,proof[label].noOverflow && await page.locator('#send-request').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight));
    const mobileSummary=await page.locator('#mobile-case-summary').textContent();
    record(`${width}px 병원·자료·택시·동행 읽기 요약`,await page.locator('[data-case-status]').count()===4 && (width>960 || ['병원','자료','택시','동행'].every(term=>mobileSummary.includes(term))));
    record(`${width}px 로고·한국어 폰트`,await page.locator('.brand img').evaluate(e=>e.complete && e.naturalWidth>0) && await page.evaluate(()=>[...document.fonts].some(f=>f.family.replaceAll('"','')==='MaruBuri' && f.status==='loaded')));
    record(`${width}px 준비 단계 수동 폼 없음`,await page.locator('select,input[type=checkbox]').count()===0 && await page.locator('.hero,.care-scene,.case-visual').count()===0);
    const input=page.locator('#request-input');
    await input.fill('어머니 진료 준비를 부탁합니다.');
    await input.dispatchEvent('compositionstart');
    await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});
    await input.dispatchEvent('compositionend');
    await input.press('Shift+Enter');
    record(`${width}px 한글 조합·줄바꿈 중 미전송`,requests.length===0 && (await input.inputValue()).endsWith('\n'));
    await input.fill('모델 연결 전 자유 입력입니다.');
    const normalResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent' && r.request().method()==='POST');
    await page.locator('#send-request').click();
    const normal=await normalResponse;
    await page.waitForSelector('.request-error');
    const normalPayload=await normal.json();
    proof.normalInputDisconnected=normal.status()===503 && normalPayload.error?.code==='MODEL_NOT_CONNECTED';
    record(`${width}px 자유 입력은 실제 503·입력 보존·가짜 응답 없음`,proof.normalInputDisconnected && await input.inputValue()==='모델 연결 전 자유 입력입니다.' && await page.locator('.message.assistant').count()===1 && await page.locator('.tool-record').count()===0);
    const first=requests.at(-1);
    record(`${width}px 동일 JSON UTF-8 SHA256`,first.headers()['x-amz-content-sha256']===createHash('sha256').update(first.postData()).digest('hex'));
    const retryResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent' && r.request().method()==='POST');
    await page.locator('[data-retry]').click();await retryResponse;
    await page.waitForFunction(()=>document.querySelector('[data-retry]') && document.querySelector('#conversation-form').getAttribute('aria-busy')==='false');
    record(`${width}px 같은 요청 재시도는 ID·본문 보존`,requests.at(-1).postData()===first.postData() && await page.locator('.message.user').count()===1);
    await screenshot(page,`error-${label}`);
    await page.locator('#new-conversation').click();
    const previewResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent/preview');
    await page.locator('#preview-button').click();
    const preview=await previewResponse, payload=await preview.json();
    await page.waitForSelector('.tool-record');
    proof.fixedPreview=preview.status()===200 && payload.isPreview===true && payload.events.length===15;
    record(`${width}px 고정 미리보기 실제 도구 15건`,proof.fixedPreview && await page.locator('.tool-record').count()===15 && await page.locator('.example-label').count()===2 && /고정 시나리오/.test(await page.locator('#mode-notice').textContent()));
    record(`${width}px 실제 공개 기관·애월콜·공식 동행 경로`,payload.caseState.selectedHospital?.source.datasetId==='859' && payload.caseState.visitSupport.taxi.provider.name==='애월콜' && payload.caseState.visitSupport.taxi.provider.source.datasetId==='327' && payload.caseState.visitSupport.companion.provider.id==='areum-escort');
    record(`${width}px 공단 미연결·진찰 미수행·동행 불통 유지`,payload.events.some(e=>e.tool==='request_records' && e.status==='not_connected') && payload.pendingActions.some(a=>a.kind==='physician-exam') && payload.caseState.visitSupport.companion.status==='unreachable_demo');
    record(`${width}px source 링크는 HTTPS`,await page.locator('.tool-source a').evaluateAll(links=>links.length>0 && links.every(a=>a.href.startsWith('https://'))));
    if(width<960)await page.locator('#case-summary>summary').click();
    record(`${width}px 동행 재문의와 합성 병원 절차 표시`,(await page.locator('#case-content').innerText()).includes('동행 재문의') && /합성|시연/.test(await page.locator('[data-case-status="병원 문의"]').innerText()));
    const mapLink=page.locator('#case-content a[href^="https://www.google.com/maps/"]');
    record(`${width}px 실제 공개 주소 지도 링크`,await mapLink.count()===1 && new URL(await mapLink.getAttribute('href')).searchParams.get('query').includes(payload.caseState.selectedHospital.address));
    await screenshot(page,`preview-${label}`);
    await page.locator('#conversation-scroll').evaluate(e=>e.scrollTop=e.scrollHeight);
    await screenshot(page,`tools-${label}`);
    const downloadPromise=page.waitForEvent('download');await page.locator('#save-report').click();
    const download=await downloadPromise, report=await readFile(await download.path(),'utf8');
    record(`${width}px 보고서 시연·데이터 출처`,download.suggestedFilename().endsWith('.md') && /고정 시나리오/.test(report) && report.includes('859') && report.includes('327') && report.includes('애월콜'));
    await input.fill('미리보기 이후 새 자유 요청');
    const freshResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent' && r.request().method()==='POST');
    await page.locator('#send-request').click();await freshResponse;
    await page.waitForSelector('.request-error');
    const fresh=JSON.parse(requests.at(-1).postData());
    record(`${width}px 미리보기 상태를 실제 대화에 섞지 않음`,!fresh.sessionId && fresh.history.length===0 && await page.locator('.example-label').count()===0 && await page.locator('.tool-record').count()===0);
    await page.locator('#new-conversation').click();
    record(`${width}px 새 대화 초기화`,await page.locator('.message').count()===1 && await input.inputValue()==='' && await page.locator('#save-report').isDisabled());
    await page.close();
  }
  for(const [width,height] of [[360,780],[768,1024]]) {
    const page=await open(width,height);
    record(`${width}px 추가 반응형 가로 넘침 없음`,await overflow(page));
    await page.close();
  }
  const denied=await open(390,844,{denied:true});
  let sent=0;denied.on('request',r=>{if(r.method()==='POST')sent++;});
  await denied.locator('#voice-request').click();
  await denied.waitForFunction(()=>document.querySelector('#voice-help').textContent.includes('권한'));
  await denied.locator('#request-input').fill('텍스트로 이어가기');
  record('음성 권한 거절 fixture는 미전송·텍스트 복구',sent===0 && await denied.locator('#send-request').isEnabled() && await denied.locator('#voice-request').getAttribute('aria-pressed')==='false','브라우저 이벤트 주입 검사이며 실제 마이크 인식 검증 아님');
  await denied.close();
  record('브라우저 실행 오류 없음',errors.length===0,errors.join('; '));
  if(checks.every(c=>c.status==='pass'))proof.result='pass';
} catch(error) {errors.push(error.message);record('대화 브라우저 시나리오 완료',false,error.message);}
finally {
  await browser.close();
  await writeFile(resolve(root,'orchestration/runs/conversation-browser.json'),JSON.stringify(proof,null,2)+'\n');
  for(const check of checks)console.log(`${check.status==='pass'?'PASS':'FAIL'} ${check.name}${check.detail?' · '+check.detail:''}`);
  console.log(`대화 화면 검증: ${checks.filter(c=>c.status==='pass').length}/${checks.length} · 실제 LLM/전화/공단/마이크 검증 아님`);
  if(proof.result!=='pass')process.exitCode=1;
}
