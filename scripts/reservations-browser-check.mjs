import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
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
  const download=p.waitForEvent('download');await p.locator('[role=dialog] [data-book-action=coordination_save]').click();await(await download).saveAs(resolve(out,'reservation-'+width+'.md'));
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
  check('최초 진입은 장면 전환 없음',await p.evaluate(()=>!document.querySelector('.care-scene-guide')&&!document.querySelector('.conversation-layout').getAnimations().length));
  await p.evaluate(()=>{const original=Element.prototype.animate;window.__sceneRecords=[];window.__slowMotion=true;Element.prototype.animate=function(frames,options){if(this.matches('.conversation-layout'))window.__sceneRecords.push({rect:this.getBoundingClientRect().toJSON(),frames,duration:options.duration});const a=original.call(this,frames,options);if(window.__slowMotion)a.playbackRate=.15;return a;};});
  await p.locator('#choose-region-jeju').click();await p.waitForFunction(()=>window.__sceneRecords.length===1);
  let scene=await p.evaluate(()=>window.__sceneRecords[0]);check('단색 막 대신 실제 작업면이 펼쳐짐',scene.duration===900&&scene.frames[0].transform.includes('rotateY(-5deg)')&&await p.locator('.care-scene-curtain').count()===0);
  check('내용 높이와 무관하게 전체 작업 영역 전환',scene.rect.height>=820);
  await p.evaluate(()=>{window.__slowMotion=false;for(const a of document.getAnimations())if(!a.animationName){a.pause();a.currentTime=280;}});await p.screenshot({path:resolve(out,'scene-live-mid.png')});
  check('전환 중 다음 버튼이 가려지지 않음',await p.locator('#entry-mode-text').evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  await p.locator('#entry-mode-text').click();await p.locator('#request-input').waitFor();await p.locator('.request-example').first().click();check('전환 중에도 예시 입력 가능',(await p.locator('#request-input').inputValue()).includes('제주우리병원'));
  await p.getByRole('button',{name:'입력 방식 바꾸기',exact:true}).click();await p.locator('#entry-mode-manual').click();await p.locator('#public-hospital-search').waitFor();check('연속 선택 후 마지막 화면 유지',await p.locator('#public-hospital-search').isVisible());
  await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});await p.waitForFunction(()=>!document.querySelector('.care-scene-guide'));
  check('취소 시 장식과 작업면 효과 정리',await p.evaluate(()=>!document.querySelector('.care-scene-guide')&&!document.querySelector('.conversation-layout').getAnimations().length));
  await p.locator('#open-my-reservations').focus();await p.keyboard.press('Enter');check('키보드 이동은 즉시 표시',await p.locator('.reservations-page').isVisible());check('키보드 이동은 공간 효과 생략',await p.evaluate(()=>!document.querySelector('.conversation-layout').getAnimations().length));
  await p.getByRole('button',{name:'처음으로 돌아가기',exact:true}).click();await p.locator('#choose-region-jeju').waitFor();await p.emulateMedia({reducedMotion:'reduce'});await p.locator('#choose-region-jeju').click();check('움직임 줄이기는 공간 효과 생략',await p.evaluate(()=>!document.querySelector('.conversation-layout').getAnimations().length&&!document.querySelector('.care-scene-guide')));
  await c.close();
 }
 {
  const {c,p}=await setup({width:1280,height:720},'no-preference');await p.locator('#choose-region-jeju').click();await p.setViewportSize({width:1100,height:720});check('크기를 바꾸면 진행 중 효과 정리',await p.evaluate(()=>!document.querySelector('.care-scene-guide')));await p.locator('#entry-mode-text').click();await p.locator('#request-input').fill('12월 3일 오후에 가고 싶어요.');check('화면 변경 후 텍스트 입력 가능',(await p.locator('#request-input').inputValue()).includes('12월'));await c.close();
 }
 check('전화·모델 POST 없음',report.posts===0);check('브라우저 예외 없음',report.errors.length===0);
}catch(e){report.errors.push(e.stack);check('전체 흐름 완료',false);}finally{await browser.close();report.passed=report.checks.filter(x=>x.pass).length;report.failed=report.checks.filter(x=>!x.pass);await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,errors:report.errors,posts:report.posts},null,2));if(report.failed.length)process.exitCode=1;}
