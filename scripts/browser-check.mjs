import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFingerprint } from '../orchestration/checks.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
let chromium;
try { ({chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { throw new Error('브라우저 QA에는 선택 도구 Playwright가 필요합니다. README의 브라우저 검사 절차를 참고하세요. 일반 앱 실행에는 필요하지 않습니다.'); }
const base=process.env.BASE_URL || 'http://127.0.0.1:4173';
const shots='.impeccable/review';
await mkdir(resolve(root,shots),{recursive:true});
await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[],checks=[];
const record=(name,ok,detail='')=>checks.push({name,status:ok?'pass':'fail',detail});
const proof={result:'fail',checkedAt:new Date().toISOString(),url:base,sourceHash:await runtimeFingerprint(root),errors,checks,flowCompleted:false,supplementLoop:false,desktop:{width:1440,noOverflow:false,screenshot:shots+'/desktop.png'},mobile:{width:390,noOverflow:false,screenshot:shots+'/mobile.png'},map:{liveTiles:false,automatedPanZoom:false}};
const watch=page=>page.on('pageerror',error=>errors.push(error.message));
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
async function initialMap(page) {
 await page.waitForSelector('.leaflet-container');
 try {await page.waitForFunction(()=>document.querySelectorAll('.leaflet-tile-loaded').length>0,{},{timeout:5000});return true;}
 catch {await page.waitForTimeout(1800);return false;}
}
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});watch(page);
 await page.goto(base,{waitUntil:'networkidle'});
 record('초기 다음 할 일',await page.locator('#task-title').textContent()==='지금 할 일');
 proof.desktop.noOverflow=await overflow(page);record('PC 가로 넘침 없음',proof.desktop.noOverflow);
 record('배너 이미지 로드',await page.evaluate(async()=>{const image=new Image();image.src=getComputedStyle(document.querySelector('.hero')).backgroundImage.match(/url\(["']?(.*?)["']?\)/)[1];await image.decode();return image.naturalWidth>0;}));
 proof.map.liveTiles=await initialMap(page);
 record('실제 지도 UI와 가상 두 지점',await page.locator('.leaflet-container').count()===1 && await page.locator('.care-marker').count()===2);
 await page.screenshot({path:resolve(root,proof.desktop.screenshot),fullPage:true});
 // 최초 보이는 영역만 타일을 조회한다. 반복 기능 검사에서 타일을 재수집하지 않는다.
 await page.route('https://tile.openstreetmap.org/**',route=>route.abort());
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
 record('모든 텍스트 입력에 레이블',await page.evaluate(()=>[...document.querySelectorAll('input:not([type=checkbox]),textarea,select')].every(e=>e.labels?.length)));
 const download=page.waitForEvent('download');await page.locator('.topbar [data-report]').click();
 record('출처 보고서 내려받기',(await download).suggestedFilename().includes('보고서'));
 const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});watch(mobile);
 await mobile.goto(base,{waitUntil:'networkidle'});
 const mobileTiles=await initialMap(mobile);proof.map.mobileLiveTiles=mobileTiles;
 proof.mobile.noOverflow=await overflow(mobile);record('모바일 가로 넘침 없음',proof.mobile.noOverflow);
 await mobile.screenshot({path:resolve(root,proof.mobile.screenshot),fullPage:true});
 await mobile.route('https://tile.openstreetmap.org/**',route=>route.abort());
 for(const view of ['documents','calls','plan']) {await mobile.locator(`.nav-item[data-nav=${view}]`).click();record(`모바일 ${view} 넘침 없음`,await overflow(mobile));}
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
