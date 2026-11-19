import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFingerprint } from '../orchestration/checks.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),base=process.env.BASE_URL || 'http://127.0.0.1:4188';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname));
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory=resolve(root,'output/appointment-react-qa');await mkdir(directory,{recursive:true});
const proof={checkedAt:new Date().toISOString(),sourceHash:await runtimeFingerprint(root),result:'fail',checks:[],screenshots:[],errors:[],appointmentPosts:0,modelInvoked:false,scope:'Next.js static export + 기존 Node API. 합성 슬롯·입력 교통 계획, viewport 검사. 실기기·실예약·실모델 검증 아님.'};
const check=(name,value)=>{proof.checks.push({name,status:value?'pass':'fail'});assert.ok(value,name);};
const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.CHROMIUM_PATH||undefined});
const selector=(action,value)=>`[data-book-action="${action==='continue'?'find_dates':action}"]${value===undefined?'':`[data-book-value="${value}"]`}`;
async function click(page,action,value) {await page.locator(':is(#appointment-workspace,#appointment-actions) '+selector(action,value)).first().click();}
async function select(page,id,text) {await page.locator('#'+id).click();await page.getByRole('option',{name:text,exact:true}).click();}
async function layout(page,name) {
  const measure=await page.evaluate(()=>{
    const host=document.getElementById('appointment-workspace'),scroll=document.getElementById('conversation-scroll'),input=document.getElementById('request-input');
    const r=input.getBoundingClientRect();
    return {fits:document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1 && scroll.scrollWidth<=scroll.clientWidth+1 && r.bottom<=innerHeight+1,
      targets:[...host.querySelectorAll('button,select,summary,a,input')].filter(node=>node.checkVisibility()).filter(node=>node.getBoundingClientRect().height<43.999).map(node=>({text:node.textContent,height:node.getBoundingClientRect().height})),
      font:parseFloat(getComputedStyle(input).fontSize)>=16,inputSame:input===window.appointmentInput,
      inactive:document.getElementById('existing-visit-workspace').inert && document.getElementById('existing-preparation-navigation').inert};
  });
  if(!measure.fits || measure.targets.length)console.log(JSON.stringify({name,measure}));
  check(name+' 화면·스크롤·44px·16px·같은 입력·비활성 영역',measure.fits && !measure.targets.length && measure.font && measure.inputSame && measure.inactive);
}
async function shot(page,name) {await page.screenshot({path:resolve(directory,name+'.png')});proof.screenshots.push('output/appointment-react-qa/'+name+'.png');}
async function nav(page,value,width) {if(width<=900)await page.locator('#workspace-tab-preparation').click();await page.locator('#appointment-navigation '+selector('view',value)).click();}
try {
  const build=await (await fetch(base+'/deployment.json')).json();
  check('실제 Next 정적 빌드와 현재 소스 지문 일치',build.frontend==='next-react' && build.sourceHash===proof.sourceHash);
  for(const [width,height] of [[1440,900],[390,844],[900,600],[320,500]]) {
    const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',locale:'ko-KR',acceptDownloads:true});
    const page=await context.newPage();page.setDefaultTimeout(10000);page.on('dialog',dialog=>dialog.accept());
    page.on('pageerror',error=>proof.errors.push(error.message));
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
    let posts=0;page.on('request',request=>{if(request.method()==='POST')posts++;});
    await page.goto(base);await page.locator('#open-existing-preparation').click();await page.locator('#open-appointment-demo').waitFor();
    check(width+' Next React 앱 진입',await page.locator('#app').getAttribute('data-framework')==='next-react');
    await page.locator('#request-input').fill('기존 입력 초안을 보존해 주세요.');
    await page.evaluate(()=>{window.appointmentInput=document.getElementById('request-input');window.existingBoard=document.getElementById('preparation-board');});
    const storage=await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}}));
    await page.locator('#open-appointment-demo').click();await layout(page,width+' 접수');await shot(page,'intake-'+width);
    await page.locator('#appointment-department').click();
    check(width+' 27개 진료과 검색 목록',await page.locator('[cmdk-item]').count()===27);
    await page.getByPlaceholder('진료과 검색').fill('없는진료과');
    check(width+' 검색 결과 없음 안내',await page.locator('[data-slot="command-empty"]').isVisible() && await page.locator('[cmdk-item]:visible').count()===0);
    await page.getByPlaceholder('진료과 검색').fill('정형');
    await page.getByPlaceholder('진료과 검색').press('Enter');
    check(width+' 검색·키보드 선택·초점 복귀',/정형외과/.test(await page.locator('#appointment-department').innerText()) && await page.locator('#appointment-department').evaluate(node=>node===document.activeElement));
    await click(page,'continue');
    check(width+' 추가 진료과의 날짜 우선 월별 일정 연결',/정형외과/.test(await page.locator('.availability-context').innerText()) && await page.locator('[data-slot="calendar"]').isVisible() && await page.locator(selector('doctor')).count()===0);
    await click(page,'back');await page.locator('#appointment-department').click();await page.getByPlaceholder('진료과 검색').fill('종양');await page.getByPlaceholder('진료과 검색').press('Enter');
    check(width+' 진료과 변경 뒤 일정 선택으로 진행',await page.locator('#appointment-actions '+selector('continue')).isEnabled() && await page.locator(selector('visit_type')).count()===0);
    await click(page,'continue');await click(page,'consult');await click(page,'visit_type','first');await click(page,'referral','missing');
    check(width+' 의뢰서 안내 왼쪽 색 막대 없음',await page.locator('.appointment-referral').evaluate(node=>parseFloat(getComputedStyle(node).borderLeftWidth)===0));
    check(width+' 미의뢰서 상담 우선',/상담 요청 체험/.test(await page.locator('#appointment-actions').innerText()));
    await click(page,'request');
    check(width+' 상담에서 가짜 확정 불가',await page.locator(selector('reply','confirm')).count()===0 && /예약 상담 접수 시연/.test(await page.locator('.appointment-result-state').innerText()));
    await click(page,'reply','documents');await page.getByRole('button',{name:'의뢰서 준비 다시 확인',exact:true}).click();await click(page,'referral','reported');await click(page,'back');
    await layout(page,width+' 당월 달력');
    check(width+' 월별 기본·당월 빈자리 없음',await page.locator('.rdp-caption_label').innerText()==='2026년 11월' && await page.locator(selector('preferred_date')).count()===30 && await page.locator('.appointment-month-empty').isVisible());
    await click(page,'preferred_date','2026-11-17');
    check(width+' 마감 날짜에 시간 생성 안 함',await page.locator(selector('slot')).count()===0 && await page.locator('#appointment-actions '+selector('consult')).isVisible());
    await click(page,'preferred_date','2026-11-18');
    check(width+' 미공개 날짜에서 요청 차단',await page.locator('#appointment-actions '+selector('consult')).isVisible() && await page.locator('.appointment-empty').isVisible());
    await click(page,'next_match');await click(page,'preferred_date','2026-12-08');await click(page,'slot','hanbit-kim|2026-12-08|14:40');
    check(width+' 하루 선택·의료진 시간·초점 보존',await page.locator('.rdp-caption_label').innerText()==='2026년 12월' && await page.locator(selector('slot','hanbit-kim|2026-12-08|14:40')).evaluate(node=>node===document.activeElement && node.getAttribute('aria-pressed')==='true'));
    await click(page,'preferred_mode','range');
    check(width+' 기간 종료일 전에는 결과 없음',/종료 날짜/.test(await page.locator('#availability-result-title').innerText()) && await page.locator(selector('slot')).count()===0 && await page.locator(selector('review')).isDisabled());
    await click(page,'preferred_date','2026-12-01');
    check(width+' 역순 기간·여러 의료진 비교',await page.locator('.availability-doctor').count()===2 && await page.locator(selector('slot')).count()===4 && /이서연/.test(await page.locator('.availability-results').innerText()) && /김도윤/.test(await page.locator('.availability-results').innerText()));
    await click(page,'preferred_date','2026-12-22');await page.getByRole('button',{name:'다음 달',exact:true}).click();await click(page,'preferred_date','2027-01-12');
    check(width+' 연도 넘는 기간·종료일 포함',await page.locator('.rdp-caption_label').innerText()==='2027년 1월' && await page.locator(selector('slot','hanbit-kim|2027-01-12|09:30')).isVisible() && await page.locator(selector('slot','hanbit-lee|2027-01-05|10:20')).count()===1);
    await page.getByRole('button',{name:'이전 달',exact:true}).click();await click(page,'preferred_date','2026-12-01');await click(page,'preferred_date','2026-12-15');await click(page,'slot','hanbit-kim|2026-12-08|14:40');
    await page.getByRole('button',{name:'다음 달',exact:true}).click();check(width+' 월 탐색만으로 기존 선택·기간을 지우지 않음',await page.locator(selector('slot','hanbit-kim|2026-12-08|14:40')).getAttribute('aria-pressed')==='true');await page.getByRole('button',{name:'이전 달',exact:true}).click();
    await layout(page,width+' 다음달');await page.locator('#conversation-scroll').evaluate(node=>node.scrollTop=0);await shot(page,'calendar-'+width);
    await nav(page,'records',width);
    check(width+' 의뢰서와 판독문 구분',/진료의뢰서/.test(await page.locator('.appointment-records').innerText()) && /기존 준비에서 미확보/.test(await page.locator('.appointment-records').innerText()));
    await click(page,'resume');check(width+' 자료 조회 후 시간 보존',await page.locator(selector('slot','hanbit-kim|2026-12-08|14:40')).getAttribute('aria-pressed')==='true');
    await click(page,'review');await click(page,'request');await click(page,'reply','change');await click(page,'edit');
    check(width+' 병원 일정 변경 시 재확인',await page.locator('.appointment-recheck').isVisible() && await page.locator('#appointment-actions '+selector('show_times')).isVisible());
    await click(page,'slot','hanbit-kim|2026-12-08|14:40');await click(page,'review');await click(page,'request');await click(page,'reply','confirm');
    check(width+' 시연 확정·실제 미예약 구분',/예약 확정 회신 시연/.test(await page.locator('.appointment-result-state').innerText()) && /실제 병원 예약은 만들어지지/.test(await page.locator('.appointment-result-state').innerText()));
    await click(page,'view','support');await layout(page,width+' 왕복 이동');
    check(width+' 재확인 경고 중복·색 막대 없음',await page.locator('.appointment-recheck').count()===1 && await page.locator('.appointment-recheck').evaluate(node=>parseFloat(getComputedStyle(node).borderLeftWidth)===0));
    await click(page,'flight_dates','previous');await page.locator('#flight-inbound').fill('2026-12-10');await select(page,'flight-adults','2명');
    const flightLink=page.locator('.flight-search-action a');
    check(width+' 진료 전날·왕복·인원 항공권 검색 연결',/cju\/gmp\/261207\/261210\//.test(await flightLink.getAttribute('href')) && /adults=2/.test(await flightLink.getAttribute('href')) && await flightLink.getAttribute('target')==='_blank' && await flightLink.getAttribute('referrerpolicy')==='no-referrer');
    await page.locator('#flight-inbound').fill('2026-12-06');check(width+' 역순 항공 날짜는 외부 검색 차단',await page.locator('.flight-search-action a').count()===0 && /오는 날/.test(await page.locator('.booking-error').innerText()));await page.locator('#flight-inbound').fill('2026-12-10');
    await select(page,'trip-jejuMode','택시');check(width+' 일반 택시 예약 안내와 공개 번호 연결',await page.locator('.ground-booking a[href="https://www.kakaomobility.com/service-kakaot/taxi"]').count()===1 && await page.locator('.ground-booking a[href^="tel:"]').count()>0);
    await select(page,'trip-jejuMode','교통약자 차량');check(width+' 제주 실제 접수·자격·당일 조건 표시',await page.locator('.ground-booking a[href="https://www.jejuhappycall.com/reservation?mcode=res01"]').count()===1 && /당일 즉시콜/.test(await page.locator('.ground-booking').innerText()));
    await select(page,'trip-jejuMode','버스');await page.locator('#trip-check-jeju_route').press('Space');
    check(width+' 체크박스는 20px 표시·44px 조작·체크 정렬',await page.locator('#trip-check-jeju_route').evaluate(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node,'::before');return r.width===44&&r.height===44&&s.width==='20px'&&s.height==='20px'&&getComputedStyle(node).padding==='0px'&&Boolean(node.querySelector('svg'));}));
    check(width+' 버스 노선·막차 점검 입력',await page.locator('#trip-check-jeju_route').getAttribute('data-state')==='checked');
    await page.locator('#trip-leg-flight').click();await page.locator('#trip-leg-seoul').click();
    await select(page,'trip-seoulMode','교통약자 차량');check(width+' 서울 차량은 제주와 별도 공식 접수',await page.locator('a[href="https://www.sisul.or.kr/open_content/calltaxi/guidance/internet.jsp"]').count()===1 && await page.locator('a[href="tel:15884388"]').count()===1);
    await page.locator('[data-slot=accordion-content]').filter({has:page.locator('#trip-seoulMode')}).locator('summary').click();
    await page.locator('#trip-hospitalArrival').fill('2026-12-08T15:30');
    check(width+' 진료보다 늦은 도착 경고',/희망 진료 시각/.test(await page.locator('.trip-conflict').innerText()));
    check(width+' 시각 변경 시 이전 체크 무효화',await page.locator('#trip-check-jeju_route').getAttribute('data-state')==='unchecked');
    await page.locator('#trip-leg-return').click();
    check(width+' 숙박·귀가·막차·검사 종료 미정',await page.locator('#trip-check-lodging').isVisible() && /검사 종료 미정/.test(await page.locator('.trip-assessment').innerText()) && /막차/.test(await page.locator('.trip-workspace').innerText()));
    await layout(page,width+' 교통 상세');await page.locator('#conversation-scroll').evaluate(node=>node.scrollTop=0);await shot(page,'travel-'+width);
    const downloadWait=page.waitForEvent('download');await click(page,'save');const download=await downloadWait;
    const downloaded=resolve(directory,`report-${width}.md`);await download.saveAs(downloaded);const report=await readFile(downloaded,'utf8');
    check(width+' 내보내기 예약·교통 충돌·미확인 보존',/2026-12-08 14:40/.test(report) && /실제 예약 미확정/.test(report) && /일정 충돌/.test(report) && /항공편·좌석·운임/.test(report) && /제주 버스정보/.test(report));
    check(width+' 예약·교통 POST 없음',posts===0);proof.appointmentPosts+=posts;
    check(width+' 예약·교통 저장하지 않음',JSON.stringify(storage)===JSON.stringify(await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}}))));
    await click(page,'close');
    check(width+' 기존 DOM·초안·편집 상태 복원',await page.evaluate(()=>window.appointmentInput===document.getElementById('request-input') && window.existingBoard===document.getElementById('preparation-board') && !window.appointmentInput.readOnly && window.appointmentInput.value==='기존 입력 초안을 보존해 주세요.'));
    await page.locator('[data-demo-start]').click();await page.locator('[data-demo-choice="records_ready"]').waitFor();await page.locator('[data-demo-choice="records_ready"]').click();await page.locator('[data-demo-choice="hospitals_accept"]').waitFor();
    const before=await page.locator('#current-task-title').innerText();await page.locator('#open-appointment-demo').click();await nav(page,'records',width);
    check(width+' 제주 체험의 최신 자료 반영',/최근 검사 판독문\s*합성 자료 보유/.test(await page.locator('.appointment-records').innerText()));
    await click(page,'close');check(width+' 제주 체험 단계 복원',await page.locator('#current-task-title').innerText()===before && await page.locator('[data-demo-choice="hospitals_accept"]').isVisible());
    await page.locator('#new-conversation').click();await page.locator('#open-appointment-demo').click();
    check(width+' 새 대화 초기화',await page.locator('#appointment-actions '+selector('continue')).isEnabled() && await page.locator(selector('visit_type')).count()===0);
    await select(page,'appointment-hospital','서울 누리대학교병원 (가상)');
    check(width+' 병원 변경 후 일정 조회 가능',await page.locator('#appointment-actions '+selector('continue')).isEnabled() && await page.locator(selector('referral')).count()===0);
    await click(page,'continue');
    check(width+' 일정 미공개 의료진 상담 경로',await page.locator(selector('next_match')).count()===0 && await page.locator(selector('consult')).isVisible());
    await page.reload();await page.locator('#choose-region-seoul').click();
    check(width+' 새로고침 자동 실행·복원 없음',await page.locator('#appointment-actions '+selector('continue')).isEnabled() && await page.locator(selector('visit_type')).count()===0);await context.close();
  }
  check('브라우저 예외 없음',!proof.errors.length);proof.result='pass';
} finally {
  await browser.close();await writeFile(resolve(directory,'summary.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify({result:proof.result,checks:proof.checks.length,appointmentPosts:proof.appointmentPosts,errors:proof.errors,sourceHash:proof.sourceHash}));
}
