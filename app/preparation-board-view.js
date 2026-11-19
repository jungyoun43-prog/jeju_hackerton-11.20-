import { PREPARATION_STAGES, progressActivity } from './preparation-stages.js';
import { icon } from './icons.js';
import { escapeHtml as escape } from './message-format.js';

const topics={records:'folder',hospitals:'hospital',support:'car',plan:'calendar'};
const taskStatusLabel={not_started:'준비할 일',needs_input:'보호자 확인 필요',prepared:'준비 결과 있음',waiting_external:'기관·의료진 확인 필요',handoff:'사람에게 인계',needs_recheck:'변경 조건 재확인',not_needed:'해당 없음'};
function signalMarkup(signal) {
  const shape=({available:'<circle cx="12" cy="12" r="7"/>',attention:'<path d="M12 4 21 20H3Z"/>',blocked:'<path d="m5 5 14 14M19 5 5 19"/>'})[signal]||'<path d="M5 12h14"/>';
  return `<svg class="signal-mark" data-signal="${escape(signal)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`;
}

export function preparationNavigationMarkup() {
  return `<div class="preparation-heading"><h2 id="preparation-title">준비 길잡이</h2><p class="preparation-note" id="workflow-summary">확인한 조건으로 준비를 이어가요.</p></div>
    <nav id="stage-navigation" class="stage-navigation" aria-label="진료 준비 단계">${PREPARATION_STAGES.map(stage=>`<button type="button" data-open-stage="${stage.id}" data-workflow-status="not_started" data-signal="waiting" data-current="false" data-live="false" aria-controls="stage-${stage.id}" aria-pressed="false">${icon(topics[stage.id],'stage-topic-icon')}<span class="stage-nav-copy"><strong>${escape(stage.title)}</strong><span data-nav-label>확인 전</span><span data-nav-live hidden></span></span><span data-nav-signal>${signalMarkup('waiting')}</span>${icon('chevron')}</button>`).join('')}</nav>
    <p class="preparation-boundary">초안과 문의 준비를 보여드려요.<br>실제 진료·예약·배차는 미확정입니다.</p>`;
}

export function preparationBoardMarkup() {
  const section=stage=>`<section id="stage-${stage.id}" class="stage-pane" data-stage-id="${stage.id}" data-stage-status="waiting" data-signal="waiting" tabindex="-1" aria-labelledby="stage-title-${stage.id}" hidden inert>
      <header class="stage-pane-header"><h2 id="stage-title-${stage.id}">${icon(topics[stage.id],'stage-topic-icon')}${escape(stage.title)}</h2><span class="stage-status" data-stage-status="waiting" data-signal="waiting">${signalMarkup('waiting')}<span>확인 전</span></span></header>
      <p class="stage-live" data-stage-live hidden></p>
      <dl class="stage-preview" data-stage-preview></dl><details class="stage-details" data-stage-details><summary aria-label="${escape(stage.shortTitle)} 자세히 보기"><span>확인한 내용과 근거</span><span class="stage-brief" data-stage-brief></span>${icon('chevron')}</summary><div class="stage-pane-body"><p class="stage-summary" data-stage-summary></p><dl class="stage-facts" data-stage-facts></dl><section class="stage-gaps${stage.id==='plan'?' workflow-remaining':''}" ${stage.id==='plan'?'id="workflow-remaining"':''} data-stage-gaps></section><div class="stage-sources" data-stage-sources></div><details class="stage-log" data-stage-log><summary><span data-stage-log-label>처리 기록</span>${icon('chevron')}</summary><div data-stage-events></div></details></div></details>
    </section>`;
  return `<section class="current-preparation-task" id="current-preparation-task" aria-labelledby="current-task-heading"><h2 id="current-task-heading" class="sr-only">지금 준비할 일</h2><h3 id="current-task-title" tabindex="-1"></h3><div class="current-task-heading"><div class="current-task-meta"><span id="current-task-stage"></span><p class="current-task-owner" id="current-task-owner"></p><p class="mode-notice" id="mode-notice">연결 범위를 확인하고 있어요.</p></div><button type="button" class="current-task-answer" id="current-task-answer" hidden>최근 답변 보기${icon('chevron')}</button></div><p class="current-task-detail" id="current-task-detail"></p><p class="current-task-question" id="current-task-question" hidden></p><div class="current-task-choices" id="current-task-choices" hidden></div><button type="button" class="next-request-draft" id="current-task-draft" data-workflow-draft hidden>이 내용으로 요청 초안 넣기${icon('arrow')}</button><p class="workflow-draft-note" id="workflow-draft-note" hidden>초안을 확인·수정한 뒤 아래 입력창에서 보내 주세요.</p><div id="guided-demo-controls" class="guided-demo-controls" aria-label="체험 답변 선택"></div><details class="guided-demo-result" id="guided-demo-result" hidden><summary><span>앞선 선택</span><strong id="guided-demo-selection"></strong>${icon('chevron')}</summary><p id="guided-demo-result-text"></p></details><p class="current-task-waiting" id="current-task-waiting" role="status" hidden></p></section>
    <details class="preparation-reading" id="preparation-reading" open><summary><span>준비 현황과 근거</span>${icon('chevron')}</summary><div class="stage-reading-tools"><span id="stage-reading-label">현재 단계 상세</span><button type="button" id="return-to-current-task" hidden>지금 할 일로${icon('arrow')}</button></div>
    <div id="preparation-board" class="preparation-board" aria-label="진료 준비 내역">${PREPARATION_STAGES.map(section).join('')}</div></details>`;
}

