import { PREPARATION_STAGES, progressActivity } from './preparation-stages.js';
import { icon } from './icons.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const signalLabel=stage=>({available:stage.id==='plan'?'답변 있음':'준비 결과 있음',attention:stage.status==='needs_recheck'?'재확인':'추가 확인',blocked:'문의 실패 · 인계',waiting:stage.id==='plan'?'답변 전':'문의 전',not_needed:'필요 없음'})[stage.signal]||'확인 전';
function signalMarkup(signal) {
  const shape=({available:'<circle cx="12" cy="12" r="7"/>',attention:'<path d="M12 4 21 20H3Z"/>',blocked:'<path d="m5 5 14 14M19 5 5 19"/>'})[signal]||'<path d="M5 12h14"/>';
  return `<svg class="signal-mark" data-signal="${escape(signal)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`;
}

export function preparationBoardMarkup() {
  const topics={records:'folder',hospitals:'hospital',support:'car',plan:'calendar'};
  const section=stage=>`<section id="stage-${stage.id}" class="stage-pane" data-stage-id="${stage.id}" data-stage-status="waiting" data-signal="waiting" tabindex="-1" aria-labelledby="stage-title-${stage.id}">
      <header class="stage-pane-header"><h2 id="stage-title-${stage.id}">${icon(topics[stage.id],'stage-topic-icon')}${stage.id==='plan'?'방문 계획':stage.title}</h2><span class="stage-status" data-stage-status="waiting" data-signal="waiting">${signalMarkup('waiting')}<span>확인 전</span></span></header>
      <p class="stage-live" data-stage-live hidden></p>
      <dl class="stage-preview" data-stage-preview></dl><details class="stage-details" data-stage-details><summary aria-label="${stage.id==='plan'?'방문 계획':stage.shortTitle} 자세히 보기"><span>자세히 보기</span><span class="stage-brief" data-stage-brief></span>${icon('chevron')}</summary><div class="stage-pane-body"><p class="stage-summary" data-stage-summary></p><dl class="stage-facts" data-stage-facts></dl><section class="stage-gaps" data-stage-gaps></section><div class="stage-sources" data-stage-sources></div><details class="stage-log" data-stage-log><summary><span data-stage-log-label>처리 기록</span>${icon('chevron')}</summary><div data-stage-events></div></details></div></details>
    </section>`;
  return `<div class="preparation-heading"><h2 id="preparation-title">준비 현황</h2><p class="preparation-note">자료·문의 준비 상태예요.<br>실제 진료·예약·배차 확정은 아닙니다.</p></div>
    <div id="preparation-board" class="preparation-board" aria-label="진료 준비 내역">${PREPARATION_STAGES.map(section).join('')}</div>`;
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

export function preservePreparationReading() {
  const anchor=document.activeElement,scroller=document.getElementById('preparation-rail');
  if(!scroller?.contains(anchor) || !scroller.checkVisibility())return;
  const bounds=anchor.getBoundingClientRect();
  const frame=scroller.getBoundingClientRect();
  if(bounds.top>=frame.bottom || bounds.bottom<=frame.top)return;
  return ()=>{
    if(anchor.isConnected && document.activeElement===anchor)scroller.scrollTop+=anchor.getBoundingClientRect().top-bounds.top;
  };
}

export function renderPreparationBoard(board,{unreadAnswer=false,progress=null}={}) {
  const realProgress=board.pending && progress?.status==='running' && board.progressAvailable && PREPARATION_STAGES.some(stage=>stage.id===progress.currentStage);
  const boardNode=document.getElementById('preparation-board');
  const restoreReading=preservePreparationReading();
  boardNode.dataset.activeStage=realProgress?board.activeStageId:'';
  boardNode.dataset.pending=String(board.pending);
  const activity=document.getElementById('board-activity');
  activity.hidden=!board.pending;activity.textContent=board.overallLabel;
  document.getElementById('answer-ready-notice').hidden=board.pending || !unreadAnswer;
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
    const preview=(stage.id==='records'?stage.facts.slice(1):stage.facts).slice(0,1);
    replaceMarkup(pane.querySelector('[data-stage-preview]'),preview.map(fact=>`<div><dt>${escape(fact.label)}</dt><dd>${escape(fact.value||'확인 전')}</dd></div>`).join(''));
    const brief=pane.querySelector('[data-stage-brief]');
    brief.hidden=!stage.gapCount;brief.textContent=stage.gapCount?`추가 확인 ${stage.gapCount}건`:'';
    replaceMarkup(pane.querySelector('[data-stage-facts]'),stage.facts.map(fact=>`<div><dt>${escape(fact.label)}</dt><dd>${escape(fact.value||'확인 전')}</dd></div>`).join(''));
    replaceMarkup(pane.querySelector('[data-stage-gaps]'),stage.gaps.length?`<h3>확인할 내용 <span>${stage.gapCount??stage.gaps.length}건</span></h3><ul>${stage.gaps.map(gap=>`<li>${escape(gap)}</li>`).join('')}</ul>`:'');
    replaceMarkup(pane.querySelector('[data-stage-sources]'),stage.sources.map(sourceMarkup).join(''));
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
  restoreReading?.();
}
