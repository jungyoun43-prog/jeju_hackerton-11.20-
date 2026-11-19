import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
const base=process.env.BASE_URL||'http://127.0.0.1:4189',out=resolve('output/reservations-qa/browser');
await mkdir(out,{recursive:true});assert.equal((await(await fetch(base+'/api/agent/capabilities')).json()).llm,false);
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const report={sourceHash:await runtimeFingerprint(process.cwd()),checks:[],views:[],errors:[],posts:0};
const check=(name,pass)=>report.checks.push({name,pass:Boolean(pass)});
async function setup(viewport,motion='reduce'){
 const c=await browser.newContext({viewport,locale:'ko-KR',reducedMotion:motion});
 await c.route('**/*',r=>{if(new URL(r.request().url()).origin!==new URL(base).origin)return r.abort();if(r.request().method()==='POST'){report.posts++;return r.abort();}return r.continue();});
 const p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));p.setDefaultTimeout(12000);await p.goto(base);await p.locator('#choose-region-jeju').waitFor();await p.evaluate(()=>document.fonts.ready);
 return{c,p};
}
async function finish(p){await p.locator('#choose-region-jeju').click();await p.locator('#entry-mode-text').click();await p.locator('#request-input').fill('제주우리병원 정형외과 12월 3일 오후에 가고 싶어요. 애월읍에서 휠체어와 동행이 필요해요.');await p.locator('#send-request').click();await p.locator('.entry-review-footer .appointment-primary').click();await p.locator('[data-book-primary]').click();await p.locator('[role=dialog]').waitFor();}
async function inspect(p,name){
 const v=await p.evaluate(()=>{const el=document.querySelector('.coordination-result-dialog')||document.querySelector('.reservations-page'),r=el.getBoundingClientRect(),footer=el.querySelector('.result-window-footer'),f=footer?.getBoundingClientRect();return{bounds:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},footerBottom:f?.bottom,viewport:[innerWidth,innerHeight],horizontal:document.documentElement.scrollWidth-innerWidth,globalVisible:document.getElementById('open-my-reservations').checkVisibility()};});report.views.push({name,...v});
 check(name+' 가로 넘침 없음',v.horizontal<=1&&v.bounds.x>=0&&v.bounds.right<=v.viewport[0]+1);if(v.footerBottom)check(name+' 완료 버튼이 화면 안',v.footerBottom<=v.viewport[1]+1);await p.screenshot({path:resolve(out,name+'.png')});
}
try{
 for(const [width,height] of [[1280,720],[1920,1080],[390,844],[320,600]]){
  const {c,p}=await setup({width,height});
  await p.locator('#open-my-reservations').click();check(width+' 처음 현황은 빈 상태',await p.locator('.reservations-empty').isVisible());
  await p.getByRole('button',{name:'진료 준비 시작',exact:true}).click();await finish(p);await inspect(p,'result-'+width);
  check(width+' 완료창의 두 가지 목적지',await p.locator('[role=dialog] [data-book-action=home]').count()===1&&await p.locator('[role=dialog] [data-book-action=reservations]').count()===1);
  await p.locator('[role=dialog] [data-book-action=home]').click();await p.locator('[role=dialog]').waitFor({state:'hidden'});await p.locator('#choose-region-jeju').waitFor();
  check(width+' 홈 이동 후 제목 초점',await p.evaluate(()=>document.activeElement.id==='care-region-title'));
  await p.locator('#open-my-reservations').click();await p.locator('.reservation-visit').waitFor();await inspect(p,'overview-'+width);
  check(width+' 홈 왕복 뒤 결과 보존',await p.locator('.reservation-status-list [data-result=confirmed]').count()===3);
  check(width+' 공개기관과 가상회신 구분',(await p.locator('.reservation-selected').textContent()).includes('제주우리병원')&&(await p.locator('.reservation-status-list').textContent()).includes('가상 제주 병원'));
  await p.getByRole('button',{name:'예약 결과 보기',exact:true}).click();await p.locator('[role=dialog]').waitFor();
  check(width+' 결과 다시 열어도 완료3건',await p.locator('[role=dialog] [data-result=confirmed]').count()===3);
  const download=p.waitForEvent('download');
  await p.locator('[role=dialog] [data-book-action=coordination_save]').click();
  const saved=resolve(out,'reservation-'+width+'.md');
  await(await download).saveAs(saved);
  const markdown=await readFile(saved,'utf8');
  check(width+' 저장한 결과에 선택 병원과 시연 확정 3건 포함',markdown.includes('제주우리병원')&&markdown.match(/예약 확정 \(시연\)/g)?.length===3);
  await p.locator('[role=dialog] [data-book-action=reservations]').click();await p.locator('[role=dialog]').waitFor({state:'hidden'});check(width+' 결과에서 현황 직접 연결',await p.locator('.reservations-page').isVisible());
  if(width===1280){
   await p.getByRole('button',{name:'처음으로 돌아가기',exact:true}).click();await p.locator('#choose-region-seoul').click();await p.locator('#entry-mode-manual').click();await p.locator('#appointment-title').waitFor();await p.locator('#open-my-reservations').click();
   check('두 지역의 현재 준비를 함께 표시',await p.locator('.reservation-visit').count()===2);
   check('준비 중 내륙은 완료로 집계하지 않음',await p.locator('[data-reservation-region=seoul] [data-result=confirmed]').count()===0&&(await p.locator('.reservations-summary').textContent()).includes('3건'));
  }
  await c.close();
 }
 {
  const {c,p}=await setup({width:1440,height:900},'no-preference');
  await p.locator('#choose-region-jeju').click();
  await p.locator('#entry-mode-manual').click();
  await p.setViewportSize({width:1100,height:720});
  await p.locator('#public-hospital-search').fill('제주우리병원');
  await p.getByRole('button',{name:'제주우리병원 선택',exact:true}).click();

  const openReservations=p.getByRole('button',{name:'내 예약 현황 보기',exact:true});
  await openReservations.focus();
  await p.keyboard.press('Enter');
  const heading=p.getByRole('heading',{name:'내 예약 현황',exact:true});
  await heading.waitFor();
  check('키보드로 현황 열면 제목에 초점',await heading.evaluate(el=>el===document.activeElement));
  const visit=p.locator('[data-reservation-region=jeju]');
  check('선택한 병원이 준비 중인 제주 일정에 표시',(await visit.locator('.reservation-selected').innerText()).includes('제주우리병원'));
  await visit.getByRole('button',{name:'준비 이어보기',exact:true}).click();
  check('이어보기에서 선택한 병원 유지',(await p.locator('.public-chosen-hospital').innerText()).includes('제주우리병원'));
  await openReservations.click();
  await heading.waitFor();
  check('현황 재진입해도 일정은 하나이며 회신은 대기',await p.locator('.reservation-visit').count()===1&&await visit.locator('[data-result=confirmed]').count()===0);
  await c.close();
 }
 check('전화·모델 POST 없음',report.posts===0);check('브라우저 예외 없음',report.errors.length===0);
}catch(e){report.errors.push(e.stack);check('전체 흐름 완료',false);}finally{await browser.close();report.passed=report.checks.filter(x=>x.pass).length;report.failed=report.checks.filter(x=>!x.pass);await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,errors:report.errors,posts:report.posts},null,2));if(report.failed.length)process.exitCode=1;}