const renderedMarkup=new WeakMap();
function replaceMarkup(node,markup) {
  // SVG의 브라우저 직렬화 차이로 같은 출처 링크를 다시 만들지 않는다.
  if(node && renderedMarkup.get(node)!==markup){node.innerHTML=markup;renderedMarkup.set(node,markup);}
}

function sourceMarkup(source) {
  try {
    const url=new URL(source.url);
    if(url.protocol!=='https:' || url.username || url.password)return '';
    return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${escape(source.label||'사용한 출처')}${icon('external')}</a>`;
  } catch {return '';}
}

export function renderPreparationSources(node,sources) {
  const urls=new Set();
  for(const source of sources) {
    const markup=sourceMarkup(source);if(!markup)continue;
    const url=new URL(source.url).href;if(urls.has(url))continue;urls.add(url);
    const existing=[...node.children].find(child=>child.tagName==='A'&&child.href===url);
    if(existing)existing.firstChild.textContent=source.label||'사용한 출처';
    else node.insertAdjacentHTML('beforeend',markup);
  }
  for(const child of [...node.children])if(child.tagName!=='A'||!urls.has(child.href))child.remove();
}

export function preservePreparationReading() {
  const anchor=document.activeElement;
  const scroller=['conversation-scroll','preparation-rail'].map(id=>document.getElementById(id)).find(node=>node?.contains(anchor) && node.checkVisibility());
  if(!scroller)return;
  const bounds=anchor.getBoundingClientRect(),frame=scroller.getBoundingClientRect();
  if(bounds.top>=frame.bottom || bounds.bottom<=frame.top)return;
  return ()=>{
    if(anchor.isConnected && document.activeElement===anchor && anchor.checkVisibility())scroller.scrollTop+=anchor.getBoundingClientRect().top-bounds.top;
  };
}

export function renderPreparationView(board,{unreadAnswer=false,selectedStageId,reviewing=false,currentStageId=board.workflow.currentStageId}={}) {
  const workflow=board.workflow;
  const selected=PREPARATION_STAGES.some(stage=>stage.id===selectedStageId)?selectedStageId:workflow.currentStageId;
  document.getElementById('preparation-board').dataset.selectedStage=selected;
  document.getElementById('answer-ready-notice').hidden=board.pending || !unreadAnswer;
  document.getElementById('return-to-current-task').hidden=!reviewing&&selected===currentStageId;
  document.getElementById('stage-reading-label').textContent=selected===currentStageId?'현재 단계 상세':'선택한 단계 상세 · 읽기 전용';
  for(const stage of PREPARATION_STAGES) {
    const pane=document.querySelector(`[data-stage-id="${stage.id}"]`);
    pane.hidden=stage.id!==selected;pane.inert=pane.hidden;
    document.querySelector(`#stage-navigation [data-open-stage="${stage.id}"]`).setAttribute('aria-pressed',String(stage.id===selected && (board.hasResponse || reviewing)));
  }
}

