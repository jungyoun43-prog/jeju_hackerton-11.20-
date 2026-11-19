import { createDemoCase, getProgress, getTasks, buildReport, DOCUMENT_DEFINITIONS } from './domain.js';
import { getVisitSupportSummary } from './visit-support.js';
import { icon } from './icons.js';
import { DEFAULT_CARE_PREFERENCES, normalizeCarePreferences, getTaxiPreferenceOptions } from './care-preferences.js';
import { formatMessage, escapeHtml as escape } from './message-format.js';
import { buildCallPlan, CALL_TARGETS } from './call-policy.js';
import { getCareJourneySummary, JOURNEY_SCENARIOS, CALL_RECOVERY_SCENARIOS } from './care-journey.js';
import { getPreparationBoard, normalizePreparationProgress } from './preparation-stages.js';
import { preparationBoardMarkup, preparationNavigationMarkup, renderPreparationBoard, renderPreparationView, renderPreparationSources, preservePreparationReading } from './preparation-board-view.js';
import { renderPatientRecords as renderPatientRecordsContent } from './patient-records.js';
import { GUIDED_DEMO_ID, getGuidedDemo } from './guided-demo.js';
import { createAppointmentDemo, reduceAppointmentDemo, canReviewAppointment, needsScheduleConsultation, referralDisposition, buildAppointmentReport } from './appointment-demo.js';
import { appointmentMarkup, appointmentNavigationMarkup } from './appointment-view.js';
import { buildAppointmentAgentDraft, mergeAppointmentDraft } from './appointment-agent-handoff.js';
import { applyCareRequest, careRequestPreview, careRequestReview } from './care-request-entry.js';
import { createRealtimeVoice } from './voice-reply.js';
import { createCareMotion } from './care-motion.js';
import {coordinationView,reduceCoordination,runCoordinationDemo,coordinationReport} from './care-coordination.js';
import {reservationEditTarget,reservationEditSummary,applyReservationEdit,RESERVATION_EDIT_SECTIONS} from './reservation-edit.js';

const API = '/api/agent';
const MAX_MESSAGE = 1600;
const MAX_HISTORY = 8;
const MAX_HISTORY_TEXT = 2000;
const PREFERENCES_STORAGE_KEY = 'jeju-care-preferences-v1';
const VISIT_TOKEN_STORAGE_KEY = 'hondi-visit-token-v1';
const VISIT_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const mobileRail = window.matchMedia('(max-width:1050px)');
const compactWorkspace = window.matchMedia('(max-width:900px), (max-height:650px)');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const micIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';
const stopIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
const makeId = () => crypto.randomUUID();
const timeLabel = date => new Intl.DateTimeFormat('ko-KR', {hour:'2-digit',minute:'2-digit',hour12:false}).format(date);

let caseState = createDemoCase();
let sessionId;
let history = [];
let pending = false;
let activeRequest;
let failedPreviewRequest;
let conversationVersion = 0;
let capabilityState = 'checking';
let capabilities = {llm:null,phone:'not_connected',healthRecords:'not_connected',voiceInput:'browser',progress:'unavailable'};
let latestActions = [];
let latestEvents = [];
let responseCount = 0;
let previewMode = false;
let guidedDemo = null;
let appointmentDemo = null;
let appointmentOpen = false;
let appointmentDrafts = {jeju:null,seoul:null};
let reservationEdit = null;
let regionHomeOpen = false;
let regionRenderer;
let careEntry={screen:'region',region:null,mode:null};
let voiceSession;
let careMotion;
let coordinationRun;
let voiceUi={status:'idle',active:false,assistant:''};
let appointmentReturnFocus;
let appointmentReturnScroll = 0;
let appointmentReturnContext;
let appointmentRenderer;
let activeRecognition;
let recognitionCancelled = false;
let recognitionFailed = false;
let finalTranscript = '';
let voiceBase = '';
let composing = false;
let preferencesStored = false;
let preferencesStorageAvailable = true;
let carePreferences = loadCarePreferences();
let visitStorageAvailable = true;
let visitToken = loadVisitToken();
let visitRecoveryRequest;
let visitRecoveryMessage = '';
let visitRecoveryExpired = false;
let capabilitiesReady;
let preferencesNeedApply = !visitToken;
let preferencesRevision = 0;
let drawerOpen = false;
let drawerReturnFocus;
let patientRecordsReturnFocus;
let contactPlanReturnFocus;
let careJourneyReturnFocus;
let manualStageSelection=false;
let selectedStageId;
let preparationBoard;
let unreadAnswer=false;
let requestProblem='';
let answerReturnFocus;
let workspaceView='chat';
let previewProblem=false;
const workspaceScroll={chat:0,preparation:0};
const failedRequests = new Map();

function setWorkspaceView(view,{focus=false}={}) {
  const layout=document.querySelector('.conversation-layout');
  if(!layout)return;
  if(reservationEdit)view='chat';
  const panels={chat:document.getElementById('chat-workspace'),preparation:document.getElementById('preparation-rail')};
  const scrollers={chat:document.getElementById('conversation-scroll'),preparation:panels.preparation};
  for(const key of Object.keys(panels))if(!panels[key].hidden)workspaceScroll[key]=scrollers[key].scrollTop;
  workspaceView=view;
  layout.dataset.activeView=view;
  for(const key of Object.keys(panels)) {
    const hidden=((regionHomeOpen || reservationEdit) && key==='preparation') || (compactWorkspace.matches && key!==view);
    panels[key].hidden=hidden;panels[key].inert=hidden;
    const tab=document.getElementById('workspace-tab-'+key);
    tab.setAttribute('aria-selected',String(key===view));tab.tabIndex=key===view?0:-1;
    if(!hidden)scrollers[key].scrollTop=workspaceScroll[key];
  }
  if(view==='preparation')manualStageSelection=true;
  if(focus)document.getElementById('workspace-tab-'+view).focus({preventScroll:true});
}

function renderBoard() {
  const progress=activeRequest?.kind==='message'?activeRequest.progress:null;
  const board=getPreparationBoard(caseState,{events:latestEvents,progress,pending,responseCount,requestProblem});
  preparationBoard=board;
  if(!manualStageSelection || !selectedStageId)selectedStageId=guidedDemo?.stepId || board.workflow.currentStageId;
  document.getElementById('care-journey-summary').hidden=responseCount===0;
  document.getElementById('return-to-request').hidden=responseCount===0;
  renderPreparationBoard(board,{unreadAnswer,progress,selectedStageId,reviewing:manualStageSelection,disableDrafts:pending||Boolean(activeRecognition),currentStageId:guidedDemo?.stepId || board.workflow.currentStageId});
  renderGuidedDemo();
  const task=board.workflow.currentTask;
  document.getElementById('care-journey-next').textContent=task?.title || '현재 방문 준비와 남은 일을 확인해 주세요.';
  const draft=document.getElementById('next-request-draft');
  draft.hidden=Boolean(guidedDemo)||!board.hasResponse || !task?.requestDraft;draft.disabled=pending || Boolean(activeRecognition);
  const replyCount=document.querySelectorAll('#message-list .message.assistant:not(.greeting)').length;
  document.getElementById('conversation-history-count').textContent=replyCount?`${replyCount}회 응답`:'';
  document.getElementById('current-task-answer').hidden=!replyCount;
  document.getElementById('request-problem-notice').hidden=pending || !(requestProblem || previewProblem);
  document.getElementById('request-examples').hidden=document.getElementById('starter-prompts').hidden;
  syncAppointmentMode();
}

function renderBoardView() {
  if(!preparationBoard)return;
  if(!manualStageSelection || !selectedStageId)selectedStageId=guidedDemo?.stepId || preparationBoard.workflow.currentStageId;
  renderPreparationView(preparationBoard,{unreadAnswer,selectedStageId,reviewing:manualStageSelection,currentStageId:guidedDemo?.stepId || preparationBoard.workflow.currentStageId});
  syncAppointmentMode();
}

function setupAppointmentWorkspace() {
  // 기존 출처·단계·대화 DOM은 옮겨서 보존한다. 서울 예약 체험은 별도 임시 상태다.
  for(const [parentId,previousId,nextId] of [
    ['conversation-scroll','existing-visit-workspace','appointment-workspace'],
    ['preparation-rail','existing-preparation-navigation','appointment-navigation'],
  ]) {
    const parent=document.getElementById(parentId),previous=document.createElement('div'),next=document.createElement('section');
    previous.id=previousId;previous.append(...parent.childNodes);
    next.id=nextId;next.hidden=true;next.inert=true;
    if(nextId==='appointment-workspace'){next.className='appointment-workspace';next.setAttribute('aria-labelledby','appointment-title');}
    parent.append(previous,next);
    if(!appointmentRenderer)next.addEventListener('click',event=>{
      const control=event.target.closest('[data-book-action]');
      if(control && !control.disabled)handleAppointmentAction(control.dataset.bookAction,control.dataset.bookValue,control);
    });
  }
  if(!appointmentRenderer)document.getElementById('appointment-workspace').addEventListener('change',event=>{
    if(event.target.id==='appointment-hospital')handleAppointmentAction('hospital',event.target.value,event.target);
    if(event.target.id==='appointment-department')handleAppointmentAction('department',event.target.value,event.target);
  });
  const entry=document.createElement('div');entry.className='appointment-entry';
  entry.innerHTML=`<button type="button" id="open-appointment-demo">${icon('hospital')}<span>내륙 병원 예약 준비</span>${icon('arrow')}</button>`;
  document.getElementById('guided-demo-controls').after(entry);
  entry.firstElementChild.addEventListener('click',()=>openAppointmentDemo('seoul'));
  const start=document.createElement('section');start.id='care-region-workspace';start.hidden=true;start.inert=true;start.setAttribute('aria-labelledby','care-region-title');
  document.getElementById('conversation-scroll').append(start);
  const reservations=document.createElement('button');reservations.type='button';reservations.id='open-my-reservations';reservations.className='header-button';reservations.setAttribute('aria-label','내 예약 현황 보기');reservations.innerHTML=`${icon('calendar')}<span>내 예약 현황</span>`;
  reservations.addEventListener('click',showReservations);
  document.querySelector('.header-actions').prepend(reservations);
  if(appointmentRenderer) {
    const actions=document.createElement('section');actions.id='appointment-actions';actions.hidden=true;actions.inert=true;actions.setAttribute('aria-label','선택 요약과 다음 단계');
    document.getElementById('chat-composer').prepend(actions);
  }
  if(regionRenderer)renderRegionHome();
}

function renderRegionHome() {
  const preview=careEntry.screen==='request'?careRequestPreview(careEntry.conditionText||document.getElementById('request-input').value,careEntry.region):[];
  regionRenderer?.(appointmentDrafts,handleCareEntryAction,{...careEntry,preview,voice:voiceUi,caseState});
}

function playCareTransition(options={},update=()=>{}) { if(careMotion)careMotion.transition({...options,update});else update(); }

function discardReservationEdit() {
  if(!reservationEdit)return;
  const original=reservationEdit.original;
  appointmentDemo={...original,coordination:{...original.coordination,resultOpen:false}};
  appointmentDrafts[reservationEdit.region]=appointmentDemo;reservationEdit=null;
}
function beginReservationEdit(region,section='schedule') {
  if(pending||activeRecognition||!appointmentDrafts[region]||!RESERVATION_EDIT_SECTIONS.some(([id])=>id===section))return;
  stopCoordination();parkAppointment();void voiceSession?.stop();
  const original=structuredClone(appointmentDrafts[region]);
  reservationEdit={region,section,original};
  appointmentDemo=reservationEditTarget(structuredClone(original),section);
  appointmentOpen=true;regionHomeOpen=false;
  playCareTransition({},()=>{setWorkspaceView('chat');renderAppointment();});
}

function parkAppointment() {
  discardReservationEdit();
  if(!appointmentOpen||!appointmentDemo)return;
  appointmentDemo=reduceCoordination(appointmentDemo,{type:'coordination_result_close'},caseState);
  appointmentDrafts[appointmentDemo.region]=appointmentDemo;
  appointmentRenderer?.(appointmentDemo,caseState,handleAppointmentAction);
}

function showReservations() {
  if(!regionRenderer||pending||activeRecognition)return;
  stopCoordination();parkAppointment();void voiceSession?.stop();
  appointmentOpen=false;regionHomeOpen=true;careEntry={...careEntry,screen:'reservations'};
  playCareTransition({},()=>{
    setWorkspaceView('chat');renderSnapshot();renderRegionHome();
    document.getElementById('conversation-scroll').scrollTop=0;
    document.getElementById('care-region-title')?.focus({preventScroll:true});
  });
}

function showCareEntry(screen) {
  discardReservationEdit();
  stopCoordination();
  const previousScreen=careEntry.screen;
  if(screen!=='request'&&voiceSession?.active)void voiceSession.stop();
  appointmentOpen=false;regionHomeOpen=true;careEntry={...careEntry,screen};
  playCareTransition({kind:previousScreen==='region'||(previousScreen==='method'&&screen==='request')?'choice':'step',back:previousScreen!=='region'&&screen==='method'},()=>{
    setWorkspaceView('chat');renderSnapshot();renderRegionHome();
    document.getElementById('conversation-scroll').scrollTop=0;
    document.getElementById('care-region-title')?.focus({preventScroll:true});
    if(screen==='request')document.getElementById('request-input').focus({preventScroll:true});
  });
}

function handleCareEntryAction(type,value) {
  if(type==='voice_stop'){void voiceSession?.stop();return;}
  if(type==='voice_start'){void voiceSession?.start({region:careEntry.region,draft:document.getElementById('request-input').value});return;}
  if(type==='voice_play'){voiceSession?.resumeAudio();return;}
  if(pending||activeRecognition)return;
  if(type==='existing'){closeAppointmentDemo();return;}
  if(type==='home'){showRegionHome();return;}
  if(type==='reservations'){showReservations();return;}
  if(type==='resume_region'){
    const draft=appointmentDrafts[value];
    if(!draft)return;
    if(coordinationView(draft,caseState).stopped){
      appointmentDrafts[value]=reduceAppointmentDemo(draft,{type:'view',value:'support'});
    }
    openAppointmentDemo(value);return;
  }
  if(type==='consultation_memo'||type==='consultation_dates'){
    const draft=appointmentDrafts[value];
    if(!draft||!needsScheduleConsultation(draft))return;
    appointmentDrafts[value]=type==='consultation_memo'?{...draft,screen:'review'}:reduceAppointmentDemo(draft,{type:'find_dates'});
    openAppointmentDemo(value);
    return;
  }
  if(type==='reservation_edit'){beginReservationEdit(value);return;}
  if(type==='reservation_detail'){
    const draft=appointmentDrafts[value];if(!draft||!coordinationView(draft,caseState).done)return;
    appointmentDrafts[value]={...reduceCoordination(draft,{type:'coordination_result_open'},caseState),screen:'support'};
    openAppointmentDemo(value,{motion:false});return;
  }
  if(type==='reservation_save'){
    const draft=appointmentDrafts[value];if(draft&&coordinationView(draft,caseState).done)downloadReport(coordinationReport(draft,caseState),'혼디-예약-결과-시연.md');return;
  }
  if(type==='region'){careEntry={...careEntry,region:value};showCareEntry('method');return;}
  if(type==='methods'){showCareEntry('method');return;}
  if(type==='mode') {
    careEntry={...careEntry,mode:value};
    if(value==='manual'){openAppointmentDemo(careEntry.region);return;}
    showCareEntry('request');
    document.getElementById('request-input').focus({preventScroll:true});
    return;
  }
  if(type==='resume'){openAppointmentDemo(careEntry.region);return;}
  if(type==='edit_request') {
    showCareEntry('request');document.getElementById('request-input').value=appointmentDrafts[careEntry.region]?.quickEntry?.text||document.getElementById('request-input').value;resizeInput();document.getElementById('request-input').focus({preventScroll:true});return;
  }
  if(type==='example') {
    if(voiceSession?.active||voiceUi.ending)return;
    const input=document.getElementById('request-input');
    if(typeof value!=='string'||!value.trim()||input.value.includes(value))return;
    const combined=[input.value.trim(),value].filter(Boolean).join('\n');
    if(combined.length>MAX_MESSAGE){document.getElementById('conversation-status').textContent='입력 길이를 줄인 뒤 예시를 더해 주세요.';return;}
    input.value=combined;careEntry.conditionText=null;resizeInput();input.focus({preventScroll:true});return;
  }
  if(type==='complete') {
    openAppointmentDemo(careEntry.region);
    handleAppointmentAction(value==='support'?'view':value,value==='support'?'support':undefined);
  }
}

function prepareCareRequest(text,conditions=careEntry.conditionText) {
  if(!text.trim()||text.length>MAX_MESSAGE)return;
  const region=careEntry.region;
  const previous=appointmentDrafts[region]||createAppointmentDemo(region,{usePublicData:region==='jeju',area:caseState.patient.area});
  appointmentDrafts[region]=applyCareRequest(previous,conditions||text);
  appointmentDrafts[region].quickEntry.text=text;
  appointmentDemo=appointmentDrafts[region];showCareEntry('summary');
}

