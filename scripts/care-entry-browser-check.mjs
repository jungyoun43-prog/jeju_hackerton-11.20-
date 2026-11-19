import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runtimeFingerprint} from '../orchestration/checks.mjs';
const base=process.env.BASE_URL||'http://127.0.0.1:4189',out=resolve('output/compact-entry-qa/browser');
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
assert.equal((await(await fetch(base+'/api/agent/capabilities')).json()).llm,false,'keyless QA server required');
await mkdir(out,{recursive:true});const proof={sourceHash:await runtimeFingerprint(process.cwd()),checks:[],errors:[],modelCalls:0,voiceStarts:0,voiceEnds:0};
const check=(name,ok)=>{proof.checks.push({name,pass:Boolean(ok)});assert.ok(ok,name);};
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
try {
 for(const [width,height] of [[1366,768],[1280,720],[390,844],[320,600]]) {
  const context=await browser.newContext({viewport:{width,height},locale:'ko-KR'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==new URL(base).origin)return route.abort();if(url.pathname==='/api/agent'&&route.request().method()==='POST'){proof.modelCalls++;return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',e=>proof.errors.push(e.message));page.setDefaultTimeout(8000);await page.goto(base);
  await page.locator('#choose-region-jeju').waitFor();
  if(width===1280)await page.screenshot({path:resolve(out,'region-1280.png')});
  check(width+' 지역부터 선택',await page.locator('#choose-region-seoul').isVisible()&&!await page.locator('#conversation-form').isVisible());
  if(width>=1280)check(width+' 지역 화면 스크롤 불필요',await page.locator('#conversation-scroll').evaluate(n=>n.scrollHeight<=n.clientHeight+2));
  await page.locator('#choose-region-jeju').click();check(width+' 세 입력 방식 제공',await page.locator('.entry-method').count()===3);
  if(width===1280)await page.screenshot({path:resolve(out,'methods-1280.png')});
  await page.locator('#entry-mode-text').click();check(width+' 같은 입력창 유지',await page.locator('textarea#request-input').count()===1);
  const parts=['제주우리병원 정형외과',' 12월 1일부터 3일 사이 오후',' 의뢰서는 없어요.',' 애월읍에서 휠체어와 동행이 필요해요.'];let text='';
  for(const [i,part]of parts.entries()){text+=part;await page.locator('#request-input').fill(text);check(width+' 실시간 조건 '+(i+1),(await page.locator('.entry-live li[data-found=true]').count())===i+1);}
  check(width+' 입력 중 외부 모델 자동 호출 없음',proof.modelCalls===0);
  if(width>=1280)check(width+' 입력과 네 항목이 한 화면',await page.locator('#conversation-scroll').evaluate(n=>n.scrollHeight<=n.clientHeight+8));
  await page.evaluate(()=>document.fonts.load('24px "Jeju Gothic"'));check(width+' 제주고딕 로드',await page.evaluate(()=>document.fonts.check('24px "Jeju Gothic"')));
  if([1280,390].includes(width))await page.screenshot({path:resolve(out,`live-${width}.png`)});
  await page.locator('#send-request').click();check(width+' 기간·과·시간을 요약에 반영',/제주우리병원[\s\S]*정형외과[\s\S]*2026-12-01 ~ 2026-12-03[\s\S]*오후/.test(await page.locator('.entry-review-rows').innerText()));
  check(width+' 원문 초안 보존',await page.locator('#request-input').inputValue()===text);
  if(width===1280)await page.screenshot({path:resolve(out,'summary-1280.png')});
  await page.getByRole('button',{name:'진료과 수정',exact:true}).click();check(width+' 직접 수정에 기존 조건 연결',await page.locator('#public-visit-department').innerText()==='정형외과');
  check(width+' 다른 병원과 출처 기본 접힘',await page.locator('.public-candidates').getAttribute('open')===null&&await page.locator('.jeju-data-sources').getAttribute('open')===null);
  await page.locator('[data-book-action="entry_summary"]').click();check(width+' 요약 복귀 보존',(await page.locator('.entry-review-rows').innerText()).includes('2026-12-01'));
  await page.getByRole('button',{name:'이동·준비표로 계속',exact:true}).click();check(width+' 상세 이동정보 접힘',await page.getByText('제주 이동·동행 문의처 찾기',{exact:true}).isVisible()&&!await page.locator('#jeju-support-area').isVisible());
  await page.getByText('제주 이동·동행 문의처 찾기',{exact:true}).click();check(width+' 지원 조회에 입력 반영',await page.locator('#jeju-support-wheelchair').getAttribute('data-state')==='checked');
  check(width+' 문서 전체 overflow 없음',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1));
  check(width+' 모델명/추론 설정 숨김',!/(gpt-|reasoningEffort|\bmedium\b)/i.test(await page.locator('body').innerText()));
  await context.close();
 }
 const context=await browser.newContext({viewport:{width:1280,height:720},locale:'ko-KR'});
 await context.addInitScript(()=>{
  window.__voiceTest={mediaCalls:0,stopped:0,sent:[]};
  const track={stop(){window.__voiceTest.stopped++;}};
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{window.__voiceTest.mediaCalls++;return{getTracks:()=>[track],getAudioTracks:()=>[track]};}},configurable:true});
  window.RTCPeerConnection=class {constructor(){window.__voiceTest.peer=this;this.connectionState='new';}addTrack(){}createDataChannel(){const c={readyState:'connecting',send:text=>window.__voiceTest.sent.push(JSON.parse(text)),close(){this.readyState='closed';}};window.__voiceTest.channel=c;return c;}async createOffer(){return{sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'};}async setLocalDescription(){}async setRemoteDescription(){this.connectionState='connected';window.__voiceTest.channel.readyState='open';window.__voiceTest.channel.onopen();}close(){this.connectionState='closed';}};
 });
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==new URL(base).origin)return route.abort();if(url.pathname==='/api/voice/session'){proof.voiceStarts++;return route.fulfill({json:{sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',token:'x'.repeat(43),expiresIn:180}});}if(url.pathname==='/api/voice/end'){proof.voiceEnds++;return route.fulfill({json:{ended:true}});}if(url.pathname==='/api/agent'&&route.request().method()==='POST'){proof.modelCalls++;return route.abort();}return route.continue();});
 const p=await context.newPage();p.on('pageerror',e=>proof.errors.push(e.message));await p.goto(base);await p.locator('#choose-region-jeju').click();await p.locator('#entry-mode-voice').click();
 check('음성 방식 선택만으로 마이크를 열지 않음',await p.evaluate(()=>window.__voiceTest.mediaCalls===0));await p.locator('#realtime-start').click();await p.getByText('듣고 있어요',{exact:true}).waitFor();
 check('명시 시작 후 WebRTC 연결',proof.voiceStarts===1&&await p.evaluate(()=>window.__voiceTest.mediaCalls===1));
 const emit=event=>p.evaluate(event=>window.__voiceTest.channel.onmessage({data:JSON.stringify(event)}),event);
 await emit({type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:'제주우리병원 정형외과 12월 1일 오후. 의뢰서는 없고 애월읍에서 휠체어가 필요해요.'});
 check('음성 전사가 네 항목을 갱신',await p.locator('.entry-live li[data-found=true]').count()===4);
 await emit({type:'response.output_audio_transcript.delta',delta:'희망 날짜를 확인할게요.'});await p.getByText('말씀하셔도 돼요 · 끼어들기 가능',{exact:true}).waitFor();
 check('1280 음성·네 항목·입력 한 화면',await p.locator('#conversation-scroll').evaluate(n=>n.scrollHeight<=n.clientHeight+8));await p.screenshot({path:resolve(out,'voice-1280.png')});
 await emit({type:'input_audio_buffer.speech_started'});check('사용자가 말하면 듣기 상태로 전환',await p.getByText('듣고 있어요',{exact:true}).isVisible());
 await emit({type:'response.function_call_arguments.done',name:'update_preparation',call_id:'c1',arguments:JSON.stringify({text:'제주우리병원 정형외과 12월 3일 오후. 의뢰서는 없고 애월읍에서 휠체어가 필요해요.'})});
 check('AI 정정 요약도 확인 전 조건으로 갱신',(await p.locator('.entry-live').innerText()).includes('2026-12-03'));
 await p.locator('#realtime-stop').click();check('종료 시 마이크·피어 정리',await p.evaluate(()=>window.__voiceTest.stopped===1&&window.__voiceTest.peer.connectionState==='closed'));
 await emit({type:'conversation.item.input_audio_transcription.completed',item_id:'late',transcript:'늦은 오염'});check('늦은 음성 이벤트를 무시',!(await p.locator('#request-input').inputValue()).includes('늦은 오염'));
 await p.locator('#send-request').click();check('음성 조건 적용은 사용자 확인 뒤',(await p.locator('.entry-review-rows').innerText()).includes('2026-12-03'));
 await p.emulateMedia({reducedMotion:'reduce'});check('모션 줄이기 적용',await p.locator('#care-transition').evaluate(n=>getComputedStyle(n).display==='none'));
 check('고정 응답 검사만 사용',proof.modelCalls===0&&proof.voiceStarts===1&&proof.voiceEnds===1);await context.close();
 check('브라우저 JS 오류 없음',proof.errors.length===0);proof.result='pass';
} finally {await browser.close();await writeFile(resolve(out,'report.json'),JSON.stringify(proof,null,2));}
console.log(JSON.stringify({result:proof.result,checks:proof.checks.length,voiceFixtures:proof.voiceStarts,liveCalls:0}));