export function renderPreparationBoard(board,{unreadAnswer=false,progress=null,selectedStageId,reviewing=false,disableDrafts=false,currentStageId=board.workflow.currentStageId}={}) {
  const workflow=board.workflow;
  const realProgress=board.pending && progress?.status==='running' && board.progressAvailable && PREPARATION_STAGES.some(stage=>stage.id===progress.currentStage);
  const boardNode=document.getElementById('preparation-board');
  const restoreReading=preservePreparationReading();
  boardNode.dataset.activeStage=realProgress?board.activeStageId:'';
  boardNode.dataset.currentStage=currentStageId;
  boardNode.dataset.pending=String(board.pending);
  const activity=document.getElementById('board-activity');
  activity.hidden=!board.pending;activity.textContent=board.overallLabel;
  document.getElementById('expand-answer').disabled=!board.hasResponse;
  document.getElementById('workflow-summary').textContent=board.hasResponse?workflow.summary.label:'자료부터 준비표까지, 네 단계로 살펴봐요.';
  const initial=!board.hasResponse;
  const task=workflow.currentTask;
  const taskNode=document.getElementById('current-preparation-task');
  taskNode.dataset.taskId=task?.id||'';taskNode.dataset.currentStage=workflow.currentStageId;
  taskNode.dataset.taskStatus=task?.status||'not_started';taskNode.dataset.taskActor=task?.actor||'agent';
  document.getElementById('current-task-stage').textContent=initial?'':workflow.stages.find(stage=>stage.id===workflow.currentStageId)?.title||'';
  document.getElementById('current-task-title').textContent=initial?'이번 방문을 준비해 볼까요?':task?.title||'현재 방문 준비와 남은 일을 확인해 주세요.';
  document.getElementById('current-task-detail').textContent=initial?'제주에 계신 어머니의 자료, 병원 문의, 이동과 동행을 함께 챙겨요. 제주 방문 준비부터 서울 대학병원의 진료 일정까지 이어서 준비할 수 있어요.':task?.detail||'방문 준비표에서 확인된 내용과 기관·의료진에게 남은 일을 함께 읽을 수 있어요.';
  const owner=document.getElementById('current-task-owner');owner.hidden=initial||!task?.owner;owner.textContent=task?.owner?`담당 · ${task.owner} · ${taskStatusLabel[task.status]}`:'';
  const question=document.getElementById('current-task-question');question.hidden=initial||task?.actor!=='caregiver'||!task?.question;question.textContent=task?.question||'';
  const choices=document.getElementById('current-task-choices');
  const taskChoices=!initial && task?.actor==='caregiver'?task.choices:[];
  choices.hidden=!taskChoices?.length;
  replaceMarkup(choices,(taskChoices||[]).map(choice=>`<button type="button" data-workflow-choice="${escape(choice.id)}">${escape(choice.label)} · 답변 초안</button>`).join(''));
  const draft=document.getElementById('current-task-draft');draft.hidden=initial||!task?.requestDraft;draft.disabled=disableDrafts;
  for(const button of choices.querySelectorAll('button'))button.disabled=disableDrafts;
  document.getElementById('workflow-draft-note').hidden=draft.hidden&&choices.hidden;
  const waiting=document.getElementById('current-task-waiting');waiting.hidden=!board.pending;
  if(waiting.textContent!==board.overallLabel)waiting.textContent=board.overallLabel;
  for(const stage of board.stages) {
    const workStage=workflow.stages.find(item=>item.id===stage.id);
    const signal=stage.signal;
    const pane=document.querySelector(`[data-stage-id="${stage.id}"]`);
    pane.dataset.stageStatus=stage.status;pane.dataset.workflowStatus=workStage.status;
    pane.dataset.signal=signal;pane.dataset.live=String(realProgress && stage.live);
    const status=pane.querySelector('.stage-status');
    status.dataset.stageStatus=stage.status;status.dataset.signal=signal;
    replaceMarkup(status,`${signalMarkup(signal)}<span>${escape(workStage.label)}</span>`);
    const nav=document.querySelector(`#stage-navigation [data-open-stage="${stage.id}"]`);
    nav.dataset.workflowStatus=workStage.status;nav.dataset.signal=signal;
    nav.dataset.current=String(!initial && stage.id===currentStageId);nav.dataset.live=String(realProgress&&stage.live);
    if(!initial && stage.id===currentStageId)nav.setAttribute('aria-current','step');else nav.removeAttribute('aria-current');
    nav.querySelector('[data-nav-label]').textContent=initial?({records:'필요한 자료와 보유 여부',hospitals:'접수·발급·제출 방법',support:'차량과 동행 지원 조건',plan:'준비 내역과 남은 일'})[stage.id]:workStage.label+(workStage.remainingCount?` · 남은 ${workStage.remainingCount}건`:'');
    replaceMarkup(nav.querySelector('[data-nav-signal]'),initial?'':signalMarkup(signal));
    const navLive=nav.querySelector('[data-nav-live]');navLive.hidden=!(realProgress&&stage.live);navLive.textContent=stage.liveActivity||'확인 중';
    pane.querySelector('[data-stage-summary]').textContent=stage.summary;
    const live=pane.querySelector('[data-stage-live]');
    const observed=progress?.currentStage===stage.id || (progress?.events??[]).some(event=>event.stage===stage.id) || progress?.stages?.some(item=>item.id===stage.id && item.lastTool);
    live.hidden=!(board.pending && progress?.status==='running' && board.progressAvailable && observed && stage.liveActivity);live.textContent=stage.liveActivity;
    const preview=(stage.id==='records'?stage.facts.slice(1):stage.facts).slice(0,1);
    replaceMarkup(pane.querySelector('[data-stage-preview]'),preview.map(fact=>`<div><dt>${escape(fact.label)}</dt><dd>${escape(fact.value||'확인 전')}</dd></div>`).join(''));
    const brief=pane.querySelector('[data-stage-brief]');
    brief.hidden=!stage.gapCount;brief.textContent=stage.gapCount?`확인할 내용 ${stage.gapCount}건`:'';
    replaceMarkup(pane.querySelector('[data-stage-facts]'),stage.facts.map(fact=>`<div><dt>${escape(fact.label)}</dt><dd>${escape(fact.value||'확인 전')}</dd></div>`).join(''));
    const gapsMarkup=stage.id==='plan'
      ? `<h3>아직 남은 일 <span>${stage.gapCount}건</span></h3><p id="workflow-remaining-note">남은 일 ${workflow.summary.remainingCount}건 · 기관·의료진 확인 ${workflow.summary.waitingCount}건. 실제 진료·예약·배차는 확정되지 않았어요.</p><ol id="workflow-remaining-list">${workflow.remainingTasks.map(item=>`<li data-workflow-task="${escape(item.id)}" data-workflow-status="${escape(item.status)}"><strong>${escape(item.title)}</strong><span>${escape(item.owner)} · ${escape(taskStatusLabel[item.status])}</span><p>${escape(item.detail)}</p></li>`).join('')}</ol>`
      : stage.gaps.length?`<h3>확인할 내용 <span>${stage.gapCount??stage.gaps.length}건</span></h3><ul>${stage.gaps.map(gap=>`<li>${escape(gap)}</li>`).join('')}</ul>`:'';
    replaceMarkup(pane.querySelector('[data-stage-gaps]'),gapsMarkup);
    renderPreparationSources(pane.querySelector('[data-stage-sources]'),stage.sources);
    const liveEvents=board.pending?(progress?.events??[]).filter(event=>event.stage===stage.id):[];
    const count=stage.events.length+liveEvents.length;
    pane.querySelector('[data-stage-log]').hidden=count===0;
    pane.querySelector('[data-stage-log-label]').textContent=`처리 기록 ${count}건`;
    const events=stage.events.map(event=>`<li data-tool-status="${escape(event.status)}"><strong>${escape(event.label)}</strong><span>${event.isSimulation?'합성 · ':''}${({completed:'결과 있음',needs_input:'확인 필요',not_connected:'미연결',error:'추가 확인 필요'})[event.status]||'상태 확인'}</span>${event.detail?`<p>${escape(event.detail)}</p>`:''}${event.source?sourceMarkup({url:event.source,label:'처리 근거'}):''}</li>`);
    const eventHost=pane.querySelector('[data-stage-events]');
    replaceMarkup(eventHost,'<ol data-stage-confirmed-events></ol><ol data-stage-live-events></ol><p class="stage-log-empty">이 요청의 도구 실행 기록이 아직 없습니다.</p>');
    replaceMarkup(eventHost.querySelector('[data-stage-confirmed-events]'),events.join(''));
    replaceMarkup(eventHost.querySelector('[data-stage-live-events]'),liveEvents.map(event=>`<li class="stage-live-event" data-progress-sequence="${event.sequence}"><p>${escape(progressActivity(event))}</p></li>`).join(''));
    eventHost.querySelector('.stage-log-empty').hidden=count>0;
  }
  renderPreparationView(board,{unreadAnswer,selectedStageId,reviewing,currentStageId});
  restoreReading?.();
}