function showRegionHome() {
  stopCoordination();
  if(!regionRenderer || pending || activeRecognition)return;
  parkAppointment();
  appointmentOpen=false;regionHomeOpen=true;careEntry={...careEntry,screen:'region'};void voiceSession?.stop();
  playCareTransition({back:true},()=>{
    setWorkspaceView('chat');renderSnapshot();renderRegionHome();
    document.getElementById('conversation-scroll').scrollTop=0;
    document.getElementById('care-region-title').focus({preventScroll:true});
  });
}

function syncAppointmentMode() {
  const entering=regionHomeOpen&&careEntry.screen==='request';
  const reservations=document.getElementById('open-my-reservations');
  if(reservations){reservations.disabled=pending||Boolean(activeRecognition);reservations.setAttribute('aria-current',regionHomeOpen&&careEntry.screen==='reservations'?'page':'false');}
  document.getElementById('main').classList.toggle('is-region-home',regionHomeOpen);
  document.getElementById('main').classList.toggle('is-booking-workspace',appointmentOpen);
  document.getElementById('main').classList.toggle('is-reservation-edit',Boolean(reservationEdit));
  document.getElementById('main').classList.toggle('is-request-entry',entering);
  const start=document.getElementById('care-region-workspace');
  if(start){start.hidden=!regionHomeOpen;start.inert=!regionHomeOpen;}
  const chooser=document.getElementById('choose-care-region');
  if(chooser){chooser.hidden=regionHomeOpen || appointmentOpen || !regionRenderer;chooser.disabled=pending || Boolean(activeRecognition);}
  document.getElementById('chat-composer').hidden=regionHomeOpen&&!entering;
  document.getElementById('chat-composer').classList.toggle('is-booking',appointmentOpen&&Boolean(appointmentRenderer));
  document.getElementById('conversation-form').hidden=appointmentOpen&&Boolean(appointmentRenderer);
  document.getElementById('conversation-form').inert=appointmentOpen&&Boolean(appointmentRenderer);
  document.getElementById('conversation-scroll').classList.toggle('is-appointment-mode',appointmentOpen);
  for(const id of ['existing-visit-workspace','existing-preparation-navigation']) {
    const node=document.getElementById(id);if(node){node.hidden=appointmentOpen || regionHomeOpen;node.inert=appointmentOpen || regionHomeOpen;}
  }
  for(const id of ['appointment-workspace','appointment-navigation','appointment-actions']) {
    const node=document.getElementById(id);if(node){node.hidden=!appointmentOpen;node.inert=!appointmentOpen;}
  }
  const entry=document.getElementById('open-appointment-demo');
  if(entry){entry.disabled=pending || Boolean(activeRecognition);entry.querySelector('span').textContent=appointmentDrafts.seoul?'내륙 예약 준비 이어보기':'내륙 병원 예약 준비';}
  document.getElementById('preview-button').disabled=pending || appointmentOpen || regionHomeOpen;
  if(regionHomeOpen)document.getElementById('case-caption').textContent=careEntry.screen==='reservations'?'내 예약 현황 · 실제 예약 없음':careEntry.screen==='region'?'제주 또는 내륙 · 진료 지역 선택':`${careEntry.region==='jeju'?'제주':'내륙'} 진료 준비 · 실제 예약 없음`;
  const submit=document.getElementById('send-request');
  submit.querySelector('span').textContent=entering?'내용 정리':'보내기';submit.setAttribute('aria-label',entering?'입력한 조건 정리하기':'요청 보내기');
  document.querySelector('.keyboard-hint').textContent=entering?'Enter로 정리 · Shift+Enter 줄바꿈':'Enter로 전송 · Shift+Enter 줄바꿈';
  if(entering) {
    const input=document.getElementById('request-input');input.readOnly=Boolean(activeRecognition)||voiceUi.active;input.placeholder='병원·진료과, 희망 날짜, 서류와 이동 조건을 알려 주세요.';
    document.getElementById('chat-composer').classList.remove('is-guided');
    for(const id of ['voice-request','send-request','character-count'])document.getElementById(id).hidden=false;
    document.getElementById('request-examples').hidden=true;document.getElementById('exit-guided-demo').hidden=true;
    submit.disabled=Boolean(activeRecognition)||!input.value.trim();
    document.getElementById('voice-request').disabled=!SpeechRecognition||voiceUi.active;
    if(careEntry.mode==='voice')document.getElementById('voice-request').hidden=true;
  }
  if(!appointmentOpen)return;
  document.getElementById('chat-composer').classList.add('is-guided');
  const input=document.getElementById('request-input');input.readOnly=true;input.placeholder='예약 준비 중';
  for(const id of ['voice-request','send-request','character-count','request-examples'])document.getElementById(id).hidden=true;
  for(const id of ['voice-request','send-request'])document.getElementById(id).disabled=true;
  const exit=document.getElementById('exit-guided-demo');exit.hidden=false;exit.textContent='기존 준비로 돌아가기';exit.disabled=false;
  const coordination=coordinationView(appointmentDemo,caseState);
  if(reservationEdit){document.getElementById('case-caption').textContent='예약 수정 중';return;}
  document.getElementById('case-caption').textContent=`${caseState.patient.area} → ${appointmentDemo.region==='jeju'?'제주 병원':'내륙 병원'} · ${coordination.done?'예약 조율 시연 완료':coordination.running?'예약 조율 시연 중':appointmentDemo.usePublicData?'공개자료·문의 준비':'예약 체험'} · 실제 예약 없음`;
}

function renderAppointment({focus=true,control}={}) {
  if(appointmentRenderer)appointmentRenderer(appointmentDemo,caseState,handleAppointmentAction,reservationEdit);
  else {
    document.getElementById('appointment-workspace').innerHTML=appointmentMarkup(appointmentDemo,caseState);
    document.getElementById('appointment-navigation').innerHTML=appointmentNavigationMarkup(appointmentDemo);
  }
  syncAppointmentMode();
  if(control) {
    const target=control.id?document.getElementById(control.id):document.querySelector(`#appointment-workspace [data-book-action="${CSS.escape(control.action)}"][data-book-value="${CSS.escape(control.value)}"]`);
    if(target && !target.disabled){target.focus({preventScroll:true});return;}
  }
  if(focus){document.getElementById('conversation-scroll').scrollTop=0;document.getElementById('appointment-title').focus({preventScroll:true});}
}

function openAppointmentDemo(region='seoul',{motion=true}={}) {
  if(pending || activeRecognition)return;
  if(!['jeju','seoul'].includes(region))return;
  discardReservationEdit();
  stopCoordination();
  if(!regionHomeOpen && !appointmentOpen) {
    appointmentReturnFocus=document.activeElement;appointmentReturnScroll=document.getElementById('conversation-scroll').scrollTop;
    appointmentReturnContext={manualStageSelection,selectedStageId,unreadAnswer};
  }
  appointmentDrafts[region] ||= createAppointmentDemo(region,{usePublicData:region==='jeju',area:caseState.patient.area});
  appointmentDemo=appointmentDrafts[region];appointmentOpen=true;regionHomeOpen=false;
  const update=()=>{setWorkspaceView('chat');renderAppointment();};
  if(motion)playCareTransition({kind:'choice'},update);else{careMotion?.cancel();update();}
  document.getElementById('conversation-status').textContent=appointmentDemo.usePublicData?'제주 공개자료로 병원과 문의처를 찾아요. 실제 빈자리 조회·예약·발신은 하지 않습니다.':`${region==='jeju'?'제주':'내륙'} 병원 예약 체험을 열었어요. 기존 자료와 초안은 유지합니다. 병원·의료진·시간표는 가상입니다.`;
}

function closeAppointmentDemo() {
  discardReservationEdit();
  stopCoordination();
  if(appointmentReturnContext)({manualStageSelection,selectedStageId,unreadAnswer}=appointmentReturnContext);
  appointmentOpen=false;regionHomeOpen=false;renderSnapshot();
  document.getElementById('exit-guided-demo').textContent='자유 입력으로 전환';
  setWorkspaceView('chat');document.getElementById('conversation-scroll').scrollTop=appointmentReturnScroll;
  if(appointmentReturnFocus?.isConnected && appointmentReturnFocus.checkVisibility())appointmentReturnFocus.focus({preventScroll:true});
  else document.getElementById('current-task-title').focus({preventScroll:true});
}

function stopCoordination() {
  if(!coordinationRun)return;
  const run=coordinationRun;coordinationRun=null;run.controller.abort();
  const draft=appointmentDrafts[run.region];
  if(draft?.coordination?.runId!==run.id)return;
  const stopped=reduceCoordination(draft,{type:'coordination_stop'},caseState);
  appointmentDrafts[run.region]=stopped;
  if(appointmentDemo?.region===run.region)appointmentDemo=stopped;
}
function startCoordination(type='coordination_start',value) {
  if(reservationEdit)return;
  const id=makeId(),next=reduceCoordination(appointmentDemo,{type,value,runId:id},caseState);
  if(next===appointmentDemo)return;
  const run={id,region:next.region,controller:new AbortController()};coordinationRun=run;
  appointmentDemo=next;appointmentDrafts[next.region]=next;renderAppointment({focus:false});
  void runCoordinationDemo(next,caseState,{signal:run.controller.signal,onEvent:event=>{
    if(coordinationRun!==run||appointmentDrafts[run.region]?.coordination?.runId!==id)return;
    const draft=appointmentDrafts[run.region],updated=reduceCoordination(draft,{type:'coordination_event',value:event},caseState);
    if(updated===draft)return;
    appointmentDrafts[run.region]=updated;
    if(appointmentOpen&&appointmentDemo.region===run.region){appointmentDemo=updated;renderAppointment({focus:false});}
  }}).catch(error=>{
    if(error.name==='AbortError'||coordinationRun!==run)return;
    stopCoordination();if(appointmentOpen)renderAppointment({focus:false});
    document.getElementById('conversation-status').textContent='시연을 멈췄어요. 확인한 결과는 남아 있으니 이어서 다시 시작해 주세요.';
  }).finally(()=>{if(coordinationRun===run)coordinationRun=null;});
}
function handleAppointmentAction(type,value,control) {
  if(!appointmentOpen || pending || activeRecognition)return;
  if(type==='coordination_fix_issue'){
    const id=coordinationView(appointmentDemo,caseState).issueControl;
    if(!id)return;
    const reveal=()=>{
      setWorkspaceView('chat');
      if(reservationEdit&&reservationEdit.section!=='support'){
        reservationEdit.section='support';
        appointmentDemo=reservationEditTarget(appointmentDemo,'support');
        renderAppointment({focus:false});
      }
      const field=document.getElementById(id);
      if(!field)return;
      for(let parent=field.closest('details');parent;parent=parent.parentElement?.closest('details'))parent.open=true;
      field.scrollIntoView({block:'nearest',behavior:'instant'});
      field.focus({preventScroll:true});
    };
    if(reservationEdit&&reservationEdit.section!=='support')playCareTransition({},reveal);
    else reveal();
    return;
  }
  if(type==='reservation_edit'){beginReservationEdit(appointmentDemo.region,value||'schedule');return;}
  if(type==='reservation_edit_cancel'){discardReservationEdit();showReservations();return;}
  if(type==='reservation_edit_section'){
    if(!reservationEdit||!RESERVATION_EDIT_SECTIONS.some(([id])=>id===value))return;
    reservationEdit.section=value;appointmentDemo=reservationEditTarget(appointmentDemo,value);
    playCareTransition({},()=>renderAppointment());return;
  }
  if(type==='reservation_edit_review'){
    if(!reservationEdit)return;const summary=reservationEditSummary(reservationEdit.original,appointmentDemo,caseState);
    if(!summary.changed||!summary.ready)return;
    appointmentDemo={...appointmentDemo,screen:'reservation_review'};playCareTransition({},()=>renderAppointment());return;
  }
  if(type==='reservation_edit_apply'){
    if(!reservationEdit||appointmentDemo.screen!=='reservation_review')return;
    const next=applyReservationEdit(reservationEdit.original,appointmentDemo,caseState);if(!next)return;
    reservationEdit=null;appointmentDemo=next;appointmentDrafts[next.region]=next;
    if(coordinationView(next,caseState).done){showReservations();return;}
    renderAppointment();startCoordination();return;
  }
  if(reservationEdit&&['coordination_start','coordination_save','coordination_result_open','coordination_scenario','data_mode','save','agent_draft'].includes(type))return;
  if(type==='coordination_start'||type==='coordination_vehicle_retry'){startCoordination(type,value);return;}
  if(type==='coordination_stop'){stopCoordination();renderAppointment({focus:false});return;}
  if(type==='coordination_save'){downloadReport(coordinationReport(appointmentDemo,caseState),'혼디-예약-결과-시연.md');return;}
  if(coordinationRun&&!type.startsWith('coordination_')&&!['jeju_support_area','jeju_support_pick','jeju_support_wheelchair'].includes(type))stopCoordination();
  if(type==='close'){closeAppointmentDemo();return;}
  if(type==='home'){showRegionHome();return;}
  if(type==='reservations'){showReservations();return;}
  if(type==='entry_summary'){careEntry.region=appointmentDemo.region;showCareEntry('summary');return;}
  if(type==='methods'){careEntry.region=appointmentDemo.region;showCareEntry('method');return;}
  if(type==='region'){openAppointmentDemo(value);return;}
  if(type==='agent_draft') {
    const text=buildAppointmentAgentDraft(appointmentDemo,caseState);
    appointmentDrafts[appointmentDemo.region]=appointmentDemo;
    fillRequestDraft(text,{source:'선택한 병원·일정·제주 문의처',preserveExisting:true});return;
  }
  if(type==='save'){downloadReport(buildAppointmentReport(appointmentDemo,caseState),appointmentDemo.usePublicData?'제주-병원-문의-준비표.md':`${appointmentDemo.region==='jeju'?'제주':'내륙'}-진료-예약-준비표-시연.md`);return;}
  if(type==='show_times') {
    setWorkspaceView('chat');
    const target=document.getElementById('availability-result-title');
    target?.scrollIntoView({block:'start',behavior:'instant'});target?.focus({preventScroll:true});return;
  }
  if(['coordination_option','coordination_scenario','coordination_edit','coordination_result_open','coordination_result_close'].includes(type)) {
    const next=reduceCoordination(appointmentDemo,{type,value},caseState);if(next===appointmentDemo)return;appointmentDemo=next;
  } else if(type==='summary') {
    if(!canReviewAppointment(appointmentDemo))return;
    appointmentDemo=appointmentDemo.usePublicData?{...appointmentDemo,screen:'public_review'}:{...appointmentDemo,screen:appointmentDemo.status==='draft'?'review':'result',requestMode:appointmentDemo.requestMode || 'slot'};
  } else {
    const next=reduceAppointmentDemo(appointmentDemo,{type,value,area:caseState.patient.area,wheelchair:Boolean(caseState.visitSupport?.requirements?.wheelchair)});if(next===appointmentDemo)return;appointmentDemo=next;
  }
  const retain=['coordination_result_open','coordination_result_close','coordination_option','coordination_scenario','hospital','department','visit_type','referral','date','time','month','preferred_mode','preferred_date','preferred_month','slot','travel_field','travel_check','flight_field','flight_dates','public_area','public_department','public_hospital','public_visit_department','public_date_mode','public_month','public_date','public_time','public_exact_time','public_doctor_mode','public_doctor_name','public_show_preferences','jeju_support_area','jeju_support_pick','jeju_support_wheelchair'].includes(type);
  if(appointmentDemo.quickEntry) {
    const field={hospital:'hospital',department:'department',public_hospital:'hospital',public_visit_department:'department'}[type];
    if(field)appointmentDemo={...appointmentDemo,quickEntry:{...appointmentDemo.quickEntry,fields:{...appointmentDemo.quickEntry.fields,[field]:true}}};
  }
  if(reservationEdit){
    if(['public_find','intake'].includes(appointmentDemo.screen))reservationEdit.section='hospital';
    else if(['public_dates','availability','schedule','doctors'].includes(appointmentDemo.screen))reservationEdit.section='schedule';
    else if(appointmentDemo.screen==='support')reservationEdit.section='support';
  }
  if(!reservationEdit)appointmentDrafts[appointmentDemo.region]=appointmentDemo;
  const update=()=>{
    setWorkspaceView('chat');
    renderAppointment({focus:!retain,control:retain&&control?{id:control.id,action:type,value:typeof value==='string'?value:''}:undefined});
  };
  if(retain)update();else playCareTransition({back:['back','hospital'].includes(type)},update);
  if(type==='public_show_preferences') {
    const target=document.getElementById('public-preferences-title');target?.scrollIntoView({block:'start',behavior:'instant'});target?.focus({preventScroll:true});
  }
  if(type==='public_hospital'&&!appointmentDemo.jejuHospital.visitDepartment) {
    const target=document.getElementById('public-visit-department');target?.scrollIntoView({block:'center',behavior:'instant'});target?.focus({preventScroll:true});
  }
  document.getElementById('conversation-status').textContent=type==='time'?`${value} 시연 시간을 선택했어요. 선택한 일정 확인으로 이어가세요.`:document.getElementById('appointment-title')?.textContent||'선택한 준비 내용을 확인해 주세요.';
}

