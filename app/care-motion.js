// Offsets are em units so the fruit and its scattering pieces scale together.
const pieces = [
  ['slice', -3.5, -1.6, -103], ['slice', -1.6, -3.6, 62],
  ['slice', 2.6, -2.9, 128], ['slice', 3.5, 1.0, -54],
  ['slice', -1.9, 2.5, 93], ['leaf', 0.6, -4.3, -41],
  ['drop', -4.2, 0.4, -80], ['drop', 1.5, 2.9, 145],
  ['drop', 3.5, -1.3, 57],
];

function decoration(className) {
  const element = document.createElement('span');
  element.className = className;
  return element;
}

function makeBurst(x, y) {
  const burst = decoration('care-citrus-burst');
  burst.style.left = x + 'px';
  burst.style.top = y + 'px';
  const fruit = document.createElement('img');
  fruit.className = 'citrus-fruit';
  fruit.src = '/assets/hondi-mark-v1.png';
  fruit.alt = '';
  fruit.draggable = false;
  burst.append(decoration('citrus-halo'), fruit);
  for (const [shape, dx, dy, spin] of pieces) {
    const piece = decoration('citrus-piece citrus-' + shape);
    piece.style.setProperty('--dx', dx + 'em');
    piece.style.setProperty('--dy', dy + 'em');
    piece.style.setProperty('--spin', spin + 'deg');
    burst.append(piece);
  }
  return burst;
}

function makeFlash({ bounds, radius, x, y }) {
  const flash = decoration('care-button-flash');
  Object.assign(flash.style, {
    left: bounds.left + 'px', top: bounds.top + 'px',
    width: bounds.width + 'px', height: bounds.height + 'px', borderRadius: radius,
  });
  flash.style.setProperty('--press-x', (x - bounds.left) + 'px');
  flash.style.setProperty('--press-y', (y - bounds.top) + 'px');
  return flash;
}

export function createCareMotion(root) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const layer = document.createElement('div');
  layer.className = 'care-motion-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  let origin = null;
  let originTimer;
  let cleanupTimer;

  function clear() {
    origin = null;
    window.clearTimeout(originTimer);
    window.clearTimeout(cleanupTimer);
    layer.replaceChildren();
  }

  function owns(element) {
    return root.contains(element) || Boolean(element.closest?.('.coordination-result-dialog'));
  }

  function rememberClick(event) {
    clear();
    const button = event.target.closest?.('button');
    if (!button || !owns(button) || button.disabled || button.getAttribute('aria-disabled') === 'true'
        || event.detail === 0 || event.button !== 0 || document.hidden) return;
    origin = { x: event.clientX, y: event.clientY, bounds: button.getBoundingClientRect(),
      radius: getComputedStyle(button).borderRadius };
    // Only a navigation performed by this activation may use the position.
    originTimer = window.setTimeout(() => { origin = null; }, 0);
  }

  function transition(update) {
    const point = origin;
    origin = null;
    update();
    if (!point || document.hidden || !layer.isConnected) return;
    layer.append(makeFlash(point));
    if (!reduced.matches) layer.append(makeBurst(point.x, point.y));
    // Also releases feedback if a browser extension turns all CSS animations off.
    cleanupTimer = window.setTimeout(clear, 800);
  }

  function pointer(event) {
    if (owns(event.target)) root.dataset.carePointer = 'true';
  }
  function keyboard() {
    root.dataset.carePointer = 'false';
    clear();
  }
  function visibility() {
    if (document.hidden) clear();
  }
  function removeFinished(event) {
    if (event.target.parentNode === layer) event.target.remove();
  }
  const controller = new AbortController();
  const capture = { capture: true, signal: controller.signal };
  document.addEventListener('click', rememberClick, capture);
  document.addEventListener('pointerdown', pointer, capture);
  document.addEventListener('keydown', keyboard, capture);
  document.addEventListener('visibilitychange', visibility, { signal: controller.signal });
  reduced.addEventListener('change', clear, { signal: controller.signal });
  window.addEventListener('resize', clear, { signal: controller.signal });
  layer.addEventListener('animationend', removeFinished, { signal: controller.signal });
  return { transition, cancel: clear, dispose() { controller.abort(); clear(); layer.remove(); } };
}
