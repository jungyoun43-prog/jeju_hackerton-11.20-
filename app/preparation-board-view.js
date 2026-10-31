import { PREPARATION_STAGES, progressActivity } from './preparation-stages.js';
import { icon } from './icons.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const expandIcon='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/></svg>';
const preparationStages=PREPARATION_STAGES.filter(stage=>stage.id!=='plan');
const signalLabel=(stage,short=false)=>({available:short?'결과 있음':'준비 결과 있음',attention:stage.status==='needs_recheck'?'재확인':short?'추가 확인':'추가 확인 필요',blocked:short?'실패·인계':'문의 실패 · 인계',waiting:'확인 전',not_needed:'필요 없음'})[stage.signal]||'확인 전';
function signalMarkup(signal) {
  const shape=({available:'<circle cx="12" cy="12" r="7"/>',attention:'<path d="M12 4 21 20H3Z"/>',blocked:'<path d="m5 5 14 14M19 5 5 19"/>'})[signal]||'<path d="M5 12h14"/>';
  return `<svg class="signal-mark" data-signal="${escape(signal)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`;
}

export function preparationBoardMarkup(planContent) {
  const section=stage=>`<section id="stage-${stage.id}" class="stage-pane${stage.id==='plan'?' answer-pane':''}" data-stage-id="${stage.id}" data-stage-status="waiting" data-signal="waiting" tabindex="-1" aria-labelledby="stage-title-${stage.id}">
      <header class="stage-pane-header"><h2 id="stage-title-${stage.id}">${stage.id==='plan'?'혼디의 정리':stage.title}</h2><span class="stage-status" data-stage-status="waiting" data-signal="waiting">${signalMarkup('waiting')}<span>확인 전</span></span>${stage.id==='plan'?`<button type="button" class="expand-answer" id="expand-answer" aria-haspopup="dialog" aria-controls="answer-dialog" disabled>${expandIcon}<span>넓게 읽기</span></button>`:''}</header>
      <p class="stage-summary" data-stage-summary></p><p class="stage-live" data-stage-live hidden></p>
      ${stage.id==='plan'?planContent:`<div class="stage-pane-body"><dl class="stage-facts" data-stage-facts></dl><section class="stage-gaps" data-stage-gaps></section><div class="stage-sources" data-stage-sources></div><details class="stage-log" data-stage-log><summary><span data-stage-log-label>처리 기록</span>${icon('chevron')}</summary><div data-stage-events></div></details></div>`}
    </section>`;
  return `<nav id="stage-navigation" class="stage-navigation" aria-label="진료 준비 상태와 내역">${preparationStages.map(stage=>`<button type="button" data-open-stage="${stage.id}" data-signal="waiting" aria-controls="stage-${stage.id}" aria-pressed="false" aria-expanded="false"><span class="stage-nav-title">${stage.shortTitle}</span><span class="stage-nav-result">${signalMarkup('waiting')}<span data-navigation-status>확인 전</span></span><span data-navigation-live hidden>확인 중</span><span class="visually-hidden" data-navigation-summary></span></button>`).join('')}</nav>
    <div id="answer-ready-notice" class="answer-ready-notice" hidden><button type="button" data-open-stage="plan">새 답변이 도착했어요. 혼디의 정리 보기${icon('arrow')}</button></div>
    <div id="preparation-board" class="preparation-board" aria-label="진료 준비 내역과 답변"><details id="preparation-details" class="preparation-details"><summary><span>준비 내역</span><span>확인한 사실·남은 일·출처</span>${icon('chevron')}</summary><p class="preparation-note">기호는 자료와 문의 준비 상태예요. 실제 진료·예약·배차 확정은 아닙니다.</p>${preparationStages.map(section).join('')}</details>${section(PREPARATION_STAGES.find(stage=>stage.id==='plan'))}</div>`;
}

function replaceMarkup(node,markup) {
  if(node && node.innerHTML!==markup)node.innerHTML=markup;
}