function renderGuidedDemo() {
  const host=document.getElementById('guided-demo-controls');
  host.hidden=responseCount>0 && !guidedDemo;
  document.getElementById('chat-composer').classList.toggle('is-guided',Boolean(guidedDemo));
  document.getElementById('current-preparation-task').classList.toggle('is-intro',!responseCount && !guidedDemo);
  const markup=guidedDemo
    ? guidedDemo.complete
      ? `<button type="button" class="demo-primary" data-demo-save>${icon('download')}준비표 저장</button><button type="button" data-demo-start>다시 체험${icon('refresh')}</button>`
      : guidedDemo.choices.map(choice=>`<button type="button" data-demo-choice="${escape(choice.id)}"><span>${escape(choice.label)}</span>${icon('arrow')}</button>`).join('')
    : `<button type="button" class="demo-primary" data-demo-start>방문 준비 시작${icon('arrow')}</button><button type="button" class="demo-write" data-demo-write>직접 요청하기${icon('message')}</button><p class="demo-intro">가상 사례로 체험해요. 실제 연락·예약은 하지 않아요.</p>`;
  const viewKey=guidedDemo?JSON.stringify(guidedDemo.answers):responseCount?'response':'initial';
  if(host.dataset.step!==viewKey) {
    host.innerHTML=markup;host.dataset.step=viewKey;
    document.getElementById('preparation-reading').open=Boolean(guidedDemo?.complete || (!guidedDemo && responseCount));
  }
  for(const button of host.querySelectorAll('button'))button.disabled=pending || Boolean(activeRecognition);
  const exit=document.getElementById('exit-guided-demo');
  exit.hidden=!guidedDemo;exit.disabled=pending;exit.textContent='자유 입력으로 전환';
  const input=document.getElementById('request-input');
  input.readOnly=pending || Boolean(guidedDemo);
  input.placeholder=guidedDemo?.complete?'체험을 마쳤어요.':guidedDemo?'위에서 답변 선택':'예: 어머니 진료 자료와 이동·동행을 준비해줘.';
  for(const id of ['voice-request','send-request','character-count'])document.getElementById(id).hidden=Boolean(guidedDemo);
  document.getElementById('send-request').disabled=pending || Boolean(guidedDemo) || Boolean(activeRecognition) || !input.value.trim();
  document.getElementById('voice-request').disabled=pending || Boolean(guidedDemo) || !SpeechRecognition;
  const result=document.getElementById('guided-demo-result');
  result.hidden=!guidedDemo?.previousAnswer;
  if(guidedDemo?.previousAnswer) {
    document.getElementById('guided-demo-selection').textContent=guidedDemo.previousAnswer;
    document.getElementById('guided-demo-result-text').textContent=guidedDemo.result;
  }
  if(!guidedDemo)return;
  document.getElementById('current-task-title').textContent=guidedDemo.title;
  document.getElementById('current-task-detail').textContent=guidedDemo.detail;
  document.getElementById('current-task-stage').textContent=guidedDemo.complete?'답변 선택 체험 종료':`답변 선택 ${guidedDemo.answers.length+1} / 4`;
  document.getElementById('current-task-owner').hidden=true;
  for(const id of ['current-task-question','current-task-choices','current-task-draft','workflow-draft-note'])document.getElementById(id).hidden=true;
}

function showLatestAnswer() {
  setWorkspaceView('chat');
  manualStageSelection=true;unreadAnswer=false;renderBoardView();
  scrollToMessage([...document.querySelectorAll('#message-list .message.assistant:not(.greeting)')].at(-1));
}

function showCurrentTask({focus=true}={}) {
  if(regionHomeOpen){if(focus)document.getElementById('care-region-title').focus({preventScroll:true});return;}
  if(appointmentOpen){setWorkspaceView('chat');if(focus)document.getElementById('appointment-title').focus({preventScroll:true});return;}
  setWorkspaceView('chat');
  manualStageSelection=false;unreadAnswer=false;renderBoardView();
  const scroller=document.getElementById('conversation-scroll');scroller.scrollTop=0;
  if(focus)document.getElementById('current-task-title').focus({preventScroll:true});
}

function selectPreparationStage(id) {
  if(!preparationBoard?.stages.some(stage=>stage.id===id))return;
  selectedStageId=id;manualStageSelection=true;
  setWorkspaceView('chat');renderBoardView();
  document.getElementById('preparation-reading').open=true;
  const pane=document.querySelector(`[data-stage-id="${id}"]`);
  pane.querySelector('[data-stage-details]').open=true;
  scrollToMessage(pane,document.querySelector('.stage-reading-tools'));
}

function focusRequest() {
  if(regionHomeOpen || appointmentOpen)closeAppointmentDemo();
  setWorkspaceView('chat');
  manualStageSelection=false;unreadAnswer=false;renderBoardView();
  const input=document.getElementById('request-input');
  input.focus({preventScroll:true});
}

function markAnswerReady() {
  unreadAnswer=manualStageSelection;
  return unreadAnswer?preservePreparationReading():undefined;
}

function openAnswer() {
  if(!responseCount)return;
  const dialog=document.getElementById('answer-dialog');
  if(dialog.open)return;
  manualStageSelection=true;unreadAnswer=false;renderBoardView();
  answerReturnFocus=document.activeElement;
  const view=document.getElementById('answer-read-view');
  view.innerHTML=document.getElementById('message-list').innerHTML;
  const recoveryNotice=document.getElementById('visit-recovery-notice');
  if(!view.children.length && !recoveryNotice.hidden){const note=document.createElement('p');note.className='preparation-note';note.textContent=recoveryNotice.textContent;view.append(note);}
  for(const button of view.querySelectorAll('button'))button.remove();
  view.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
  view.querySelectorAll('[data-message-id]').forEach(node=>node.removeAttribute('data-message-id'));
  dialog.showModal();document.body.classList.add('records-dialog-open');
  document.getElementById('answer-title').focus({preventScroll:true});
  view.scrollTop=0;
}

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
  status.textContent=previewMode ? '준비 흐름 체험에는 설정을 적용하지 않아요.' : !preferencesStorageAvailable ? '이 기기에 저장하지 못했어요. 이번 화면의 다음 요청에는 반영해요.' : preferencesNeedApply ? preferencesStored ? '이 기기에 저장 · 다음 요청부터 반영' : '기본값 · 다음 요청에 반영' : '현재 대화에 반영됨 · 변경하면 다음 요청부터 적용';
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
  preferencesRevision++;
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

function renderPatientRecords() {
  renderPatientRecordsContent(caseState);
}

function openPatientRecords() {
  const dialog=document.getElementById('patient-records-dialog');
  if(dialog.open)return;
  patientRecordsReturnFocus=document.getElementById(mobileRail.matches?'open-care-menu':'nav-patient-records');
  closeCareMenu({restoreFocus:false});
  renderPatientRecords();
  dialog.showModal();
  document.body.classList.add('records-dialog-open');
  document.getElementById('patient-records-body').scrollTop=0;
  document.getElementById('patient-records-title').focus({preventScroll:true});
}

function renderContactPlans() {
  const host=document.getElementById('contact-plans');
  const openTargets=[...host.querySelectorAll('[data-contact-target][open]')].map(node=>node.dataset.contactTarget);
  const focused=document.activeElement;
  const focusTarget=focused?.closest('[data-contact-target]')?.dataset.contactTarget;
  const focusSelector=focused?.closest('[data-contact-draft]')?'[data-contact-draft]':focused?.matches('summary')?'summary':null;
  const labels={mainland:'기존 도외 병원',jeju:'제주 병원',taxi:'택시·휠체어 이동',companion:'병원 동행'};
  const checkLabels={missing:'누락',unverified:'미확인',simulation:'합성 사례'};
  const list=items=>`<ul>${items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`;
  const recordLabel=value=>value==='not_configured'?'미설정':value==='not_verified'?'미확인':'확인 필요';
  host.innerHTML=CALL_TARGETS.map(target=>{
    const plan=buildCallPlan(caseState,target);
    return `<details class="contact-plan" data-contact-target="${target}" ${openTargets.includes(target)?'open':''}>
      <summary><span class="contact-recipient"><strong>${escape(plan.recipient.name)}</strong><span>${labels[target]}</span></span><span class="contact-status">${escape(plan.simulation.label)}</span>${icon('chevron')}</summary>
      <div class="contact-plan-content">
        <dl class="contact-facts"><div><dt>문의 목적</dt><dd data-contact-purpose>${escape(plan.purpose)}</dd></div><div><dt>문의처</dt><dd data-contact-recipient>${escape(plan.recipient.phone || '공개 대표번호 미확인')}<span class="contact-meta">실제 상대·연결 여부 미확인</span>${plan.recipient.source?`<span class="contact-meta">${escape(plan.recipient.source)}</span>`:''}${plan.recipient.sourceUrl?`<span class="contact-source">${safeSource(plan.recipient.sourceUrl)}</span>`:''}</dd></div><div><dt>전달 범위</dt><dd data-contact-disclosure><p>허용 범위를 확인할 최소 전달 항목</p>${plan.minimumDisclosure.length?list(plan.minimumDisclosure.map(item=>`${item.label} · ${item.value}`)):'전달 항목 확인 필요'}</dd></div><div><dt>자동 제외</dt><dd data-contact-excluded>${escape(plan.excludedInformation.join(' · '))}</dd></div></dl>
        <section class="contact-section"><h4>확인할 질문</h4><div data-contact-questions>${list(plan.questions)}</div></section>
        <section class="contact-section"><h4>AI가 먼저 알릴 예정 문구</h4><p data-contact-opening>${escape(plan.openingScript)}</p><p class="contact-meta">위임·고지·기록 처리 조건을 확인한 뒤 사용할 계획입니다. 실제 통화에서 고지한 기록이 아닙니다.</p></section>
        <section class="contact-section" data-contact-records><h4>통화 기록 처리</h4><dl class="contact-records"><div><dt>녹음</dt><dd>${recordLabel(plan.recordHandling.recording)}</dd></div><div><dt>전사</dt><dd>${recordLabel(plan.recordHandling.transcription)}</dd></div><div><dt>보관</dt><dd>${recordLabel(plan.recordHandling.retention)}</dd></div><div><dt>국외 이전</dt><dd>${recordLabel(plan.recordHandling.overseasTransfer)}</dd></div></dl><p>${escape(plan.recordHandling.notice)}</p></section>
        <section class="contact-section"><h4>실제 발신 전에 필요한 확인</h4><ul class="contact-checks" data-contact-checks>${plan.preCallChecks.map(check=>`<li><strong>${checkLabels[check.status] || '확인 필요'} · ${escape(check.label)}</strong><span>${escape(check.detail)}</span></li>`).join('')}</ul></section>
        <section class="contact-section" data-contact-simulation><h4>합성 진행 결과</h4><p><strong>${escape(plan.simulation.label)}</strong> · ${escape(plan.simulation.detail)}</p></section>
        <section class="contact-section"><h4>다음 행동과 담당</h4><div data-contact-next-actions>${list(plan.nextActions)}</div></section>
        <div class="contact-draft"><p data-contact-request-draft>${escape(plan.requestDraft)}</p><button type="button" class="contact-draft-button" data-contact-draft="${target}" ${pending || activeRecognition?'disabled':''}>이 내용으로 문의 준비${icon('arrow')}</button><p class="contact-meta">입력창에서 확인·수정한 뒤 직접 보내세요. 이 버튼은 발신하거나 요청을 전송하지 않습니다.</p></div>
      </div>
    </details>`;
  }).join('');
  renderCallRecovery();
  if(focusTarget && focusSelector && document.getElementById('contact-plan-dialog').open)host.querySelector(`[data-contact-target="${focusTarget}"] ${focusSelector}`)?.focus({preventScroll:true});
}

function openContactPlan() {
  const dialog=document.getElementById('contact-plan-dialog');
  if(dialog.open)return;
  contactPlanReturnFocus=document.getElementById(mobileRail.matches?'open-care-menu':'nav-contact-plan');
  closeCareMenu({restoreFocus:false});renderContactPlans();
  dialog.returnValue='';dialog.showModal();
  document.body.classList.add('records-dialog-open');
  document.getElementById('contact-plan-body').scrollTop=0;
  document.getElementById('contact-plan-title').focus({preventScroll:true});
}

function journeyEvidenceMarkup(items=[]) {
  if(!items.length)return '<p class="journey-note">근거가 제공되지 않았습니다. 확인 전에는 준비 완료나 진료 경로를 확정하지 않습니다.</p>';
  return `<ul class="journey-evidence">${items.map(item=>`<li data-journey-evidence="${escape(item.documentId)}"><strong>${escape(item.label || '근거 자료')} · ${item.isSimulation===true?'합성 자료':'출처 확인 필요'}</strong><blockquote>${escape(item.excerpt || '원문 발췌가 제공되지 않았습니다.')}</blockquote><dl><div><dt>작성일</dt><dd>${escape(item.authoredAt || '작성일 미상')}</dd></div><div><dt>확인 여부</dt><dd>${item.confirmation==='demo_confirmed'?'합성 시연에서 확인':'미확인'} · ${escape(item.confirmedAt || '확인일 없음')}</dd></div></dl>${item.sourceUrl?`<div class="journey-source">${safeSource(item.sourceUrl)}</div>`:''}</li>`).join('')}</ul>`;
}

function callHandoffsMarkup(handoffs=[]) {
  const reasonLabels={no_answer:'무응답',unreachable:'연결되지 않음',ai_declined:'AI 응대 거절',identity_required:'환자 본인 확인 필요',recipient_changed:'문의처 변경 · 새 범위 확인',missing_documents:'필요 서류 부족',no_slots:'요청 일정 예약 불가',not_participating:'이번 요청 접수 미참여',answered:'응답 확인 · 합성'};
  const statusLabels={policy_required:'재시도 정책 미설정',retry_allowed:'허용 범위 내 합성 재시도 가능',retry_exhausted:'허용 횟수 도달 · 인계 필요',retry_expired:'허용 시간 종료 · 인계 필요',handed_off:'자동 반복 문의 중단 · 사람 인계',blocked:'선행 작업 필요 · 문의 중단',waiting_user:'보호자 허용 범위 확인',followup_required:'이전 실패 후 남은 일 확인'};
  const list=items=>`<ul class="journey-list">${items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`;
  return handoffs.map(item=>{
    const policy=item.retryPolicy,attempts=item.attempts;
    return `<article class="call-handoff" data-call-recovery="${escape(item.id)}" data-call-handoff="${escape(item.id)}" data-status="${escape(item.status)}" data-owner="${escape(item.owner)}" data-target="${escape(item.target)}" data-stop-automatic="${item.stopAutomatic===true}" data-actual-call-placed="false">
      <div class="call-handoff-heading"><h4>${escape(item.title)}</h4><span>${escape(statusLabels[item.status] || item.status)}</span></div>
      <dl class="call-handoff-facts"><div><dt>실패 이유</dt><dd>${escape(reasonLabels[item.reason] || item.reason)}</dd></div><div><dt>인계 담당</dt><dd>${escape(item.owner)}</dd></div><div><dt>공개 문의처</dt><dd>${escape(item.contact.name || '담당 문의처 확인 필요')}<span class="contact-meta">${escape(item.contact.phone || '공개 번호 미확인')} · 실제 연결 확인 전</span>${item.contact.sourceUrl?`<span class="journey-source">${safeSource(item.contact.sourceUrl)}</span>`:''}</dd></div></dl>
      <p class="journey-detail">${escape(item.detail)}</p>
      <h5>합성 시도 내역</h5>${attempts.length?`<ol class="call-attempts">${attempts.map(attempt=>`<li data-call-attempt="${escape(attempt.number)}" data-outcome="${escape(attempt.outcome)}" data-at="${escape(attempt.at)}"><strong>${escape(attempt.number)}차 · ${escape(reasonLabels[attempt.outcome] || attempt.outcome)}</strong><span>${escape(attempt.at || '시도 시각 미상')}</span><span>${attempt.isSimulation===true?'합성 시도 기록':'기록 출처 확인 필요'} · 실제 발신 없음</span></li>`).join('')}</ol>`:'<p class="journey-note">이 사례에 시도 내역이 제공되지 않았습니다. 실제 통화를 시도했다고 표시하지 않습니다.</p>'}
      <div class="call-retry-policy" data-call-retry-policy><h5>재시도 정책과 현재 시도</h5><p>${policy.configured?`최초 시도 포함 최대 ${escape(policy.maxAttempts)}회 · ${escape(policy.windowMinutes)}분 이내`:'미설정 · 자동 재시도하지 않음'}</p><p>누적 ${escape(attempts.length)}건${attempts.length?` · 마지막 ${escape(attempts.at(-1).number)}차`:''}의 합성 기록</p>${policy.configured?`<dl><div><dt>허용 시작</dt><dd>${escape(policy.startsAt || '시작 시각 미설정')}</dd></div><div><dt>허용 종료</dt><dd>${escape(policy.expiresAt || '종료 시각 미설정')}</dd></div></dl>`:''}<p class="journey-note">${item.stopAutomatic?'자동 반복 문의는 중단 상태입니다. 담당자가 다음 절차를 확인해야 합니다.':'표시된 허용 범위를 넘겨 반복 문의하지 않습니다.'} 실제 자동 재시도 예약·발신은 없습니다.</p></div>
      ${item.questions.length?`<h5>사람이 이어서 물을 질문</h5>${list(item.questions)}`:''}<h5>남은 일과 인계 내용</h5>${item.remainingTasks.length?list(item.remainingTasks):'<p class="journey-note">다음 담당자에게 남은 절차를 확인해 주세요.</p>'}
      ${item.requestDraft?`<div class="journey-draft"><p>${escape(item.requestDraft)}</p><button type="button" class="contact-draft-button" data-call-handoff-draft="${escape(item.id)}" data-journey-draft="${escape(item.id)}" ${pending || activeRecognition?'disabled':''}>인계 요청을 입력창에 넣기${icon('arrow')}</button><p class="journey-note">내용을 확인·수정한 뒤 직접 보내세요. 이 버튼은 기관에 연락하거나 동의를 확인하지 않습니다.</p></div>`:''}
    </article>`;
  }).join('');
}

