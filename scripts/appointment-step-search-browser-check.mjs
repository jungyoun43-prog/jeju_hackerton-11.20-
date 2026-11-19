import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
const root=process.cwd(),base=process.env.BASE_URL||'http://127.0.0.1:4188';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname));
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=resolve(root,'output/step-search-qa');await mkdir(out,{recursive:true});
const proof={checkedAt:new Date().toISOString(),sourceHash:await runtimeFingerprint(root),result:'fail',checks:[],errors:[],posts:0,screenshots:[]};
const check=(name,value)=>{proof.checks.push({name,status:value?'pass':'fail'});assert.ok(value,name);};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
const action=(p,type,value)=>p.locator(`:is(#appointment-workspace,#appointment-actions) [data-book-action="${type}"]${value===undefined?'':`[data-book-value="${value}"]`}`).first().click();
const primary=p=>p.locator('#appointment-actions [data-book-primary]');
async function search(p,id,label,query,name){await p.locator('#'+id).click();const input=p.getByPlaceholder(label+' 검색',{exact:true});await input.fill(query);await p.getByRole('option',{name}).first().waitFor({state:'visible'});await input.press('Enter');}
async function layout(p,name){
  const data=await p.evaluate(()=>{
    const scroll=document.getElementById('conversation-scroll'),footer=document.getElementById('appointment-actions'),button=footer.querySelector('[data-book-primary]'),r=button.getBoundingClientRect(),css=getComputedStyle(button);
    return {fits:document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1&&scroll.scrollWidth<=scroll.clientWidth+1,primaryVisible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&r.height>=44,one:footer.querySelectorAll('[data-book-primary]').length===1,formHidden:document.getElementById('conversation-form').hidden&&document.getElementById('conversation-form').inert,focus:!document.activeElement.closest('[inert]'),color:css.color,background:css.backgroundColor};
  });
  check(name+' 화면 경계·고정 다음 버튼·원래 입력 비활성',data.fits&&data.primaryVisible&&data.one&&data.formHidden&&data.focus);
  check(name+' 다음 버튼이 흰 배경 링크와 구별됨',data.background!=='rgba(0, 0, 0, 0)'&&data.background!=='rgb(255, 255, 255)'&&data.color==='rgb(255, 255, 255)');
}
async function shot(p,name){await p.screenshot({path:resolve(out,name+'.png')});proof.screenshots.push(name+'.png');}
let active;
try {
  check('빌드와 실행 소스 지문 일치',(await(await fetch(base+'/deployment.json')).json()).sourceHash===proof.sourceHash);
  for(const [width,height] of [[1440,900],[390,844],[900,600],[320,500]]) {
    const c=await browser.newContext({viewport:{width,height},locale:'ko-KR',reducedMotion:'reduce',acceptDownloads:true});
    await c.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
    const p=await c.newPage();active=p;p.setDefaultTimeout(12000);p.on('pageerror',e=>proof.errors.push(e.message));p.on('request',r=>{if(r.method()==='POST')proof.posts++;});
    await p.goto(base);await p.locator('#choose-region-seoul').click();await p.evaluate(()=>document.fonts.ready);
    await layout(p,width+' 병원·진료과');await shot(p,'step1-'+width);
    check(width+' 상단과 오른쪽 네 단계 일치',await p.locator('.appointment-progress li').count()===4&&JSON.stringify(await p.locator('.appointment-progress li').allTextContents())===JSON.stringify((await p.locator('.appointment-nav strong').allTextContents()).map((v,i)=>`${i+1}${v}`)));
    await p.locator('#appointment-department').click();await p.locator('[cmdk-item]').first().waitFor();check(width+' 27개 진료과 목록',await p.locator('[cmdk-item]').count()===27);
    await p.getByPlaceholder('진료과 검색',{exact:true}).fill('없는과xyz');await p.locator('[cmdk-empty]').waitFor({state:'visible'});check(width+' 검색 빈 결과 안내',/검색 결과가 없어요/.test(await p.locator('[cmdk-empty]').innerText()));
    await p.getByPlaceholder('진료과 검색',{exact:true}).fill('종양');await p.getByRole('option',{name:/종양내과/}).waitFor();await p.getByPlaceholder('진료과 검색',{exact:true}).press('Enter');
    check(width+' 검색 키보드 선택 후 초점 복귀',await p.locator('#appointment-department').evaluate(n=>n===document.activeElement));
    await primary(p).click();check(width+' 접수 질문 없이 월간 일정으로 이동',await p.locator('.rdp-caption_label').innerText()==='2026년 11월'&&await p.locator('[data-book-action="visit_type"]').count()===0);
    await p.getByRole('button',{name:'다음 달',exact:true}).click();await action(p,'preferred_date','2026-12-08');
    check(width+' 날짜 선택 뒤 의료진·시간 선택 안내',await primary(p).getAttribute('data-book-action')==='show_times');if(width<=900||height<=650)await p.locator('#workspace-tab-preparation').click();await primary(p).click();
    check(width+' 다음 버튼으로 시간 목록에 초점 이동',await p.locator('#availability-result-title').evaluate(n=>n===document.activeElement&&n.getBoundingClientRect().top>=0));
    await action(p,'slot','hanbit-kim|2026-12-08|14:40');check(width+' 선택한 의사와 시각이 하단에 표시',/김도윤.*2026-12-08.*14:40/.test(await p.locator('.booking-footer-selection').innerText()));
    await layout(p,width+' 의료진·시간');await shot(p,'step2-'+width);await primary(p).click();
    check(width+' 접수 답변 전 요청 차단',await primary(p).isDisabled());await action(p,'visit_type','first');check(width+' 의뢰서 답변 전 요청 차단',await primary(p).isDisabled());
    await action(p,'referral','missing');check(width+' 미의뢰서는 상담으로 연결',await primary(p).isEnabled()&&/상담 요청/.test(await primary(p).innerText())&&/14:40/.test(await p.locator('.appointment-selection').innerText()));
    await p.locator('#appointment-actions [aria-label="이전 단계"]').click();check(width+' 이전 단계에서 선택 시간 유지',await p.locator('[data-book-value="hanbit-kim|2026-12-08|14:40"]').getAttribute('aria-pressed')==='true');
    await primary(p).click();await action(p,'referral','reported');await layout(p,width+' 접수 확인');await shot(p,'step3-'+width);
    await primary(p).click();await action(p,'reply','confirm');await primary(p).click();check(width+' 마지막 단계 이동과 준비표 저장 연결',await primary(p).getAttribute('data-book-action')==='save'&&await p.locator('#flight-search-title').isVisible());
    await action(p,'home');await p.locator('#choose-region-jeju').click();
    await p.locator('#public-hospital-search').fill('검색결과없음xyz');await p.locator('.appointment-empty').waitFor();check(width+' 병원 검색 빈 표본 설명',/병원이 없다는 뜻은 아니/.test(await p.locator('.appointment-empty').innerText()));
    await p.locator('#public-hospital-search').fill('중앙로 373');await p.locator('.public-hospital-row').first().waitFor();check(width+' 주소로 실제 등록 병원 찾기',await p.locator('.public-hospital-row').count()===1&&/제주우리병원/.test(await p.locator('.public-hospital-row').innerText()));
    await action(p,'public_hospital','hospital-4');check(width+' 병원 선택 후 진료과 지정·명시적 다음',await p.locator('#public-visit-department').isVisible()&&await primary(p).isDisabled());
    await search(p,'public-visit-department','진료받을 과','정형',/정형외과/);await layout(p,width+' 공개 병원 선택');await primary(p).click();
    const day=p.locator('[data-book-action="public_date"]:not([disabled])').nth(1),date=await day.getAttribute('data-book-value');await day.click();check(width+' 공개 날짜 다음은 희망 의료진 조건',await primary(p).getAttribute('data-book-action')==='public_show_preferences');await primary(p).click();
    check(width+' 희망 의료진 조건으로 초점 이동',await p.locator('#public-preferences-title').evaluate(n=>n===document.activeElement));
    await action(p,'public_doctor_mode','named');check(width+' 이름 없이 다음 진행 제한',await primary(p).isDisabled());await p.locator('#public-doctor-name').fill('문의할 의료진');
    await action(p,'public_time','specific');check(width+' 정확한 시각 미입력 안내',await primary(p).isDisabled());await p.locator('#public-exact-time').fill('10:20');
    check(width+' 이름·정확한 시각 입력 보존',await p.locator('#public-doctor-name').inputValue()==='문의할 의료진'&&await primary(p).isEnabled());await layout(p,width+' 희망 의료진·시각');await shot(p,'public-preferences-'+width);
    await primary(p).click();const reviewText=await p.locator('.public-hospital-review').innerText();check(width+' 실기관 희망 조건과 예약 상태 구분',['정형외과','문의할 의료진','10:20','예약 미확정','소속·가능 여부 미확인'].every(t=>reviewText.includes(t))&&await p.locator('[data-book-action="reply"]').count()===0);
    const wait=p.waitForEvent('download');await action(p,'save');const file=await wait,path=resolve(out,'public-wishes-'+width+'.md');await file.saveAs(path);const report=await readFile(path,'utf8');check(width+' 준비표에 입력 조건과 미확인 경계 보존',['제주우리병원','정형외과','문의할 의료진','10:20 희망',date,'진료 가능 여부 미확인','예약 미확정'].every(t=>report.includes(t))&&!report.includes('김도윤'));
    await primary(p).click();await search(p,'jeju-support-area','이동·지원 문의 지역','한경',/제주시 한경면/);check(width+' 이동 지역도 검색 선택',/한경면/.test(await p.locator('#jeju-support-area').innerText()));
    await layout(p,width+' 이동·준비표');await c.close();active=null;
  }
  check('예약·모델·외부 POST 없음',proof.posts===0);check('브라우저 오류 없음',proof.errors.length===0);check('검사 중 실행 소스 불변',await runtimeFingerprint(root)===proof.sourceHash);proof.result='pass';
} catch(e) {if(active)await shot(active,'failure');throw e;}
finally {await browser.close();await writeFile(resolve(out,'report.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({result:proof.result,checks:proof.checks.length,errors:proof.errors,posts:proof.posts,sourceHash:proof.sourceHash}));}
