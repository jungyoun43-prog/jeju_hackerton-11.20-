import { createDemoCase, getProgress, getTasks, buildReport } from './domain.js';
import { getVisitSupportSummary } from './visit-support.js';
import { icon } from './icons.js';
import { DEFAULT_CARE_PREFERENCES, normalizeCarePreferences, getTaxiPreferenceOptions } from './care-preferences.js';
import { formatMessage } from './message-format.js';

const API = '/api/agent';
const MAX_MESSAGE = 1600;
const MAX_HISTORY = 8;
const MAX_HISTORY_TEXT = 2000;
const PREFERENCES_STORAGE_KEY = 'jeju-care-preferences-v1';
const mobileRail = window.matchMedia('(max-width:1050px)');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const micIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';
const stopIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
const makeId = () => crypto.randomUUID();
const timeLabel = date => new Intl.DateTimeFormat('ko-KR', {hour:'2-digit',minute:'2-digit',hour12:false}).format(date);

let caseState = createDemoCase();
let sessionId;
let history = [];
let pending = false;
let capabilityState = 'checking';
let capabilities = {llm:null,model:'',phone:'not_connected',healthRecords:'not_connected',voiceInput:'browser'};
let latestActions = [];
let latestEvents = [];
let responseCount = 0;
let previewMode = false;
let activeRecognition;
let recognitionCancelled = false;
let recognitionFailed = false;
let finalTranscript = '';
let voiceBase = '';
let composing = false;
let preferencesStored = false;
let preferencesStorageAvailable = true;
let carePreferences = loadCarePreferences();
let preferencesNeedApply = true;
let drawerOpen = false;
let drawerReturnFocus;
const failedRequests = new Map();

function loadCarePreferences() {
  try {
    const raw=localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if(raw===null)return {...DEFAULT_CARE_PREFERENCES};
    const normalized=normalizeCarePreferences(JSON.parse(raw),{strict:true});
    preferencesStored=true;
    return normalized;
  } catch {
    try {localStorage.removeItem(PREFERENCES_STORAGE_KEY);} catch {preferencesStorageAvailable=false;}
    return {...DEFAULT_CARE_PREFERENCES};
  }
}

function preferencesEqual(left,right) {
  return left?.taxiProviderId===right?.taxiProviderId && left?.wheelchair===right?.wheelchair && left?.companionNeeded===right?.companionNeeded;
}

function preferenceFeedback() {
  const status=document.getElementById('preferences-status');
  status.textContent=previewMode ? '고정 미리보기에는 설정을 적용하지 않아요.' : !preferencesStorageAvailable ? '이 기기에 저장하지 못했어요. 이번 화면의 다음 요청에는 반영해요.' : preferencesNeedApply ? preferencesStored ? '이 기기에 저장 · 다음 요청부터 반영' : '기본값 · 다음 요청에 반영' : '현재 대화에 반영됨 · 변경하면 다음 요청부터 적용';
}

function renderPreferences() {
  const options=getTaxiPreferenceOptions(caseState.patient.area);
  if(!options.some(item=>item.value===carePreferences.taxiProviderId)) {
    const selected=getTaxiPreferenceOptions('').find(item=>item.value===carePreferences.taxiProviderId);
    if(selected)options.push({...selected,label:`${selected.label} · 지역 확인 필요`});
  }
  document.getElementById('pref-taxi').innerHTML=options.map(item=>`<option value="${escape(item.value)}"${item.value===carePreferences.taxiProviderId?' selected':''}>${escape(item.label)}</option>`).join('');
  document.getElementById('pref-wheelchair').checked=carePreferences.wheelchair;
  document.getElementById('pref-companion').checked=carePreferences.companionNeeded;
  preferenceFeedback();
}

function changePreferences() {
  carePreferences=normalizeCarePreferences({taxiProviderId:document.getElementById('pref-taxi').value,wheelchair:document.getElementById('pref-wheelchair').checked,companionNeeded:document.getElementById('pref-companion').checked});
  preferencesNeedApply=true;
  try {localStorage.setItem(PREFERENCES_STORAGE_KEY,JSON.stringify(carePreferences));preferencesStored=true;preferencesStorageAvailable=true;}
  catch {preferencesStored=false;preferencesStorageAvailable=false;}
  preferenceFeedback();
}

function closeCareMenu({restoreFocus=true}={}) {
  drawerOpen=false;document.body.classList.remove('drawer-open');
  const rail=document.getElementById('care-rail');
  rail.removeAttribute('role');rail.removeAttribute('aria-modal');rail.inert=mobileRail.matches;
  document.getElementById('workspace-shell').inert=false;
  document.getElementById('mobile-app-header').inert=false;
  document.getElementById('drawer-backdrop').hidden=true;
  document.getElementById('open-care-menu').setAttribute('aria-expanded','false');
  if(restoreFocus && mobileRail.matches)(drawerReturnFocus?.isConnected?drawerReturnFocus:document.getElementById('open-care-menu')).focus({preventScroll:true});
}

function openCareMenu() {
  if(!mobileRail.matches)return;
  drawerReturnFocus=document.activeElement;drawerOpen=true;
  const rail=document.getElementById('care-rail');rail.inert=false;rail.setAttribute('role','dialog');rail.setAttribute('aria-modal','true');
  document.body.classList.add('drawer-open');
  document.getElementById('drawer-backdrop').hidden=false;
  document.getElementById('open-care-menu').setAttribute('aria-expanded','true');
  document.getElementById('close-care-menu').focus({preventScroll:true});
  document.getElementById('workspace-shell').inert=true;
  document.getElementById('mobile-app-header').inert=true;
}