function renderCallRecovery() {
  let handoffs=[];
  try {handoffs=getCareJourneySummary(caseState).handoffs || [];} catch { /* 현재 대화는 유지하고 확인되지 않은 실패 기록을 만들지 않는다. */ }
  document.getElementById('call-handoffs').innerHTML=handoffs.length?`<h3>연결되지 않은 문의와 사람 인계</h3><p class="journey-note">실패 이유·시도·남은 일을 보존한 합성 기록입니다. 실제 발신·예약·본인 확인·위임 검증은 수행하지 않았습니다.</p>${callHandoffsMarkup(handoffs)}`:'<p class="journey-note">현재 대화에 실패·인계 기록은 없습니다. 문의가 막히면 이유와 시도 내역, 남은 일과 담당자를 함께 남깁니다.</p>';
  document.getElementById('call-recovery-options').innerHTML=CALL_RECOVERY_SCENARIOS.map(item=>`<button type="button" data-call-recovery-scenario="${escape(item.id)}" ${pending || activeRecognition?'disabled':''}><span><strong>${escape(item.label)}</strong><span>${escape(item.description)}</span></span>${icon('chevron')}</button>`).join('');
}

function renderCareJourney({includeDetails=true}={}) {
  const host=document.getElementById('care-journey-content');
  let journey;
  try {journey=getCareJourneySummary(caseState);} catch { /* 기존 상태도 안전하게 읽고, 실패를 완료로 바꾸지 않는다. */ }
  document.getElementById('care-journey-current').textContent=journey?.pathway?.label || '진료 연결 미확인';
  if(!includeDetails)return;
  if(!journey){host.innerHTML='<p class="journey-note">진료 여정을 읽지 못했어요. 현재 대화는 유지됩니다. 대화에서 준비 상태를 다시 확인해 주세요.</p>';return;}
  const openItems=new Set([...host.querySelectorAll('details[data-journey-task][open],details[data-journey-data][open]')].map(node=>node.dataset.journeyTask || node.dataset.journeyData));
  const focused=document.activeElement;
  const focusId=focused?.closest('[data-journey-task],[data-journey-data]')?.dataset;
  const focusItem=focusId?.journeyTask || focusId?.journeyData;
  const focusSelector=focused?.closest('[data-journey-draft]')?'[data-journey-draft]':focused?.matches('summary')?'summary':null;
  const statusLabels={todo:'할 일',blocked:'선행 확인 필요',ready:'합성 준비됨',recheck:'재확인 필요'};
  const disabled=pending || Boolean(activeRecognition);
  const list=items=>`<ul class="journey-list">${items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`;
  const draftButton=item=>item.requestDraft?`<div class="journey-draft"><p data-journey-request-draft>${escape(item.requestDraft)}</p><button type="button" class="contact-draft-button" data-journey-draft="${escape(item.id)}" ${disabled?'disabled':''}>입력창에 초안 넣기${icon('arrow')}</button></div>`:'';
  const schedule=journey.schedule;
  const scheduleStatus=value=>({not_requested:'문의 전',not_contacted:'문의 전',not_selected:'문의처 선택 전',selected:'공개 문의처 선택',prepared:'문의 준비 · 응답 전',available_demo:'합성 가능 응답 · 예약 미확정',unavailable_demo:'합성 불가 응답',unreachable_demo:'합성 연락 실패',needs_recheck:'조건 변경 · 재확인 필요',pending:'확인 필요',unconfirmed:'미확인',recheck:'재확인 필요',recheck_required:'재확인 필요',confirmed:'합성 가능 응답 · 예약 미확정',ready:'합성 가능 응답 · 예약 미확정'}[value] || value || '미확인');
  host.innerHTML=`
    <section class="journey-section journey-outcome" aria-labelledby="journey-outcome-title"><h3 id="journey-outcome-title">${escape(journey.pathway.label)}</h3><p class="journey-detail">${escape(journey.pathway.detail)}</p>${journey.activeScenario?`<p class="journey-active-scenario" data-journey-active-scenario="${escape(journey.activeScenario.id)}"><strong>합성 상황 · ${escape(journey.activeScenario.label)}</strong><span>${escape(journey.activeScenario.summary)}</span></p>`:''}<p class="journey-note">자료 준비 → 두 병원 문의 → 이동·동행 후속 확인을 이어갑니다. 실제 통화·예약·배차·진료 수락·외부 기록 연결은 수행하지 않습니다.</p></section>
    <section class="journey-section" aria-labelledby="journey-pathways-title"><h3 id="journey-pathways-title">의료진이 확인할 세 가지 진료 경로</h3><p class="journey-note">환자별 진료 경로는 제주·기존 도외 의료진과 기관이 확인합니다. 접수 창구의 거절만으로 진료 경로를 결정하지 않습니다.</p><ul class="journey-pathways">${journey.pathways.map(item=>`<li data-journey-pathway="${escape(item.id)}" data-selected="${item.selected===true}"><div><strong>${escape(item.label)}</strong><span class="journey-pathway-state">${item.selected && journey.pathway.status==='demo_confirmed'?'합성 근거로 확인':'미확인'}</span></div><p>${escape(item.detail)}</p></li>`).join('')}</ul><details class="journey-proof"><summary>진료 경로 판단의 근거${icon('chevron')}</summary>${journeyEvidenceMarkup(journey.pathway.evidence)}</details></section>
    <section class="journey-section" aria-labelledby="journey-tasks-title"><h3 id="journey-tasks-title">이어지는 할 일과 담당</h3><p class="journey-note">선행 자료와 문의 결과를 확인한 뒤 다음 일을 준비합니다. 아래 초안은 입력창에서 고친 뒤 직접 보내세요.</p><div class="journey-tasks">${journey.tasks.map((item,index)=>`<details class="journey-task" data-journey-task="${escape(item.id)}" data-status="${escape(item.status)}" ${openItems.has(item.id) || (!host.children.length && index===0)?'open':''}><summary><span class="journey-task-heading"><strong>${escape(item.title)}</strong><span>${escape(item.owner)}</span></span><span class="journey-task-state" data-status="${escape(item.status)}">${statusLabels[item.status] || '확인 필요'}</span>${icon('chevron')}</summary><div class="journey-task-content"><p class="journey-detail">${escape(item.detail)}</p><h4>요청의 근거와 원문</h4>${journeyEvidenceMarkup(item.evidence)}${draftButton(item)}</div></details>`).join('')}</div></section>
    <section class="journey-section" aria-labelledby="journey-findings-title"><h3 id="journey-findings-title">합성 전화 응답과 후속 질문</h3>${journey.findings.length?`<ol class="journey-findings">${journey.findings.map(item=>`<li data-journey-finding="${escape(item.id)}"><strong>${escape(item.label)}</strong><span class="journey-note">${item.isSimulation===true?'합성 응답':'출처 확인 필요'} · ${escape(item.at || '응답일 미상')}</span><p class="journey-detail">${escape(item.detail)}</p></li>`).join('')}</ol>`:'<p class="journey-note">아직 이 사례에 합성 문의 응답이 없습니다. 문의에서 확인된 조건은 후속 할 일과 질문에 반영합니다.</p>'}</section>
    ${(journey.handoffs || []).length?`<section class="journey-section journey-handoffs" aria-labelledby="journey-handoffs-title"><h3 id="journey-handoffs-title">실패한 문의와 사람에게 남긴 일</h3><p class="journey-note">실패를 성공으로 바꾸지 않고 인계 이유·시도 내역·담당과 남은 일을 보존합니다.</p>${callHandoffsMarkup(journey.handoffs)}</section>`:''}
    <section class="journey-section" aria-labelledby="journey-schedule-title"><h3 id="journey-schedule-title">일정과 이동·동행 재확인</h3><dl class="journey-schedule"><div><dt>시연 일정</dt><dd>${escape(schedule.date || '날짜 미정')} · ${escape(schedule.time || '시각 미정')} <span>(변경 ${escape(schedule.revision ?? 0)}회)</span></dd></div><div><dt>택시 이동</dt><dd data-journey-taxi-status>${escape(scheduleStatus(schedule.taxiStatus))}</dd></div><div><dt>병원 동행</dt><dd data-journey-companion-status>${escape(scheduleStatus(schedule.companionStatus))}</dd></div></dl>${schedule.recheckReasons.length?`<div class="journey-recheck" data-journey-recheck><h4>이전 조건으로 진행할 수 없는 이유</h4>${list(schedule.recheckReasons)}</div>`:'<p class="journey-note">일정·기관·출발 지역·휠체어 조건이 바뀌면 이전 이동·동행 문의 결과를 다시 확인합니다.</p>'}</section>
    <section class="journey-section" aria-labelledby="journey-data-title"><h3 id="journey-data-title">공공자료가 바꾼 문의 후보와 질문</h3><p class="journey-note">공개 등록 자료로 문의 후보를 좁힙니다. 현재 진료 수용·임상 적합성·차량·동행 인력의 확보 여부는 별도 확인입니다.</p><div class="journey-data">${journey.dataImpact.map(item=>`<details class="journey-data-item" data-journey-data="${escape(item.id)}" ${openItems.has(item.id)?'open':''}><summary><span><strong>${escape(item.title)}</strong><span>${escape(item.datasetId || '별도 공식 안내')}${Number.isFinite(item.candidateCount)?` · 공개 후보 ${escape(item.candidateCount)}곳`:''}</span></span>${icon('chevron')}</summary><div class="journey-data-content"><p class="journey-detail">${escape(item.detail)}</p>${item.questions.length?`<h4>이 자료로 더 확인할 질문</h4>${list(item.questions)}`:''}<div class="journey-source">${safeSource(item.sourceUrl)}</div></div></details>`).join('')}</div></section>
    <section class="journey-section" aria-labelledby="journey-next-title"><h3 id="journey-next-title">다음 요청으로 이어가기</h3><ul class="journey-next-actions">${journey.nextActions.map(item=>`<li><strong>${escape(item.title)}</strong><p class="journey-note">${escape(item.detail)}</p>${draftButton(item)}</li>`).join('')}</ul><p class="journey-note">초안 버튼은 대화를 전송하거나 기관에 연락하지 않습니다.</p></section>
    <section class="journey-section" aria-labelledby="journey-scenarios-title"><h3 id="journey-scenarios-title">세 가지 상황 미리보기</h3><p class="journey-note">작성된 합성 예시로 현재 대화를 바꾸어 봅니다. 실제 모델·환자 기록 조회·전화는 실행하지 않습니다.</p><div class="journey-scenarios">${JOURNEY_SCENARIOS.map(item=>`<button type="button" data-journey-scenario="${escape(item.id)}" ${disabled?'disabled':''}><span><strong>${escape(item.label)}</strong><span>${escape(item.description)}</span></span>${icon('chevron')}</button>`).join('')}</div></section>`;
  if(focusItem && focusSelector && document.getElementById('care-journey-dialog').open)host.querySelector(`[data-journey-task="${CSS.escape(focusItem)}"], [data-journey-data="${CSS.escape(focusItem)}"]`)?.querySelector(focusSelector)?.focus({preventScroll:true});
}

function openCareJourney() {
  const dialog=document.getElementById('care-journey-dialog');
  if(dialog.open)return;
  careJourneyReturnFocus=mobileRail.matches && document.getElementById('care-rail').contains(document.activeElement)?document.getElementById('open-care-menu'):document.activeElement;
  closeCareMenu({restoreFocus:false});renderCareJourney();
  dialog.returnValue='';dialog.showModal();
  document.body.classList.add('records-dialog-open');
  document.getElementById('care-journey-content').scrollTop=0;
  document.getElementById('care-journey-title').focus({preventScroll:true});
}

