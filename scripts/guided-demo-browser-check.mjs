import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFingerprint } from '../orchestration/checks.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const base=new URL(process.env.BASE_URL || 'http://127.0.0.1:4186');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(base.hostname),'키 없는 로컬 서버에서만 실행하세요.');
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory=resolve(root,'output/guided-demo-qa');
await mkdir(directory,{recursive:true});
const proof={checkedAt:new Date().toISOString(),sourceHash:await runtimeFingerprint(root),result:'fail',checks:[],screenshots:[],screenshotHashes:{},previewPosts:0,modelPosts:0,modelInvoked:false,realCalls:false,scope:'실제 로컬 API·공개 snapshot·합성 상태. 오류/지연은 HTTP fixture. 모바일 viewport이며 실기기·스크린리더 검증 아님.'};
const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.CHROMIUM_PATH || undefined});
const check=(name,value)=>{proof.checks.push({name,status:value?'pass':'fail'});assert.ok(value,name);};
async function open(width,height) {
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',locale:'ko-KR',acceptDownloads:true});
  const page=await context.newPage();page.setDefaultTimeout(8000);
  await context.route('**/*',route=>new URL(route.request().url()).origin===base.origin?route.continue():route.abort());
  page.on('request',request=>{if(request.method()==='POST'){if(new URL(request.url()).pathname==='/api/agent/preview')proof.previewPosts++;else proof.modelPosts++;}});
  await page.goto(base.href);await page.locator('#open-existing-preparation').click();await page.locator('[data-demo-start]').waitFor();
  return {page,context};
}
async function shot(page,name) {
  const path=resolve(directory,name+'.png');await page.screenshot({path});proof.screenshots.push('output/guided-demo-qa/'+name+'.png');
  proof.screenshotHashes[name+'.png']=createHash('sha256').update(await readFile(path)).digest('hex');
}
async function choose(page,selector) {
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent/preview');
  await page.locator(selector).click();
  const reply=await response;const data=await reply.json();
  await page.waitForFunction(()=>document.getElementById('conversation-form').getAttribute('aria-busy')==='false');
  check('체험 HTTP 200',reply.status()===200 && data.isPreview && !data.capabilities.llm);
  return data;
}
async function layout(page,name) {
  const result=await page.evaluate(()=>{
    const input=document.getElementById('request-input'),r=input.getBoundingClientRect();
    return {fits:document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1 && r.bottom<=innerHeight && r.top>=0,
      oneInput:document.querySelectorAll('#request-input').length===1,
      targets:[...document.querySelectorAll('#guided-demo-controls button')].filter(n=>n.checkVisibility()).every(n=>n.getBoundingClientRect().height>=44),
      font:parseFloat(getComputedStyle(input).fontSize)>=16,
      focus:document.activeElement.id==='current-task-title'};
  });
  check(name+' 화면·입력·44px·16px',result.fits && result.oneInput && result.targets && result.font);
  return result;
}
try {
  for(const [width,height,adverse] of [[1440,900,false],[390,844,true],[900,600,true],[320,500,true]]) {
    const {page,context}=await open(width,height);
    try {
      await layout(page,width+' 초기');await shot(page,'initial-'+width);
      check(width+' 시작 전 진행·잔여 건수 없음',await page.locator('#stage-navigation [aria-current="step"]').count()===0 && !/남은.*건/.test(await page.locator('#workflow-summary').innerText()));
      check(width+' 첫 상세 접힘',!await page.locator('#preparation-reading').evaluate(n=>n.open));
      await page.locator('[data-demo-write]').click();
      check(width+' 직접 요청은 입력 초점만 이동',await page.locator('#request-input').evaluate(n=>document.activeElement===n && !n.readOnly));
      await page.evaluate(()=>{window.qaInput=document.getElementById('request-input');});
      let data=await choose(page,'[data-demo-start]');
      check(width+' 첫 질문·readonly',data.guidedDemo.stepId==='records' && await page.locator('#request-input').evaluate(n=>n.readOnly));
      check(width+' 체험에서 비활성 전송·음성 숨김',await page.locator('#send-request').isHidden() && await page.locator('#voice-request').isHidden());
      check(width+' 체험 하단 높이 절약',await page.locator('#chat-composer').evaluate(n=>n.getBoundingClientRect().height<120));
      const answers=adverse?['records_missing','hospitals_declined','support_wheelchair','plan_changed']:['records_ready','hospitals_accept','support_taxi','plan_keep'];
      for(const [index,id] of answers.entries()) {
        await page.locator(`[data-demo-choice="${id}"]`).focus();
        const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/agent/preview');
        await page.keyboard.press('Enter');
        data=await (await response).json();
        await page.waitForFunction(()=>document.getElementById('conversation-form').getAttribute('aria-busy')==='false');
        check(width+' 선택 이력 '+index,JSON.stringify(data.guidedDemo.answers)===JSON.stringify(answers.slice(0,index+1)));
        check(width+' 단계 일치 '+index,await page.locator('#preparation-board').getAttribute('data-selected-stage')===data.guidedDemo.stepId && await page.locator('#stage-navigation [aria-current="step"]').getAttribute('data-open-stage')===data.guidedDemo.stepId);
        check(width+' 같은 입력 '+index,await page.evaluate(()=>window.qaInput===document.getElementById('request-input')));
        const questionResult={detail:await page.locator('#current-task-detail').textContent(),expected:data.guidedDemo.detail,result:await page.locator('#guided-demo-result-text').textContent(),open:await page.locator('#guided-demo-result').evaluate(n=>n.open)};
        check(width+' 질문 설명과 이전 결과 분리 '+index,questionResult.detail===questionResult.expected && Boolean(questionResult.result) && !questionResult.open);
        check(width+' 키보드 초점 '+index,(await layout(page,width+' 단계 '+index)).focus);
        if(index===2)await shot(page,'support-'+width);
      }
      check(width+' 네 단계 종료·임상 미확정',data.guidedDemo.complete && data.caseState.review.status!=='completed' && !data.caseState.permissions.share);
      check(width+' 자료 분기',data.caseState.documents.find(d=>d.id==='report').status===(adverse?'missing':'ready'));
      check(width+' 병원 분기',data.caseState.inquiries.jeju.status===(adverse?'not_participating':'confirmed'));
      check(width+' 휠체어 후보',data.caseState.visitSupport.taxi.provider.id===(adverse?'jeju-accessible-transport':'taxi327-14'));
      check(width+' 일정 재확인',data.caseState.visitSupport.taxi.status===(adverse?'needs_recheck':'available_demo'));
      check(width+' 준비표 펼침',await page.locator('#stage-plan [data-stage-details]').evaluate(n=>n.open));
      await shot(page,'final-'+width);
      const download=page.waitForEvent('download');await page.locator('[data-demo-save]').click();
      const file=await (await download).path(),report=await readFile(file,'utf8');
      check(width+' 보고서 합성·미확인',/합성/.test(report) && /미확인/.test(report) && /출처/.test(report));
      if(await page.locator('#workspace-tab-preparation').isVisible())await page.locator('#workspace-tab-preparation').click();
      await page.locator('[data-open-stage="support"]').click();
      await page.locator('#stage-support [data-stage-sources] a').first().scrollIntoViewIfNeeded();
      check(width+' 출처 링크',await page.locator('#stage-support [data-stage-sources] a').count()>0);
      await page.locator('#exit-guided-demo').click();await page.waitForTimeout(50);
      // 기본 confirm dismiss는 완성된 체험을 보존한다.
      check(width+' 전환 취소 보존',await page.locator('[data-demo-save]').count()===1);
      page.once('dialog',dialog=>dialog.accept());await page.locator('#exit-guided-demo').click();
      check(width+' 명시 전환 후 입력',!await page.locator('#request-input').evaluate(n=>n.readOnly) && await page.locator('[data-demo-start]').isVisible());
      await page.reload();await page.locator('#open-existing-preparation').click();check(width+' 체험 원문 미저장',await page.locator('[data-demo-start]').isVisible() && await page.evaluate(()=>sessionStorage.length===0));
    } finally {await context.close();}
  }
  const {page,context}=await open(390,844);
  try {
    await choose(page,'[data-demo-start]');
    await page.route('**/api/agent/preview',route=>route.fulfill({status:503,json:{error:{code:'TEST_FAILURE'}}}),{times:1});
    await page.locator('[data-demo-choice="records_missing"]').click();
    await page.waitForFunction(()=>document.getElementById('mode-notice').textContent.includes('불러오지 못'));
    check('오류 뒤 선택·이전 상태 보존',await page.locator('[data-demo-choice="records_missing"]').isEnabled() && await page.locator('#current-task-title').innerText()==='판독문을 준비하셨나요?');
    await shot(page,'error-390');await choose(page,'[data-demo-choice="records_missing"]');
    check('같은 선택 재시도',await page.locator('#current-task-title').innerText()==='양쪽 병원에 어떤 절차를 확인할까요?');
    let release,started;
    const held=new Promise(resolve=>{release=resolve;}),arrived=new Promise(resolve=>{started=resolve;});
    await page.route('**/api/agent/preview',async route=>{const response=await route.fetch();started();await held;try {await route.fulfill({response});} catch {}},{times:1});
    await page.locator('[data-demo-choice="hospitals_accept"]').click();await arrived;
    check('중복 클릭 방지',await page.locator('[data-demo-choice="hospitals_accept"]').isDisabled());
    await page.locator('#cancel-request').click();release();
    await page.waitForFunction(()=>document.getElementById('conversation-form').getAttribute('aria-busy')==='false');
    check('중지 뒤 이전 질문 보존',await page.locator('#current-task-title').innerText()==='양쪽 병원에 어떤 절차를 확인할까요?');
    await choose(page,'[data-demo-choice="hospitals_accept"]');
    check('중지 후 재시도',await page.locator('#current-task-title').innerText()==='어떤 이동 지원이 필요하세요?');
  } finally {await context.close();}
  check('일반 모델 요청 없음',proof.modelPosts===0);
  check('검사 중 동일 소스',proof.sourceHash===await runtimeFingerprint(root));
  proof.result='pass';
} catch(error) {proof.error=error.message;process.exitCode=1;}
finally {
  await browser.close();await writeFile(resolve(directory,'summary.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify({result:proof.result,checks:proof.checks.length,error:proof.error,previewPosts:proof.previewPosts,modelPosts:proof.modelPosts,sourceHash:proof.sourceHash}));
}