function hasConversationWork() {
  return Boolean(document.getElementById('request-input')?.value.trim() || document.querySelector('.message.user') || responseCount);
}

function dateLabel(value) {
  const date = new Date(`${value}T12:00:00Z`);
  return !value || Number.isNaN(date.valueOf()) ? '방문일 확인 필요' : new Intl.DateTimeFormat('ko-KR', {month:'long',day:'numeric',weekday:'short',timeZone:'UTC'}).format(date);
}

function safeSource(value) {
  const text = String(value ?? '').slice(0,600);
  try {
    const url = new URL(text);
    if (url.protocol === 'https:' && !url.username && !url.password) return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">출처 · ${escape(url.hostname)}${icon('external')}</a>`;
  } catch { /* 출처 설명 문자열은 링크로 바꾸지 않는다. */ }
  return text ? `<span>출처 · ${escape(text)}</span>` : '';
}

function publicHospitalLocation(hospital) {
  if (!hospital?.companyName || !hospital.address) return '';
  const query = encodeURIComponent(`${hospital.companyName} ${hospital.address}`);
  return `<div class="hospital-location"><span>공개 주소 · ${escape(hospital.address)}</span><a href="https://www.google.com/maps/search/?api=1&amp;query=${query}" target="_blank" rel="noopener noreferrer">지도에서 기관 보기${icon('external')}</a></div>`;
}

function normalizeHistory(items) {
  return items.slice(-MAX_HISTORY).map(item=>({role:item.role,text:item.text.slice(0,MAX_HISTORY_TEXT)}));
}

function safeSummary() {
  try { return {progress:getProgress(caseState),support:getVisitSupportSummary(caseState),tasks:getTasks(caseState)}; }
  catch { return null; }
}

function capabilityCopy() {
  const phone = capabilities.phone === 'connected' ? '통화 서비스 설정됨' : capabilities.phone === 'simulation' ? '병원·이동 문의는 시연' : '실제 전화 미연결';
  const records = capabilities.healthRecords === 'connected' ? '기록 연계 서비스 설정됨' : capabilities.healthRecords === 'demo' ? '합성 진료기록 사용' : '공단 진료기록 미연계';
  return {phone,records};
}

function updateCapabilities(next) {
  if (next && typeof next === 'object') {
    capabilities = {
      llm: typeof next.llm === 'boolean' ? next.llm : capabilities.llm,
      model: typeof next.model === 'string' ? next.model.slice(0,160) : capabilities.model,
      phone: ['simulation','not_connected','connected'].includes(next.phone) ? next.phone : capabilities.phone,
      healthRecords: ['demo','not_connected','connected'].includes(next.healthRecords) ? next.healthRecords : capabilities.healthRecords,
      voiceInput:'browser',
    };
  }
  if (capabilities.llm !== null) capabilityState = capabilities.llm === true ? 'connected' : 'unavailable';
  const connection = document.getElementById('connection-state');
  connection.className = `connection-state ${capabilityState}`;
  connection.textContent = capabilityState === 'connected' ? '대화 연결 설정됨' : capabilityState === 'checking' ? '연결 확인 중' : 'AI 모델 미연결';
  const copy = capabilityCopy();
  document.getElementById('mode-label').textContent = `가상 사례 · ${capabilities.phone === 'connected' ? '연결 상태 확인' : '실제 발신 없음'}`;
  document.getElementById('connection-details').innerHTML = `<dl><div><dt>대화</dt><dd>${capabilities.llm === true ? '모델 연결을 설정했습니다. 실제 응답은 요청을 보낼 때 확인합니다.' : capabilityState === 'checking' ? '대화 API 연결 상태를 확인하고 있습니다.' : 'AI 모델은 아직 연결하지 않았습니다. 자유 입력은 대화 API로 전송하며, 모델 연결 뒤 작동합니다.'}</dd></div><div><dt>기록</dt><dd>${escape(copy.records)}</dd></div><div><dt>문의</dt><dd>${escape(copy.phone)}</dd></div><div><dt>음성</dt><dd>${SpeechRecognition ? '브라우저에서 한국어 요청을 텍스트로 바꿉니다.' : '이 브라우저는 음성 입력을 지원하지 않습니다. 텍스트로 요청하세요.'}</dd></div></dl><p>실제 기록 조회에는 본인인증·동의와 연계 서비스가 필요합니다. 연결 설정과 실제 처리 완료는 구분합니다.</p>`;
  const notice = document.getElementById('mode-notice');
  notice.hidden = !previewMode && capabilities.llm === true;
  notice.classList.toggle('is-preview',previewMode);
  notice.textContent = previewMode ? '고정 시나리오 미리보기 · 환자·회신은 합성, LLM·실제 발신 없음' : capabilityState === 'checking' ? '연결 범위를 확인하고 있어요.' : '자유 대화는 AI 모델 연결 후 작동합니다. 지금은 고정 예시를 미리 볼 수 있어요.';
}

