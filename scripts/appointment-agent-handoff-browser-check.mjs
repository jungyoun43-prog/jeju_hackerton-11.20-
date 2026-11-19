import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
const base=process.env.BASE_URL||'http://127.0.0.1:4189';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const caps=await(await fetch(base+'/api/agent/capabilities')).json();
assert.equal(caps.llm,false,'실제 키를 쓰는 서버에서는 회귀 검사를 실행하지 않는다');
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=resolve('output/api-connection-qa/handoff');await mkdir(out,{recursive:true});
const proof={sourceHash:await runtimeFingerprint(process.cwd()),checks:[],errors:[],posts:0,liveCalls:0};
const check=(name,ok)=>{proof.checks.push({name,pass:Boolean(ok)});assert.ok(ok,name);};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const action=(p,name,value)=>p.locator(`[data-book-action="${name}"]${value!==undefined?`[data-book-value="${value}"]`:''}`).first().click();
const next=p=>p.locator('#appointment-actions [data-book-primary]');
try {
  check('빌드와 소스 일치',(await(await fetch(base+'/deployment.json')).json()).sourceHash===proof.sourceHash);
  for(const [width,height]of [[1440,900],[390,844]]) {
    const context=await browser.newContext({viewport:{width,height},locale:'ko-KR',acceptDownloads:true});
    const captured=[];
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==new URL(base).origin)return route.abort();
      if(url.pathname==='/api/agent/capabilities')return route.fulfill({json:{llm:true,phone:'simulation',healthRecords:'demo',voiceInput:'browser',progress:'unavailable',visitRecovery:'unavailable'}});
      if(url.pathname==='/api/agent'&&route.request().method()==='POST'){captured.push(route.request().postDataJSON());proof.posts++;return route.fulfill({status:503,json:{error:{code:'MODEL_QUOTA_EXHAUSTED',message:'고정 검사'},requestId:captured.at(-1).requestId}});}
      return route.continue();
    });
    const p=await context.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>proof.errors.push(e.message));
    await p.goto(base);await p.getByRole('button',{name:'대화·자료 준비 열기'}).click();await p.locator('#request-input').fill('동행도 필요한지 확인해 주세요.');await p.locator('#choose-care-region').click();await p.locator('#choose-region-jeju').click();
    await p.locator('#public-hospital-search').fill('제주우리병원');await action(p,'public_hospital','hospital-4');
    await p.locator('#public-visit-department').click();await p.getByRole('option',{name:'정형외과',exact:true}).click();await next(p).click();
    await action(p,'public_date_mode','range');await action(p,'public_date','2026-11-20');await action(p,'public_date','2026-11-23');await next(p).click();await action(p,'public_time','morning');await next(p).click();
    check(width+' 공개 문의 단계명 일치',(await p.locator('.appointment-progress').innerText()).includes('문의 내용 확인')&&(await p.locator('.booking-footer-step').innerText()).includes('문의 내용 확인'));
    const url=new URL(await p.getByRole('link',{name:'병원 공식 창구 검색'}).getAttribute('href'));check(width+' 병원명이 이어지는 공식 창구 검색',url.searchParams.get('query').includes('제주우리병원'));
    await next(p).click();await p.locator('#jeju-support-wheelchair').check();await p.getByRole('button',{name:'제주 교통약자 이동지원센터 문의처로 선택',exact:true}).click();
    check(width+' 오전 희망을 미선택으로 오표시하지 않음',/오전 희망/.test(await p.locator('.trip-assessment').innerText())&&!/시각 미선택/.test(await p.locator('.trip-assessment').innerText()));
    const downloadPromise=p.waitForEvent('download');await next(p).click();const download=await downloadPromise;const saved=resolve(out,'preparation-'+width+'.md');await download.saveAs(saved);const report=await readFile(saved,'utf8');
    check(width+' 저장표에 시간과 문의처·출처 보존',/오전 희망/.test(report)&&/제주 교통약자 이동지원센터/.test(report)&&/jejudatahub.net/.test(report));
    await p.getByRole('button',{name:'AI 요청 준비하기'}).scrollIntoViewIfNeeded();await p.screenshot({path:resolve(out,'handoff-'+width+'.png')});
    await p.getByRole('button',{name:'AI 요청 준비하기'}).click();
    const draft=await p.locator('#request-input').inputValue();
    check(width+' 기존 작성 문장 보존',draft.startsWith('동행도 필요한지 확인해 주세요.'));
    check(width+' 병원·진료과·기간·시간·문의처 전달',/제주우리병원/.test(draft)&&/정형외과/.test(draft)&&/2026-11-20 ~ 2026-11-23/.test(draft)&&/오전/.test(draft)&&/제주 교통약자 이동지원센터/.test(draft));
    check(width+' 초안만 작성하고 자동 API 전송 없음',captured.length===0);
    check(width+' 초안 길이·초점·모델 비노출',draft.length<=1600&&await p.locator('#request-input').evaluate(n=>n===document.activeElement)&&!/(gpt-|reasoningEffort|medium)/i.test(await p.locator('body').innerText()));
    await p.locator('#send-request').click();await p.locator('#message-list').getByText('AI 이용 잔액이 소진되어 운영자의 확인이 필요해요.',{exact:false}).waitFor();
    check(width+' 실제 전송 본문에 선택 조건 포함',captured.length===1&&captured[0].message===draft);
    check(width+' 계정 잔액 오류에서 재시도 오안내 없음',!(await p.locator('#message-list').innerText()).includes('잠시 뒤 다시 요청'));
    check(width+' 오류 후 초안 유지',(await p.locator('#request-input').inputValue())===draft);
    check(width+' 화면 오버플로 없음',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1));
    await p.screenshot({path:resolve(out,'quota-'+width+'.png')});await context.close();
  }
  check('JS 오류 없음',proof.errors.length===0);proof.result='pass';
} finally {await browser.close();await writeFile(resolve(out,'report.json'),JSON.stringify(proof,null,2));}
console.log(JSON.stringify({result:proof.result,checks:proof.checks.length,posts:proof.posts,liveCalls:proof.liveCalls,sourceHash:proof.sourceHash}));
