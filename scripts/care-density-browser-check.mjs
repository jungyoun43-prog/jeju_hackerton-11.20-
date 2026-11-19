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

// Compare an unobstructed part of the rendered coast with the same crop of
// the original. Checking the CSS alone misses an opaque layer above it.
async function checkCoast(page) {
  const frame = await page.evaluate(() => {
    const main = document.querySelector('.page-main');
    const header = main.querySelector('.workspace-header');
    const chat = main.querySelector('#chat-workspace');
    const choices = main.querySelector('#care-region-workspace:not([hidden]) :is(.care-region-choices,.entry-methods)');
    const scene = choices ? main : header;
    const layer = getComputedStyle(scene, choices ? null : '::after');
    const box = scene.getBoundingClientRect();
    const y = choices ? box.top : box.bottom;
    const height = choices ? box.height : parseFloat(layer.height);
    let left = box.left, right = box.right, top = y, bottom = y + height;
    const surfaces = [];
    if (choices) {
      const [a, b] = [...choices.children].map(card => card.getBoundingClientRect());
      if (b.left >= a.right) {
        left = a.right; right = b.left; top = a.top; bottom = a.bottom;
      } else {
        left = a.left; right = a.right; top = a.bottom; bottom = b.top;
      }
      surfaces.push(...choices.children, ...choices.parentElement.querySelectorAll('.entry-page-header>div,.entry-screen-footer>*'));
    } else {
      surfaces.push(getComputedStyle(chat).display === 'contents' ? main.querySelector('.conversation-layout') : chat);
    }
    const x = Math.ceil(Math.max(0, left)) + 2, cy = Math.ceil(Math.max(0, top)) + 2;
    const clip = {x, y:cy, width:Math.floor(Math.min(innerWidth, right)) - x - 2, height:Math.floor(Math.min(innerHeight, bottom)) - cy - 2};
    const url = new URL('/assets/jeju-workspace-background-v1.webp', location.href).href;
    const clear = layer.backgroundImage === 'url("' + url + '")' && layer.backgroundSize === 'cover'
      && layer.opacity === '1' && layer.filter === 'none' && layer.visibility === 'visible';
    const opaque = surfaces.filter(el => el.checkVisibility()).every(el => {
      const s = getComputedStyle(el);
      return s.opacity === '1' && s.backgroundColor.startsWith('rgb(') && s.backgroundImage === 'none';
    });
    return {url, clear, opaque, clip, x:box.left, y, width:box.width, height,
      fx:parseFloat(layer.backgroundPositionX)/100, fy:parseFloat(layer.backgroundPositionY)/100};
  });
  const metrics = {unfiltered:frame.clear, opaque:frame.opaque, sampleWidth:frame.clip.width, sampleHeight:frame.clip.height, meanColorDifference:null};
  if (!frame.clear || !frame.opaque || frame.clip.width <= 0 || frame.clip.height <= 0) return metrics;
  const screenshot = await page.screenshot({clip:frame.clip, scale:'css'});
  const difference = await page.evaluate(async ({frame:f, png}) => {
    const source = new Image(); source.src = f.url;
    await source.decode();
    const scale = Math.max(f.width/source.width, f.height/source.height);
    const width = source.width * scale, height = source.height * scale;
    const crop = new OffscreenCanvas(f.clip.width, f.clip.height);
    crop.getContext('2d').drawImage(source, f.x + (f.width-width)*f.fx - f.clip.x,
      f.y + (f.height-height)*f.fy - f.clip.y, width, height);
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    const capture = await createImageBitmap(new Blob([bytes], {type:'image/png'}));
    const sample = image => {
      const ctx = new OffscreenCanvas(8, 8).getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, 8, 8);
      return ctx.getImageData(0, 0, 8, 8).data;
    };
    const a = sample(crop), b = sample(capture);
    capture.close();
    const distances = a.map((n, i) => Math.abs(n - b[i])).filter((_, i) => i % 4 !== 3);
    return distances.reduce((sum, n) => sum + n, 0) / distances.length;
  }, {frame, png:screenshot.toString('base64')});
  metrics.meanColorDifference = Number(difference.toFixed(2));
  return metrics;
}
try{
 for(const [width,height] of [[1280,720],[1440,900],[1920,1080],[390,844]]){
  const context=await browser.newContext({viewport:{width,height},locale:'ko-KR'});await context.route('**/*',r=>{const url=new URL(r.request().url());if(url.origin!==new URL(base).origin)return r.abort();if(url.pathname==='/api/agent'&&r.request().method()==='POST'){report.modelCalls++;return r.abort();}return r.continue();});
  const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));p.setDefaultTimeout(7000);
  const inspect = async screen => {
    await p.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
      const transitions = document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity);
      await Promise.allSettled(transitions.map(a => a.finished));
    });
    const geometry = await p.evaluate(() => {
      const scroll = document.getElementById('conversation-scroll');
      const panel = getComputedStyle(scroll).display === 'contents' ? document.querySelector('.conversation-layout') : scroll;
      const content = panel.querySelector('#care-region-workspace:not([hidden])>.hondi-react') || panel.querySelector('#appointment-workspace:not([hidden])');
      const primaryVisible = [...document.querySelectorAll('[data-book-primary],#send-request')]
        .filter(el => el.checkVisibility())
        .every(el => {const box=el.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight;});
      return {overflow:panel.scrollHeight-panel.clientHeight, bodyOverflow:document.documentElement.scrollWidth-innerWidth,
        contentWidth:content?.getBoundingClientRect().width, availableWidth:panel.getBoundingClientRect().width,
        background:getComputedStyle(document.getElementById('chat-workspace')).backgroundImage, primaryVisible};
    });
    const coast = await checkCoast(p);
    report.views.push({width,height,screen,...geometry,coast});
    if (width >= 1280) check(`${width} ${screen} 기본 화면 무스크롤`,geometry.overflow <= 3);
    check(`${width} ${screen} 다음 행동과 가로 폭`,geometry.primaryVisible && geometry.bodyOverflow <= 1);
    check(`${width} ${screen} 원본 해안과 불투명 작업면`,coast.meanColorDifference !== null && coast.meanColorDifference < 8);
    if ([1280,1920,390].includes(width)) await p.screenshot({path:resolve(out,`${screen}-${width}.png`)});
  };
  await p.goto(base);await p.locator('#choose-region-jeju').waitFor();await inspect('region');
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
