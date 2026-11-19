import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
const base=process.env.BASE_URL||'http://127.0.0.1:4189',out=resolve('output/coordination-qa');
await mkdir(out,{recursive:true});assert.equal((await(await fetch(base+'/api/agent/capabilities')).json()).llm,false);
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const report={sourceHash:await runtimeFingerprint(process.cwd()),checks:[],views:[],errors:[],apiPosts:0};
const check=(name,pass)=>{report.checks.push({name,pass:Boolean(pass)});};
async function setup(viewport){
 const c=await browser.newContext({viewport,locale:'ko-KR',reducedMotion:'reduce'});
 await c.route('**/*',r=>{if(new URL(r.request().url()).origin!==new URL(base).origin)return r.abort();if(r.request().method()==='POST'){report.apiPosts++;return r.abort();}return r.continue();});
 const p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));p.setDefaultTimeout(9000);
 await p.goto(base);await p.locator('#choose-region-jeju').click();await p.locator('#entry-mode-text').click();
 await p.locator('#request-input').fill('제주우리병원 정형외과 12월 3일 오후에 가고 싶어요. 애월읍에서 휠체어와 동행이 필요해요.');await p.locator('#send-request').click();
 await p.locator('.entry-review-footer .appointment-primary').click();await p.locator('.coordination').waitFor();await p.evaluate(()=>document.fonts.ready);
 return {c,p};
}
async function finishAndClose(p){
 await p.locator('[data-coordination-status=finished]').waitFor();
 await p.locator('[role=dialog]').waitFor();
 await p.getByRole('button',{name:'결과창 닫기',exact:true}).click();
 await p.locator('[role=dialog]').waitFor({state:'hidden'});
}
async function inspect(p,name){
 const v=await p.evaluate(()=>{const s=document.querySelector('#conversation-scroll'),b=document.querySelector('[data-book-primary]'),r=b.getBoundingClientRect(),footer=document.querySelector('#appointment-actions').getBoundingClientRect();return {width:innerWidth,height:innerHeight,overflow:s.scrollHeight-s.clientHeight,horizontal:document.documentElement.scrollWidth-innerWidth,ctaVisible:r.top>=0&&r.bottom<=innerHeight,allResultsVisible:[...document.querySelectorAll('.coordination-results>li')].every(n=>n.getBoundingClientRect().bottom<=footer.top),rows:[...document.querySelectorAll('.coordination-results>li')].map(n=>({id:n.dataset.job,state:n.dataset.result})),primary:b.textContent};});
 report.views.push({name,...v});check(`${name} 가로 넘침 없음`,v.horizontal<=1);check(`${name} 주 행동 화면 내`,v.ctaVisible);await p.screenshot({path:resolve(out,`${name}.png`)});
}
try{
 assert.equal((await(await fetch(base+'/deployment.json')).json()).sourceHash,report.sourceHash,'검사 서버와 작업 트리의 빌드가 다릅니다.');
 for(const [width,height] of [[1280,720],[1920,1080],[2831,1448],[390,844]]){
  const {c,p}=await setup({width,height});await inspect(p,`ready-${width}`);check(`${width} 주 행동 한 개`,await p.locator('.appointment-primary:visible').count()===1);
  if(width>=1280)check(`${width} 기본 준비 화면 무스크롤`,report.views.at(-1).overflow<=2);
  await p.locator('[data-book-primary]').click();await p.locator('[data-coordination-status=running]').waitFor();check(`${width} 시작 즉시 성공 아님`,await p.locator('[data-result=confirmed]').count()===0);
  await finishAndClose(p);check(`${width} 3건 결과 체크`,await p.locator('[data-result=confirmed]').count()===3);check(`${width} 분명한 종료`,await p.locator('#coordination-title').innerText()==='맡기신 예약 조율을 마쳤어요');await inspect(p,`done-${width}`);
  if(width>=1280)check(`${width} 기본 완료 화면 무스크롤`,report.views.at(-1).overflow<=2);
  const downloadPromise=p.waitForEvent('download');await p.locator('[data-book-primary]').click();const file=await downloadPromise;await file.saveAs(resolve(out,`result-${width}.md`));check(`${width} 결과표 다운로드`,file.suggestedFilename().includes('시연'));
  if(width===1280){
   await p.locator('.coordination-tools summary').filter({hasText:'시연 안내'}).click();await p.locator('[data-book-action=coordination_scenario][data-book-value=taxi_unavailable]').click();await p.locator('[data-book-primary]').click();await finishAndClose(p);check('차량 실패: 성공2 인계1',await p.locator('[data-result=confirmed]').count()===2&&await p.locator('[data-result=handoff]').count()===1);await inspect(p,'taxi-handoff');
   await p.locator('[data-result=handoff] [data-book-action=coordination_result_open]').click();
   const dialog=p.getByRole('dialog');
   await dialog.locator('[data-book-action=coordination_vehicle_retry]').first().click();
   await p.locator('[data-coordination-status=running]').waitFor();
   check('차량만 재조율할 때 완료창을 닫고 병원·동행 회신 보존',await dialog.count()===0&&await p.locator('.coordination-results [data-result=confirmed]').count()===2);
   await finishAndClose(p);
   check('대안 선택 후 세 건 완료',await p.locator('.coordination-results [data-result=confirmed]').count()===3);
   const scenarioTools=p.locator('.coordination-tools details').filter({has:p.locator('[data-book-action=coordination_scenario]')});
   if(!await scenarioTools.evaluate(el=>el.open))await scenarioTools.locator('summary').first().click();
   await p.locator('[data-book-action=coordination_scenario][data-book-value=success]').click();await p.locator('[data-book-primary]').click();await p.locator('[data-coordination-status=running]').waitFor();await p.locator('[data-book-action=coordination_stop]').click();await p.waitForTimeout(1700);check('중지 후 늦은 회신 없음',await p.locator('[data-result=confirmed]').count()===0&&await p.locator('[data-coordination-status=idle]').count()===1);
   await p.locator('[data-book-primary]').click();
   await p.locator('.coordination-results [data-job=hospital][data-result=confirmed]').waitFor();
   await p.getByRole('button',{name:'시연 중지',exact:true}).click();
   await p.locator('#appointment-navigation [data-book-action=view][data-book-value=records]').click();
   await p.locator('#open-my-reservations').click();
   const pausedVisit=p.locator('[data-reservation-region=jeju]');
   await pausedVisit.waitFor();
   check('부분 회신 뒤 내 예약 현황에 조율 중지 표시',await pausedVisit.getByText('조율 중지 · 시연',{exact:true}).count()===1);
   check('받은 병원 회신과 재개 대기 두 건 구분',await pausedVisit.locator('[data-result=confirmed]').count()===1&&await pausedVisit.getByText('조율 재개 대기',{exact:true}).count()===2);
   await pausedVisit.getByRole('button',{name:'중지한 조율 이어보기'}).click();
   await p.getByRole('button',{name:'남은 예약 이어서 조율'}).waitFor();
   check('서류에서 현황을 열어도 중지한 조율 화면으로 복귀',await p.locator('[data-appointment-screen=support]').count()===1&&await p.locator('.coordination-results [data-result=confirmed]').count()===1);
   const receipts=p.locator('.coordination-results [data-result=confirmed]');
   await p.locator('[data-book-primary]').click();
   await finishAndClose(p);
   check('중지 이후 다시 완료 가능',await receipts.count()===3);
   await p.locator('#appointment-navigation [data-book-action=public_edit_dates]').click();
   await p.locator('[data-book-action=public_time][data-book-value=morning]').click();
   await p.locator('#appointment-navigation [data-book-action=view][data-book-value=support]').click();
   check('진료시간 변경 후 예약 체크 무효',await receipts.count()===0);
   check('변경 안내',await p.locator('#coordination-title').innerText()==='바뀐 조건으로 다시 조율해요');
   check('진료가 빨라지면 선택한 차량 시각을 재확인',await p.locator('[data-book-primary]').isDisabled());
   await p.locator('.coordination-issue [data-book-action=coordination_fix_issue]').click();
   check('출발 시각 입력에 초점 이동',await p.locator('#coordination-pickup-time').evaluate(el=>el===document.activeElement));
   await p.locator('#coordination-pickup-time').fill('08:30');
   await p.locator('[data-book-primary]').click();await p.locator('[data-coordination-status=running]').waitFor();await p.locator('#appointment-workspace [data-book-action=home]').click();await p.waitForTimeout(1600);await p.locator('#choose-region-jeju').click();await p.locator('.entry-screen-footer button').first().click();check('이탈 후 자동 완료 없음',await p.locator('[data-result=confirmed]').count()===0);
  }
  await c.close();
 }
 const {c,p}=await setup({width:1440,height:900});await p.locator('#appointment-workspace [data-book-action=home]').click();await p.locator('#choose-region-seoul').click();await p.locator('#entry-mode-text').click();await p.locator('#request-input').fill('서울 한빛대학교병원 종양내과 12월 8일 오후에 가고 싶어요. 택시와 동행이 필요해요.');await p.locator('#send-request').click();await p.locator('.entry-review-footer .appointment-primary').click();await p.locator('[data-book-action=slot][data-book-value="hanbit-kim|2026-12-08|14:40"]').click();await p.locator('[data-book-primary]').click();check('내륙 접수 응답 강제 없이 다음 단계',await p.locator('[data-book-primary]').isEnabled());await p.locator('[data-book-primary]').click();await p.locator('[data-book-primary]').click();await finishAndClose(p);check('내륙 3건 완료',await p.locator('[data-result=confirmed]').count()===3);await p.locator('.coordination-tools>details>summary').filter({hasText:'항공권 가격 비교'}).click();check('항공권은 별도 비교 사이트로 연결',await p.locator('a[href*="skyscanner"]').count()>0);await c.close();
 check('외부 예약·유료 모델 POST 없음',report.apiPosts===0);check('브라우저 예외 없음',report.errors.length===0);
}catch(e){report.errors.push(e.stack);check('브라우저 시나리오 완료',false);}finally{await browser.close();report.passed=report.checks.filter(c=>c.pass).length;report.failed=report.checks.filter(c=>!c.pass);await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,errors:report.errors,views:report.views,apiPosts:report.apiPosts},null,2));if(report.failed.length)process.exitCode=1;}
