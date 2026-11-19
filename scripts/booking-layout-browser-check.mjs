import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runtimeFingerprint} from '../orchestration/checks.mjs';

const base=process.env.BASE_URL||'http://127.0.0.1:4189';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname));
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const sourceHash=await runtimeFingerprint(process.cwd());
const directory=resolve('output/vehicle-recovery-qa');
await mkdir(directory,{recursive:true});
const measurements=[],errors=[],posts=[];
try {
  const context=await browser.newContext({locale:'ko-KR',reducedMotion:'reduce'});
  await context.route('**/*',route=>{
    const request=route.request();
    if(request.method()==='POST')posts.push(new URL(request.url()).pathname);
    return request.method()==='GET'&&new URL(request.url()).origin===new URL(base).origin?route.continue():route.abort();
  });
  const page=await context.newPage();
  page.on('pageerror',err=>errors.push(err.message));
  await page.goto(base);
  await page.locator('#choose-region-seoul').click();
  await page.locator('#entry-mode-manual').click();
  await page.locator('[data-book-primary]').click();
  await page.locator('.availability-first-date button').click();
  await page.locator('.availability-slots button').first().click();
  const selection=await page.locator('.booking-footer-selection').innerText();
  for(const [width,height] of [[1093,512],[1024,600],[900,650],[901,651],[1050,650],[1051,650],[1366,768],[390,844],[320,600]]) {
    await page.setViewportSize({width,height});
    const compact=width<=900||height<=650;
    const tabs=page.locator('.workspace-controls');
    await tabs.waitFor({state:compact?'visible':'hidden'});
    await page.waitForFunction(tabbed=>document.getElementById('preparation-rail').hidden===tabbed,compact);
    const measure=await page.evaluate(()=>{
      const box=s=>document.querySelector(s).getBoundingClientRect();
      const work=box('#chat-workspace'),layout=box('.conversation-layout'),footer=box('#chat-composer'),calendar=box('.availability-calendar-panel'),times=box('.availability-results'),cta=box('[data-book-primary]');
      return {width:innerWidth,height:innerHeight,work:work.width,layout:layout.width,footer:footer.width,content:box('.appointment-availability').width,sideBySide:times.left>=calendar.right,primaryVisible:cta.bottom<=innerHeight+1&&cta.right<=innerWidth+1,horizontalOverflow:document.documentElement.scrollWidth-innerWidth};
    });
    assert.ok(measure.primaryVisible&&measure.horizontalOverflow<=1);
    assert.equal(measure.sideBySide,measure.content>=640);
    if(compact){
      assert.ok(Math.abs(measure.layout-measure.work)<=1&&Math.abs(measure.layout-measure.footer)<=1);
      await page.locator('#workspace-tab-preparation').click();
      assert.ok(await page.locator('#preparation-rail').evaluate(el=>Math.abs(el.offsetWidth-el.parentElement.clientWidth)<=1));
      await page.locator('#workspace-tab-chat').click();
      assert.equal(await page.locator('.booking-footer-selection').innerText(),selection);
    }else assert.ok(await page.locator('#preparation-rail').isVisible());
    measurements.push(measure);
  }
  await page.locator('[data-book-primary]').click();
  await page.locator('[data-appointment-screen=review]').waitFor();
  assert.equal(await page.locator('.booking-footer-selection').innerText(),selection);
  assert.deepEqual(errors,[]);
  assert.deepEqual(posts,[]);
  assert.equal((await(await fetch(base+'/deployment.json')).json()).sourceHash,sourceHash);
  console.log(`${measurements.length}개 화면에서 달력·의료진·하단 행동과 탭 왕복 통과`);
}catch(error){
  errors.push(error.message);
  throw error;
}finally {
  await browser.close();
  await writeFile(resolve(directory,'calendar-regression.json'),JSON.stringify({sourceHash,measurements,errors,posts},null,2));
}
