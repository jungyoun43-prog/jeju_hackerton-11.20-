import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
const root=process.cwd(),base=process.env.BASE_URL||'http://127.0.0.1:4188';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname));
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=resolve(root,'output/jeju-data-qa');await mkdir(out,{recursive:true});
const proof={checkedAt:new Date().toISOString(),sourceHash:await runtimeFingerprint(root),result:'fail',checks:[],errors:[],posts:0,screenshots:[]};
const check=(name,value)=>{proof.checks.push({name,status:value?'pass':'fail'});assert.ok(value,name);};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
const action=(p,type,value)=>p.locator(`:is(#appointment-workspace,#appointment-actions) [data-book-action="${type}"]${value===undefined?'':`[data-book-value="${value}"]`}`).first().click();
const choose=async(p,id,name)=>{await p.locator('#'+id).click();await p.getByRole('option',{name,exact:true}).click();};
async function layout(p,name){check(name,await p.evaluate(()=>{const el=document.getElementById('conversation-scroll');return document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1&&el.scrollWidth<=el.clientWidth+1&&!document.activeElement.closest('[inert]');}));}
async function shot(p,name){await p.screenshot({path:resolve(out,name+'.png')});proof.screenshots.push(name+'.png');}
try {
  check('빌드 지문 일치',(await(await fetch(base+'/deployment.json')).json()).sourceHash===proof.sourceHash);
  for(const [width,height] of [[1440,900],[390,844],[900,600],[320,500]]){
    const context=await browser.newContext({viewport:{width,height},locale:'ko-KR',reducedMotion:'reduce',acceptDownloads:true});
    await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
    const p=await context.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>proof.errors.push(e.message));p.on('request',r=>{if(r.method()==='POST')proof.posts++;});
    await p.goto(base);await p.locator('#choose-region-jeju').click();await p.locator('#public-hospital-area').waitFor();await p.evaluate(()=>document.fonts.ready);
    check(width+' 공개자료 기본 진입',/제주 병원·진료과 선택/.test(await p.locator('#appointment-title').innerText())&&!await p.locator('#appointment-hospital').count());
    await choose(p,'public-hospital-area','서귀포시');check(width+' 빈 결과가 지역 부재로 해석되지 않음',/이 지역에 병원이 없다는 뜻은 아니에요/.test(await p.locator('.appointment-empty').innerText()));
    await choose(p,'public-hospital-area','제주시');await choose(p,'public-hospital-department','정형외과');
    check(width+' 실제 등록 과목 필터 3곳',await p.locator('.public-hospital-row').count()===3);
    await p.locator('#appointment-title').focus();await layout(p,width+' 병원 목록 레이아웃');await shot(p,'public-find-'+width);
    await action(p,'public_hospital','hospital-4');check(width+' 병원 선택만으로 화면 이동하지 않음',await p.locator('#public-hospital-search').isVisible());await action(p,'public_dates_next');check(width+' 실기관에 가상 의료진 없음',await p.locator('.public-wish-calendar').isVisible()&&await p.locator('.availability-doctor').count()===0);
    await action(p,'public_date_mode','range');
    const days=await p.locator('[data-book-action="public_date"]:not([disabled])').evaluateAll(nodes=>nodes.map(n=>n.dataset.bookValue));
    assert.ok(days.length>=2);await action(p,'public_date',days[0]);check(width+' 종료일 전 진행 제한',await p.locator('[data-book-action="public_prepare"]').isDisabled());
    await action(p,'public_date',days.at(-1));await action(p,'public_time','morning');
    check(width+' 희망 날짜에는 빈자리 표식 없음',!/가능:|마감:|시연 휴진일/.test(await p.locator('.public-wish-calendar').innerText()));
    await p.locator('.public-wish-calendar').scrollIntoViewIfNeeded();await layout(p,width+' 희망 날짜 레이아웃');await shot(p,'public-dates-'+width);
    await action(p,'public_prepare');check(width+' 문의 준비표와 미확정 구분',/제주우리병원/.test(await p.locator('.public-hospital-review').innerText())&&/예약 미확정/.test(await p.locator('.public-hospital-review').innerText()));
    await action(p,'view','support');check(width+' 애월 기본 문의처',/애월콜/.test(await p.locator('.public-support-list').innerText()));
    check(width+' 공개 문의 이동 시각은 다음 해 월말까지 입력',Number((await p.locator('#trip-homeDeparture').getAttribute('max')).slice(0,4))===Number(days[0].slice(0,4))+1);
    await p.getByRole('button',{name:'애월콜 문의처로 선택',exact:true}).click();
    check(width+' 선택이 차량 문의 창구로 연결',/애월콜/.test(await p.locator('.ground-booking').first().innerText()));
    await p.locator('#jeju-support-wheelchair').check();check(width+' 휠체어 조건은 공식 이동지원 먼저',await p.locator('.public-support-row').first().getAttribute('data-provider-id')==='jeju-accessible-transport');
    await p.getByRole('button',{name:'제주 교통약자 이동지원센터 문의처로 선택',exact:true}).click();
    await p.getByRole('group',{name:'제주 지원 문의 종류'}).getByRole('button',{name:/동행·돌봄/}).click();
    check(width+' 과거 돌봄과 동행 가능 구분',/2020년 돌봄 등록자료/.test(await p.locator('.jeju-support-contacts').innerText()));
    await p.getByRole('button',{name:'제주시 홀로 사는노인 지원센터 문의처로 선택',exact:true}).click();
    await p.getByRole('group',{name:'제주 지원 문의 종류'}).getByRole('button',{name:/공공보건/}).click();
    check(width+' 애월 관할 보건 문의처 우선',/애월보건지소/.test(await p.locator('.public-support-row').first().innerText()));
    await p.getByRole('button',{name:'애월보건지소 문의처로 선택',exact:true}).click();
    await p.locator('#jeju-support-title').scrollIntoViewIfNeeded();await layout(p,width+' 문의처 레이아웃');await shot(p,'public-support-'+width);
    const download=p.waitForEvent('download');await action(p,'save');const file=await download,path=resolve(out,'public-plan-'+width+'.md');await file.saveAs(path);const report=await readFile(path,'utf8');
    check(width+' 출처·날짜·지역 근거까지 저장',file.suggestedFilename()==='제주-병원-문의-준비표.md'&&['제주우리병원','애월보건지소','교통약자','2020-04-17','2026-03-19','2026-03-23','2024-10-17','오전 희망',days[0],days.at(-1),'예약 미확정'].every(t=>report.includes(t))&&!report.includes('바람종합'));
    await choose(p,'jeju-support-area','제주시 한경면');check(width+' 관할 변경하면 보건 문의처 변경·이전 선택 해제',/한경보건지소/.test(await p.locator('.public-support-row').first().innerText())&&!/선택:/.test(await p.locator('.public-support-context').innerText()));
    await choose(p,'jeju-support-area','서귀포시');check(width+' 제주시 파일 범위 밖 안내',/제주시 범위만/.test(await p.locator('.appointment-empty').innerText()));
    await action(p,'home');check(width+' 제주 이어보기 실기관 표시',/제주우리병원/.test(await p.locator('#choose-region-jeju').innerText()));
    await p.locator('#choose-region-seoul').click();
    if(width<=900||height<=650)await p.locator('#workspace-tab-preparation').click();
    await p.locator('#appointment-navigation [data-book-value="support"]').click();
    check(width+' 서울도 제주 출발 지원 자료 활용',await p.locator('#flight-search-title').isVisible()&&/애월콜/.test(await p.locator('.public-support-list').innerText()));
    await action(p,'home');await p.locator('#choose-region-jeju').click();check(width+' 지역별 문의 조건 독립 유지',/서귀포시/.test(await p.locator('#jeju-support-area').innerText()));
    await context.close();
  }
  check('외부 실행·모델 POST 없음',proof.posts===0);check('브라우저 오류 없음',proof.errors.length===0);proof.result='pass';
} finally {await browser.close();await writeFile(resolve(out,'browser-report.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({result:proof.result,checks:proof.checks.length,errors:proof.errors,posts:proof.posts,sourceHash:proof.sourceHash}));}
