/**
 * A visible, animated cursor AND a subtitle bar for the demo recordings. Playwright
 * drives real mouse events but the OS cursor is not captured in videos, so we inject a
 * DOM overlay that follows the pointer and shows a click ripple. We also inject a
 * lower-third caption bar and expose `window.__demoSay(text)` so the reels narrate
 * themselves on screen (see {@link ./helpers.ts} Captioner). Combined with stepped mouse
 * moves (humanClick/humanFill) the videos read like a real person using the app.
 */

/** Init script (stringified) injected into every page + popup before load. */
export const CURSOR_INIT_SCRIPT = `
(() => {
  if (window.__demoCursorInstalled) return;
  window.__demoCursorInstalled = true;

  // Title card painted before the app renders when the page is opened with
  // ?reelIntro=1&reelTitle=..&reelSubtitle=.. — so the VERY FIRST frames of a reel are
  // the branded card, not the app's loading spinner. Runs as early as possible and again
  // on DOMContentLoaded (idempotent) because at document-start <body> / the final URL may
  // not be ready yet. __closeTitleCard fades it out to reveal the app behind it.
  const ensureTitleCard = () => {
    try {
      if (document.getElementById('__demo-titlecard')) return;
      const params = new URLSearchParams(location.search);
      if (params.get('reelIntro') !== '1') return;
      const host = document.body || document.documentElement;
      if (!host) return;
      const card = document.createElement('div');
      card.id = '__demo-titlecard';
      card.style.cssText = [
        'position:fixed','inset:0','z-index:2147483647','display:flex','flex-direction:column',
        'align-items:center','justify-content:center','text-align:center',
        'background:linear-gradient(135deg,#1a73e8,#0b3d91)','color:#fff',
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        'opacity:1','transition:opacity 0.4s ease',
      ].join(';');
      const titleEl = document.createElement('div');
      titleEl.style.cssText = 'font-size:44px;font-weight:800;letter-spacing:-0.5px;max-width:82%';
      titleEl.textContent = params.get('reelTitle') || '';
      const subEl = document.createElement('div');
      subEl.style.cssText = 'font-size:21px;margin-top:14px;opacity:0.92;max-width:72%';
      subEl.textContent = params.get('reelSubtitle') || '';
      card.appendChild(titleEl);
      card.appendChild(subEl);
      host.appendChild(card);
      window.__closeTitleCard = () =>
        new Promise((resolve) => {
          const el = document.getElementById('__demo-titlecard');
          if (!el) { resolve(); return; }
          el.style.opacity = '0';
          setTimeout(() => { el.remove(); resolve(); }, 420);
        });
    } catch (_e) { /* ignore */ }
  };
  ensureTitleCard();
  document.addEventListener('DOMContentLoaded', ensureTitleCard);
  document.addEventListener('readystatechange', ensureTitleCard);

  const ensure = () => {
    if (document.getElementById('__demo-cursor')) return;
    const dot = document.createElement('div');
    dot.id = '__demo-cursor';
    dot.style.cssText = [
      'position:fixed','top:0','left:0','width:26px','height:26px','z-index:2147483647',
      'pointer-events:none','margin:-2px 0 0 -2px','transition:transform 0.05s linear',
      'transform:translate(-100px,-100px)','filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45))'
    ].join(';');
    dot.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M3 2 L3 17 L7 13 L10 20 L13 19 L10 12 L16 12 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>' +
      '</svg>';
    document.body.appendChild(dot);
    const move = (x, y) => { dot.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
    window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY), true);
    const ripple = (x, y) => {
      const r = document.createElement('div');
      r.style.cssText = [
        'position:fixed','z-index:2147483646','pointer-events:none','border-radius:50%',
        'width:8px','height:8px','left:' + (x - 4) + 'px','top:' + (y - 4) + 'px',
        'background:rgba(26,115,232,0.45)','transition:all 0.4s ease-out'
      ].join(';');
      document.body.appendChild(r);
      requestAnimationFrame(() => {
        r.style.width = '40px'; r.style.height = '40px';
        r.style.left = (x - 20) + 'px'; r.style.top = (y - 20) + 'px'; r.style.opacity = '0';
      });
      setTimeout(() => r.remove(), 450);
    };
    window.addEventListener('mousedown', (e) => ripple(e.clientX, e.clientY), true);

    // Subtitle / caption bar (lower third).
    if (!document.getElementById('__demo-caption')) {
      const cap = document.createElement('div');
      cap.id = '__demo-caption';
      cap.style.cssText = [
        'position:fixed','left:50%','bottom:36px','transform:translateX(-50%)',
        'max-width:80%','z-index:2147483646','pointer-events:none',
        'background:rgba(17,17,17,0.82)','color:#fff','padding:10px 18px','border-radius:10px',
        "font:500 20px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        'text-align:center','box-shadow:0 4px 16px rgba(0,0,0,0.3)',
        'opacity:0','transition:opacity 0.25s ease'
      ].join(';');
      document.body.appendChild(cap);
    }
    const w = window;
    w.__demoSay = (text) => {
      const cap = document.getElementById('__demo-caption');
      if (!cap) return;
      if (text) { cap.textContent = text; cap.style.opacity = '1'; }
      else { cap.style.opacity = '0'; }
    };
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensure);
  } else {
    ensure();
  }
})();
`;
