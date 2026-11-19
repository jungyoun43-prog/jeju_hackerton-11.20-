import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
const base=process.env.BASE_URL||'http://127.0.0.1:4189',out=resolve('output/density-qa/browser');await mkdir(out,{recursive:true});
assert.equal((await(await fetch(base+'/api/agent/capabilities')).json()).llm,false);
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH}),report={sourceHash:await runtimeFingerprint(process.cwd()),views:[],checks:[],errors:[],modelCalls:0};
const check=(name,pass)=>{report.checks.push({name,pass:Boolean(pass)});};
try{
 for(const [width,height] of [[1280,720],[1440,900],[1920,1080],[390,844]]){
  const context=await browser.newContext({viewport:{width,height},locale:'ko-KR'});await context.route('**/*',r=>{const url=new URL(r.request().url());if(url.origin!==new URL(base).origin)return r.abort();if(url.pathname==='/api/agent'&&r.request().method()==='POST'){report.modelCalls++;return r.abort();}return r.continue();});
  const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));p.setDefaultTimeout(7000);
  const inspect=async screen=>{const geometry=await p.evaluate(()=>{const scroll=document.getElementById('conversation-scroll'),n=getComputedStyle(scroll).display==='contents'?document.querySelector('.conversation-layout'):scroll,r=n.getBoundingClientRect(),main=n.querySelector('#care-region-workspace:not([hidden])>.hondi-react')||n.querySelector('#appointment-workspace:not([hidden])'),m=main?.getBoundingClientRect();return{overflow:n.scrollHeight-n.clientHeight,bodyOverflow:document.documentElement.scrollWidth-innerWidth,contentWidth:m?.width,availableWidth:r.width,background:getComputedStyle(document.getElementById('chat-workspace')).backgroundImage,primaryVisible:[...document.querySelectorAll('[data-book-primary],#send-request')].filter(x=>x.checkVisibility()).every(x=>{const b=x.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight;})};});report.views.push({width,height,screen,...geometry});if(width>=1280)check(`${width} ${screen} 기본 화면 무스크롤`,geometry.overflow<=3);check(`${width} ${screen} 다음 행동과 가로 폭`,geometry.primaryVisible&&geometry.bodyOverflow<=1);if([1280,1920,390].includes(width))await p.screenshot({path:resolve(out,`${screen}-${width}.png`)});};
  await p.goto(base);await p.locator('#choose-region-jeju').waitFor();await inspect('region');check(width+' 투명 사진 배경 없음',await p.locator('#chat-workspace').evaluate(n=>getComputedStyle(n).backgroundImage==='none'));
  await p.locator('#choose-region-jeju').click();await inspect('method');await p.locator('#entry-mode-text').click();
  check(width+' 예시를 바로 표시',await p.locator('.request-example').count()===2&&await p.locator('.request-example').first().isVisible());
  await p.locator('#request-input').fill('어머니 진료를 준비해요.');await p.locator('.request-example').nth(0).click();await p.locator('.request-example').nth(1).click();
  check(width+' 예시 추가가 원문 보존',/어머니 진료/.test(await p.locator('#request-input').inputValue()));check(width+' 예시로 네 조건 갱신',await p.locator('.entry-live li[data-found=true]').count()===4);await inspect('text');
  await p.getByRole('button',{name:'입력 방식 바꾸기',exact:true}).click();await p.locator('#entry-mode-voice').click();await inspect('voice');
  await p.getByRole('button',{name:'입력 방식 바꾸기',exact:true}).click();await p.locator('#entry-mode-manual').click();await inspect('finder');
  await p.locator('#public-hospital-search').fill('제주우리병원');await p.getByRole('button',{name:'제주우리병원 선택',exact:true}).click();
  await p.locator('#public-visit-department').click();await p.getByRole('option',{name:'정형외과',exact:true}).click();await inspect('department');
  await p.locator('[data-book-primary]').click();await p.getByRole('button',{name:'다음 달',exact:true}).click();await p.locator('[data-book-action="public_date"][data-book-value="2026-12-03"]').click();
  check(width+' 화면 안 선택과 다음 단계 구별',await p.locator('[data-book-primary]').getAttribute('data-role')==='within-step');await p.locator('[data-book-primary]').click();await p.locator('[data-book-action="public_time"][data-book-value="afternoon"]').click();await inspect('dates');
  check(width+' 실제 다음 단계 주 행동',await p.locator('[data-book-primary]').getAttribute('data-role')==='next-step');await p.locator('[data-book-primary]').click();await inspect('review');
  await context.close();
 }
 check('자동 모델 호출 없음',report.modelCalls===0);check('브라우저 오류 없음',report.errors.length===0);report.result=report.checks.every(c=>c.pass)?'pass':'fail';
}finally{await browser.close();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({result:report.result,views:report.views,failed:report.checks.filter(c=>!c.pass),errors:report.errors},null,2));
if(report.result!=='pass')process.exitCode=1;
