import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
const base=process.env.BASE_URL||'http://127.0.0.1:4189',out=resolve('output/fluid-motion-qa');
await mkdir(out,{recursive:true});assert.equal((await(await fetch(base+'/api/agent/capabilities')).json()).llm,false);
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const report={sourceHash:await runtimeFingerprint(process.cwd()),checks:[],views:[],errors:[],apiPosts:0};
const check=(name,pass)=>report.checks.push({name,pass:Boolean(pass)});
async function context(options={}){
 const c=await browser.newContext({locale:'ko-KR',...options});
 await c.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==new URL(base).origin)return r.abort();if(r.request().method()==='POST'){report.apiPosts++;return r.abort();}return r.continue();});
 const p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));p.setDefaultTimeout(8000);
 await p.goto(base);await p.locator('#choose-region-jeju').waitFor();await p.evaluate(()=>document.fonts.ready);
 return {c,p};
}
// Read the real click before React replaces its button. Measure the decoration at paint.
async function watchClicks(page){
 await page.evaluate(()=>{
  const measurements=window.__careClicks=[];
  const rect=node=>{const {x,y,width,height}=node.getBoundingClientRect();return {x,y,width,height};};
  window.addEventListener('click',event=>{
   const button=event.target.closest?.('button');
   if(!button)return;
   const activation={x:event.clientX,y:event.clientY,box:rect(button),detail:event.detail};
   measurements.push(activation);
   requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const flash=document.querySelector('.care-button-flash'),burst=document.querySelector('.care-citrus-burst');
    const layer=(flash||burst)?.closest('.care-motion-layer');
    const decoration=flash&&getComputedStyle(flash);
    activation.frame={
     flashes:document.querySelectorAll('.care-button-flash').length,bursts:document.querySelectorAll('.care-citrus-burst').length,
     box:flash&&rect(flash),origin:burst&&rect(burst),
     colors:decoration?[decoration.backgroundColor,decoration.borderTopColor]:[],
     visible:flash?.checkVisibility({visibilityProperty:true})&&Number(decoration.opacity)>0,
     fixed:layer&&getComputedStyle(layer).position==='fixed',
     transparentToPointer:[layer,flash,burst].filter(Boolean).every(n=>getComputedStyle(n).pointerEvents==='none'),
     slices:burst?.querySelectorAll('.citrus-slice').length||0,leaf:Boolean(burst?.querySelector('.citrus-leaf')),
     fruit:Boolean(burst?.querySelector('img.citrus-fruit')),central:document.querySelectorAll('.care-scene-guide').length,
     movingSurface:document.querySelector('.conversation-layout').getAnimations().some(a=>a.effect.getKeyframes().some(f=>f.transform&&f.transform!=='none')),
    };
   }));
  },true);
  window.__careAdditions=0;
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){
   if(node.nodeType===1)window.__careAdditions+=Number(node.matches('.care-citrus-burst,.care-button-flash'))+node.querySelectorAll('.care-citrus-burst,.care-button-flash').length;
  }}).observe(document.body,{subtree:true,childList:true});
 });
}
async function clickAwayFromCenter(page,button,touch=false){
 await button.scrollIntoViewIfNeeded();
 const box=await button.boundingBox();assert.ok(box,'클릭 위치를 측정할 수 있는 버튼이 필요합니다.');
 const index=await page.evaluate(()=>window.__careClicks.length);
 const x=Math.floor(box.x+box.width*.23),y=Math.floor(box.y+box.height*.64);
 if(touch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
 await page.waitForFunction(i=>Boolean(window.__careClicks[i]?.frame),index);
 return page.evaluate(i=>window.__careClicks[i],index);
}
function orange(css){
 const [r,g,b,a=1]=(css.match(/[\d.]+/g)||[]).map(Number);
 return r>=190&&g>=65&&g<r-32&&b<g-25&&a>0;
}
function checkFlash(label,{box,frame}){
 check(label+' 당시 버튼과 강조 영역 일치',frame.flashes===1&&frame.box&&['x','y','width','height'].every(k=>Math.abs(frame.box[k]-box[k])<=2));
 check(label+' 버튼 위에 주황 강조 표시',frame.visible&&frame.colors.some(orange));
 check(label+' 고정 레이어가 입력을 통과시킴',frame.fixed&&frame.transparentToPointer);
}
function checkBurst(label,event){
 const {box,frame,x,y}=event;
 check(label+' 버튼 중앙이 아닌 실제 입력 좌표',Math.abs(x-(box.x+box.width/2))>7&&event.detail>0);
 check(label+' 귤 입자 원점이 입력 좌표와 일치',frame.bursts===1&&frame.origin&&Math.abs(frame.origin.x-x)<=2&&Math.abs(frame.origin.y-y)<=2);
 check(label+' 감귤 조각과 열매·잎',frame.slices>1&&frame.fruit&&frame.leaf);
 check(label+' 중앙 궤적과 작업면 이동 없음',!frame.central&&!frame.movingSurface);
}
try {
 for(const [width,height] of [[1280,720],[1440,900],[1920,1080],[2831,1448],[3840,2160],[1920,720],[390,844],[320,600]]){
  const {c,p}=await context({viewport:{width,height},reducedMotion:'reduce'});
  const inspect=async name=>{
   const v=await p.evaluate(()=>{const root=document.querySelector('#care-region-workspace'),stage=root.firstElementChild,r=root.getBoundingClientRect(),s=stage.getBoundingClientRect(),scroll=document.querySelector('#conversation-scroll'),card=stage.querySelector('.care-region-choice,.entry-method');return{width:innerWidth,height:innerHeight,stageWidth:s.width,stageHeight:s.height,availableWidth:r.width,availableHeight:r.height,widthRatio:s.width/r.width,heightRatio:s.height/r.height,overflow:scroll.scrollHeight-scroll.clientHeight,horizontal:document.documentElement.scrollWidth-innerWidth,cardHeight:card?.getBoundingClientRect().height,bodyFont:getComputedStyle(stage.querySelector('.region-choice-description,.entry-method small')).fontSize,ctaClipped:[...stage.querySelectorAll('.region-choice-action')].some(n=>n.scrollWidth>n.clientWidth+1)};});
   report.views.push({name,...v});check(`${width} ${name} 가로 넘침/문구 잘림 없음`,v.horizontal<=1&&!v.ctaClipped);if(width>=1280)check(`${width} ${name} 기본 무스크롤`,v.overflow<=3);
   if([1280,1920,2831,3840,390].includes(width))await p.screenshot({path:resolve(out,`${name}-${width}x${height}.png`)});
  };
  await inspect('region');await p.locator('#choose-region-jeju').click();await inspect('method');await c.close();
 }
 const desktop=report.views.filter(v=>v.name==='region'&&v.width>=1280&&!(v.width===1920&&v.height===720));
 check('노트북부터 4K까지 너비 점유율 차이 18%p 이내',Math.max(...desktop.map(v=>v.widthRatio))-Math.min(...desktop.map(v=>v.widthRatio))<=.18);
 check('노트북부터 4K까지 높이 점유율 차이 18%p 이내',Math.max(...desktop.map(v=>v.heightRatio))-Math.min(...desktop.map(v=>v.heightRatio))<=.18);
 {
  const {c,p}=await context({viewport:{width:1280,height:720}});
  await watchClicks(p);
  const region=await clickAwayFromCenter(p,p.locator('#choose-region-jeju'));
  checkFlash('PC 지역 선택',region);checkBurst('PC 지역 선택',region);
  check('선택 즉시 다음 화면 및 제목 초점',await p.locator('#entry-mode-text').isVisible()&&await p.locator('#care-region-title').evaluate(n=>n===document.activeElement));
  check('다음 단계 버튼 위에서 올바른 요소를 누를 수 있음',await p.locator('#entry-mode-text').evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  await p.screenshot({path:resolve(out,'click-citrus.png')});
  await p.locator('#entry-mode-text').click();
  const example=await clickAwayFromCenter(p,p.locator('.request-example').first());
  checkFlash('연속 입력',example);checkBurst('연속 입력',example);
  check('연속 클릭 중 예시가 초안에 한 번 반영',((await p.locator('#request-input').inputValue()).match(/제주우리병원/g)||[]).length===1);
  await p.getByRole('button',{name:'입력 방식 바꾸기',exact:true}).click();await p.locator('#entry-mode-manual').click();
  check('빠른 전환 후 마지막 선택 유지',await p.locator('#public-hospital-search').isVisible());
  await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});
  check('탭을 떠나면 입자와 강조 정리',await p.locator('.care-citrus-burst,.care-button-flash').count()===0);
  await c.close();
 }
 {
  const {c,p}=await context({viewport:{width:390,height:720},hasTouch:true,isMobile:true});
  await watchClicks(p);
  const touch=await clickAwayFromCenter(p,p.locator('#choose-region-jeju'),true);
  checkFlash('모바일 터치',touch);checkBurst('모바일 터치',touch);
  await p.locator('#entry-mode-text').tap();
  const send=p.locator('#send-request');assert.equal(await send.isDisabled(),true);
  await p.waitForFunction(()=>!document.querySelector('.care-citrus-burst,.care-button-flash'),null,{timeout:2000});
  const before=await p.evaluate(()=>window.__careAdditions),box=await send.boundingBox();
  await p.touchscreen.tap(Math.floor(box.x+box.width/2),Math.floor(box.y+box.height/2));
  // A wheel gesture is observed even if this viewport has no overflow.
  await p.evaluate(()=>window.addEventListener('wheel',()=>{window.__careWheel=true;},{once:true,passive:true}));
  await p.mouse.move(180,310);await p.mouse.wheel(0,170);await p.waitForFunction(()=>window.__careWheel);
  check('비활성 버튼과 스크롤에서 장식 생성 없음',await p.evaluate(()=>window.__careAdditions)===before);
  await c.close();
 }
 {
  const {c,p}=await context({viewport:{width:1280,height:720},reducedMotion:'reduce'});
  await watchClicks(p);
  const reduced=await clickAwayFromCenter(p,p.locator('#choose-region-jeju'));
  checkFlash('움직임 줄이기',reduced);
  check('움직임 줄이기에서 귤 입자·작업면 이동 생략',reduced.frame.bursts===0&&!reduced.frame.central&&!reduced.frame.movingSurface);
  await p.waitForFunction(()=>!document.querySelector('.care-button-flash'),null,{timeout:2000});
  await p.getByRole('button',{name:'진료 지역 다시 선택',exact:true}).click();
  await p.emulateMedia({reducedMotion:'no-preference'});await p.locator('#choose-region-seoul').focus();
  const index=await p.evaluate(()=>window.__careClicks.length);
  await p.keyboard.press('Enter');await p.waitForFunction(i=>Boolean(window.__careClicks[i]?.frame),index);
  const keyboard=await p.evaluate(i=>window.__careClicks[i],index);
  check('키보드 진입에 위치 강조·입자·작업면 이동 없음',keyboard.detail===0&&!keyboard.frame.bursts&&!keyboard.frame.flashes&&!keyboard.frame.central&&!keyboard.frame.movingSurface);
  check('키보드 초점은 새 단계 제목에 유지',await p.locator('#care-region-title').evaluate(n=>n===document.activeElement));
  await c.close();
 }
 check('모델/음성 자동 호출 없음',report.apiPosts===0);check('브라우저 예외 없음',report.errors.length===0);
 report.result=report.checks.every(x=>x.pass)?'pass':'fail';
}finally{await browser.close();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({result:report.result,checks:report.checks.length,failed:report.checks.filter(x=>!x.pass),views:report.views,errors:report.errors},null,2));
if(report.result!=='pass')process.exitCode=1;
