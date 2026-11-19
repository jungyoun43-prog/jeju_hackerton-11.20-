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
  await p.evaluate(()=>{const original=Element.prototype.animate;window.__motionFrames=[];window.__motionSlow=true;Element.prototype.animate=function(frames,options){window.__motionFrames.push({id:this.id,role:this.className,frames,options});const a=original.call(this,frames,options);if(window.__motionSlow)a.playbackRate=.1;return a;};});
  await p.locator('#choose-region-jeju').click();
  check('선택 즉시 다음 화면 도달',await p.locator('#entry-mode-text').isVisible());
  check('작업면과 감귤 궤적 효과 실행',await p.evaluate(()=>document.querySelector('.conversation-layout').getAnimations().length===1&&document.querySelector('.care-scene-guide img')?.getAnimations().length===1));
  await p.waitForFunction(()=>document.querySelector('.conversation-layout')?.getAnimations()[0]?.currentTime>=140);
  await p.screenshot({path:resolve(out,'motion-10percent.png')});
  await p.evaluate(()=>{window.__motionSlow=false;for(const a of document.getAnimations())if(!a.animationName){a.pause();a.currentTime=280;}});
  const trajectory=await p.evaluate(()=>window.__motionFrames.find(x=>String(x.role).includes('conversation-layout')));
  check('작업면이 900ms 동안 펼쳐짐',trajectory.frames[0].transform!==trajectory.frames.at(-1).transform&&trajectory.options.duration===900);
  check('효과 레이어가 다음 조작을 가리지 않음',await p.locator('#entry-mode-text').evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  await p.locator('#entry-mode-text').click();await p.locator('.request-example').first().click();
  check('애니메이션 중 입력/예시 작동',(await p.locator('#request-input').inputValue()).includes('제주우리병원'));
  await p.getByRole('button',{name:'입력 방식 바꾸기',exact:true}).click();await p.locator('#entry-mode-manual').click();
  check('빠른 전환 후 마지막 선택 유지',await p.locator('#public-hospital-search').isVisible());
  check('연속 클릭에서 감귤 궤적 중복 없음',await p.locator('.care-scene-guide').count()<=1);
  await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});
  check('탭 숨김 신호가 효과 정리',await p.evaluate(()=>document.querySelectorAll('.care-scene-guide,.care-action-wave').length===0));
  await c.close();
 }
 {
  const {c,p}=await context({viewport:{width:1280,height:720},reducedMotion:'reduce'});
  await p.locator('#choose-region-jeju').click();
  check('움직임 줄이기에서는 궤적과 파동 생략',await p.evaluate(()=>document.querySelectorAll('.care-scene-guide,.care-action-wave').length===0));
  await p.getByRole('button',{name:'진료 지역 다시 선택',exact:true}).click();
  await p.emulateMedia({reducedMotion:'no-preference'});await p.locator('#choose-region-seoul').focus();await p.keyboard.press('Enter');
  check('키보드 진입에 공간 이동 효과 없음',await p.evaluate(()=>document.querySelector('#care-transition').getAnimations().length===0&&[...document.querySelectorAll('.entry-method')].every(n=>n.getAnimations().length===0)));
  check('키보드 초점은 새 단계 제목에 유지',await p.locator('#care-region-title').evaluate(n=>n===document.activeElement));
  await c.close();
 }
 check('모델/음성 자동 호출 없음',report.apiPosts===0);check('브라우저 예외 없음',report.errors.length===0);
 report.result=report.checks.every(x=>x.pass)?'pass':'fail';
}finally{await browser.close();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({result:report.result,checks:report.checks.length,failed:report.checks.filter(x=>!x.pass),views:report.views,errors:report.errors},null,2));
if(report.result!=='pass')process.exitCode=1;
