(function () {
  if (!('serviceWorker' in navigator)) return;

  let registration = null;
  let pending = false;
  let applying = false;
  let banner = null;
  const hasExistingController = Boolean(navigator.serviceWorker.controller);

  function refreshBanner() {
    if (!pending) return;
    if (!banner) {
      banner = document.createElement('div');
      banner.setAttribute('role', 'status');
      banner.style.cssText = 'position:fixed;z-index:90000;left:50%;top:calc(8px + env(safe-area-inset-top, 0px));transform:translateX(-50%);width:min(94%,420px);box-sizing:border-box;padding:10px 12px;border-radius:12px;background:#123b68;color:white;box-shadow:0 4px 18px #0004;display:flex;align-items:center;gap:10px;font:600 14px system-ui,sans-serif;';
      banner.innerHTML = '<span style="flex:1"></span><button type="button" style="border:0;border-radius:8px;padding:8px 12px;font:inherit;white-space:nowrap;">อัปเดตเลย</button>';
      banner.querySelector('button').addEventListener('click', () => {
        if (applying || !window.canApplyPwaUpdate?.()) return;
        applying = true;
        if (registration?.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
          window.location.reload();
        }
      });
      document.body.appendChild(banner);
    }
    const safe = Boolean(window.canApplyPwaUpdate?.());
    banner.querySelector('span').textContent = safe ? 'มีเวอร์ชันใหม่พร้อมใช้งาน' : 'มีเวอร์ชันใหม่ รอทำรายการให้เสร็จก่อน';
    const button = banner.querySelector('button');
    button.disabled = !safe || applying;
    button.style.opacity = button.disabled ? '.55' : '1';
  }

  function markPending() {
    pending = true;
    refreshBanner();
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hasExistingController) return;
    if (applying) window.location.reload();
    else markPending();
  });

  async function checkForUpdate() {
    if (!registration || !navigator.onLine) return;
    try { await registration.update(); } catch (error) { console.warn('ตรวจสอบเวอร์ชันใหม่ไม่สำเร็จ', error); }
    if (registration.waiting && navigator.serviceWorker.controller) markPending();
  }

  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then(reg => {
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) markPending();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) markPending();
      });
    });
    checkForUpdate();
  }).catch(error => console.error('Service Worker registration failed:', error));

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { checkForUpdate(); refreshBanner(); }
  });
  window.addEventListener('online', checkForUpdate);
  setInterval(() => { if (!document.hidden) checkForUpdate(); }, 5 * 60 * 1000);
  setInterval(refreshBanner, 1000);
})();
