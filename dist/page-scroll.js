// A persistent, draggable page scrollbar for browsers that hide the native thumb.
const rail = document.createElement('div');
rail.className = 'page-scroll-rail';
rail.setAttribute('role', 'scrollbar');
rail.setAttribute('aria-label', 'Scroll page');
rail.setAttribute('aria-orientation', 'vertical');
rail.setAttribute('aria-valuemin', '0');
rail.setAttribute('aria-valuemax', '100');
rail.tabIndex = 0;
rail.title = 'Scroll page';
const thumb = document.createElement('span');
thumb.className = 'page-scroll-thumb';
rail.append(thumb);
document.body.append(rail);
document.documentElement.classList.add('page-scroll-enhanced');

let maxScroll = 0;
let thumbTravel = 0;
let dragging = false;
let grabOffset = 0;
let frame = 0;

function update() {
  frame = 0;
  const pageHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  maxScroll = Math.max(0, pageHeight - window.innerHeight);
  rail.hidden = maxScroll < 2;
  if (rail.hidden) return;
  const railHeight = rail.clientHeight;
  const thumbHeight = Math.min(railHeight, Math.max(52, railHeight * window.innerHeight / pageHeight));
  thumbTravel = railHeight - thumbHeight;
  const progress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
  thumb.style.height = `${thumbHeight}px`;
  thumb.style.transform = `translateY(${progress * thumbTravel}px)`;
  rail.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  rail.setAttribute('aria-valuetext', `${Math.round(progress * 100)}% down page`);
}

function scheduleUpdate() {
  if (!frame) frame = requestAnimationFrame(update);
}

function scrollToPointer(clientY) {
  const top = rail.getBoundingClientRect().top;
  const position = Math.min(thumbTravel, Math.max(0, clientY - top - grabOffset));
  window.scrollTo(0, thumbTravel ? position / thumbTravel * maxScroll : 0);
}

rail.addEventListener('pointerdown', event => {
  if (rail.hidden || event.button !== 0) return;
  event.preventDefault();
  dragging = true;
  grabOffset = event.target === thumb ? event.clientY - thumb.getBoundingClientRect().top : thumb.clientHeight / 2;
  rail.setPointerCapture(event.pointerId);
  scrollToPointer(event.clientY);
});
rail.addEventListener('pointermove', event => {
  if (dragging) scrollToPointer(event.clientY);
});
rail.addEventListener('pointerup', () => { dragging = false; });
rail.addEventListener('pointercancel', () => { dragging = false; });
rail.addEventListener('keydown', event => {
  const step = window.innerHeight * 0.8;
  const offsets = {ArrowUp: -80, ArrowDown: 80, PageUp: -step, PageDown: step};
  if (event.key in offsets) {
    event.preventDefault();
    window.scrollBy(0, offsets[event.key]);
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    window.scrollTo(0, event.key === 'Home' ? 0 : maxScroll);
  }
});

// Route vertical wheel movement to the document even when a browser fails to
// advance its native root scroller. Keep independently scrollable panels native.
document.addEventListener('wheel', event => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  if (document.querySelector('dialog:modal')) return;
  for (let node = event.target; node instanceof Element && node !== document.body; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (/^(auto|scroll)$/.test(overflow) && node.scrollHeight > node.clientHeight + 1) return;
  }
  if (document.documentElement.scrollHeight <= window.innerHeight) return;
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
  window.scrollBy(0, event.deltaY * unit);
}, {passive: false});

window.addEventListener('scroll', scheduleUpdate, {passive: true});
window.addEventListener('resize', scheduleUpdate);
new ResizeObserver(scheduleUpdate).observe(document.body);
scheduleUpdate();