function renderSnapshot() {
  const snapshot = safeSummary();
  if (!snapshot) {
    document.getElementById('case-content').innerHTML = '<p class="quiet">준비 상태를 확인하지 못했어요. 대화에서 다시 확인을 요청해 주세요.</p>';
    return;
  }
  const {progress,support,tasks} = snapshot;
  const patient = caseState.patient;
  const confirmed = Object.values(caseState.inquiries).filter(item => item.status === 'confirmed').length;
  const time = caseState.visitSupport?.requirements?.appointmentTime;
  document.getElementById('case-heading').textContent = `${patient.name} 님의 진료 준비`;
  document.getElementById('case-caption').textContent = `${patient.area} · 보호자 ${patient.caregiver} · 합성 사례`;
  document.getElementById('rail-patient').textContent = `${patient.name} 님`;
  document.getElementById('rail-caregiver').textContent = `보호자 ${patient.caregiver}의 가상 가족 사례`;
  document.getElementById('rail-area').textContent = patient.area;
  renderPreferences();
  const items = [
    {name:'병원 문의',value:`${confirmed}/2곳 절차 확인${confirmed?' · 합성':''}`,detail:caseState.selectedHospital?.companyName || '제주 기관 확인 필요',ready:confirmed===2,symbol:'hospital',location:publicHospitalLocation(caseState.selectedHospital)},
    {name:'진료 자료',value:`${progress.prepared}/${progress.total}개 준비`,detail:progress.prepared===progress.total?'요청 자료 준비됨':'요청된 자료를 확인합니다.',ready:progress.prepared===progress.total,symbol:'folder'},
    {name:'택시 이동',value:support.taxi.label,detail:support.taxi.providerName || '지역 문의처 확인',ready:support.taxi.ready,symbol:'car'},
    {name:'병원 동행',value:support.companion.label,detail:support.companion.providerName || '필요한 지원 확인',ready:support.companion.ready,symbol:'users'},
  ];
  document.getElementById('mobile-case-summary').innerHTML = `<div class="mobile-summary-date"><strong>${escape(dateLabel(patient.nextVisit))}${time?` · ${escape(time)}`:''}</strong><span>시연 일정 · 예약 미확정</span></div><div class="mobile-summary-states"><span>병원 ${confirmed}/2${confirmed?'(합성)':''}</span><span>자료 ${progress.prepared}/${progress.total}</span><span>택시 ${support.taxi.ready?'시연 가능':'확인 필요'}</span><span>동행 ${support.companion.ready?'시연 가능':'확인 필요'}</span></div>`;
  const pendingItems = latestActions.length ? latestActions.map(item => ({title:item.label || '확인할 내용',reason:item.reason || ''})) : tasks.slice(0,2).map(task => ({title:task.title,reason:task.owner}));
  document.getElementById('case-content').innerHTML = `<div class="visit-date">${icon('calendar')}<div><span>이번 방문 · 시연 일정</span><strong>${escape(dateLabel(patient.nextVisit))}</strong><small>${time?`${escape(time)} 시각 가정`:'진료 시각 미정'} · ${escape(patient.area)} 출발</small></div></div><div class="read-only-statuses">${items.map(item => `<div class="read-only-status ${item.ready?'ready':''}" data-case-status="${escape(item.name)}">${icon(item.symbol)}<div><span>${escape(item.name)}</span><strong>${escape(item.value)}</strong><small>${escape(item.detail)}</small>${item.location || ''}</div>${item.ready?icon('check'):''}</div>`).join('')}</div><div class="next-confirmation"><h3>${responseCount?'다음 확인':'함께 확인할 내용'}</h3>${pendingItems.length ? `<ul>${pendingItems.map(item => `<li><strong>${escape(item.title)}</strong>${item.reason?`<span>${escape(item.reason)}</span>`:''}</li>`).join('')}</ul>` : '<p>현재 응답의 준비 내역을 확인해 주세요. 실제 예약·배정은 제공기관의 확인이 필요합니다.</p>'}</div><p class="snapshot-note">${icon('info')}이곳은 대화에서 준비한 내용을 보여줍니다. 수정할 내용도 말로 알려주세요.</p>`;
  const sourceItems = [];
  if (caseState.selectedHospital?.source) sourceItems.push({label:'제주 기관',source:caseState.selectedHospital.source.url});
  for (const kind of ['taxi','companion']) {
    const provider = caseState.visitSupport?.[kind]?.provider;
    if (provider) sourceItems.push({label:kind==='taxi'?'이동 문의처':'동행 문의처',source:provider.source?.url});
  }
  document.getElementById('case-sources').innerHTML = sourceItems.length ? sourceItems.map(item=>`<div><strong>${escape(item.label)}</strong>${safeSource(item.source)}</div>`).join('') : '<p>Agent가 자료를 조회하면 사용한 출처를 처리 기록과 함께 보여드립니다.</p>';
  document.getElementById('save-report').disabled = responseCount === 0;
}

function eventsMarkup(events) {
  if (!events.length) return '';
  const labels = {completed:'처리됨',needs_input:'확인 필요',not_connected:'미연결',error:'확인 실패'};
  return `<details class="tool-records"><summary>${icon('file')}이번 요청에서 확인한 일 <span>${events.length}건</span>${icon('chevron')}</summary><ol>${events.map(event => `<li class="tool-record ${escape(event.status)}" data-tool-status="${escape(event.status)}"><span class="tool-state-dot"></span><div><div class="tool-record-heading"><strong>${escape(event.label)}</strong><span>${labels[event.status] || '상태 확인'}${event.isSimulation?' · 합성':''}</span></div>${event.detail?`<p>${escape(event.detail)}</p>`:''}${event.source?`<div class="tool-source">${safeSource(event.source)}</div>`:''}</div></li>`).join('')}</ol></details>`;
}

function appendMessage({role,text,id=makeId(),events=[],greeting=false,isExample=false}) {
  const node = document.createElement('article');
  node.className = `message ${role} ${greeting?'greeting':''}`;
  node.dataset.messageId = id;
  const body=greeting?`<div class="welcome-content"><h2>이번 진료에 필요한 일,<br>편하게 말씀해 주세요.</h2><div class="welcome-copy">${formatMessage(text)}</div><figure class="welcome-photo"><img src="/assets/care-journey-v3.webp" alt="제주 집에서 휴대전화를 확인하는 가상의 어머니" width="1536" height="1024"/><figcaption>가상 인물로 만든 이미지</figcaption></figure></div>`:formatMessage(text);
  node.innerHTML = `<div class="message-meta">${role==='assistant'?'<img src="/assets/jeju-mark-v1.png" alt="" width="23" height="23"/>':''}<strong>${role==='user'?'보호자':'나침반'}</strong>${isExample?'<span class="example-label">작성된 예시</span>':greeting?'':`<time>${escape(timeLabel(new Date()))}</time>`}</div><div class="message-body">${body}</div>${eventsMarkup(events)}`;
  document.getElementById('message-list').append(node);
  return node;
}

