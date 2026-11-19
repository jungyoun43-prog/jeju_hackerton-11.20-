import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
import hospitals from '../app/data/hospital-candidates.json' with {type:'json'};
const base=process.env.BASE_URL||'http://127.0.0.1:4189',out=resolve('output/density-qa/browser');await mkdir(out,{recursive:true});
assert.equal((await(await fetch(base+'/api/agent/capabilities')).json()).llm,false);
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH}),report={sourceHash:await runtimeFingerprint(process.cwd()),views:[],checks:[],errors:[],modelCalls:0};
const check=(name,pass)=>{report.checks.push({name,pass:Boolean(pass)});};

async function checkHospitalDirectory(page,width) {
  const directory=page.locator('.public-candidates'),rows=directory.locator('.public-hospital-row');
  const search=page.locator('#public-hospital-search');
  const expected=hospitals.records.map(hospital=>hospital.id).sort();
  const ids=await rows.locator('[data-book-action="public_hospital"]').evaluateAll(buttons=>buttons.map(button=>button.dataset.bookValue).sort());
  check(width+' 전체 등록 병원 13곳을 한 목록에서 선택',ids.length===13 && JSON.stringify(ids)===JSON.stringify(expected));
  check(width+' 병원 목록 페이지 이동 제거',await directory.locator('.hospital-pagination').count()===0 && await directory.getByRole('navigation',{name:'병원 목록 페이지'}).count()===0);
  check(width+' 병원을 고르기 전에는 모든 상세가 접힘',await rows.locator('[aria-expanded="false"]').count()===13 && await rows.locator('[aria-expanded="true"]').count()===0);

  const geometry=await rows.evaluateAll(items=>{
    let fullyVisible=0,singleLine=0;
    let smallestTouchHeight=Infinity;
    for (const row of items) {
      const rect=row.getBoundingClientRect(),x=rect.left+rect.width/2;
      if (rect.top>=0 && rect.bottom<=innerHeight && [rect.top+2,rect.bottom-2].every(y=>row.contains(document.elementFromPoint(x,y)))) fullyVisible++;
      for (const button of row.querySelectorAll(':scope > button')) smallestTouchHeight=Math.min(smallestTouchHeight,button.getBoundingClientRect().height);
      const name=row.querySelector('.hospital-directory-name'),address=row.querySelector('.hospital-directory-address');
      if (!name || !address) continue;
      const boxes=[name,address].map(element=>element.getBoundingClientRect());
      const oneLine=[name,address].every((element,i)=>boxes[i].height<=Math.ceil(parseFloat(getComputedStyle(element).lineHeight))+1);
      if (oneLine && boxes[0].height>0 && boxes[1].height>0 && boxes[1].left>=boxes[0].right-1 && boxes[0].top<boxes[1].bottom && boxes[1].top<boxes[0].bottom) singleLine++;
    }
    const overflow=document.documentElement.scrollWidth-innerWidth;
    return {fullyVisible,singleLine,overflow,smallestTouchHeight};
  });
  report.directory ??= [];
  report.directory.push({width,rows:ids.length,...geometry});
  check(width+' 병원 목록 가로 넘침 없음',geometry.overflow<=1);
  if (width===390) check('390px에서 병원·상세 터치 영역은 모두 44px 이상',Number.isFinite(geometry.smallestTouchHeight) && geometry.smallestTouchHeight>=44);
  if (width===1280) {
    check('1280×720에서 첫 스크롤 전 병원 다섯 곳 이상 온전히 표시',geometry.fullyVisible>=5);
    check('1280×720에서 접힌 13행의 이름·주소를 같은 줄에 표시',geometry.singleLine===13);
  }

  const row=rows.first();
  const id=await row.locator('[data-book-action="public_hospital"]').getAttribute('data-book-value');
  const record=hospitals.records.find(hospital=>hospital.id===id);
  const toggle=row.getByRole('button',{name:record.companyName+' 자세히',exact:true});
  const detail=row.locator('.hospital-directory-detail');
  if (width===390) {
    await toggle.tap();
  } else {
    await search.focus();
    for (let i=0;i<20 && !await toggle.evaluate(el=>el===document.activeElement);i++) await page.keyboard.press('Tab');
    check(width+' 검색창에서 Tab으로 첫 병원 상세에 도달',await toggle.evaluate(el=>el===document.activeElement));
    await page.keyboard.press('Enter');
  }
  await detail.waitFor({state:'visible'});
  const contents=(await detail.innerText()).replace(/\s+/g,' ');
  check(width+' 상세에 원문 주소·모든 등록 진료과·공식 출처 보존',contents.includes(record.address.replace(/\s+/g,' ')) && record.departments.every(name=>contents.includes(name)) && await detail.getByRole('link').getAttribute('href')===record.source.url);
  check(width+' 상세를 펼쳐도 병원은 미선택',await toggle.getAttribute('aria-expanded')==='true' && await page.locator('#public-visit-department').count()===0 && await page.locator('[data-book-primary]').isDisabled());
  if (width===390) await page.screenshot({path:resolve(out,'directory-detail-390.png')});
  if (width===390) await toggle.tap(); else await page.keyboard.press('Space');
  await detail.waitFor({state:'hidden'});
  check(width+' 상세를 닫아도 선택 상태 보존',await toggle.getAttribute('aria-expanded')==='false' && await page.locator('#public-visit-department').count()===0);

  await search.fill('중앙로 373');
  check(width+' 주소 검색으로 제주우리병원 한 곳 찾기',await rows.count()===1 && await rows.getByRole('button',{name:'제주우리병원 선택',exact:true}).isVisible());
  await search.fill('검색결과없는병원987');
  const clear=page.getByRole('button',{name:'검색어 지우기',exact:true});
  await clear.waitFor();
  check(width+' 검색 0건과 복구 행동',await rows.count()===0 && /없|찾지 못/.test(await page.locator('.appointment-empty').innerText()));
  if (width===390) await clear.tap(); else await clear.press('Enter');
  check(width+' 검색 초기화로 전체 13곳 복원',await search.inputValue()==='' && await rows.count()===13);

  if (width===1280) {
    const missing=hospitals.records.find(item=>item.departments.length===0);
    await search.fill(missing.companyName);
    await rows.getByRole('button',{name:missing.companyName+' 자세히',exact:true}).click();
    check('등록 진료과가 비어 있는 병원에 미수록 명시',/미수록/.test(await rows.locator('.hospital-directory-detail').innerText()));
    await rows.getByRole('button',{name:missing.companyName+' 선택',exact:true}).press('Enter');
    const official=page.getByRole('link',{name:/병원 공식 창구 검색/});
    await page.waitForFunction(()=>document.activeElement?.id==='public-visit-department');
    check('진료과 미수록 병원은 키보드 초점을 공식 창구로 이동',await official.evaluate(link=>link===document.activeElement) && decodeURIComponent(await official.getAttribute('href')).includes(missing.companyName));
    const hint=await page.locator('#booking-next-hint').innerText();
    check('진료과 미수록이면 공식 문의·재선택 안내를 하고 미확인 진행을 막음',/공식 창구/.test(hint) && /다른 병원/.test(hint) && await page.locator('[data-book-primary]').isDisabled() && await page.locator('#public-visit-department[role="combobox"]').count()===0);
    await page.screenshot({path:resolve(out,'directory-missing-department-1280.png')});
    await page.keyboard.press('Tab');
    const reopen=directory.locator(':scope > summary');
    check('공식 창구에서 Tab으로 다른 병원 선택에 도달',await reopen.evaluate(el=>el===document.activeElement));
    await page.keyboard.press('Enter');
  }
}

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
 assert.equal((await(await fetch(base+'/deployment.json')).json()).sourceHash,report.sourceHash,'기록할 화면과 검사 소스가 같은 빌드여야 합니다.');
 for(const [width,height] of [[1280,720],[1440,900],[1920,1080],[390,844]]){
  const context=await browser.newContext({viewport:{width,height},locale:'ko-KR',hasTouch:width===390});await context.route('**/*',r=>{const url=new URL(r.request().url());if(url.origin!==new URL(base).origin)return r.abort();if(url.pathname==='/api/agent'&&r.request().method()==='POST'){report.modelCalls++;return r.abort();}return r.continue();});
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
  if ([1280,390].includes(width)) await checkHospitalDirectory(p,width);
  await p.locator('#public-hospital-search').fill('제주우리병원');
  const hospitalChoice=p.getByRole('button',{name:'제주우리병원 선택',exact:true});
  check(width+' 병원 이름 검색은 해당 이름의 한 행으로 좁힘',await p.locator('.public-hospital-row').count()===1 && await hospitalChoice.isVisible());
  if (width===390) await hospitalChoice.tap(); else await hospitalChoice.press('Enter');
  check(width+' 병원 선택 뒤 진료과를 정할 때까지 다음 단계 대기',await p.locator('#public-visit-department').isVisible() && await p.locator('[data-book-primary]').isDisabled());
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
