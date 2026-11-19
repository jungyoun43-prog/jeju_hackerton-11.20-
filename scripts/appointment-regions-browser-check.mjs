import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
const root=process.cwd(),base=process.env.BASE_URL || 'http://127.0.0.1:4188';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname));
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=resolve(root,'output/region-booking-qa');await mkdir(out,{recursive:true});
const proof={checkedAt:new Date().toISOString(),sourceHash:await runtimeFingerprint(root),result:'fail',checks:[],errors:[],posts:0,screenshots:[]};
const check=(name,value)=>{proof.checks.push({name,status:value?'pass':'fail'});assert.ok(value,name);};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined});
const action=(page,type,value)=>page.locator(`:is(#appointment-workspace,#appointment-actions) [data-book-action="${type}"]${value===undefined?'':`[data-book-value="${value}"]`}`).first().click();
const shot=async(page,name)=>{await page.screenshot({path:resolve(out,name+'.png')});proof.screenshots.push(name+'.png');};
async function layout(page,name,home=false) {
  const sizes=await page.evaluate(()=>{
    const scroll=document.getElementById('conversation-scroll'),a=document.getElementById('choose-region-jeju').getBoundingClientRect(),b=document.getElementById('choose-region-seoul').getBoundingClientRect();
    return {fits:document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1 && scroll.scrollWidth<=scroll.clientWidth+1,side:a.right<=b.left && a.top===b.top,big:a.height>=280 && b.height>=280,hidden:document.getElementById('existing-visit-workspace').inert && document.getElementById('preparation-rail').inert && document.getElementById('chat-composer').hidden,focus:!document.activeElement.closest('[inert]')};
  });
  check(name+' 화면 경계·초점',sizes.fits&&sizes.focus);
  if(home)check(name+' 큰 좌우 선택·기존 영역 비활성',sizes.side&&sizes.big&&sizes.hidden);
}
try {
  check('빌드 지문 일치',(await (await fetch(base+'/deployment.json')).json()).sourceHash===proof.sourceHash);
  for(const [width,height] of [[1440,900],[390,844],[900,600],[320,500]]) {
    const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',locale:'ko-KR',acceptDownloads:true});
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
    const p=await context.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>proof.errors.push(e.message));p.on('request',r=>{if(r.method()==='POST')proof.posts++;});
    await p.goto(base);await p.locator('#choose-region-jeju').waitFor();await p.evaluate(()=>document.fonts.ready);
    await layout(p,width+' 첫 화면',true);await shot(p,'home-'+width);
    check(width+' 첫 화면은 시작 문구',/예약 준비 시작/.test(await p.locator('#choose-region-seoul').innerText()));
    await p.locator('#choose-region-jeju').focus();await p.keyboard.press('Enter');
    check(width+' 제주 기본은 공개 병원 탐색',await p.locator('#public-hospital-area').isVisible());
    await action(p,'data_mode','demo');
    check(width+' 제주 진입·제목 초점',/제주 병원·진료과/.test(await p.locator('#appointment-title').innerText()) && await p.locator('#appointment-title').evaluate(n=>document.activeElement===n));
    await p.locator('#appointment-hospital').click();
    await p.locator('[cmdk-item]').first().waitFor({state:'visible'});
    check(width+' 제주 병원만 선택 가능',await p.locator('[cmdk-item]').count()===2 && !/서울/.test(await p.locator('[cmdk-list]').innerText()));
    await p.getByRole('option',{name:'서귀포 온유병원 (가상)',exact:true}).click();
    await action(p,'find_dates');await action(p,'preferred_date','2026-11-19');
    check(width+' 다른 제주 병원 의료진·시간',await p.locator('[data-book-value="onyu-moon|2026-11-19|10:00"]').isVisible());
    await action(p,'back');await p.locator('#appointment-hospital').click();await p.getByRole('option',{name:'제주 바람종합병원 (가상)',exact:true}).click();
    await action(p,'find_dates');await action(p,'preferred_date','2026-11-18');
    check(width+' 같은 날 제주 의료진 2명 비교',await p.locator('.availability-doctor').count()===2 && await p.locator('[data-book-action="slot"]').count()===3);
    await action(p,'slot','baram-kang|2026-11-18|09:30');await p.locator('[data-book-value="baram-kang|2026-11-18|09:30"]').hover();
    const contrast=await p.locator('[data-book-value="baram-kang|2026-11-18|09:30"]').evaluate(n=>{
      const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(v=>Number(v)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0);
      const css=getComputedStyle(n),a=luminance(css.color),b=luminance(css.backgroundColor);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    });
    check(width+' 선택 시간 hover 대비 4.5 이상',contrast>=4.5);await layout(p,width+' 제주 달력');
    await p.locator('#conversation-scroll').evaluate(n=>n.scrollTop=0);await shot(p,'jeju-calendar-'+width);
    await action(p,'home');await layout(p,width+' 제주 준비 후 홈',true);
    check(width+' 제주 이어보기·시간 요약',/제주 예약 준비 이어보기/.test(await p.locator('#choose-region-jeju').innerText()) && /09:30/.test(await p.locator('#choose-region-jeju').innerText()));
    await p.locator('#choose-region-seoul').click();
    check(width+' 접수 응답 전 일정 열람 허용',await p.locator('#appointment-actions [data-book-action="find_dates"]').isEnabled() && await p.locator('[data-book-action="visit_type"]').count()===0);
    await action(p,'find_dates');await action(p,'next_match');await action(p,'preferred_date','2026-12-08');await action(p,'slot','hanbit-kim|2026-12-08|14:40');
    await action(p,'home');check(width+' 서울·제주 각각 이어보기',/14:40/.test(await p.locator('#choose-region-seoul').innerText()) && /09:30/.test(await p.locator('#choose-region-jeju').innerText()));
    await shot(p,'resume-'+width);await p.locator('#choose-region-jeju').click();
    check(width+' 제주 선택 그대로 복원',await p.locator('[data-book-value="baram-kang|2026-11-18|09:30"]').getAttribute('aria-pressed')==='true');
    await action(p,'review');await action(p,'visit_type','first');await action(p,'request');await action(p,'reply','confirm');
    check(width+' 제주 회신 시연 표시',/실제 병원 예약은 만들어지지/.test(await p.locator('.appointment-result-state').innerText()));
    await action(p,'view','support');check(width+' 제주 병원 왕복만 표시',await p.locator('#trip-leg-jeju').isVisible() && await p.locator('#trip-leg-return').isVisible() && await p.locator('#flight-search-title').count()===0 && !/제주공항|항공편/.test(await p.locator('#appointment-workspace').innerText()));
    await p.locator('#trip-jejuMode').click();await p.getByRole('option',{name:'교통약자 차량',exact:true}).click();
    check(width+' 제주 휠체어 공식 접수 연결',await p.locator('a[href="https://www.jejuhappycall.com/reservation?mcode=res01"]').count()>=1);
    await p.locator('#trip-check-hospital').check();
    await action(p,'home');await p.locator('#choose-region-seoul').click();await action(p,'home');await p.locator('#choose-region-jeju').click();
    check(width+' 제주 이동 계획·체크 독립 복원',await p.locator('#trip-check-hospital').isChecked() && /교통약자 차량/.test(await p.locator('#trip-jejuMode').innerText()));
    const download=p.waitForEvent('download');await action(p,'save');const file=await download;const path=resolve(out,'jeju-'+width+'.md');await file.saveAs(path);
    const report=await readFile(path,'utf8');check(width+' 제주 보고서·지역·일정',file.suggestedFilename().startsWith('제주') && /2026-11-18 09:30/.test(report) && !/항공권 가격 비교|제주공항/.test(report));
    await action(p,'home');await p.locator('#open-existing-preparation').click();await p.locator('#request-input').fill('지역을 바꾸어도 남길 요청 초안');
    await p.evaluate(()=>window.regionOriginalInput=document.getElementById('request-input'));await p.locator('#choose-care-region').click();await p.locator('#choose-region-seoul').click();await action(p,'close');
    check(width+' 기존 대화 DOM·초안 보존',await p.locator('#request-input').inputValue()==='지역을 바꾸어도 남길 요청 초안' && await p.evaluate(()=>document.getElementById('request-input')===window.regionOriginalInput));
    await p.reload();await p.locator('#choose-region-jeju').waitFor();check(width+' 새로고침은 지역 시작으로',!/이어보기/.test(await p.locator('#care-region-workspace').innerText()));
    await context.close();
  }
  check('예약·모델 POST 없음',proof.posts===0);check('브라우저 오류 없음',proof.errors.length===0);proof.result='pass';
} finally {await browser.close();await writeFile(resolve(out,'report.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({result:proof.result,checks:proof.checks.length,errors:proof.errors,posts:proof.posts,sourceHash:proof.sourceHash}));}