function scrollToLatest() {
  const scroll = document.getElementById('conversation-scroll');
  requestAnimationFrame(()=>{scroll.scrollTop=scroll.scrollHeight;});
}

function scrollToMessage(node) {
  if(!node)return;
  requestAnimationFrame(()=>{const scroll=document.getElementById('conversation-scroll');scroll.scrollTop+=node.getBoundingClientRect().top-scroll.getBoundingClientRect().top-22;});
}

function resizeInput() {
  const input = document.getElementById('request-input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight,160)}px`;
  document.getElementById('send-request').disabled = pending || Boolean(activeRecognition) || !input.value.trim();
  document.getElementById('character-count').textContent = `${input.value.length}/${MAX_MESSAGE}`;
}

function setPending(value) {
  pending = value;
  document.getElementById('request-input').readOnly = value;
  document.getElementById('send-request').disabled = value || !document.getElementById('request-input').value.trim();
  document.getElementById('voice-request').disabled = value || !SpeechRecognition;
  document.getElementById('new-conversation').disabled = value;
  document.getElementById('preview-button').disabled = value;
  document.getElementById('pending-message').hidden = !value;
  document.getElementById('conversation-form').setAttribute('aria-busy',String(value));
  document.getElementById('send-request').setAttribute('aria-label',value?'요청 응답을 기다리는 중':'요청 보내기');
  for (const button of document.querySelectorAll('[data-example]')) button.disabled=value;
  if (value) scrollToLatest();
}

function errorCopy(code) {
  if (/MODEL_NOT_CONFIGURED|MODEL_DISABLED|LLM_NOT_CONFIGURED|MODEL_NOT_CONNECTED/.test(code)) return 'AI 모델이 아직 연결되지 않았어요. 입력한 요청은 그대로 남겨두었습니다. 준비 흐름은 ‘대화 흐름 미리보기’에서 볼 수 있어요.';
  if (/LOOP_LIMIT|TOOL_LIMIT/.test(code)) return '한 번에 확인할 일이 많아 이번 요청을 마치지 못했어요. 요청을 나누어 다시 말씀해 주세요.';
  if (/DAILY_LIMIT/.test(code)) return '오늘의 시연 이용 한도에 도달했어요. 한국 시간 오전 9시에 새 한도가 열립니다.';
  if (/TURN_LIMIT/.test(code)) return '이 대화의 요청 한도에 도달했어요. 준비 내역을 저장하고 새 대화를 시작해 주세요.';
  if (/RATE_LIMIT/.test(code)) return '요청이 몰리고 있어요. 잠시 뒤 같은 요청을 다시 확인해 주세요.';
  if (/SESSION_BUSY/.test(code)) return '앞선 요청을 아직 처리하고 있어요. 잠시 뒤 같은 요청을 다시 확인해 주세요.';
  if (/SESSION_STORE_UNAVAILABLE|CLOUD_RUNTIME_UNAVAILABLE/.test(code)) return '준비 상태를 저장하는 곳에 연결하지 못했어요. 입력은 남겨두었습니다. 잠시 뒤 같은 요청을 확인해 주세요.';
  if (/LIMIT|BUDGET|RATE|QUOTA/.test(code)) return '지금은 대화 이용 한도에 도달했어요. 잠시 뒤 다시 요청해 주세요.';
  if (/SESSION/.test(code)) return '이 대화 연결이 만료됐어요. 새 대화에서 다시 시작해 주세요.';
  if (/TIMEOUT|ABORT/.test(code)) return '응답을 기다리는 시간이 길어졌어요. 같은 요청을 다시 확인할 수 있습니다.';
  if (/VALIDATION|INVALID_MESSAGE/.test(code)) return '요청을 짧게 다시 말씀해 주세요. 주민번호·인증정보는 입력하지 마세요.';
  return '현재 Agent와 연결하지 못했어요. 요청 내용은 입력창에 남겨두었습니다. 잠시 뒤 다시 보내주세요.';
}

function normalizeResponse(data) {
  if (!data || typeof data.reply!=='string' || !data.reply.trim() || data.reply.length>16000 || typeof data.sessionId!=='string' || data.sessionId.length>160 || !data.caseState?.patient) throw new Error('INVALID_RESPONSE');
  getProgress(data.caseState); getVisitSupportSummary(data.caseState); getTasks(data.caseState);
  const events = (Array.isArray(data.events)?data.events:[]).slice(0,24).map((event,index)=>({
    id:String(event.id || index),tool:String(event.tool || '').slice(0,100),label:String(event.label || '요청 처리').slice(0,200),
    status:['completed','needs_input','not_connected','error'].includes(event.status)?event.status:'needs_input',
    detail:String(event.detail || '').slice(0,1600),isSimulation:event.isSimulation===true,source:typeof event.source==='string'?event.source.slice(0,1000):'',
  }));
  const actions = (Array.isArray(data.pendingActions)?data.pendingActions:[]).slice(0,12).map(item=>({id:String(item.id || ''),kind:String(item.kind || ''),label:String(item.label || '').slice(0,240),reason:String(item.reason || '').slice(0,600)}));
  return {...data,events,pendingActions:actions};
}

async function payloadHash(payload) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

// 모델 연결을 바꿔도 화면·음성 입력은 이 API 경로를 그대로 사용한다.
async function callAgent(path,body,signal) {
  const payload=JSON.stringify(body);
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','x-amz-content-sha256':await payloadHash(payload)},body:payload,signal,cache:'no-store'});
  let raw;
  try {raw=await response.json();} catch {throw new Error('INVALID_RESPONSE');}
  if(!response.ok || raw?.error)throw new Error(String(raw?.error?.code || `HTTP_${response.status}`));
  return normalizeResponse(raw);
}

async function showPreview() {
  if(pending || activeRecognition)return;
  if(hasConversationWork() && !window.confirm('고정 예시를 열면 현재 대화와 작성 중인 요청이 사라집니다. 미리보기를 열까요?'))return;
  setPending(true);
  const button=document.getElementById('preview-button');
  const notice=document.getElementById('mode-notice');
  button.textContent='미리보기 불러오는 중';
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try {
    const data=await callAgent(API+'/preview',{scenarioId:'aewol-parent-visit',requestId:makeId()},controller.signal);
    if(data.isPreview!==true || !Array.isArray(data.previewMessages) || !data.previewMessages.length)throw new Error('INVALID_PREVIEW');
    const messages=data.previewMessages.slice(0,12).filter(message=>['user','assistant'].includes(message.role) && typeof message.text==='string' && message.text.trim()).map(message=>({role:message.role,text:message.text.slice(0,16000)}));
    if(!messages.length)throw new Error('INVALID_PREVIEW');
    const last=messages.at(-1);
    if(last.role!=='assistant' || last.text!==data.reply)messages.push({role:'assistant',text:data.reply});
    previewMode=true;sessionId=undefined;history=[];failedRequests.clear();
    caseState=data.caseState;latestActions=data.pendingActions;latestEvents=data.events;responseCount=1;
    document.getElementById('request-input').value='';resizeInput();
    document.getElementById('message-list').replaceChildren();
    document.getElementById('starter-prompts').hidden=true;
    messages.forEach((message,index)=>appendMessage({...message,isExample:true,events:index===messages.length-1?data.events:[]}));
    // 미리보기의 LLM 미사용은 전역 모델 연결 설정과 별개다.
    updateCapabilities();renderSnapshot();
    document.getElementById('conversation-status').textContent='고정된 합성 대화 예시를 불러왔습니다. 실제 모델 응답과 전화는 아닙니다.';
    requestAnimationFrame(()=>{document.getElementById('conversation-scroll').scrollTop=0;});
  } catch {
    notice.hidden=false;notice.textContent='미리보기를 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 눌러주세요.';
    document.getElementById('conversation-status').textContent=notice.textContent;
  } finally {
    clearTimeout(timer);setPending(false);button.textContent='대화 흐름 미리보기';
  }
}

async function sendRequest(text,retryId) {
  if (pending || activeRecognition) return;
  const input=document.getElementById('request-input');
  text=String(text ?? input.value).trim();
  if (!text || text.length>MAX_MESSAGE) return;
  if(previewMode)resetConversation({focus:false,force:true});
  const requestId=retryId || makeId();
  const requestBody=retryId && failedRequests.has(retryId) ? failedRequests.get(retryId).body : {message:text,...(sessionId?{sessionId}:{}),history:normalizeHistory(history),requestId,preferences:{...carePreferences},applyPreferences:preferencesNeedApply};
  let messageNode,replyNode;
  if (retryId) {
    messageNode=document.querySelector(`[data-message-id="${requestId}"]`);
    messageNode?.querySelector('.request-error')?.remove();
    messageNode?.classList.remove('failed');
  } else messageNode=appendMessage({role:'user',text,id:requestId});
  document.getElementById('starter-prompts').hidden=true;
  input.value='';resizeInput();setPending(true);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),65000);
  try {
    const data=await callAgent(API,requestBody,controller.signal);
    caseState=data.caseState;sessionId=data.sessionId;latestActions=data.pendingActions;latestEvents=data.events;responseCount++;
    history=normalizeHistory([...history,{role:'user',text},{role:'assistant',text:data.reply}]);
    failedRequests.delete(requestId);
    if(preferencesEqual(requestBody.preferences,carePreferences))preferencesNeedApply=false;
    replyNode=appendMessage({role:'assistant',text:data.reply,events:data.events});
    updateCapabilities(data.capabilities);renderSnapshot();
    document.getElementById('conversation-status').textContent=data.needsInput?'필요한 내용을 이어서 말씀해 주세요.':'준비 내용을 갱신했습니다.';
  } catch(error) {
    const code=error.name==='AbortError'?'MODEL_TIMEOUT':error.message || 'CONNECTION_ERROR';
    const copy=errorCopy(code);
    failedRequests.set(requestId,{text,body:requestBody});
    if (messageNode) {
      messageNode.classList.add('failed');
      const problem=document.createElement('div');problem.className='request-error';problem.setAttribute('role','alert');
      problem.innerHTML=`<p>${escape(copy)}</p><button type="button" class="text-button" data-retry="${escape(requestId)}">같은 요청 다시 확인${icon('refresh')}</button>`;
      messageNode.append(problem);
    }
    input.value=text;resizeInput();
    document.getElementById('conversation-status').textContent='요청 전송을 확인하지 못했습니다.';
    updateCapabilities(/MODEL_NOT_CONFIGURED|MODEL_DISABLED|LLM_NOT_CONFIGURED|MODEL_NOT_CONNECTED/.test(code)?{llm:false}:undefined);
  } finally {
    clearTimeout(timer);setPending(false);scrollToMessage(replyNode || messageNode);
    if (window.matchMedia('(min-width:961px)').matches)input.focus({preventScroll:true});
  }
}