function trapDialogFocus(event,dialog) {
  if(event.key!=='Tab')return;
  const items=[...dialog.querySelectorAll('a[href],button:not(:disabled),summary,[tabindex]:not([tabindex="-1"])')].filter(node=>{
    if(!node.getClientRects().length || getComputedStyle(node).visibility==='hidden')return false;
    for(let ancestor=node.parentElement;ancestor && ancestor!==dialog;ancestor=ancestor.parentElement) {
      if(ancestor.tagName==='DETAILS' && !ancestor.open && !ancestor.querySelector(':scope > summary')?.contains(node))return false;
    }
    return true;
  });
  const first=items[0],last=items.at(-1);
  if(event.shiftKey && (document.activeElement===first || !items.includes(document.activeElement))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
}

function hasConversationWork() {
  return Boolean(appointmentDemo || document.getElementById('request-input')?.value.trim() || document.querySelector('.message.user') || responseCount);
}

function loadVisitToken() {
  try {
    const token=sessionStorage.getItem(VISIT_TOKEN_STORAGE_KEY);
    if(token===null || VISIT_TOKEN.test(token))return token || undefined;
    sessionStorage.removeItem(VISIT_TOKEN_STORAGE_KEY);
  } catch {visitStorageAvailable=false;}
}

function storeVisitToken() {
  try {
    if(visitToken)sessionStorage.setItem(VISIT_TOKEN_STORAGE_KEY,visitToken);
    else sessionStorage.removeItem(VISIT_TOKEN_STORAGE_KEY);
  } catch {visitStorageAvailable=false;}
}

function stopVisitRecovery() {
  visitRecoveryRequest?.controller.abort();visitRecoveryRequest=undefined;
}

function clearVisitRecovery() {
  stopVisitRecovery();visitToken=undefined;storeVisitToken();
  visitRecoveryMessage='';visitRecoveryExpired=false;renderVisitRecovery();
}

function renderVisitRecovery() {
  const notice=document.getElementById('visit-recovery-notice');
  const copy=visitRecoveryMessage || (!visitStorageAvailable && capabilities.visitRecovery==='token'?'이 브라우저는 이어하기 참조를 저장할 수 없어요. 현재 탭의 요청은 계속할 수 있지만 새로고침 뒤에는 복구되지 않습니다.':'');
  notice.hidden=!copy;notice.textContent=copy;
  const enabled=Boolean(visitToken && !previewMode);
  document.getElementById('visit-recovery-controls').hidden=!enabled && visitStorageAvailable;
  const button=document.getElementById('resume-visit');
  button.hidden=!enabled;button.disabled=pending || Boolean(activeRecognition || visitRecoveryRequest) || visitRecoveryExpired;
  button.setAttribute('aria-busy',String(Boolean(visitRecoveryRequest)));
  document.getElementById('visit-recovery-scope').textContent=visitStorageAvailable?'이 탭에서 새로고침한 뒤 확인된 준비를 이어 볼 수 있어요. 대화 원문은 보관하지 않습니다.':'이 브라우저는 이어하기 참조를 저장할 수 없어요. 현재 탭에서는 계속 요청할 수 있지만 새로고침 뒤에는 복구되지 않습니다.';
}

function normalizeRecovery(data) {
  const recovery=data?.recovery,request=recovery?.request;
  if(!data?.caseState?.patient || typeof data.sessionId!=='string' || !VISIT_TOKEN.test(data.sessionId) || !recovery
    || !(recovery.savedAt===null || typeof recovery.savedAt==='string' && recovery.savedAt.length<=40 && Number.isFinite(Date.parse(recovery.savedAt)))
    || !Number.isSafeInteger(recovery.expiresAt) || recovery.expiresAt<=0 || recovery.expiresAt>8640000000000
    || !(request===null || request && typeof request.requestId==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{11,79}$/.test(request.requestId) && ['running','completed','interrupted'].includes(request.status)))throw new Error('INVALID_RECOVERY');
  getProgress(data.caseState);getVisitSupportSummary(data.caseState);getTasks(data.caseState);
  return {sessionId:data.sessionId,caseState:data.caseState,pendingActions:normalizePendingActions(data.pendingActions),recovery};
}

async function resumeVisit() {
  if(pending || activeRecognition || !visitToken || previewMode || visitRecoveryExpired)return;
  stopVisitRecovery();
  const request={token:visitToken,version:conversationVersion,controller:new AbortController()};visitRecoveryRequest=request;
  const current=()=>visitRecoveryRequest===request && request.version===conversationVersion && visitToken===request.token;
  visitRecoveryMessage='저장된 방문 준비를 확인하고 있어요.';renderVisitRecovery();
  const timer=setTimeout(()=>request.controller.abort(),8000);
  try {
    const data=normalizeRecovery(await callAgent(API+'/resume',{visitToken:request.token},request.controller.signal));
    if(!current())return;
    const restoreReading=preservePreparationReading();
    const stateChanged=JSON.stringify(caseState)!==JSON.stringify(data.caseState);
    const snapshotChanged=stateChanged || JSON.stringify(latestActions)!==JSON.stringify(data.pendingActions) || responseCount===0;
    caseState=data.caseState;sessionId=data.sessionId;latestActions=data.pendingActions;
    if(stateChanged)latestEvents=[];
    requestProblem='';previewProblem=false;
    if(data.recovery.savedAt!==null)responseCount=Math.max(responseCount,1);
    document.querySelector('#message-list .greeting')?.remove();
    const status=data.recovery.request?.status;
    const summary=status==='running'?'직전 요청은 아직 처리 중으로 표시돼요. 마지막 확인 상태만 불러왔습니다.':status==='interrupted'?'직전 요청의 완료 여부를 확인하지 못했어요. 자동으로 다시 실행하지 않고 마지막 확인 상태를 불러왔습니다.':'마지막으로 확인된 방문 준비와 남은 일을 불러왔어요.';
    const dateFormat=new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const date=data.recovery.savedAt?dateFormat.format(new Date(data.recovery.savedAt)):'아직 완료된 요청 없음';
    visitRecoveryMessage=`${summary} 확인 시점: ${date}. 저장 기간: ${dateFormat.format(new Date(data.recovery.expiresAt*1000))}까지. 이전 대화 원문은 보관하지 않습니다.`;
    if(status==='completed') {
      const failed=failedRequests.get(data.recovery.request.requestId);
      if(failed && failed.preferencesRevision===preferencesRevision && preferencesEqual(failed.body.preferences,carePreferences))preferencesNeedApply=false;
      failedRequests.delete(data.recovery.request.requestId);
      const node=document.querySelector(`[data-message-id="${data.recovery.request.requestId}"]`);
      node?.classList.remove('failed');node?.querySelector('.request-error')?.remove();
    }
    if(snapshotChanged)renderSnapshot();else{preferenceFeedback();renderBoard();}
    restoreReading?.();
    document.getElementById('conversation-status').textContent=summary;
  } catch(error) {
    if(!current())return;
    if(error.message==='SESSION_EXPIRED') {
      visitRecoveryExpired=Boolean(sessionId || responseCount);
      if(!visitRecoveryExpired){visitToken=undefined;preferencesNeedApply=true;}
      try {sessionStorage.removeItem(VISIT_TOKEN_STORAGE_KEY);} catch {visitStorageAvailable=false;}
      failedRequests.clear();document.querySelectorAll('[data-retry]').forEach(button=>button.remove());
      visitRecoveryMessage=visitRecoveryExpired?'저장된 방문 준비의 기간이 끝났어요. 필요한 내역을 저장한 뒤 새 대화로 시작해 주세요.':'저장된 방문 준비가 없거나 기간이 끝났어요. 작성한 내용은 유지되며 새 요청으로 시작할 수 있습니다.';
    } else visitRecoveryMessage='저장된 준비를 확인하지 못했어요. 작성한 내용은 그대로 두었습니다. 방문 상세에서 다시 확인할 수 있습니다.';
    document.getElementById('conversation-status').textContent=visitRecoveryMessage;
  } finally {
    clearTimeout(timer);
    if(visitRecoveryRequest===request){visitRecoveryRequest=undefined;renderVisitRecovery();}
  }
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
      phone: ['simulation','not_connected','connected'].includes(next.phone) ? next.phone : capabilities.phone,
      healthRecords: ['demo','not_connected','connected'].includes(next.healthRecords) ? next.healthRecords : capabilities.healthRecords,
      progress: next.progress==='poll'?'poll':'unavailable',
      visitRecovery: ['token','unavailable'].includes(next.visitRecovery)?next.visitRecovery:capabilities.visitRecovery || 'unavailable',
      voiceInput:'browser',
    };
  }
  if (capabilities.llm !== null) capabilityState = capabilities.llm === true ? 'connected' : 'unavailable';
  const connection = document.getElementById('connection-state');
  connection.className = `connection-state ${capabilityState}`;
  connection.textContent = capabilityState === 'connected' ? '대화 연결 설정됨' : capabilityState === 'checking' ? '연결 확인 중' : 'AI 모델 미연결';
  const copy = capabilityCopy();
  document.getElementById('mode-label').textContent = `가상 사례 · ${capabilities.phone === 'connected' ? '연결 상태 확인' : '실제 발신 없음'}`;
  document.getElementById('connection-details').innerHTML = `<dl><div><dt>대화</dt><dd>${capabilities.llm === true ? '모델 연결을 설정했습니다. 실제 응답은 요청을 보낼 때 확인합니다.' : capabilityState === 'checking' ? '대화 API 연결 상태를 확인하고 있습니다.' : 'AI 모델은 아직 연결하지 않았습니다. 자유 입력은 대화 API로 전송하며, 모델 연결 뒤 작동합니다.'}</dd></div><div><dt>기록</dt><dd>${escape(copy.records)}</dd></div><div><dt>문의</dt><dd>${escape(copy.phone)}</dd></div><div><dt>음성</dt><dd>${SpeechRecognition ? '브라우저에서 한국어 요청을 텍스트로 바꿉니다.' : '이 브라우저는 음성 입력을 지원하지 않습니다. 텍스트로 요청하세요.'}</dd></div></dl><p>체험은 작성된 예시이며 실제 AI 모델의 응답이 아닙니다. 공개 자료와 합성 사례로 준비 흐름을 보여 줍니다.</p><p>실제 기록 조회에는 본인인증·동의와 연계 서비스가 필요합니다. 연결 설정과 실제 처리 완료는 구분합니다.</p>`;
  const notice = document.getElementById('mode-notice');
  notice.hidden = !previewMode && capabilities.llm === true;
  notice.classList.toggle('is-preview',previewMode);
  notice.textContent = previewMode ? '작성된 예시 · 합성 사례, 실제 연락·예약 없음' : capabilityState === 'checking' ? '연결 범위를 확인하고 있어요.' : '자유 입력은 AI 연결 후 사용할 수 있어요. 방문 준비 체험은 바로 시작할 수 있어요.';
  renderVisitRecovery();
}

function renderSnapshot({updateBoard=true}={}) {
  if(document.getElementById('patient-records-dialog').open)renderPatientRecords();
  if(document.getElementById('contact-plan-dialog').open)renderContactPlans();
  renderCareJourney({includeDetails:document.getElementById('care-journey-dialog').open});
  const snapshot = safeSummary();
  if (!snapshot) {
    document.getElementById('case-content').innerHTML = '<p class="quiet">준비 상태를 확인하지 못했어요. 대화에서 다시 확인을 요청해 주세요.</p>';
    return;
  }
  const {progress,support,tasks} = snapshot;
  const patient = caseState.patient;
  const confirmed = Object.values(caseState.inquiries).filter(item => item.status === 'confirmed').length;
  const time = caseState.visitSupport?.requirements?.appointmentTime;
  document.getElementById('case-heading').innerHTML = `<span class="patient-name">${escape(patient.name)}</span><span class="case-heading-context"> 님의 진료 준비</span>`;
  document.getElementById('case-heading').setAttribute('aria-label',`${patient.name} 님의 진료 준비`);
  document.getElementById('case-caption').textContent = `${patient.area} · 보호자 ${patient.caregiver} · 합성 사례`;
  document.getElementById('rail-patient').innerHTML = `<span class="patient-name">${escape(patient.name)}</span> 님`;
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
  const sourcesHost=document.getElementById('case-sources');
  renderPreparationSources(sourcesHost,sourceItems.map(item=>({url:item.source,label:`${item.label} · 사용한 출처`})));
  if(!sourcesHost.children.length)sourcesHost.innerHTML='<p>Agent가 자료를 조회하면 사용한 출처를 처리 기록과 함께 보여드립니다.</p>';
  document.getElementById('save-report').disabled = responseCount === 0;
  if(updateBoard)renderBoard();
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
  if(role==='user')document.querySelector('#message-list .greeting')?.remove();
  const body=greeting?`<div class="welcome-content">${formatMessage(text)}</div>`:formatMessage(text);
  node.innerHTML = `<div class="message-meta">${role==='assistant'?'<img src="/assets/hondi-mark-v1.png" alt="" width="23" height="23"/>':''}<strong>${role==='user'?'보호자':'혼디'}</strong>${isExample?'<span class="example-label">작성된 예시</span>':greeting?'':`<time>${escape(timeLabel(new Date()))}</time>`}</div><div class="message-body">${body}</div>${eventsMarkup(events)}`;
  document.getElementById('message-list').append(node);
  return node;
}


function scrollToMessage(node,readFrom=node) {
  if(!node)return;
  const historyDetails=node.closest('#conversation-history');
  if(historyDetails)historyDetails.open=true;
  requestAnimationFrame(()=>{
    if(!node.isConnected || !document.getElementById('conversation-scroll').checkVisibility())return;
    node.setAttribute('tabindex','-1');node.focus({preventScroll:true});
    const scroller=document.getElementById('conversation-scroll');
    if(!scroller.checkVisibility())return;
    scroller.scrollTop+=readFrom.getBoundingClientRect().top-scroller.getBoundingClientRect().top-12;
  });
}

