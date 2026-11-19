import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
const base=process.env.BASE_URL||'http://127.0.0.1:4189',out=resolve('output/reservation-edit-qa');
await mkdir(out,{recursive:true});assert.equal((await(await fetch(base+'/api/agent/capabilities')).json()).llm,false);
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const report={sourceHash:await runtimeFingerprint(process.cwd()),checks:[],views:[],errors:[],posts:0};
const check=(name,pass)=>report.checks.push({name,pass:Boolean(pass)});
async function setup(width,height){
 const c=await browser.newContext({viewport:{width,height},locale:'ko-KR',reducedMotion:'reduce'});
 await c.route('**/*',r=>{if(new URL(r.request().url()).origin!==new URL(base).origin)return r.abort();if(r.request().method()==='POST'){report.posts++;return r.abort();}return r.continue();});
 const p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));p.setDefaultTimeout(10000);await p.goto(base);await p.locator('#choose-region-jeju').waitFor();return{c,p};
}
async function complete(p){await p.locator('#choose-region-jeju').click();await p.locator('#entry-mode-text').click();await p.locator('#request-input').fill('제주우리병원 정형외과 12월 3일 오후에 가고 싶어요. 애월읍에서 휠체어와 동행이 필요해요.');await p.locator('#send-request').click();await p.locator('.entry-review-footer .appointment-primary').click();await p.locator('[data-book-primary]').click();await p.locator('[role=dialog]').waitFor();}
async function edit(p){await p.getByRole('button',{name:'제주 진료 예약 수정',exact:true}).click();await p.locator('.reservation-edit-workspace').waitFor();}
const section=(p,name)=>p.locator(`.reservation-edit-tabs [data-book-value=${name}]`).click();
const cancel=p=>p.locator('.appointment-topline [data-book-action=reservation_edit_cancel]').click();
async function capture(p,name){
 const v=await p.evaluate(()=>{const footer=document.querySelector('.reservation-edit-footer'),r=footer?.getBoundingClientRect();return{width:innerWidth,height:innerHeight,horizontal:document.documentElement.scrollWidth-innerWidth,footerBottom:r?.bottom,buttons:footer?[...footer.querySelectorAll('button')].map(n=>({x:n.getBoundingClientRect().x,right:n.getBoundingClientRect().right,clipped:n.scrollWidth>n.clientWidth+1})):[]};});report.views.push({name,...v});check(name+' 화면 안의 수정 행동',v.horizontal<=1&&(!v.footerBottom||v.footerBottom<=v.height+1)&&v.buttons.every(b=>b.x>=0&&b.right<=v.width+1&&!b.clipped));await p.screenshot({path:resolve(out,name+'.png')});
}
try{
 assert.equal((await(await fetch(base+'/deployment.json')).json()).sourceHash,report.sourceHash,'검사 서버와 작업 트리의 빌드가 다릅니다.');
 for(const [width,height] of [[1280,720],[390,844],[320,600]]){
  const {c,p}=await setup(width,height);await complete(p);
  check(width+' 결과창에서 수정 가능',await p.locator('[role=dialog] [data-book-action=reservation_edit]').isVisible());
  await p.locator('[role=dialog] [data-book-action=reservation_edit]').click();await p.locator('[role=dialog]').waitFor({state:'hidden'});await p.locator('.reservation-edit-workspace').waitFor();
  check(width+' 기존 일정이 채워짐',await p.locator('[data-book-action=public_time][data-book-value=afternoon]').getAttribute('aria-pressed')==='true');
  check(width+' 아무 수정 없이 적용하지 않음',await p.locator('[data-book-primary]').isDisabled());
  await capture(p,'date-editor-'+width);
  await p.locator('[data-book-action=public_time][data-book-value=morning]').click();await p.locator('#open-my-reservations').click();
  check(width+' 다른 화면으로 나가면 원래 예약 유지',await p.locator('.reservation-status-list [data-result=confirmed]').count()===3&&(await p.locator('.reservation-visit-header').textContent()).includes('14:00'));
  await edit(p);await section(p,'hospital');await p.locator('#public-hospital-search').fill('제주우리병원');check(width+' 병원 검색 재사용',await p.locator('.public-chosen-hospital').isVisible());
  await section(p,'support');check(width+' 기존 차량 출발 시각이 채워짐',await p.locator('#coordination-pickup-time').inputValue()==='13:00');
  await p.locator('#coordination-pickup-time').fill('16:00');check(width+' 진료보다 늦은 차량 시각은 수정 안내',await p.locator('[data-book-primary]').getAttribute('data-book-action')==='coordination_fix_issue'&&await p.locator('[data-book-action=reservation_edit_review]').count()===0);
  await p.locator('#coordination-pickup-time').fill('12:20');await cancel(p);check(width+' 취소 후 출발 시각 보존',(await p.locator('.reservation-status-list').textContent()).includes('13:00 출발'));
  await edit(p);await section(p,'support');await p.locator('#coordination-pickup-time').fill('12:20');await capture(p,'support-editor-'+width);
  await p.locator('[data-book-action=reservation_edit_review]').click();await p.locator('.reservation-edit-review').waitFor();check(width+' 차량만 변경 비교',await p.locator('[data-edit-change]').count()===1&&(await p.locator('.reservation-edit-review').textContent()).includes('기존 2건'));
  check(width+' 적용 전후 시각 표시',(await p.locator('.reservation-edit-review').textContent()).includes('13:00')&&(await p.locator('.reservation-edit-review').textContent()).includes('12:20'));
  check(width+' 변경 전후가 스크롤 전에 보임',await p.evaluate(()=>{const viewport=document.getElementById('conversation-scroll').getBoundingClientRect(),row=document.querySelector('[data-edit-change] dl').getBoundingClientRect();return row.top>=viewport.top&&row.bottom<=viewport.bottom;}));await capture(p,'review-'+width);
  await p.locator('[data-book-action=reservation_edit_apply]').click();check(width+' 재조율 시작 때 병원·동행 완료 유지',await p.locator('.coordination-results [data-result=confirmed]').count()===2);await p.locator('[role=dialog]').waitFor();
  check(width+' 변경 회신 도착 후 완료3건',await p.locator('[role=dialog] [data-result=confirmed]').count()===3&&(await p.locator('[role=dialog]').textContent()).includes('12:20 출발'));
  await p.locator('[role=dialog] [data-book-action=reservations]').click();await p.locator('[role=dialog]').waitFor({state:'hidden'});await edit(p);
  await p.locator('[data-book-action=public_time][data-book-value=morning]').click();
  await p.locator('[data-book-primary][data-book-action=coordination_fix_issue]').click();
  check(width+' 날짜 화면에서 충돌한 출발 시각으로 바로 이동',await p.locator('#coordination-pickup-time').evaluate(el=>el===document.activeElement&&el.value==='12:20'));
  await p.locator('#coordination-pickup-time').fill('08:30');await p.locator('[data-book-action=reservation_edit_review]').click();
  check(width+' 진료 시각 변경은 연결된 세 예약 비교',await p.locator('[data-edit-change]').count()===3);await p.locator('[data-book-action=reservation_edit_apply]').click();check(width+' 시각 변경 후 오래된 완료 표시 제거',await p.locator('.coordination-results [data-result=confirmed]').count()===0);await p.locator('[role=dialog]').waitFor();
  check(width+' 새 진료·차량 시간으로 완료',(await p.locator('[role=dialog]').textContent()).includes('10:00')&&(await p.locator('[role=dialog]').textContent()).includes('08:30 출발'));
  await p.locator('[role=dialog] [data-book-action=reservations]').click();await p.locator('[role=dialog]').waitFor({state:'hidden'});await capture(p,'edited-overview-'+width);await c.close();
 }
 check('실전화·모델 POST 없음',report.posts===0);check('브라우저 예외 없음',report.errors.length===0);
}catch(e){report.errors.push(e.stack);check('전체 수정 흐름 완료',false);}finally{await browser.close();report.passed=report.checks.filter(x=>x.pass).length;report.failed=report.checks.filter(x=>!x.pass);await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,errors:report.errors,posts:report.posts},null,2));if(report.failed.length)process.exitCode=1;}