function voiceMessage(text,error=false) {
  const hint=document.getElementById('voice-help');hint.textContent=text;hint.classList.toggle('error',error);
}

function resetVoiceButton() {
  const button=document.getElementById('voice-request');button.classList.remove('listening');button.setAttribute('aria-pressed','false');button.setAttribute('aria-label','음성으로 요청하기');button.innerHTML=micIcon+'<span>말로 요청</span>';
}

function startVoice() {
  if (pending || !SpeechRecognition) return;
  if (activeRecognition) {
    recognitionCancelled=true;activeRecognition.abort();
    document.getElementById('request-input').value=voiceBase;resizeInput();
    voiceMessage('음성 입력을 중지했어요. 텍스트로도 요청할 수 있습니다.');
    return;
  }
  recognitionCancelled=false;recognitionFailed=false;finalTranscript='';voiceBase=document.getElementById('request-input').value.trim();
  const recognition=new SpeechRecognition();activeRecognition=recognition;
  recognition.lang='ko-KR';recognition.interimResults=true;recognition.continuous=false;recognition.maxAlternatives=1;
  recognition.onstart=()=>{
    const button=document.getElementById('voice-request');button.classList.add('listening');button.setAttribute('aria-pressed','true');button.setAttribute('aria-label','음성 입력 중지');button.innerHTML=stopIcon+'<span>듣기 중지</span>';
    voiceMessage('듣고 있어요. 말이 끝나면 내용을 확인하고 보내 주세요.');
    resizeInput();
  };
  recognition.onresult=event=>{
    let interim='';
    for(let index=event.resultIndex;index<event.results.length;index++) {
      const transcript=event.results[index][0]?.transcript || '';
      if(event.results[index].isFinal)finalTranscript+=transcript;else interim+=transcript;
    }
    const value=[voiceBase,finalTranscript,interim].filter(Boolean).join(' ').slice(0,MAX_MESSAGE);
    document.getElementById('request-input').value=value;resizeInput();
  };
  recognition.onspeechend=()=>recognition.stop();
  recognition.onerror=event=>{
    recognitionFailed=true;
    const errors={'not-allowed':'마이크 권한이 허용되지 않았어요. 텍스트로 요청할 수 있습니다.','service-not-allowed':'이 브라우저에서 음성 서비스를 사용할 수 없어요. 텍스트로 요청해 주세요.','no-speech':'음성을 인식하지 못했어요. 다시 말하거나 텍스트로 요청해 주세요.','audio-capture':'마이크를 찾지 못했어요. 기기 설정을 확인하거나 텍스트로 요청해 주세요.',network:'음성 인식에 연결하지 못했어요. 텍스트로 요청해 주세요.','language-not-supported':'한국어 음성 인식을 사용할 수 없어요. 텍스트로 요청해 주세요.'};
    if(!recognitionCancelled)voiceMessage(errors[event.error] || '음성 입력을 마치지 못했어요. 텍스트로 요청할 수 있습니다.',true);
  };
  recognition.onend=()=>{
    if(activeRecognition!==recognition)return;
    activeRecognition=undefined;resetVoiceButton();resizeInput();
    if(!recognitionCancelled && !recognitionFailed && finalTranscript.trim()) {
      const message=[voiceBase,finalTranscript.trim()].filter(Boolean).join(' ').slice(0,MAX_MESSAGE);
      document.getElementById('request-input').value=message;resizeInput();
      voiceMessage('인식한 내용을 확인해 주세요. 날짜·기관명을 고친 뒤 보내면 됩니다.');
      document.getElementById('request-input').focus({preventScroll:true});
    } else if(!recognitionCancelled && !recognitionFailed)voiceMessage('인식된 내용이 없어요. 다시 말하거나 텍스트로 요청해 주세요.');
  };
  try {recognition.start();} catch {activeRecognition=undefined;resetVoiceButton();resizeInput();voiceMessage('음성 입력을 시작하지 못했어요. 텍스트로 요청할 수 있습니다.',true);}
}