function resizeInput() {
  const input = document.getElementById('request-input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight,128)}px`;
  document.getElementById('send-request').disabled = pending || Boolean(guidedDemo) || appointmentOpen || Boolean(activeRecognition) || !input.value.trim();
  document.getElementById('character-count').textContent = `${input.value.length}/${MAX_MESSAGE}`;
  for(const button of document.querySelectorAll('[data-contact-draft],[data-journey-draft],[data-journey-scenario],[data-call-recovery-scenario],[data-workflow-draft],[data-workflow-choice],#next-request-draft'))button.disabled=pending || Boolean(activeRecognition);
  renderVisitRecovery();
  if(regionHomeOpen&&careEntry.screen==='request'){renderRegionHome();syncAppointmentMode();}
}

function fillRequestDraft(text,{source='요청 예시',focus=true,preserveExisting=false}={}) {
  if(appointmentOpen || regionHomeOpen)closeAppointmentDemo();
  if(pending || activeRecognition)return false;
  if(guidedDemo && !resetConversation({focus:false}))return false;
  const input=document.getElementById('request-input');
  const draft=preserveExisting?mergeAppointmentDraft(input.value,text,MAX_MESSAGE):String(text || '').trim().slice(0,MAX_MESSAGE);
  if(draft===null) {
    const feedback=document.getElementById('draft-feedback');feedback.hidden=false;
    feedback.textContent='작성 중인 요청과 선택 내용을 함께 담기에는 길어요. 기존 입력을 유지했으니 내용을 줄인 뒤 예약 준비에서 다시 눌러 주세요.';
    resizeInput();if(focus)input.focus({preventScroll:true});return false;
  }
  if(!draft)return false;
  if(!preserveExisting && input.value.trim() && input.value.trim()!==draft && !window.confirm('입력창에 작성 중인 요청이 있어요. 선택한 문구로 바꿀까요? 취소하면 기존 초안을 유지합니다.'))return false;
  input.value=draft;resizeInput();
  const feedback=document.getElementById('draft-feedback');
  feedback.hidden=false;feedback.textContent=`${source} · 입력창에 넣었어요. 확인 후 보내 주세요.`;
  if(focus)input.focus({preventScroll:true});
  return true;
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
  for (const button of document.querySelectorAll('[data-contact-draft],[data-journey-draft],[data-journey-scenario],[data-call-recovery-scenario],[data-workflow-draft],[data-workflow-choice],#next-request-draft')) button.disabled=value || Boolean(activeRecognition);
  renderBoard();
  renderVisitRecovery();
  if(value){const cancel=document.getElementById('cancel-request');cancel.focus({preventScroll:true});}
}

function requestIsCurrent(request) {
  return activeRequest===request && request.version===conversationVersion;
}

function beginRequest(kind,values,timeout) {
  stopVisitRecovery();visitRecoveryMessage='';
  const request={...values,kind,version:conversationVersion,controller:new AbortController()};
  activeRequest=request;
  requestProblem='';previewProblem=false;unreadAnswer=false;clearInputFeedback();
  request.timer=setTimeout(()=>{if(requestIsCurrent(request))cancelRequest({timedOut:true});},timeout);
  setPending(true);
  return request;
}

function finishRequest(request) {
  clearTimeout(request.timer);
  stopProgress(request);
  if(!requestIsCurrent(request))return false;
  activeRequest=undefined;setPending(false);
  if(request.kind==='preview'){const button=document.getElementById('preview-button');button.textContent='결과 예시';button.setAttribute('aria-label','준비 결과 예시 보기');button.title='선택 없이 준비 결과 예시 보기';}
  return true;
}

function showRequestProblem(request,copy,{uncertain=false}={}) {
  requestProblem=copy;
  failedRequests.set(request.requestId,{text:request.text,body:request.body,preferencesRevision:request.preferencesRevision});
  const firstRequestWarning=uncertain && !request.body.sessionId && !request.body.visitToken ? '첫 응답을 받기 전이라 재시도하면 서버에서 같은 일을 한 번 더 처리하고 시연 이용 횟수가 추가될 수 있어요.' : '';
  const node=request.messageNode;
  if(node?.isConnected) {
    node.classList.add('failed');node.querySelector('.request-error')?.remove();
    const problem=document.createElement('div');problem.className='request-error';problem.setAttribute('role','alert');
    problem.innerHTML=`<p>${escape(copy)}</p>${firstRequestWarning?`<p>${escape(firstRequestWarning)}</p>`:''}<button type="button" class="text-button" data-retry="${escape(request.requestId)}">같은 요청 다시 확인${icon('refresh')}</button>`;
    node.append(problem);
  }
  const input=document.getElementById('request-input');
  input.value=request.text;resizeInput();
}

function cancelRequest({timedOut=false}={}) {
  const request=activeRequest;
  if(!request || !requestIsCurrent(request))return;
  request.stopReason=timedOut?'timeout':'user';request.controller.abort();
  if(request.kind==='message') {
    const copy=timedOut?'응답을 오래 기다려 이 화면의 대기를 마치고 요청을 복원했어요.':'응답 대기를 중지하고 요청을 입력창에 복원했어요.';
    showRequestProblem(request,copy+' 서버 처리는 계속될 수 있습니다. 실제 발신을 중단했다는 뜻은 아니며, 현재 실제 전화는 연결되어 있지 않습니다.',{uncertain:true});
  } else {
    failedPreviewRequest=request.body;previewProblem=true;
    const notice=document.getElementById('mode-notice');
    notice.hidden=false;notice.textContent=(timedOut?'준비 흐름 체험을 오래 기다려 이 화면의 대기를 마쳤어요.':'준비 흐름 체험 대기를 중지했어요.')+' 현재 대화와 초안은 유지됩니다. 서버 처리는 계속될 수 있습니다.';
  }
  document.getElementById('conversation-status').textContent='이 화면의 응답 대기를 중지했습니다. 서버 처리 중단을 확인한 것은 아닙니다.';
  finishRequest(request);
  if(request.messageNode)scrollToMessage(request.messageNode);
  document.getElementById('request-input').focus({preventScroll:true});
}

function errorCopy(code) {
  if(code==='MODEL_QUOTA_EXHAUSTED')return 'AI 이용 잔액이 소진되어 운영자의 확인이 필요해요. 입력은 보존했으며, 병원 선택과 준비표 저장은 계속 이용할 수 있습니다.';
  if(code==='MODEL_BUDGET_UNAVAILABLE')return '이용 한도를 확인하지 못해 AI 요청을 보내지 않았어요. 입력은 그대로 남겨두었습니다.';
  if(code==='REQUEST_CONFLICT')return '같은 요청 번호에 다른 내용이 있어 실행하지 않았어요. 저장된 준비를 확인한 뒤 새 요청으로 말씀해 주세요.';
  if(code==='REQUEST_IN_PROGRESS')return '같은 요청이 아직 처리 중으로 표시돼요. 자동으로 다시 실행하지 않습니다. 방문 상세에서 저장된 준비를 확인해 주세요.';
  if(code==='REQUEST_INTERRUPTED')return '이 요청의 완료 여부를 확인하지 못해 다시 실행하지 않았어요. 방문 상세에서 확인된 준비와 남은 일을 먼저 살펴주세요.';
  if (/MODEL_NOT_CONFIGURED|MODEL_DISABLED|LLM_NOT_CONFIGURED|MODEL_NOT_CONNECTED/.test(code)) return 'AI 모델이 아직 연결되지 않았어요. 입력한 요청은 그대로 남겨두었습니다. ‘체험’에서 준비 흐름을 볼 수 있어요.';
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
  return '대화 서비스에 연결하지 못했어요. 요청 내용은 입력창에 남겨두었습니다. 잠시 뒤 다시 보내주세요.';
}

function normalizeResponse(data) {
  if (!data || typeof data.reply!=='string' || !data.reply.trim() || data.reply.length>16000 || typeof data.sessionId!=='string' || data.sessionId.length>160 || !data.caseState?.patient) throw new Error('INVALID_RESPONSE');
  getProgress(data.caseState); getVisitSupportSummary(data.caseState); getTasks(data.caseState);
  const events = (Array.isArray(data.events)?data.events:[]).slice(0,24).map((event,index)=>({
    id:String(event.id || index),tool:String(event.tool || '').slice(0,100),label:String(event.label || '요청 처리').slice(0,200),
    status:['completed','needs_input','not_connected','error'].includes(event.status)?event.status:'needs_input',
    detail:String(event.detail || '').slice(0,1600),isSimulation:event.isSimulation===true,source:typeof event.source==='string'?event.source.slice(0,1000):'',
  }));
  return {...data,events,pendingActions:normalizePendingActions(data.pendingActions)};
}

function normalizePendingActions(items) {
  return (Array.isArray(items)?items:[]).slice(0,12).filter(item=>item && typeof item==='object').map(item=>({id:String(item.id || ''),kind:String(item.kind || ''),label:String(item.label || '').slice(0,240),reason:String(item.reason || '').slice(0,600)}));
}

async function payloadHash(payload) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function makeProgressToken() {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function stopProgress(request) {
  if(!request)return;
  request.progressStopped=true;clearTimeout(request.progressTimer);
  request.progressController?.abort();
}

function startProgress(request) {
  if(request.kind!=='message' || !request.body.progressToken || capabilities.progress!=='poll')return;
  const token=request.body.progressToken;
  const current=()=>requestIsCurrent(request) && !request.progressStopped && request.body.progressToken===token;
  request.progressPolls=0;
  const poll=async()=>{
    if(!current() || request.progressPolls>=26)return;
    request.progressPolls++;
    const controller=new AbortController();request.progressController=controller;
    const timer=setTimeout(()=>controller.abort(),2250);
    try {
      const payload=JSON.stringify({progressToken:token});
      const hash=await payloadHash(payload);
      if(!current())return;
      const response=await fetch(API+'/progress',{method:'POST',headers:{'Content-Type':'application/json','x-amz-content-sha256':hash},body:payload,signal:controller.signal,cache:'no-store'});
      if(!current())return;
      if(!response.ok)throw new Error('PROGRESS_UNAVAILABLE');
      const raw=await response.json();
      if(!current())return;
      if(raw?.available===true) {
        const progress=normalizePreparationProgress(raw.progress);
        if(!progress)throw new Error('PROGRESS_UNAVAILABLE');
        if(!request.progress || progress.sequence>request.progress.sequence) {
          request.progress=progress;renderBoard();
        }
        if(request.progress?.status!=='running')return;
      } else if(raw?.available!==false)throw new Error('PROGRESS_UNAVAILABLE');
    } catch {
      // 진행 조회가 실패해도 원래 응답을 기다리며 준비 상태를 바꾸지 않는다.
      return;
    } finally {clearTimeout(timer);}
    if(current() && request.progressPolls<26)request.progressTimer=setTimeout(poll,2500);
  };
  request.progressTimer=setTimeout(poll,2500);
}

// 모델 연결을 바꿔도 화면·음성 입력은 이 API 경로를 그대로 사용한다.
async function callAgent(path,body,signal) {
  const payload=JSON.stringify(body);
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','x-amz-content-sha256':await payloadHash(payload)},body:payload,signal,cache:'no-store'});
  let raw;
  try {raw=await response.json();} catch {throw new Error('INVALID_RESPONSE');}
  if(!response.ok || raw?.error)throw new Error(String(raw?.error?.code || `HTTP_${response.status}`));
  return raw;
}

async function showPreview(scenarioId='aewol-parent-visit',answers=[]) {
  if(pending || activeRecognition || appointmentOpen || regionHomeOpen)return;
  const guided=scenarioId===GUIDED_DEMO_ID;
  if(![GUIDED_DEMO_ID,'aewol-parent-visit',...JOURNEY_SCENARIOS.map(item=>item.id),...CALL_RECOVERY_SCENARIOS.map(item=>item.id)].includes(scenarioId))return;
  if(guided && !getGuidedDemo(answers))return;
  const advancing=guided && guidedDemo && answers.length===guidedDemo.answers.length+1 && guidedDemo.answers.every((value,index)=>answers[index]===value);
  if(!advancing && hasConversationWork() && !window.confirm('준비 흐름 체험을 열면 현재 대화와 작성 중인 요청이 사라집니다. 체험을 열까요?'))return;
  const sameRetry=failedPreviewRequest?.scenarioId===scenarioId && JSON.stringify(failedPreviewRequest.answers ?? [])===JSON.stringify(answers);
  const body=sameRetry?failedPreviewRequest:{scenarioId,...(guided?{answers}:{}),requestId:makeId()};
  const journeyDialog=document.getElementById('care-journey-dialog');
  if(journeyDialog.open)journeyDialog.close('preview');
  const contactDialog=document.getElementById('contact-plan-dialog');
  if(contactDialog.open)contactDialog.close('preview');
  const request=beginRequest('preview',{body},30000);
  let restoreReading,applied=false;
  const button=document.getElementById('preview-button');
  const notice=document.getElementById('mode-notice');
  button.textContent='불러오는 중';button.setAttribute('aria-label','준비 결과 예시 불러오는 중');button.title='준비 흐름 체험 불러오는 중';
  try {
    const data=normalizeResponse(await callAgent(API+'/preview',request.body,request.controller.signal));
    if(!requestIsCurrent(request))return;
    if(data.isPreview!==true || !Array.isArray(data.previewMessages) || !data.previewMessages.length)throw new Error('INVALID_PREVIEW');
    const nextDemo=guided?getGuidedDemo(data.guidedDemo?.answers):null;
    if(guided && (!nextDemo || JSON.stringify(data.guidedDemo.answers)!==JSON.stringify(answers)))throw new Error('INVALID_PREVIEW');
    const messages=data.previewMessages.slice(0,12).filter(message=>['user','assistant'].includes(message.role) && typeof message.text==='string' && message.text.trim()).map(message=>({role:message.role,text:message.text.slice(0,16000)}));
    if(!messages.length)throw new Error('INVALID_PREVIEW');
    const last=messages.at(-1);
    if(last.role!=='assistant' || last.text!==data.reply)messages.push({role:'assistant',text:data.reply});
    clearVisitRecovery();previewMode=true;sessionId=undefined;history=[];failedRequests.clear();
    const previousStep=answers.length?getGuidedDemo(answers.slice(0,-1)):null;
    guidedDemo=nextDemo?{...nextDemo,previousAnswer:previousStep?.choices.find(choice=>choice.id===answers.at(-1))?.label,
      result:data.reply.endsWith(nextDemo.title)?data.reply.slice(0,-nextDemo.title.length).trim():data.reply}:null;
    document.getElementById('guided-demo-result').open=false;
    failedPreviewRequest=undefined;
    caseState=data.caseState;latestActions=data.pendingActions;latestEvents=data.events;responseCount=1;
    if(guided)manualStageSelection=false;
    restoreReading=markAnswerReady();
    document.getElementById('request-input').value='';resizeInput();
    document.getElementById('message-list').replaceChildren();
    document.getElementById('starter-prompts').hidden=true;
    messages.forEach((message,index)=>appendMessage({...message,isExample:true,events:index===messages.length-1?data.events:[]}));
    // 미리보기의 LLM 미사용은 전역 모델 연결 설정과 별개다.
    updateCapabilities();renderSnapshot({updateBoard:false});applied=true;
    document.getElementById('conversation-status').textContent=guided?`${data.reply} ${guidedDemo.title}`:'준비 흐름 체험의 고정 합성 예시를 불러왔습니다. 실제 모델 응답과 전화는 아닙니다.';
  } catch {
    if(!requestIsCurrent(request))return;
    failedPreviewRequest=request.body;previewProblem=true;
    notice.hidden=false;notice.textContent=guided?'체험을 불러오지 못했어요. 앞선 준비는 그대로입니다. 같은 답변을 다시 선택해 주세요.':'준비 흐름 체험을 불러오지 못했어요. 연결 상태를 확인한 뒤 ‘체험’을 다시 눌러주세요.';
    document.getElementById('conversation-status').textContent=notice.textContent;
  } finally {
    if(finishRequest(request)) {
      if(applied && guidedDemo?.complete)document.querySelector('#stage-plan [data-stage-details]').open=true;
      if(applied && !unreadAnswer)showCurrentTask();
      else restoreReading?.();
    }
  }
}

async function sendRequest(text,retryId) {
  if(regionHomeOpen&&careEntry.screen==='request'&&!pending&&!activeRecognition&&!retryId){const entered=String(text??document.getElementById('request-input').value),conditions=careEntry.conditionText;if(voiceSession?.active)void voiceSession.stop();prepareCareRequest(entered,conditions);return;}
  if (pending || activeRecognition || guidedDemo || appointmentOpen || regionHomeOpen) return;
  const input=document.getElementById('request-input');
  if(capabilityState==='checking') {
    const version=conversationVersion,draft=input.value;
    await capabilitiesReady;
    if(pending || activeRecognition || version!==conversationVersion || input.value!==draft)return;
  }
  if(visitRecoveryExpired){voiceMessage('저장된 방문 준비의 기간이 끝났어요. 필요한 내역을 저장한 뒤 새 대화로 시작해 주세요.',true);return;}
  const failed=retryId?failedRequests.get(retryId):undefined;
  if(retryId && !failed)return;
  text=String(failed?.text ?? text ?? input.value).trim();
  if (!text || text.length>MAX_MESSAGE) return;
  if(retryId && input.value.trim() && input.value.trim()!==text && !window.confirm('같은 요청을 다시 확인하면 작성 중인 새 초안을 원래 요청으로 바꿉니다. 계속할까요?'))return;
  if(previewMode)resetConversation({focus:false,force:true});
  if(!failed && capabilities.visitRecovery==='token' && !visitToken) {
    visitToken=makeProgressToken();storeVisitToken();
  }
  const requestId=retryId || makeId();
  const coreBody=failed ? {...failed.body} : {message:text,...(sessionId?{sessionId}:{}),...(visitToken && capabilities.visitRecovery==='token'?{visitToken}:{}),history:normalizeHistory(history),requestId,preferences:{...carePreferences},applyPreferences:preferencesNeedApply,guidedPreparation:true};
  delete coreBody.progressToken;
  const requestBody={...coreBody,...(capabilities.progress==='poll' && capabilities.llm===true?{progressToken:makeProgressToken()}: {})};
  manualStageSelection=compactWorkspace.matches && workspaceView==='preparation';
  let messageNode,replyNode,restoreReading;
  if (retryId) {
    messageNode=document.querySelector(`[data-message-id="${requestId}"]`);
    messageNode?.querySelector('.request-error')?.remove();
    messageNode?.classList.remove('failed');
  } else messageNode=appendMessage({role:'user',text,id:requestId});
  document.getElementById('starter-prompts').hidden=true;
  input.value='';resizeInput();
  const request=beginRequest('message',{text,requestId,body:requestBody,messageNode,preferencesRevision:failed?failed.preferencesRevision:preferencesRevision},65000);
  startProgress(request);
  try {
    const data=normalizeResponse(await callAgent(API,requestBody,request.controller.signal));
    if(!requestIsCurrent(request))return;
    caseState=data.caseState;sessionId=data.sessionId;latestActions=data.pendingActions;latestEvents=data.events;responseCount++;
    restoreReading=markAnswerReady();
    history=normalizeHistory([...history,{role:'user',text},{role:'assistant',text:data.reply}]);
    failedRequests.delete(requestId);
    if(request.preferencesRevision===preferencesRevision && preferencesEqual(requestBody.preferences,carePreferences))preferencesNeedApply=false;
    replyNode=appendMessage({role:'assistant',text:data.reply,events:data.events});
    updateCapabilities(data.capabilities);renderSnapshot({updateBoard:false});
    document.getElementById('conversation-status').textContent=data.needsInput?'필요한 내용을 이어서 말씀해 주세요.':'준비 내용을 갱신했습니다.';
  } catch(error) {
    if(!requestIsCurrent(request))return;
    const code=error.name==='AbortError'?'MODEL_TIMEOUT':error.message || 'CONNECTION_ERROR';
    const copy=errorCopy(code)+(request.stopReason==='timeout'?' 이 화면의 대기만 끝났으며 서버 처리는 계속될 수 있습니다.':'' );
    showRequestProblem(request,copy,{uncertain:request.stopReason==='timeout'});
    document.getElementById('conversation-status').textContent='요청 전송을 확인하지 못했습니다.';
    updateCapabilities(/MODEL_NOT_CONFIGURED|MODEL_DISABLED|LLM_NOT_CONFIGURED|MODEL_NOT_CONNECTED|MODEL_QUOTA_EXHAUSTED/.test(code)?{llm:false}:undefined);
  } finally {
    if(finishRequest(request)) {
      if(!replyNode && !manualStageSelection)scrollToMessage(messageNode);
      else if(!manualStageSelection)showCurrentTask();
      else restoreReading?.();
    }
  }
}

function clearInputFeedback() {
  const feedback=document.getElementById('draft-feedback');feedback.hidden=true;feedback.textContent='';
  const hint=document.getElementById('voice-help');hint.hidden=true;hint.textContent='';
  document.getElementById('composer-help').open=false;
}

function voiceMessage(text,error=false) {
  const hint=document.getElementById('voice-help');hint.hidden=false;hint.textContent=text;hint.classList.toggle('error',error);
  document.getElementById('composer-help').open=true;
}

function resetVoiceButton() {
  const button=document.getElementById('voice-request');button.classList.remove('listening');button.setAttribute('aria-pressed','false');button.setAttribute('aria-label','음성으로 요청하기');button.innerHTML=micIcon+'<span>말로 요청</span>';
}

function startVoice() {
  if((guidedDemo&&!(regionHomeOpen&&careEntry.screen==='request')) || appointmentOpen)return;
  if(voiceSession?.active)return;
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
    if(activeRecognition!==recognition || recognitionCancelled)return;
    const button=document.getElementById('voice-request');button.classList.add('listening');button.setAttribute('aria-pressed','true');button.setAttribute('aria-label','음성 입력 중지');button.innerHTML=stopIcon+'<span>듣기 중지</span>';
    voiceMessage('듣고 있어요. 말이 끝나면 내용을 확인하고 보내 주세요.');
    resizeInput();
  };
  recognition.onresult=event=>{
    if(activeRecognition!==recognition || recognitionCancelled)return;
    let interim='';
    for(let index=event.resultIndex;index<event.results.length;index++) {
      const transcript=event.results[index][0]?.transcript || '';
      if(event.results[index].isFinal)finalTranscript+=transcript;else interim+=transcript;
    }
    const value=[voiceBase,finalTranscript,interim].filter(Boolean).join(' ').slice(0,MAX_MESSAGE);
    document.getElementById('request-input').value=value;resizeInput();
  };
  recognition.onspeechend=()=>{if(activeRecognition===recognition && !recognitionCancelled)recognition.stop();};
  recognition.onerror=event=>{
    if(activeRecognition!==recognition || recognitionCancelled)return;
    recognitionFailed=true;
    const errors={'not-allowed':'마이크 권한이 허용되지 않았어요. 텍스트로 요청할 수 있습니다.','service-not-allowed':'이 브라우저에서 음성 서비스를 사용할 수 없어요. 텍스트로 요청해 주세요.','no-speech':'음성을 인식하지 못했어요. 다시 말하거나 텍스트로 요청해 주세요.','audio-capture':'마이크를 찾지 못했어요. 기기 설정을 확인하거나 텍스트로 요청해 주세요.',network:'음성 인식에 연결하지 못했어요. 텍스트로 요청해 주세요.','language-not-supported':'한국어 음성 인식을 사용할 수 없어요. 텍스트로 요청해 주세요.'};
    voiceMessage(errors[event.error] || '음성 입력을 마치지 못했어요. 텍스트로 요청할 수 있습니다.',true);
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
  stopCoordination();
  clearVisitRecovery();
  if(activeRecognition){recognitionCancelled=true;activeRecognition.abort();activeRecognition=undefined;resetVoiceButton();}
  stopProgress(activeRequest);conversationVersion++;failedPreviewRequest=undefined;
  requestProblem='';previewProblem=false;manualStageSelection=false;selectedStageId=undefined;unreadAnswer=false;
  caseState=createDemoCase();sessionId=undefined;history=[];latestActions=[];latestEvents=[];responseCount=0;previewMode=false;guidedDemo=null;failedRequests.clear();
  appointmentDemo=null;appointmentOpen=false;appointmentReturnFocus=undefined;appointmentReturnContext=undefined;
  appointmentDrafts={jeju:null,seoul:null};reservationEdit=null;careEntry={screen:'region',region:null,mode:null};void voiceSession?.stop();
  if(regionRenderer)renderRegionHome();
  preferencesNeedApply=true;
  document.getElementById('message-list').replaceChildren();
  document.getElementById('conversation-history').open=false;
  document.getElementById('preparation-reading').open=false;
  welcomeMessage();document.getElementById('starter-prompts').hidden=false;
  document.getElementById('request-input').value='';resizeInput();renderSnapshot();updateCapabilities();
  document.getElementById('conversation-status').textContent='새 가상 사례로 대화를 시작합니다.';
  clearInputFeedback();
  if(focus){setWorkspaceView('chat');document.getElementById('request-input').focus({preventScroll:true});}
  return true;
}

function saveReport() {
  if(!responseCount)return;
  const body=(previewMode?'# 고정 시나리오 미리보기\n\n작성된 합성 대화 예시입니다. 실제 모델 응답·발신·예약 결과가 아닙니다.\n\n':'')+buildReport(caseState)+'\n\n## API가 반환한 도구 처리 기록\n\n'+latestEvents.map(event=>`- ${event.label}: ${event.detail} (${event.isSimulation?'시연':event.status})${event.source?' · '+event.source:''}`).join('\n');
  downloadReport(body,'제주-진료-준비-보고서.md');
}

function downloadReport(body,filename) {
  const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function welcomeMessage() {
  appendMessage({role:'assistant',greeting:true,text:'요청하시면 확인한 내용과 남은 일을 이곳에 정리해 드려요.'});
}

export function mount({renderAppointment:renderer,renderRegionStart}={}) {
  appointmentRenderer=renderer;
  regionRenderer=renderRegionStart;regionHomeOpen=Boolean(regionRenderer);
  const brand=`<img src="/assets/hondi-logo-v1.png" alt="" width="480" height="168"/>`;
  const chatContent=`<div class="conversation-scroll" id="conversation-scroll" tabindex="0" aria-label="지금 준비할 일과 단계 상세"><p class="mode-notice" id="visit-recovery-notice" role="status" hidden></p>${preparationBoardMarkup()}<details class="conversation-history" id="conversation-history"><summary><span>대화·처리 기록</span><span id="conversation-history-count"></span>${icon('chevron')}</summary><div class="message-list" id="message-list" role="log" aria-label="진료 준비 대화" aria-live="polite" aria-relevant="additions"></div><section class="care-journey-summary" id="care-journey-summary" aria-label="현재 진료 연결과 다음 행동"><div class="journey-summary-state"><h3>현재</h3><strong id="care-journey-current">미확인</strong></div><button type="button" id="open-care-journey" aria-haspopup="dialog" aria-controls="care-journey-dialog">여정·할 일 보기${icon('chevron')}</button><p class="journey-summary-next"><span>이어서 할 일</span><strong id="care-journey-next"></strong></p><button type="button" class="next-request-draft" id="next-request-draft" hidden>다음 문의 초안 넣기${icon('arrow')}</button><p class="next-request-note">초안을 확인·수정한 뒤 직접 보내세요.</p></section><button type="button" class="return-to-request" id="return-to-request" hidden>요청 입력으로${icon('arrow')}</button></details></div>`;
  const menuIcon='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  document.getElementById('app').innerHTML=`
    <div class="app-shell">
      <header class="mobile-app-header" id="mobile-app-header">
        <a class="brand" href="/" aria-label="혼디 홈">${brand}</a>
        <button type="button" id="open-care-menu" class="menu-button" aria-controls="care-rail" aria-expanded="false">${menuIcon}<span>설정</span></button>
      </header>
      <button type="button" id="drawer-backdrop" class="drawer-backdrop" aria-label="설정 닫기" tabindex="-1" hidden></button>
      <aside class="care-rail" id="care-rail" aria-label="가상 가족 사례와 기본 설정" tabindex="-1">
        <div class="rail-brand-row"><a class="brand" href="/" aria-label="혼디 홈">${brand}</a><button type="button" id="close-care-menu" class="close-menu" aria-label="설정 닫기">${icon('close')}</button></div>
        <section class="rail-case" aria-labelledby="rail-patient">
          <h2 id="rail-patient"></h2>
          <p id="rail-area"></p><p id="rail-caregiver"></p>
          <span class="case-demo">가상 사례 체험 중</span>
        </section>
        <nav class="rail-nav" aria-label="준비 화면 이동">
          <a href="#main" id="nav-preparation" class="active" aria-current="location">${icon('compass')}<span>진료 준비</span></a>
          <a href="#care-journey-dialog" id="nav-care-journey" aria-haspopup="dialog" aria-controls="care-journey-dialog">${icon('file')}<span>진료 연결 여정</span></a>
          <a href="#patient-records-dialog" id="nav-patient-records" aria-haspopup="dialog" aria-controls="patient-records-dialog">${icon('folder')}<span>환자 정보·건강 기록</span></a>
          <a href="#contact-plan-dialog" id="nav-contact-plan" aria-haspopup="dialog" aria-controls="contact-plan-dialog">${icon('phone')}<span>전화·협진 준비</span></a>
          <a href="#care-preferences" id="nav-preferences">${icon('car')}<span>이동·동행 설정</span></a>
        </nav>
        <section class="preference-panel" id="care-preferences" aria-labelledby="preferences-heading" tabindex="-1">
          <h2 id="preferences-heading">이동·동행 기본 설정</h2>
          <p class="preference-intro">자주 쓰는 이동 조건을 정해 두세요.</p>
          <form id="preferences-form">
            <label class="select-label" for="pref-taxi">선호 택시 문의처</label>
            <select id="pref-taxi" name="taxiProviderId" aria-describedby="taxi-preference-note"></select>
            <p class="field-note" id="taxi-preference-note">공개 문의처 · 실제 배차·예약 미확정</p>
            <label class="preference-toggle" for="pref-wheelchair"><span>휠체어 차량 필요</span><input type="checkbox" id="pref-wheelchair" name="wheelchair"/></label>
            <label class="preference-toggle" for="pref-companion"><span>병원 동행 필요</span><input type="checkbox" id="pref-companion" name="companionNeeded"/></label>
          </form>
          <p class="preference-feedback" id="preferences-status" role="status" aria-live="polite"></p>
          <p class="field-note">선택 설정 · 요청에서 말한 조건이 우선해요.</p>
        </section>
        <p class="rail-note">${icon('lock')}기본 설정과 이 탭의 이어하기 참조만 저장해요. 대화와 의료기록은 저장하지 않습니다.</p>
      </aside>
      <div class="workspace-shell" id="workspace-shell">
        <main id="main" class="page-main" tabindex="-1">
          <header class="workspace-header"><img id="care-transition" class="care-transition" src="/assets/hondi-mark-v1.png" alt="" aria-hidden="true"/>
            <div class="case-header"><h1 id="case-heading"></h1><p id="case-caption"></p></div><button type="button" id="choose-care-region" class="text-button" hidden>병원 지역 선택</button>
            <div class="header-actions"><span class="connection-state checking" id="connection-state">연결 확인 중</span><div class="workspace-tools"><button type="button" class="expand-answer" id="expand-answer" aria-label="넓게 읽기" title="넓게 읽기" aria-haspopup="dialog" aria-controls="answer-dialog" disabled>${icon('expand')}<span>넓게 읽기</span></button><button type="button" id="preview-button" class="preview-button" aria-label="준비 결과 예시 보기" title="선택 없이 준비 결과 예시 보기">결과 예시</button></div><button type="button" class="header-button" id="new-conversation" aria-label="새 대화" title="새 대화">${icon('plus')}<span>새 대화</span></button></div>
          </header>
          <div class="mobile-case-summary" id="mobile-case-summary" aria-label="이번 방문 요약" hidden></div>
          <div class="workspace-controls">
            <div class="workspace-tabs" role="tablist" aria-label="작업 영역"><button type="button" id="workspace-tab-chat" role="tab" aria-controls="chat-workspace" aria-selected="true">할 일</button><button type="button" id="workspace-tab-preparation" role="tab" aria-controls="preparation-rail" aria-selected="false" aria-label="준비 단계" title="준비 단계" tabindex="-1">준비 단계</button></div>
          </div>
          <div class="conversation-layout" data-active-view="chat">
            <section class="chat-workspace" id="chat-workspace" role="tabpanel" aria-label="지금 준비할 일과 단계 상세">${chatContent}</section>
            <div class="preparation-rail" id="preparation-rail" role="tabpanel" aria-label="준비 길잡이와 방문 상세" tabindex="0">${preparationNavigationMarkup()}
              <details class="visit-summary" id="visit-summary"><summary><span>${icon('calendar')}이번 방문 상세</span><span>일정·준비 상태·출처</span>${icon('chevron')}</summary>
            <aside class="case-sidebar" aria-label="대화에서 준비한 내용">
              <details class="case-summary" id="case-summary" open><summary><span>${icon('calendar')}이번 방문 준비</span>${icon('chevron')}</summary><div id="case-content"></div></details>
              <button type="button" class="report-button" id="save-report" title="대화 응답 후 준비 내역을 저장할 수 있어요." disabled>${icon('download')}준비 내역 저장</button>
              <div id="visit-recovery-controls" hidden><p class="service-note" id="visit-recovery-scope"></p><button type="button" class="report-button" id="resume-visit">${icon('refresh')}저장된 준비 다시 확인</button></div>
              <details class="connection-details"><summary>지금 연결된 범위${icon('chevron')}</summary><div id="connection-details"></div></details>
              <details class="source-details"><summary>준비에 사용한 출처${icon('chevron')}</summary><div id="case-sources"></div></details>
              <span class="mode-label" id="mode-label">가상 사례 · 실제 발신 없음</span><p class="service-note">진찰과 진료 계획은 의료진이 결정합니다. 등록된 문의처와 실제 예약·배정은 다릅니다.</p>
            </aside></details>
            </div>
            <div class="chat-composer" id="chat-composer">
              <form id="conversation-form" class="conversation-form" aria-busy="false">
                <label for="request-input" class="visually-hidden">진료 준비 요청</label>
                <textarea id="request-input" name="message" rows="2" maxlength="${MAX_MESSAGE}" placeholder="예: 어머니 진료 자료와 이동·동행을 준비해줘." autocomplete="off" aria-describedby="composer-disclosure composer-boundary privacy-note voice-help" required></textarea>
                <div class="composer-actions"><button type="button" id="voice-request" class="voice-button" aria-label="음성으로 요청하기" aria-pressed="false" aria-describedby="voice-help" ${SpeechRecognition?'':'disabled'}>${micIcon}<span>말로 요청</span></button><button type="button" id="exit-guided-demo" class="text-button" hidden>자유 입력으로 전환</button><span class="keyboard-hint">Enter로 전송 · Shift+Enter 줄바꿈</span><span class="character-count" id="character-count">0/${MAX_MESSAGE}</span><div id="answer-ready-notice" class="answer-ready-notice" hidden><button type="button" aria-label="새 답변이 도착했어요. 대화에서 보기" title="새 답변이 도착했어요. 대화에서 보기">새 답변</button></div><div id="request-problem-notice" class="request-problem-notice" hidden><button type="button" aria-label="요청 결과를 확인해 주세요. 대화에서 보기" title="요청 결과를 확인해 주세요. 대화에서 보기">오류 보기</button></div><div class="pending-message" id="pending-message" hidden><button type="button" id="cancel-request" class="cancel-request" aria-label="응답 대기 중지" title="응답 대기 중지"><span class="working-mark" aria-hidden="true"></span>중지</button></div><button type="submit" class="send-button" id="send-request" aria-label="요청 보내기" title="요청 보내기" disabled>${icon('arrow')}<span>보내기</span></button></div>
              </form>
              <p class="draft-feedback" id="draft-feedback" role="status" aria-atomic="true" hidden></p>
              <div class="composer-notes"><p class="composer-disclosure" id="composer-disclosure">${icon('info')}시연 · 실행 없음</p>
                <div class="composer-extras">
                  <details class="request-examples" id="request-examples"><summary aria-label="요청 예시" title="요청 예시">요청 예시${icon('chevron')}</summary><div class="starter-prompts composer-detail-body" id="starter-prompts"><p>이렇게 요청해 보세요</p><button type="button" data-example="저는 동행이 어려워요. 자료와 이동도 준비해 주세요."><span>저는 동행이 어려워요. 자료와 이동도 준비해 주세요.</span>${icon('arrow')}</button><button type="button" class="secondary-prompt" data-example="어머니가 휠체어를 이용하세요. 무엇을 확인해야 할까요?"><span>어머니가 휠체어를 이용하세요. 무엇을 확인해야 할까요?</span>${icon('arrow')}</button></div></details>
                  <details class="composer-help" id="composer-help"><summary aria-label="개인정보 입력 금지 안내" title="개인정보 입력 금지 안내">안내${icon('chevron')}</summary><div class="composer-detail-body"><p class="voice-help" id="voice-help" role="status" hidden></p><p id="composer-boundary">가상 사례 · 실제 연락·예약 없음</p><p class="board-activity" id="board-activity" role="status" aria-live="polite" hidden></p><p>${SpeechRecognition?'음성은 인식한 내용을 확인한 뒤 보내요.':'음성 미지원 브라우저예요. 텍스트로 요청해 주세요.'}</p><p class="privacy-note" id="privacy-note">주민번호·인증정보·실제 의료기록 입력 금지 · 대화 원문은 새로고침하면 사라져요.</p><p class="pending-note">이 화면의 대기만 중지해요. 서버 처리는 계속될 수 있습니다.</p></div></details>
                </div>
              </div>
            </div>
          </div>
          <p id="conversation-status" class="visually-hidden" role="status" aria-live="polite"></p>
        </main>
      </div>
      <dialog class="patient-records-dialog answer-dialog" id="answer-dialog" aria-labelledby="answer-title" aria-describedby="answer-description"><header class="patient-records-header"><div><h2 id="answer-title" tabindex="-1">혼디의 정리 · 넓게 읽기</h2><p id="answer-description">열 때의 대화 · 읽기 전용 · 실제 연락·예약 없음</p></div><button type="button" id="close-answer" class="close-records" aria-label="넓게 읽기 닫기">${icon('close')}</button></header><div class="answer-read-view message-list" id="answer-read-view"></div></dialog>
      <dialog class="patient-records-dialog" id="patient-records-dialog" aria-labelledby="patient-records-title" aria-describedby="patient-records-description">
        <header class="patient-records-header"><div><h2 id="patient-records-title" tabindex="-1">환자 정보·건강 기록</h2><p id="patient-records-description">가상 사례 · 합성 정보 · 읽기 전용</p></div><button type="button" id="close-patient-records" class="close-records" aria-label="환자 정보·건강 기록 닫기">${icon('close')}</button></header>
        <div class="patient-records-body" id="patient-records-body">
          <section class="records-section" aria-labelledby="patient-basics-title"><h3 id="patient-basics-title">현재 준비 대상</h3><dl class="patient-basics" id="patient-basics"></dl><p class="records-note">방문일은 시연 일정이며 실제 예약이 확정된 상태가 아닙니다.</p></section>
          <section class="records-section health-highway" aria-labelledby="health-highway-title"><div class="records-section-heading"><h3 id="health-highway-title">건강정보 고속도로</h3><span class="connector-state" id="health-highway-status">미연결</span></div><dl class="connector-facts"><div><dt>최근 불러오기</dt><dd id="health-highway-last-sync">불러온 기록 없음</dd></div><div><dt>현재 표시 자료</dt><dd>가상 사례의 합성 자료</dd></div></dl><p class="records-note">현재 자료는 건강정보 고속도로·공단에서 조회한 기록이 아닙니다. 연결되지 않아 실제 건강 상태는 확인되지 않았습니다.</p><details class="highway-help" id="health-highway-help"><summary>연결 안내와 현재 범위${icon('chevron')}</summary><p>이 화면에는 건강정보 고속도로의 본인인증·동의·기록 연계 기능이 없습니다. 이 창을 여는 것만으로 인증이나 기록 조회를 요청하지 않습니다.</p><a href="https://www.myhealthway.go.kr/portal/index?page=Individual%2FPortal%2FMediMyData%2FMydataService" target="_blank" rel="noopener noreferrer">공식 서비스 소개${icon('external')}</a></details></section>
          <section class="records-section" aria-labelledby="record-documents-title"><h3 id="record-documents-title">현재 진료 자료</h3><p class="records-note">이 대화에 반영된 합성 자료의 상태·출처·내용입니다. 준비됨 표시는 실제 기관이 확인했다는 뜻이 아닙니다.</p><div class="record-documents" id="patient-record-documents">${DOCUMENT_DEFINITIONS.map(item=>`<details class="record-document" data-record-document-id="${item.id}"><summary><span data-record-label>${escape(item.label)}</span><span data-record-status></span>${icon('chevron')}</summary><dl><div><dt>출처</dt><dd data-record-source></dd></div><div><dt>내용</dt><dd data-record-content></dd></div></dl></details>`).join('')}</div></section>
          <section class="records-section" id="fhir-demo-records" aria-labelledby="fhir-demo-title"><h3 id="fhir-demo-title">건강기록 체험 자료</h3><p class="records-note" data-fhir-source-label></p><p class="records-note" data-fhir-notice></p><div class="record-documents" id="fhir-demo-entries"></div><details class="record-document" data-fhir-original><summary><span>FHIR 합성 원본 보기</span>${icon('chevron')}</summary><pre class="fhir-source" data-fhir-json></pre></details></section>
          <p class="records-memory-note">${icon('lock')}환자 정보와 진료 자료는 현재 대화에서만 표시합니다. 이 창에서는 수정하거나 기기에 저장하지 않습니다.</p>
        </div>
      </dialog>
      <dialog class="patient-records-dialog contact-plan-dialog" id="contact-plan-dialog" aria-labelledby="contact-plan-title" aria-describedby="contact-plan-description">
        <header class="patient-records-header"><div><h2 id="contact-plan-title" tabindex="-1">전화·협진 준비</h2><p id="contact-plan-description">문의 계획·합성 결과 · 실제 전화 미연결</p></div><button type="button" id="close-contact-plan" class="close-records" aria-label="전화·협진 준비 닫기">${icon('close')}</button></header>
        <div class="patient-records-body" id="contact-plan-body">
          <section class="contact-overview" aria-labelledby="contact-overview-title"><h3 id="contact-overview-title">두 병원에 문의할 준비를 이어가요</h3><p>기존 도외 병원의 협진·회송 창구와 제주 병원의 현지 진찰·자료 전달 절차를 확인합니다. 실제 진찰 소견·의뢰서 작성과 진료 수락은 의료진과 기관이 담당합니다.</p><p>아래는 현재 가상 사례의 읽기 전용 계획입니다. 실환자 본인의 위임·본인인증·동의를 확인한 상태가 아니며, 전화 서비스 계정은 연결하지 않았습니다.</p></section>
          <div class="contact-plans" id="contact-plans"></div>
          <section class="call-handoffs" id="call-handoffs" aria-label="실패한 문의와 인계"></section>
          <details class="call-recovery-examples" id="call-recovery-examples"><summary><span>연결되지 않았을 때</span>${icon('chevron')}</summary><p class="journey-note">무응답·AI 응대 거절·본인 확인·서류/예약이 막힌 네 상황의 작성된 합성 예시입니다. 선택하면 현재 대화를 바꾸며 실제 모델·전화·동의 확인은 실행하지 않습니다.</p><div class="journey-scenarios" id="call-recovery-options"></div></details>
          <p class="records-memory-note">${icon('lock')}문의 계획은 현재 대화에서만 표시해요. 실제 환자 개인정보를 자동 전달하거나 이 기기에 저장하지 않습니다.</p>
        </div>
      </dialog>
      <dialog class="patient-records-dialog care-journey-dialog" id="care-journey-dialog" aria-labelledby="care-journey-title" aria-describedby="care-journey-description">
        <header class="patient-records-header"><div><h2 id="care-journey-title" tabindex="-1">진료 연결 여정</h2><p id="care-journey-description">자료·문의·이동을 잇는 합성 준비 흐름 · 의료진 판단 전 미확인</p></div><button type="button" id="close-care-journey" class="close-records" aria-label="진료 연결 여정 닫기">${icon('close')}</button></header>
        <div class="patient-records-body" id="care-journey-content"></div>
      </dialog>
    </div>`;
  setupAppointmentWorkspace();welcomeMessage();renderSnapshot();updateCapabilities();
  careMotion?.dispose();careMotion=createCareMotion(document.getElementById('main'));
  document.getElementById('choose-care-region').addEventListener('click',showRegionHome);
  const form=document.getElementById('conversation-form'),input=document.getElementById('request-input');
  form.addEventListener('submit',event=>{event.preventDefault();if(!composing)sendRequest();});
  input.addEventListener('input',()=>{if(!activeRecognition)clearInputFeedback();resizeInput();});
  input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;resizeInput();});
  input.addEventListener('keydown',event=>{if(event.key==='Enter' && !event.shiftKey && !event.isComposing && !composing && event.keyCode!==229){event.preventDefault();if(!pending)sendRequest();}});
  document.getElementById('voice-request').addEventListener('click',startVoice);
  voiceSession=createRealtimeVoice({onState:state=>{voiceUi=state;if(regionHomeOpen&&careEntry.screen==='request'){renderRegionHome();syncAppointmentMode();}},onTranscript:text=>{if(!regionHomeOpen||careEntry.screen!=='request')return;document.getElementById('request-input').value=text;careEntry.conditionText=null;resizeInput();},onConditions:text=>{if(!regionHomeOpen||careEntry.screen!=='request')return;careEntry.conditionText=text;renderRegionHome();}});
  document.getElementById('request-input').addEventListener('input',()=>{careEntry.conditionText=null;if(regionHomeOpen&&careEntry.screen==='request')renderRegionHome();});
  window.addEventListener('pagehide',()=>{void voiceSession.stop();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&voiceSession.active)void voiceSession.stop();});
  document.getElementById('cancel-request').addEventListener('click',cancelRequest);
  document.getElementById('new-conversation').addEventListener('click',()=>resetConversation());
  document.getElementById('preview-button').addEventListener('click',()=>showPreview());
  document.getElementById('guided-demo-controls').addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button || pending || activeRecognition)return;
    if(button.hasAttribute('data-demo-start'))showPreview(GUIDED_DEMO_ID);
    else if(button.hasAttribute('data-demo-write'))focusRequest();
    else if(button.hasAttribute('data-demo-save'))saveReport();
    else if(guidedDemo?.choices.some(choice=>choice.id===button.dataset.demoChoice))showPreview(GUIDED_DEMO_ID,[...guidedDemo.answers,button.dataset.demoChoice]);
  });
  document.getElementById('exit-guided-demo').addEventListener('click',()=>appointmentOpen?closeAppointmentDemo():resetConversation());
  document.getElementById('save-report').addEventListener('click',saveReport);
  document.getElementById('resume-visit').addEventListener('click',resumeVisit);
  document.getElementById('stage-navigation').addEventListener('click',event=>{
    const button=event.target.closest('[data-open-stage]');if(button)selectPreparationStage(button.dataset.openStage);
  });
  document.getElementById('return-to-current-task').addEventListener('click',()=>showCurrentTask());
  document.getElementById('current-task-answer').addEventListener('click',showLatestAnswer);
  const fillCurrentTaskDraft=()=>{
    const task=preparationBoard?.workflow.currentTask;
    if(task?.requestDraft && fillRequestDraft(task.requestDraft,{source:'다음 준비 요청 초안',focus:false}))focusRequest();
  };
  document.getElementById('current-task-draft').addEventListener('click',fillCurrentTaskDraft);
  document.getElementById('next-request-draft').addEventListener('click',fillCurrentTaskDraft);
  document.getElementById('current-task-choices').addEventListener('click',event=>{
    const button=event.target.closest('[data-workflow-choice]'),task=preparationBoard?.workflow.currentTask;
    const choice=task?.actor==='caregiver'&&task.choices.find(item=>item.id===button?.dataset.workflowChoice);
    if(choice?.requestDraft && fillRequestDraft(choice.requestDraft,{source:'답변 초안',focus:false}))focusRequest();
  });
  document.getElementById('preparation-board').addEventListener('toggle',event=>{if(event.target.matches('[data-stage-details]') && event.target.open)manualStageSelection=true;},true);
  document.getElementById('conversation-history').addEventListener('toggle',event=>{if(event.target.open)manualStageSelection=true;});
  const preparationRail=document.getElementById('preparation-rail'),conversationScroll=document.getElementById('conversation-scroll');
  let restoreResizeReading,readingResizeFrame=0,readingWidth=innerWidth,readingHeight=innerHeight,inputEndVisible=true;
  const rememberReading=()=>{
    if(!readingResizeFrame && readingWidth===innerWidth && readingHeight===innerHeight){
      restoreResizeReading=preservePreparationReading();
      inputEndVisible=input.scrollTop+input.clientHeight>=input.scrollHeight-2;
    }
  };
  preparationRail.addEventListener('focusin',()=>{manualStageSelection=true;rememberReading();});
  preparationRail.addEventListener('scroll',rememberReading,{passive:true});
  conversationScroll.addEventListener('focusin',event=>{if(event.target.closest('.stage-pane,#conversation-history'))manualStageSelection=true;rememberReading();});
  conversationScroll.addEventListener('scroll',rememberReading,{passive:true});
  input.addEventListener('scroll',rememberReading,{passive:true});
  input.addEventListener('focus',rememberReading);
  input.addEventListener('input',rememberReading);
  window.addEventListener('resize',()=>{
    cancelAnimationFrame(readingResizeFrame);
    readingResizeFrame=requestAnimationFrame(()=>{
      restoreResizeReading?.();
      const anchor=document.activeElement;
      if(anchor===input && !composing && inputEndVisible && input.selectionStart===input.value.length && input.selectionEnd===input.value.length)input.scrollTop=input.scrollHeight;
      const scroller=[preparationRail,conversationScroll].find(node=>node.contains(anchor) && node.checkVisibility());
      if(scroller){
        const bounds=anchor.getBoundingClientRect(),frame=scroller.getBoundingClientRect();
        // 작아진 영역에서는 출처를 보이게 두고, 다시 넓어지면 원래 읽던 위치로 돌아간다.
        scroller.scrollTop+=bounds.top<frame.top+8?bounds.top-frame.top-8:Math.max(0,bounds.bottom-frame.bottom+8);
      }
      const careRail=document.getElementById('care-rail');
      if(drawerOpen && careRail.contains(anchor)){
        const bounds=anchor.getBoundingClientRect(),frame=careRail.getBoundingClientRect();
        if(bounds.top<Math.max(0,frame.top) || bounds.bottom>Math.min(innerHeight,frame.bottom))anchor.scrollIntoView({block:'nearest',inline:'nearest'});
      }
      readingResizeFrame=requestAnimationFrame(()=>{readingWidth=innerWidth;readingHeight=innerHeight;readingResizeFrame=0;});
    });
  });
  document.getElementById('return-to-request').addEventListener('click',focusRequest);
  document.getElementById('answer-ready-notice').addEventListener('click',showLatestAnswer);
  // 접힌 작업 영역을 다시 열 때 끝난 메타 피드백을 반복하지 않는다.
  for(const type of ['animationend','animationcancel'])document.getElementById('message-list').addEventListener(type,event=>{if(event.animationName==='hondi-reply-ready' && event.target.matches('.message-meta'))event.target.dataset.replyFeedback='complete';});
  document.getElementById('request-problem-notice').addEventListener('click',()=>{setWorkspaceView('chat');scrollToMessage(previewProblem?document.getElementById('mode-notice'):document.querySelector('#message-list .message.failed:last-of-type'));});
  for(const view of ['chat','preparation'])document.getElementById('workspace-tab-'+view).addEventListener('click',()=>{setWorkspaceView(view);renderBoardView();});
  document.querySelector('.workspace-tabs').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const view=event.key==='Home'?'chat':event.key==='End'?'preparation':workspaceView==='chat'?'preparation':'chat';
    setWorkspaceView(view,{focus:true});renderBoardView();
  });
  compactWorkspace.addEventListener('change',()=>{const focus=document.activeElement;const view=focus?.closest('#preparation-rail')?'preparation':focus?.closest('#chat-workspace')?'chat':workspaceView;setWorkspaceView(view);if(focus?.closest('[inert]'))document.getElementById('workspace-tab-'+workspaceView).focus({preventScroll:true});});
  for(const id of ['request-examples','composer-help'])document.getElementById(id).addEventListener('toggle',event=>{if(event.target.open)document.getElementById(id==='request-examples'?'composer-help':'request-examples').open=false;});
  document.getElementById('expand-answer').addEventListener('click',openAnswer);
  const answerDialog=document.getElementById('answer-dialog');
  document.getElementById('close-answer').addEventListener('click',()=>answerDialog.close());
  answerDialog.addEventListener('keydown',event=>trapDialogFocus(event,answerDialog));
  answerDialog.addEventListener('close',()=>{document.body.classList.remove('records-dialog-open');document.getElementById('answer-read-view').replaceChildren();if(answerReturnFocus?.isConnected)answerReturnFocus.focus({preventScroll:true});});
  document.getElementById('nav-patient-records').addEventListener('click',event=>{event.preventDefault();openPatientRecords();});
  document.getElementById('nav-contact-plan').addEventListener('click',event=>{event.preventDefault();openContactPlan();});
  document.getElementById('nav-care-journey').addEventListener('click',event=>{event.preventDefault();openCareJourney();});
  document.getElementById('open-care-journey').addEventListener('click',openCareJourney);
  const recordsDialog=document.getElementById('patient-records-dialog');
  document.getElementById('close-patient-records').addEventListener('click',()=>recordsDialog.close());
  recordsDialog.addEventListener('close',()=>{document.body.classList.remove('records-dialog-open');const target=mobileRail.matches?document.getElementById('open-care-menu'):patientRecordsReturnFocus;if(target?.isConnected)target.focus({preventScroll:true});});
  const contactDialog=document.getElementById('contact-plan-dialog');
  document.getElementById('close-contact-plan').addEventListener('click',()=>contactDialog.close());
  contactDialog.addEventListener('close',()=>{
    if(contactDialog.open)return;
    document.body.classList.remove('records-dialog-open');
    const target=contactDialog.returnValue==='draft'?input:contactDialog.returnValue==='preview' && pending?document.getElementById('cancel-request'):mobileRail.matches?document.getElementById('open-care-menu'):contactPlanReturnFocus;
    if(target?.isConnected){target.focus({preventScroll:true});}
  });
  contactDialog.addEventListener('keydown',event=>trapDialogFocus(event,contactDialog));
  document.getElementById('contact-plans').addEventListener('click',event=>{
    const button=event.target.closest('[data-contact-draft]');
    if(!button || !CALL_TARGETS.includes(button.dataset.contactDraft))return;
    const plan=buildCallPlan(caseState,button.dataset.contactDraft);
    if(fillRequestDraft(plan.requestDraft,{source:'문의 준비 문구',focus:false}))contactDialog.close('draft');
  });
  document.getElementById('contact-plan-body').addEventListener('click',event=>{
    const scenario=event.target.closest('[data-call-recovery-scenario]');
    if(scenario){showPreview(scenario.dataset.callRecoveryScenario);return;}
    const button=event.target.closest('[data-call-handoff-draft]');
    if(!button)return;
    const item=(getCareJourneySummary(caseState).handoffs || []).find(item=>item.id===button.dataset.callHandoffDraft);
    if(item && fillRequestDraft(item.requestDraft,{source:'사람 인계 초안',focus:false}))contactDialog.close('draft');
  });
  const journeyDialog=document.getElementById('care-journey-dialog');
  document.getElementById('close-care-journey').addEventListener('click',()=>journeyDialog.close());
  journeyDialog.addEventListener('close',()=>{
    if(journeyDialog.open)return;
    document.body.classList.remove('records-dialog-open');
    const target=journeyDialog.returnValue==='draft'?input:journeyDialog.returnValue==='preview' && pending?document.getElementById('cancel-request'):careJourneyReturnFocus;
    if(target?.isConnected){target.focus({preventScroll:true});}
  });
  journeyDialog.addEventListener('keydown',event=>trapDialogFocus(event,journeyDialog));
  document.getElementById('care-journey-content').addEventListener('click',event=>{
    const scenario=event.target.closest('[data-journey-scenario]');
    if(scenario){showPreview(scenario.dataset.journeyScenario);return;}
    const button=event.target.closest('[data-journey-draft]');
    if(!button)return;
    const journey=getCareJourneySummary(caseState);
    const item=[...journey.tasks,...journey.nextActions,...(journey.handoffs || [])].find(item=>item.id===button.dataset.journeyDraft);
    if(item && fillRequestDraft(item.requestDraft,{source:'다음 할 일 초안',focus:false}))journeyDialog.close('draft');
  });
  document.getElementById('preferences-form').addEventListener('submit',event=>event.preventDefault());
  document.getElementById('preferences-form').addEventListener('change',changePreferences);
  document.getElementById('open-care-menu').addEventListener('click',openCareMenu);
  document.getElementById('close-care-menu').addEventListener('click',()=>closeCareMenu());
  document.getElementById('drawer-backdrop').addEventListener('click',()=>closeCareMenu());
  document.getElementById('nav-preparation').addEventListener('click',event=>{event.preventDefault();closeCareMenu({restoreFocus:false});document.getElementById('nav-preparation').setAttribute('aria-current','location');document.getElementById('nav-preferences').removeAttribute('aria-current');if(regionHomeOpen || appointmentOpen)showRegionHome();else focusRequest();});
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
    const example=event.target.closest('[data-example]');if(example && !pending && fillRequestDraft(example.dataset.example))document.getElementById('request-examples').open=false;
    const retry=event.target.closest('[data-retry]');if(retry && failedRequests.has(retry.dataset.retry))sendRequest(failedRequests.get(retry.dataset.retry).text,retry.dataset.retry);
  });
  setWorkspaceView('chat');resizeInput();
  const capabilityController=new AbortController(),capabilityTimer=setTimeout(()=>capabilityController.abort(),8000);
  capabilitiesReady=fetch(API+'/capabilities',{cache:'no-store',signal:capabilityController.signal}).then(response=>{if(!response.ok)throw new Error('unavailable');return response.json();}).then(data=>updateCapabilities(data.capabilities || data)).catch(()=>updateCapabilities({llm:false})).finally(()=>clearTimeout(capabilityTimer));
  if(visitToken)resumeVisit();
}

if(document.querySelector('script[src="/conversation.js"]'))mount();
