import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
const base=process.env.BASE_URL||'http://127.0.0.1:4189',out=resolve('output/phone-result-qa/browser');
await mkdir(out,{recursive:true});assert.equal((await(await fetch(base+'/api/agent/capabilities')).json()).llm,false);
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const report={sourceHash:await runtimeFingerprint(process.cwd()),checks:[],views:[],errors:[],posts:0};
const check=(name,pass)=>report.checks.push({name,pass:Boolean(pass)});
async function setup(viewport,motion='reduce'){
 const c=await browser.newContext({viewport,locale:'ko-KR',reducedMotion:motion});
 await c.route('**/*',r=>{if(new URL(r.request().url()).origin!==new URL(base).origin)return r.abort();if(r.request().method()==='POST'){report.posts++;return r.abort();}return r.continue();});
 const p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));p.setDefaultTimeout(10000);await p.goto(base);await p.locator('#choose-region-jeju').waitFor();
 await p.evaluate(()=>{
  window.__resultFeedback={bursts:0,total:0};
  new MutationObserver(records=>{for(const row of records)for(const node of row.addedNodes){
   if(node.nodeType!==1)continue;
   window.__resultFeedback.total++;
   if(node.matches('.care-citrus-burst'))window.__resultFeedback.bursts++;
  }}).observe(document.querySelector('.care-motion-layer'),{childList:true});
 });
 return{c,p};
}
async function request(p){
 await p.locator('#entry-mode-text').click();
 await p.locator('#request-input').fill('제주우리병원 정형외과 12월 3일 오후에 가고 싶어요. 애월읍에서 휠체어와 동행이 필요해요.');
 await p.locator('#send-request').click();await p.locator('.entry-review-footer .appointment-primary').click();
 const start=await p.evaluate(()=>({...window.__resultFeedback,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches}));
 await p.locator('[data-book-primary]').click();await p.locator('[role=dialog]').waitFor();
 const end=await p.evaluate(()=>({...window.__resultFeedback,clean:!document.querySelector('.care-motion-layer > *')}));
 const expected=start.reduced?0:1;
 check('사용자 시작에만 귤 표시, 자동 회신·결과에 추가 클릭 효과 없음',end.total-start.total===expected&&end.bursts-start.bursts===expected&&end.clean);
}
async function inspect(p,name){
 const v=await p.evaluate(()=>{const d=document.querySelector('.coordination-result-dialog'),r=d.getBoundingClientRect(),f=d.querySelector('footer').getBoundingClientRect(),body=d.querySelector('.result-window-body');return{viewport:[innerWidth,innerHeight],bounds:r.toJSON(),footer:f.toJSON(),overflow:body.scrollHeight-body.clientHeight,heading:d.querySelector('h2').textContent,checked:d.querySelectorAll('[data-result=confirmed]').length,focus:document.activeElement.id,animation:getComputedStyle(d).animationDuration,horizontal:document.documentElement.scrollWidth-innerWidth};});report.views.push({name,...v});
 check(`${name} 결과창·저장 버튼이 화면 안`,v.bounds.left>=0&&v.bounds.right<=v.viewport[0]+1&&v.bounds.top>=0&&v.footer.bottom<=v.viewport[1]+1&&v.horizontal<=1);
 check(`${name} 완료 체크 3개`,v.checked===3);await p.screenshot({path:resolve(out,`${name}.png`)});
}
try{
 for(const [width,height] of [[1280,720],[1920,1080],[390,844],[320,600]]){
  const {c,p}=await setup({width,height});await p.locator('#choose-region-jeju').click();await request(p);await inspect(p,`result-${width}`);
  check(`${width} 완료 시 결과창 자동 열림`,await p.locator('#coordination-result-heading').isVisible());
  check(`${width} 결과창 제목에 초점`,await p.evaluate(()=>document.activeElement.id==='coordination-result-heading'));
  for(let i=0;i<6;i++)await p.keyboard.press('Tab');check(`${width} 결과창 안에서 키보드 이동`,await p.evaluate(()=>Boolean(document.activeElement.closest('[role=dialog]'))));
  const save=p.waitForEvent('download');await p.locator('[role=dialog] [data-book-action=coordination_save]').click();const file=await save;await file.saveAs(resolve(out,`result-${width}.md`));
  await p.keyboard.press('Escape');await p.locator('[role=dialog]').waitFor({state:'hidden'});check(`${width} 닫기 후 결과 보기 버튼 초점`,await p.evaluate(()=>document.activeElement.dataset.bookAction==='coordination_result_open'));
  await p.locator('[data-book-action=coordination_result_open]').click();await p.locator('[role=dialog]').waitFor();check(`${width} 결과창 다시 열기`,await p.locator('[role=dialog]').isVisible());await p.getByRole('button',{name:'결과창 닫기',exact:true}).click();
  if(width===1280){await p.locator('.coordination-tools summary').filter({hasText:'시연 안내'}).click();await p.locator('[data-book-action=coordination_scenario][data-book-value=taxi_unavailable]').click();await p.locator('[data-book-primary]').click();await p.locator('[role=dialog]').waitFor();check('차량 실패 결과창은 성공2·인계1',await p.locator('[role=dialog] [data-result=confirmed]').count()===2&&await p.locator('[role=dialog] [data-result=handoff]').count()===1);await p.screenshot({path:resolve(out,'result-handoff.png')});}
  await c.close();
 }
 const {c,p}=await setup({width:1440,height:900},'no-preference');
 await p.locator('#choose-region-jeju').click({position:{x:31,y:43}});
 check('클릭 위치에서 감귤 표시 후 다음 작업면 그대로 열림',await p.locator('#entry-mode-text').isVisible()&&await p.evaluate(()=>window.__resultFeedback.bursts===1&&window.__resultFeedback.total===1&&!document.querySelector('.care-scene-guide')));
 await p.screenshot({path:resolve(out,'button-feedback.png')});
 await request(p);check('전환 중에도 다음 선택 즉시 처리',await p.locator('[role=dialog]').isVisible());
 const duration=await p.locator('[role=dialog]').evaluate(n=>getComputedStyle(n).animationDuration);check('결과창 850ms·감귤 1200ms',duration==='0.85s'&&await p.locator('.result-brand-seal').evaluate(n=>getComputedStyle(n).animationDuration)==='1.2s');
 await p.emulateMedia({reducedMotion:'reduce'});check('움직임 줄이기 시 결과 효과 생략',await p.locator('[role=dialog]').evaluate(n=>getComputedStyle(n).animationDuration)==='0s');await c.close();
 check('전화·유료 API POST 없음',report.posts===0);check('브라우저 예외 없음',report.errors.length===0);
}catch(e){report.errors.push(e.stack);check('브라우저 흐름 완료',false);}finally{await browser.close();report.passed=report.checks.filter(c=>c.pass).length;report.failed=report.checks.filter(c=>!c.pass);await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,views:report.views,errors:report.errors,posts:report.posts},null,2));if(report.failed.length)process.exitCode=1;}