function resetConversation({focus=true,force=false}={}) {
  if(pending)return false;
  if(!force && hasConversationWork() && !window.confirm('현재 대화와 작성 중인 요청이 사라집니다. 새 가상 사례를 시작할까요?'))return false;
  if(activeRecognition){recognitionCancelled=true;activeRecognition.abort();activeRecognition=undefined;resetVoiceButton();}
  caseState=createDemoCase();sessionId=undefined;history=[];latestActions=[];latestEvents=[];responseCount=0;previewMode=false;failedRequests.clear();
  preferencesNeedApply=true;
  document.getElementById('message-list').replaceChildren();
  welcomeMessage();document.getElementById('starter-prompts').hidden=false;
  document.getElementById('request-input').value='';resizeInput();renderSnapshot();updateCapabilities();
  document.getElementById('conversation-status').textContent='새 가상 사례로 대화를 시작합니다.';
  if(focus)document.getElementById('request-input').focus({preventScroll:true});
  return true;
}

function saveReport() {
  if(!responseCount)return;
  const body=(previewMode?'# 고정 시나리오 미리보기\n\n작성된 합성 대화 예시입니다. 실제 모델 응답·발신·예약 결과가 아닙니다.\n\n':'')+buildReport(caseState)+'\n\n## API가 반환한 도구 처리 기록\n\n'+latestEvents.map(event=>`- ${event.label}: ${event.detail} (${event.isSimulation?'시연':event.status})${event.source?' · '+event.source:''}`).join('\n');
  const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='제주-진료-준비-보고서.md';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function welcomeMessage() {
  appendMessage({role:'assistant',greeting:true,text:'제주 진찰과 기존 도외 주치의 검토를 이어갈 자료·이동·동행 준비를 도와드려요.'});
}

function mount() {
  const brand=`<img src="/assets/jeju-mark-v1.png" alt="" width="42" height="42"/><span>제주 진료 나침반</span>`;
  const menuIcon='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  document.getElementById('app').innerHTML=`
    <div class="app-shell">
      <header class="mobile-app-header" id="mobile-app-header">
        <a class="brand" href="/" aria-label="제주 진료 나침반 홈">${brand}</a>
        <button type="button" id="open-care-menu" class="menu-button" aria-controls="care-rail" aria-expanded="false">${menuIcon}<span>설정</span></button>
      </header>
      <button type="button" id="drawer-backdrop" class="drawer-backdrop" aria-label="설정 닫기" tabindex="-1" hidden></button>
      <aside class="care-rail" id="care-rail" aria-label="가상 가족 사례와 기본 설정" tabindex="-1">
        <div class="rail-brand-row"><a class="brand" href="/" aria-label="제주 진료 나침반 홈">${brand}</a><button type="button" id="close-care-menu" class="close-menu" aria-label="설정 닫기">${icon('close')}</button></div>
        <section class="rail-case" aria-labelledby="rail-patient">
          <span class="case-person">${icon('user')}</span><h2 id="rail-patient"></h2>
          <p id="rail-area"></p><p id="rail-caregiver"></p>
          <span class="case-demo">가상 사례 체험 중</span>
        </section>
        <nav class="rail-nav" aria-label="준비 화면 이동">
          <a href="#main" id="nav-preparation" class="active" aria-current="location">${icon('compass')}<span>진료 준비</span>${icon('chevron')}</a>
          <a href="#care-preferences" id="nav-preferences">${icon('car')}<span>이동·동행 설정</span>${icon('chevron')}</a>
        </nav>
        <section class="preference-panel" id="care-preferences" aria-labelledby="preferences-heading" tabindex="-1">
          <h2 id="preferences-heading">이동·동행 기본 설정</h2>
          <p class="preference-intro">매번 말씀하지 않아도 되도록.<br>필요한 조건만 정해 두세요.</p>
          <form id="preferences-form">
            <label class="select-label" for="pref-taxi">선호 택시 문의처</label>
            <select id="pref-taxi" name="taxiProviderId" aria-describedby="taxi-preference-note"></select>
            <p class="field-note" id="taxi-preference-note">공개 문의처 · 실제 배차·예약 미확정</p>
            <label class="preference-toggle" for="pref-wheelchair"><span>휠체어 차량 필요</span><input type="checkbox" id="pref-wheelchair" name="wheelchair"/></label>
            <label class="preference-toggle" for="pref-companion"><span>병원 동행 필요</span><input type="checkbox" id="pref-companion" name="companionNeeded"/></label>
          </form>
          <p class="preference-feedback" id="preferences-status" role="status" aria-live="polite"></p>
          <p class="field-note">설정은 선택이에요. 대화에서 말씀하신 조건을 먼저 따릅니다.</p>
        </section>
        <p class="rail-note">${icon('lock')}이 기기에는 위의 기본 설정만 저장해요. 대화와 의료기록은 저장하지 않습니다.</p>
      </aside>
      <div class="workspace-shell" id="workspace-shell">
        <main id="main" class="page-main" tabindex="-1">
          <header class="workspace-header">
            <div class="case-header"><h1 id="case-heading"></h1><p id="case-caption"></p></div>
            <div class="header-actions"><span class="connection-state checking" id="connection-state">연결 확인 중</span><button type="button" class="header-button" id="new-conversation">${icon('plus')}<span>새 대화</span></button></div>
          </header>
          <div class="mobile-case-summary" id="mobile-case-summary" aria-label="이번 방문 요약"></div>
          <div class="conversation-layout">
            <section class="chat-workspace" aria-labelledby="conversation-title">
              <div class="chat-toolbar"><h2 id="conversation-title">나침반과 준비하기</h2><button type="button" id="preview-button" class="preview-button">대화 흐름 미리보기${icon('chevron')}</button></div>
              <p class="mode-notice" id="mode-notice">연결 범위를 확인하고 있어요.</p>
              <div class="conversation-scroll" id="conversation-scroll">
                <div class="message-list" id="message-list" role="log" aria-label="진료 준비 대화" aria-live="polite" aria-relevant="additions"></div>
                <div class="starter-prompts" id="starter-prompts"><p>이렇게 요청해 보세요</p>
                  <button type="button" data-example="11월 12일 오전 10시에 어머니 진료가 있어요. 저는 동행이 어려워요. 병원 문의와 택시·동행 준비를 도와주세요."><span>저는 동행이 어려워요.<br> 자료와 이동도 준비해 주세요.</span>${icon('arrow')}</button>
                  <button type="button" class="secondary-prompt" data-example="어머니가 휠체어를 이용하세요. 진료 준비와 이동에 무엇을 확인해야 할까요?"><span>어머니가 휠체어를 이용하세요.<br> 무엇을 확인해야 할까요?</span>${icon('arrow')}</button>
                </div>
                <div class="pending-message" id="pending-message" role="status" hidden><span class="working-mark"></span><p>요청을 정리하고 필요한 도구를 확인하고 있어요.</p></div>
              </div>
              <form id="conversation-form" class="conversation-form" aria-busy="false">
                <label for="request-input" class="visually-hidden">진료 준비 요청</label>
                <textarea id="request-input" name="message" rows="2" maxlength="${MAX_MESSAGE}" placeholder="예: 어머니 진료 자료와 이동·동행을 준비해줘." autocomplete="off" aria-describedby="composer-disclosure" required></textarea>
                <div class="composer-actions"><button type="button" id="voice-request" class="voice-button" aria-label="음성으로 요청하기" aria-pressed="false" aria-describedby="voice-help" ${SpeechRecognition?'':'disabled'}>${micIcon}<span>말로 요청</span></button><span class="keyboard-hint">Enter로 전송 · Shift+Enter 줄바꿈</span><span class="character-count" id="character-count">0/${MAX_MESSAGE}</span><button type="submit" class="send-button" id="send-request" aria-label="요청 보내기" disabled>${icon('arrow')}<span>보내기</span></button></div>
                <p class="voice-help" id="voice-help" role="status">${SpeechRecognition?'음성은 인식한 내용을 확인한 뒤 보내요.':'음성 미지원 브라우저예요. 텍스트로 요청해 주세요.'}</p>
              </form>
              <div class="composer-notes"><p class="composer-disclosure" id="composer-disclosure">${icon('info')}가상 사례 · 실제 연락·예약 없음</p><p class="privacy-note">주민번호·인증정보·실제 의료기록 입력 금지 · 대화는 새로고침하면 사라져요.</p></div>
            </section>
            <aside class="case-sidebar" aria-label="대화에서 준비한 내용">
              <details class="case-summary" id="case-summary" ${window.matchMedia('(min-width:901px)').matches?'open':''}><summary><span>${icon('calendar')}이번 방문 준비</span>${icon('chevron')}</summary><div id="case-content"></div></details>
              <button type="button" class="report-button" id="save-report" title="대화 응답 후 준비 내역을 저장할 수 있어요." disabled>${icon('download')}준비 내역 저장</button>
              <details class="connection-details"><summary>지금 연결된 범위${icon('chevron')}</summary><div id="connection-details"></div></details>
              <details class="source-details"><summary>준비에 사용한 출처${icon('chevron')}</summary><div id="case-sources"></div></details>
              <span class="mode-label" id="mode-label">가상 사례 · 실제 발신 없음</span><p class="service-note">진찰과 진료 계획은 의료진이 결정합니다. 등록된 문의처와 실제 예약·배정은 다릅니다.</p>
            </aside>
          </div>
          <p id="conversation-status" class="visually-hidden" role="status" aria-live="polite"></p>
        </main>
      </div>
    </div>`;
  welcomeMessage();renderSnapshot();updateCapabilities();
  const form=document.getElementById('conversation-form'),input=document.getElementById('request-input');
  form.addEventListener('submit',event=>{event.preventDefault();if(!composing)sendRequest();});
  input.addEventListener('input',resizeInput);
  input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;resizeInput();});
  input.addEventListener('keydown',event=>{if(event.key==='Enter' && !event.shiftKey && !event.isComposing && !composing && event.keyCode!==229){event.preventDefault();if(!pending)sendRequest();}});
  document.getElementById('voice-request').addEventListener('click',startVoice);
  document.getElementById('new-conversation').addEventListener('click',()=>resetConversation());
  document.getElementById('preview-button').addEventListener('click',showPreview);
  document.getElementById('save-report').addEventListener('click',saveReport);
  document.getElementById('preferences-form').addEventListener('submit',event=>event.preventDefault());
  document.getElementById('preferences-form').addEventListener('change',changePreferences);
  document.getElementById('open-care-menu').addEventListener('click',openCareMenu);
  document.getElementById('close-care-menu').addEventListener('click',()=>closeCareMenu());
  document.getElementById('drawer-backdrop').addEventListener('click',()=>closeCareMenu());
  document.getElementById('nav-preparation').addEventListener('click',event=>{event.preventDefault();closeCareMenu({restoreFocus:false});document.getElementById('nav-preparation').setAttribute('aria-current','location');document.getElementById('nav-preferences').removeAttribute('aria-current');input.focus({preventScroll:true});});
  document.getElementById('nav-preferences').addEventListener('click',event=>{event.preventDefault();document.getElementById('nav-preparation').removeAttribute('aria-current');document.getElementById('nav-preferences').setAttribute('aria-current','location');document.getElementById('pref-taxi').focus({preventScroll:true});document.getElementById('care-preferences').scrollIntoView({block:'nearest'});});
  document.addEventListener('keydown',event=>{
    if(!drawerOpen)return;
    if(event.key==='Escape'){event.preventDefault();closeCareMenu();return;}
    if(event.key==='Tab'){
      const items=[...document.getElementById('care-rail').querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(node=>node.getBoundingClientRect().width>0);
      const first=items[0],last=items.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  mobileRail.addEventListener('change',()=>{const focusedRail=document.getElementById('care-rail').contains(document.activeElement);closeCareMenu({restoreFocus:false});if(mobileRail.matches && focusedRail)document.getElementById('open-care-menu').focus();});
  closeCareMenu({restoreFocus:false});
  window.addEventListener('beforeunload',event=>{if(hasConversationWork()){event.preventDefault();event.returnValue='';}});
  document.addEventListener('click',event=>{
    const example=event.target.closest('[data-example]');if(example && !pending)sendRequest(example.dataset.example);
    const retry=event.target.closest('[data-retry]');if(retry && failedRequests.has(retry.dataset.retry))sendRequest(failedRequests.get(retry.dataset.retry).text,retry.dataset.retry);
  });
  fetch(API+'/capabilities',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('unavailable');return response.json();}).then(data=>updateCapabilities(data.capabilities || data)).catch(()=>updateCapabilities({llm:false}));
}

mount();
