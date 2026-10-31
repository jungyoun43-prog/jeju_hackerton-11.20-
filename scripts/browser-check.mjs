import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFingerprint } from '../orchestration/checks.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
let chromium;
try { ({chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { throw new Error('브라우저 QA에는 선택 도구 Playwright가 필요합니다. README의 브라우저 검사 절차를 참고하세요. 일반 앱 실행에는 필요하지 않습니다.'); }
const base=process.env.BASE_URL || 'http://127.0.0.1:4173';
const workspace=new URL('/workspace.html',base).href;
const shots='.impeccable/review';
await mkdir(resolve(root,shots),{recursive:true});
await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[],checks=[];
const record=(name,ok,detail='')=>checks.push({name,status:ok?'pass':'fail',detail});
const proof={result:'fail',checkedAt:new Date().toISOString(),url:base,sourceHash:await runtimeFingerprint(root),errors,checks,flowCompleted:false,supplementLoop:false,supportFlowCompleted:false,supportRecheck:false,desktop:{width:1440,noOverflow:false,screenshot:shots+'/desktop.png'},mobile:{width:390,noOverflow:false,screenshot:shots+'/mobile.png'},map:{liveTiles:false,automatedPanZoom:false},data:{datasetId:'859',scope:'public-preview',candidateCount:13,supportDatasetIds:['327','254']}};
const watch=page=>page.on('pageerror',error=>errors.push(error.message));
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const primaryInViewport=page=>page.locator('#mission-primary').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth;});
async function initialMap(page) {
 await page.waitForSelector('.leaflet-container');
 try {await page.waitForFunction(()=>document.querySelectorAll('.leaflet-tile-loaded').length>0,{},{timeout:5000});return true;}
 catch {await page.waitForTimeout(1800);return false;}
}
async function captureAtTop(page,name) {
 await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
 await page.waitForFunction(()=>window.scrollY===0);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:resolve(root,shots+'/'+name+'.png'),fullPage:true});
}
async function supportScenario(page, selectedName) {
 const status=kind=>page.locator('#support-status-'+kind).getAttribute('data-support-state');
 const respond=async(kind,outcome)=>{await page.locator('#support-outcome-'+kind).selectOption(outcome);await page.locator(`form[data-support-response-form=${kind}] button[type=submit]`).click();};
 await page.locator('#support-appointment-time').fill('10:00');
 await page.locator('#support-requirements-form button[type=submit]').click();
 await page.locator('[data-support-select][data-support-kind=taxi]').first().click();
 record('지역 콜택시 선택과 초안 전 응답 차단',await status('taxi')==='selected' && await page.locator('form[data-support-response-form=taxi] button[type=submit]').isDisabled());
 await page.locator('[data-support-prepare=taxi]').click();
 const draft=await page.locator('#support-inquiry-taxi').inputValue();
 record('지역·방문기관·시간으로 최소 문의 초안 생성',draft.includes('애월콜') && draft.includes(selectedName) && draft.includes('10:00') && !draft.includes('김정희') && !draft.includes('암 치료'));
 await respond('taxi','unreachable');
 record('택시 불통은 배차 완료가 아닌 재문의 상태',await status('taxi')==='unreachable_demo' && (await page.locator('.support-open-items').textContent()).includes('불통'));
 await page.locator('[data-support-prepare=taxi]').click();await respond('taxi','available');
 record('택시 가능 응답은 시연 상태로 기록',await status('taxi')==='available_demo' && await page.locator('form[data-support-response-form=taxi] button[type=submit]').isDisabled());
 await page.locator('[data-support-select][data-support-kind=companion]').first().click();
 await page.locator('[data-support-prepare=companion]').click();
 record('공식 병원동행 서비스와 자격·범위 질문',(await page.locator('#support-inquiry-companion').inputValue()).includes('아름동행') && (await page.locator('#support-inquiry-companion').inputValue()).includes('자격'));
 await respond('companion','unavailable');record('동행 불가 시 준비 공백 유지',await status('companion')==='unavailable_demo');
 await page.locator('[data-support-prepare=companion]').click();await respond('companion','available');
 proof.supportFlowCompleted=await status('taxi')==='available_demo' && await status('companion')==='available_demo';
 record('차량·동행 합성 응답을 같은 방문에 연결',proof.supportFlowCompleted);
 await page.locator('.nav-item[data-nav=overview]').click();
 record('메인 요약에 선택한 차량·동행 문의처 반영',(await page.locator('.readiness-strip').textContent()).includes('애월콜') && (await page.locator('.readiness-strip').textContent()).includes('아름동행'));
 await page.locator('.nav-item[data-nav=plan]').click();
 await page.locator('#patient-date').fill('2026-11-13');await page.locator('#patient-form button').click();
 proof.supportRecheck=await status('taxi')==='needs_recheck' && await status('companion')==='needs_recheck';
 record('방문일 변경은 두 지원의 과거 응답 무효화',proof.supportRecheck);
 await page.locator('#support-wheelchair').check();await page.locator('#support-requirements-form button[type=submit]').click();
 const options=page.locator('#visit-support-taxi details.support-options');
 if(await options.getAttribute('open')===null)await options.locator(':scope > summary').click();
 record('휠체어 조건은 특별교통 문의 경로 우선',await page.locator('[data-support-select][data-support-kind=taxi]').first().getAttribute('data-support-select')==='jeju-accessible-transport');
 await page.locator('[data-support-select=jeju-accessible-transport]').click();await page.locator('[data-support-prepare=taxi]').click();
 await respond('taxi','available');
 record('가능 응답만으로 휠체어·회원자격 미확인 제거하지 않음',(await page.locator('.support-open-items').textContent()).includes('휠체어') && (await page.locator('.support-open-items').textContent()).includes('회원등록'));
 await page.locator('[data-support-prepare=taxi]').click();await page.locator('#support-wheelchair-confirmed').check();await page.locator('#support-eligibility-confirmed').check();await respond('taxi','available');
 record('조건 확인도 실제 배차가 아닌 합성 응답으로 보존',await status('taxi')==='available_demo' && (await page.locator('#visit-support-taxi .support-response').textContent()).includes('합성'));
 await captureAtTop(page,'support-desktop');
}
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});watch(page);
 await page.goto(workspace,{waitUntil:'networkidle'});
 record('사례 제목과 다음 행동',((await page.locator('#service-role').textContent()).includes('김정희')) && await primaryInViewport(page));
 record('병원·자료·택시·동행 상태가 첫 화면에 표시',await page.locator('.readiness-item').count()===4 && await page.locator('.readiness-strip').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight));
 record('생성한 이미지 로고 로드',await page.locator('.brand img').evaluate(e=>e.complete && e.naturalWidth>0 && e.src.endsWith('/assets/hondi-logo-v1.png')));
 record('제목용 한국어 폰트 로드',await page.evaluate(async()=>{await document.fonts.ready;return [...document.fonts].some(font=>font.family.replaceAll('"','')==='MaruBuri' && font.status==='loaded');}));
 proof.desktop.noOverflow=await overflow(page);record('PC 가로 넘침 없음',proof.desktop.noOverflow);
 record('의사·가족 일러스트 제거',await page.locator('.hero,.care-scene,.case-visual').count()===0);
 proof.map.liveTiles=await initialMap(page);
 record('실제 지도 UI와 가상 두 지점',await page.locator('.leaflet-container').count()===1 && await page.locator('.care-marker').count()===2);
 await page.screenshot({path:resolve(root,shots+'/desktop-viewport.png'),fullPage:false});
 await page.screenshot({path:resolve(root,proof.desktop.screenshot),fullPage:true});
 // 최초 보이는 영역만 타일을 조회한다. 반복 기능 검사에서 타일을 재수집하지 않는다.
 await page.route('https://tile.openstreetmap.org/**',route=>route.abort());
 await page.locator('.nav-item[data-nav=data]').click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-select-hospital]').length===13);
 record('허브859 공개 등록 후보 13곳',await page.locator('.hospital-candidate').count()===13 && (await page.locator('.data-profile').textContent()).includes('20행'));
 await page.locator('#hospital-department').selectOption('내과');await page.locator('#hospital-area').fill('제주시');await page.locator('#hospital-filter button').click();
 record('내과 등록 진료과 정확한 6곳 조회',await page.locator('.hospital-candidate').count()===6);
 const firstCandidate=page.locator('.hospital-candidate').first();
 const selectedName=await firstCandidate.locator('h3').textContent();
 const mapUrl=new URL(await firstCandidate.locator('a.hospital-map-link').getAttribute('href'));
 record('실제 등록 기관의 주소 지도 링크',mapUrl.hostname==='www.google.com' && mapUrl.searchParams.get('query')?.includes(selectedName) && mapUrl.searchParams.get('query')?.includes('제주'));
 await page.screenshot({path:resolve(root,shots+'/data-desktop.png'),fullPage:true});
 await firstCandidate.locator('[data-select-hospital]').click();
 record('선택 기관을 제주 문의로 연결',(await page.locator('#inquiry-jeju').textContent()).includes(selectedName));
 await page.locator('.nav-item[data-nav=documents]').click();
 record('준비 전 접수 차단',await page.locator('[data-submit-packet]').isDisabled());
 await page.locator('.nav-item[data-nav=calls]').click();
 for(const target of ['mainland','jeju']) {
  await page.locator(`[data-call-form=${target}] button`).click();
  await page.waitForFunction(t=>document.querySelector(`#inquiry-${t} .badge`)?.textContent.includes('절차 확인'),target,{timeout:5000});
 }
 record('양쪽 병원 절차 확인 재현',await page.locator('.inquiry .badge.green').count()===2);
 await page.locator('.nav-item[data-nav=documents]').click();
 await page.locator('[data-example-document=report]').click();
 await page.locator('[data-example-document=exam]').click();
 record('자료만 준비하면 공유 전 접수 차단',await page.locator('[data-submit-packet]').isDisabled());
 await page.locator('[data-permission=share]').check();
 record('공유 허용 후 접수 가능',await page.locator('[data-submit-packet]').isEnabled());
 await page.locator('[data-submit-packet]').click();
 record('접수 이후 의료진 회신 재현 가능',await page.locator('#review-form button').isEnabled());
 await page.locator('#review-outcome').selectOption('needs_information');await page.locator('#review-form button').click();
 proof.supplementLoop=await page.locator('[data-example-document=report]').count()===1 && await page.locator('[data-submit-packet]').isDisabled();
 record('추가자료 요청은 보완 단계로 복귀',proof.supplementLoop);
 await page.locator('[data-example-document=report]').click();await page.locator('[data-submit-packet]').click();
 await page.locator('#review-outcome').selectOption('local_followup');await page.locator('#review-form button').click();
 proof.flowCompleted=(await page.locator('.review-controls .badge').textContent()).includes('합성 회신');
 record('보완 후 재접수와 합성 회신 완료',proof.flowCompleted);
 record('완료 뒤 중복 회신 재현 차단',await page.locator('#review-form button').isDisabled() && await page.locator('#review-outcome').isDisabled());
 await page.locator('.nav-item[data-nav=plan]').click();
 await page.waitForSelector('.leaflet-container');
 await page.evaluate(()=>window.__qaMap=document.getElementById('care-map'));
 await page.locator('#plan-visits').fill('3');await page.locator('#plan-caregiverAvailable').fill('1');
 await page.locator('#cost-form button').click();
 record('동행 미배정 2회 재계산',(await page.locator('.cost-result').textContent()).includes('2회'));
 record('갱신 후 지도 인스턴스 보존',await page.evaluate(()=>window.__qaMap===document.getElementById('care-map')));
 record('미확인 비용 유지',(await page.locator('.unknown-costs').textContent()).includes('미확인'));
 await supportScenario(page,selectedName);
 record('모든 텍스트 입력에 레이블',await page.evaluate(()=>[...document.querySelectorAll('input:not([type=checkbox]),textarea,select')].every(e=>e.labels?.length)));
 const download=page.waitForEvent('download');await page.locator('.topbar [data-report]').click();
 const reportDownload=await download;
 const report=await readFile(await reportDownload.path(),'utf8');
 record('출처 보고서 내려받기',reportDownload.suggestedFilename().includes('보고서') && report.includes(selectedName) && report.includes('859') && report.includes('시연') && report.includes('이번 방문의 이동·동행 문의') && report.includes('327'));
 await page.locator('.nav-item[data-nav=data]').click();
 await page.locator('.hospital-import-more summary').click();
 const importCsv='사업장명,도로명주소,진료과목,영업상태명,데이터갱신일시,데이터수집일시\n가상 가져오기 의원,제주특별자치도 제주시 가상로 1,가정의학과,정상,2026-01-01,2026-01-02';
 await page.locator('#hospital-file').setInputFiles({name:'synthetic-hospitals.csv',mimeType:'text/csv',buffer:Buffer.from(importCsv)});
 await page.waitForFunction(()=>document.querySelectorAll('[data-select-hospital]').length===1);
 record('사용자 CSV를 공개 미리보기와 구분',(await page.locator('.hospital-candidate h3').textContent())==='가상 가져오기 의원' && (await page.locator('.data-profile').textContent()).includes('사용자 제공'));
 await page.locator('.topbar [data-reset]').click();
 await page.locator('.nav-item[data-nav=data]').click();
 record('리셋하면 공개 후보 13곳 복원',await page.locator('[data-select-hospital]').count()===13);
 const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});watch(mobile);
 await mobile.goto(workspace,{waitUntil:'networkidle'});
 const mobileTiles=await initialMap(mobile);proof.map.mobileLiveTiles=mobileTiles;
 proof.mobile.noOverflow=await overflow(mobile);record('모바일 가로 넘침 없음',proof.mobile.noOverflow);
 record('모바일 첫 화면 주 행동',await primaryInViewport(mobile));
 await mobile.screenshot({path:resolve(root,shots+'/mobile-viewport.png'),fullPage:false});
 await mobile.screenshot({path:resolve(root,proof.mobile.screenshot),fullPage:true});
 await mobile.route('https://tile.openstreetmap.org/**',route=>route.abort());
 for(const view of ['documents','calls','plan','data']) {await mobile.locator(`.nav-item[data-nav=${view}]`).click();record(`모바일 ${view} 넘침 없음`,await overflow(mobile));}
 await mobile.screenshot({path:resolve(root,shots+'/data-mobile.png'),fullPage:true});
 const longestHospital=await mobile.locator('.hospital-candidate').evaluateAll(elements=>elements.map(e=>({name:e.querySelector('h3').textContent,id:e.querySelector('[data-select-hospital]').dataset.selectHospital})).sort((a,b)=>b.name.length-a.name.length)[0]);
 await mobile.locator(`[data-select-hospital="${longestHospital.id}"]`).click();
 record('긴 실제 기관명 모바일 문의 넘침 없음',(await mobile.locator('#inquiry-jeju').textContent()).includes(longestHospital.name) && await overflow(mobile),longestHospital.name);
 await mobile.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
 await mobile.waitForFunction(()=>window.scrollY===0);
 await mobile.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await mobile.screenshot({path:resolve(root,shots+'/calls-mobile.png'),fullPage:true});
 await mobile.locator('.nav-item[data-nav=plan]').click();
 await mobile.locator('[data-support-select][data-support-kind=taxi]').first().click();await mobile.locator('[data-support-prepare=taxi]').click();
 record('모바일 이동 문의 초안과 지원 패널 넘침 없음',await mobile.locator('#support-inquiry-taxi').isVisible() && await overflow(mobile));
 await captureAtTop(mobile,'support-mobile');
 record('실행 JS 오류 없음',errors.length===0,errors.join('; '));
 if(checks.every(check=>check.status==='pass') && errors.length===0) proof.result='pass';
} catch(error) {errors.push(error.message);record('브라우저 시나리오 완료',false,error.message);}
finally {
 await browser.close();
 await writeFile(resolve(root,'orchestration/runs/browser.json'),JSON.stringify(proof,null,2)+'\n');
 for(const check of checks) console.log(`${check.status==='pass'?'PASS':'FAIL'} ${check.name}${check.detail?' · '+check.detail:''}`);
 console.log(`기록: orchestration/runs/browser.json · ${checks.filter(c=>c.status==='pass').length}/${checks.length}`);
 if(proof.result!=='pass') process.exitCode=1;
}