function sourceMarkup(source) {
  try {
    const url=new URL(source.url);
    if(url.protocol!=='https:' || url.username || url.password)return '';
    return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${escape(source.label||'사용한 출처')}${icon('external')}</a>`;
  } catch {return '';}
}

export function renderPreparationBoard(board,{selectedStageId='records',unreadAnswer=false,progress=null}={}) {
  const realProgress=board.pending && progress?.status==='running' && board.progressAvailable && PREPARATION_STAGES.some(stage=>stage.id===progress.currentStage);
  const boardNode=document.getElementById('preparation-board');
  boardNode.dataset.activeStage=realProgress?board.activeStageId:'';
  boardNode.dataset.pending=String(board.pending);
  const activity=document.getElementById('board-activity');
  activity.hidden=!board.pending;activity.textContent=board.overallLabel;
  document.getElementById('answer-ready-notice').hidden=!unreadAnswer;
  document.getElementById('expand-answer').disabled=!board.hasResponse;
  for(const stage of board.stages) {
    const pane=document.querySelector(`[data-stage-id="${stage.id}"]`);
    pane.dataset.stageStatus=stage.status;
    pane.dataset.signal=stage.signal;
    pane.dataset.live=String(realProgress && stage.live);
    const status=pane.querySelector('.stage-status');
    status.dataset.stageStatus=stage.status;status.dataset.signal=stage.signal;
    replaceMarkup(status,`${signalMarkup(stage.signal)}<span>${escape(signalLabel(stage))}</span>`);
    pane.querySelector('[data-stage-summary]').textContent=stage.summary;
    const live=pane.querySelector('[data-stage-live]');
    const observed=progress?.currentStage===stage.id || (progress?.events??[]).some(event=>event.stage===stage.id) || progress?.stages?.some(item=>item.id===stage.id && item.lastTool);
    live.hidden=!(board.pending && progress?.status==='running' && board.progressAvailable && observed && stage.liveActivity);live.textContent=stage.liveActivity;
    const navigation=document.querySelector(`#stage-navigation [data-open-stage="${stage.id}"]`);
    if(navigation){
      navigation.setAttribute('aria-pressed',String(stage.id===selectedStageId));
      navigation.setAttribute('aria-expanded',String(document.getElementById('preparation-details').open));
      navigation.dataset.live=String(realProgress && stage.live);
      navigation.dataset.stageStatus=stage.status;navigation.dataset.signal=stage.signal;
      replaceMarkup(navigation.querySelector('.stage-nav-result'),`${signalMarkup(stage.signal)}<span data-navigation-status>${escape(signalLabel(stage,true))}</span>`);
      navigation.querySelector('[data-navigation-live]').hidden=!(realProgress && stage.live);
      navigation.querySelector('[data-navigation-summary]').textContent=stage.summary;
    }
    replaceMarkup(pane.querySelector('[data-stage-facts]'),stage.facts.map(fact=>`<div><dt>${escape(fact.label)}</dt><dd>${escape(fact.value||'확인 전')}</dd></div>`).join(''));
    replaceMarkup(pane.querySelector('[data-stage-gaps]'),stage.gaps.length?`<h3>확인할 내용 <span>${stage.gapCount??stage.gaps.length}건</span></h3><ul>${stage.gaps.map(gap=>`<li>${escape(gap)}</li>`).join('')}</ul>`:'<p class="stage-no-gap">새로 확인할 내용은 현재 표시되지 않았어요. 실제 기관 확인은 별도입니다.</p>');
    replaceMarkup(pane.querySelector('[data-stage-sources]'),stage.sources.map(sourceMarkup).join(''));
    const liveEvents=board.pending?(progress?.events??[]).filter(event=>event.stage===stage.id):[];
    const count=stage.events.length+liveEvents.length;
    pane.querySelector('[data-stage-log]').hidden=stage.id==='plan' && count===0;
    pane.querySelector('[data-stage-log-label]').textContent=`처리 기록 ${count}건`;
    const events=stage.events.map(event=>`<li data-tool-status="${escape(event.status)}"><strong>${escape(event.label)}</strong><span>${event.isSimulation?'합성 · ':''}${({completed:'결과 있음',needs_input:'확인 필요',not_connected:'미연결',error:'추가 확인 필요'})[event.status]||'상태 확인'}</span>${event.detail?`<p>${escape(event.detail)}</p>`:''}${event.source?sourceMarkup({url:event.source,label:'처리 근거'}):''}</li>`);
    events.push(...liveEvents.map(event=>`<li class="stage-live-event" data-progress-sequence="${event.sequence}"><p>${escape(progressActivity(event))}</p></li>`));
    replaceMarkup(pane.querySelector('[data-stage-events]'),count?`<ol>${events.join('')}</ol>`:'<p class="stage-log-empty">이 요청의 도구 실행 기록이 아직 없습니다.</p>');
  }
}
