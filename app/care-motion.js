// Presentation only: state and focus update immediately; motion can be interrupted.
export function createCareMotion(root) {
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  const layer=document.createElement('div');
  layer.className='care-motion-layer';layer.setAttribute('aria-hidden','true');
  const mark=document.getElementById('care-transition');if(mark)layer.append(mark);
  document.body.append(layer);
  const animations=new Set(),decorations=new Set();
  const ease=getComputedStyle(document.documentElement).getPropertyValue('--feedback-ease').trim()||'cubic-bezier(.23,1,.32,1)';
  const duration=900;
  let trigger=null,disposed=false;
  const surface=()=>root.querySelector('.conversation-layout')||root;
  const owns=node=>root.contains(node)||Boolean(node.closest?.('.coordination-result-dialog'));
  function animate(node,frames,options,remove=false) {
    if(!node?.animate)return;
    const animation=node.animate(frames,{easing:ease,...options});animations.add(animation);
    const done=()=>{animations.delete(animation);if(remove){decorations.delete(node);node.remove();}};
    animation.onfinish=done;animation.oncancel=done;return animation;
  }
  function clear() {
    for(const animation of [...animations])animation.cancel();
    animations.clear();for(const node of decorations)node.remove();decorations.clear();
  }
  function wave(x,y,tone) {
    const ring=document.createElement('span');ring.className='care-action-wave tone-'+tone;
    ring.style.left=x+'px';ring.style.top=y+'px';layer.append(ring);decorations.add(ring);
    animate(ring,[{transform:'translate(-50%,-50%) scale(.35)',opacity:.5},{transform:'translate(-50%,-50%) scale(1.5)',opacity:0}],{duration:240},true);
  }
  function click(event) {
    const button=event.target.closest?.('button');
    if(!button||!owns(button)||button.disabled||button.getAttribute('aria-disabled')==='true')return;
    clear();trigger={time:performance.now(),pointer:event.detail>0};
    if(trigger.pointer&&!reduce.matches&&!document.hidden)wave(event.clientX,event.clientY,button.matches('.region-seoul,[data-role="next-step"],#send-request')?'orange':'green');
  }
  function guide(back) {
    if(!mark)return;
    const rect=surface().getBoundingClientRect(),node=document.createElement('div');
    node.className='care-scene-guide';
    Object.assign(node.style,{left:(rect.x+rect.width/2-160)+'px',top:(rect.y+rect.height/2-60)+'px'});
    const ns='http://www.w3.org/2000/svg',arc=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
    arc.setAttribute('viewBox','0 0 320 120');
    path.setAttribute('d','M 20 88 Q 160 -4 300 88');arc.append(path);
    const seed=document.createElement('img');seed.src=mark.src;seed.alt='';
    node.append(arc,seed);layer.append(node);decorations.add(node);
    const direction=back?-1:1;
    animate(arc,[{opacity:0},{opacity:.5,offset:.3},{opacity:0}],{duration},false);
    animate(seed,[{transform:'translate('+(-120*direction)+'px,28px) rotate('+(-30*direction)+'deg) scale(.9)',opacity:0},{transform:'translate('+(12*direction)+'px,-22px) rotate('+(14*direction)+'deg) scale(1)',opacity:1,offset:.45},{transform:'translate('+(144*direction)+'px,28px) rotate('+(52*direction)+'deg) scale(.9)',opacity:0}],{duration});
    animate(node,[{opacity:1},{opacity:1}],{duration},true);
  }
  function transition({back=false,update=()=>{}}={}) {
    const origin=trigger&&performance.now()-trigger.time<1000?trigger:null;
    clear();if(disposed)return;
    update();
    if(!origin?.pointer||reduce.matches||document.hidden)return;
    // Animate the live full-height workspace, never an input-blocking screenshot or curtain.
    const direction=back?-1:1;
    guide(back);
    animate(surface(),[{transform:'perspective(1800px) translate3d('+(64*direction)+'px,14px,0) rotateY('+(-5*direction)+'deg) scale(.96)',opacity:.4},{transform:'perspective(1800px) translate3d(0,0,0) rotateY(0) scale(1)',opacity:1}],{duration});
  }
  function pointer(event){if(owns(event.target))root.dataset.carePointer='true';}
  function keyboard(){root.dataset.carePointer='false';trigger=null;clear();}
  function visibility(){if(document.hidden){clear();trigger=null;}}
  function preference(){clear();trigger=null;}
  document.addEventListener('click',click,true);document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',keyboard,true);
  document.addEventListener('visibilitychange',visibility);reduce.addEventListener('change',preference);window.addEventListener('resize',preference);
  return {transition,cancel:clear,dispose(){disposed=true;clear();layer.remove();document.removeEventListener('click',click,true);document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',keyboard,true);document.removeEventListener('visibilitychange',visibility);reduce.removeEventListener('change',preference);window.removeEventListener('resize',preference);}};
}
