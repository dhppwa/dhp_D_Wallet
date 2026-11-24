(function () {
  if (!('serviceWorker' in navigator)) return;
  const successKey = 'pwa-update-completed';
  let registration = null, pending = false, applying = false, controllerChanged = false, dialog = null, failureTimer = null, dismissedAfterFailure = false;
  const hasExistingController = Boolean(navigator.serviceWorker.controller);
  let updateCandidate = null, updateCheckSequence = 0, targetWorker = null, reloadStarted = false;

  function getWorkerVersion(worker) {
    return new Promise(resolve => {
      if (!worker || typeof MessageChannel === 'undefined') return resolve(null);
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 1500);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.version || null); };
      try { worker.postMessage({ type: 'GET_BUILD_VERSION' }, [channel.port2]); }
      catch (_) { clearTimeout(timer); channel.port1.close(); resolve(null); }
    });
  }

  function showSuccess() {
    try {
      if (sessionStorage.getItem(successKey) !== '1') return;
      sessionStorage.removeItem(successKey);
    } catch (_) { return; }
    const success = document.createElement('div');
    success.setAttribute('role', 'status');
    success.style.cssText = 'position:fixed;inset:0;z-index:100002;display:grid;place-items:center;padding:20px;background:#0007;font:600 16px system-ui,sans-serif;';
    success.innerHTML = '<div style="width:min(100%,340px);box-sizing:border-box;padding:24px;border-radius:16px;background:#fff;text-align:center;color:#166534;box-shadow:0 8px 30px #0004;">✓ อัปเดตเป็นเวอร์ชันใหม่เรียบร้อยแล้ว</div>';
    document.body.appendChild(success);
    setTimeout(() => success.remove(), 2500);
  }

  function reloadUpdatedApp() {
    if (reloadStarted) return;
    reloadStarted = true;
    try { sessionStorage.setItem(successKey, '1'); } catch (_) {}
    window.location.reload();
  }

  function refreshDialog() {
    if (!pending || applying || document.hidden || dismissedAfterFailure) return;
    if (dialog) return;
    dialog = document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = 'position:fixed;inset:0;z-index:100001;display:grid;place-items:center;padding:20px;background:#0008;font:600 16px system-ui,sans-serif;';
    dialog.innerHTML = '<div style="width:min(100%,340px);box-sizing:border-box;padding:24px;border-radius:16px;background:#fff;text-align:center;color:#172554;box-shadow:0 8px 30px #0004;"><div data-update-message>มีอัปเดตเป็นเวอร์ชันใหม่</div><div data-update-progress hidden style="height:8px;overflow:hidden;border-radius:8px;background:#dbeafe;margin-top:18px;"><div style="height:100%;width:40%;background:#2563eb;animation:pwa-update-progress 1.1s ease-in-out infinite alternate;"></div></div><button type="button" style="margin-top:18px;border:0;border-radius:9px;padding:10px 25px;background:#2563eb;color:#fff;font:inherit;">อัปเดต</button><style>@keyframes pwa-update-progress{from{transform:translateX(-100%)}to{transform:translateX(250%)}}</style></div>';
    const button = dialog.querySelector('button');
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'ยกเลิก';
    cancelButton.style.cssText = 'margin:18px 8px 0 0;border:0;border-radius:9px;padding:10px 20px;background:#e2e8f0;color:#334155;font:inherit;';
    button.before(cancelButton);
    cancelButton.addEventListener('click', () => {
      if (applying) return;
      clearTimeout(failureTimer);
      dismissedAfterFailure = true;
      dialog.remove();
      dialog = null;
    });
    button.addEventListener('click', () => {
      if (applying) return;
      const worker = registration?.waiting;
      if (!worker && !controllerChanged) {
        dialog.querySelector('[data-update-message]').textContent = 'ไม่พบเวอร์ชันที่รออัปเดต กรุณาปิดและเปิดแอปใหม่';
        return;
      }
      applying = true;
      targetWorker = worker;
      button.hidden = true;
      cancelButton.hidden = true;
      dialog.querySelector('[data-update-message]').textContent = 'กรุณารอสักครู่ กำลังอัปเดต';
      dialog.querySelector('[data-update-progress]').hidden = false;
      if (worker) {
        const finishIfControlled = () => {
          if (applying && navigator.serviceWorker.controller === worker) {
            clearTimeout(failureTimer);
            reloadUpdatedApp();
          }
        };
        worker.addEventListener('statechange', finishIfControlled);
        failureTimer = setTimeout(() => {
          if (navigator.serviceWorker.controller === worker) return reloadUpdatedApp();
          applying = false;
          if (!dialog) return;
          dialog.querySelector('[data-update-message]').textContent = 'ยังสลับเวอร์ชันไม่สำเร็จ กรุณาปิดแท็บและแอปทั้งหมด แล้วเปิดแอปใหม่';
          dialog.querySelector('[data-update-progress]').hidden = true;
          button.hidden = false;
          cancelButton.hidden = false;
        }, 45000);
        worker.postMessage({ type: 'SKIP_WAITING' });
        finishIfControlled();
      } else reloadUpdatedApp();
    });
    document.body.appendChild(dialog);
  }

  async function markPending() {
    const worker = registration?.waiting;
    if (!worker) return;
    const sequence = ++updateCheckSequence;
    const version = await getWorkerVersion(worker);
    if (sequence !== updateCheckSequence || registration?.waiting !== worker) return;
    if (version && typeof APP_BUILD_VERSION !== 'undefined' && version === APP_BUILD_VERSION) {
      pending = false;
      if (dialog && !applying) { dialog.remove(); dialog = null; }
      return;
    }
    if (updateCandidate !== worker) { updateCandidate = worker; dismissedAfterFailure = false; }
    pending = true;
    refreshDialog();
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying && (!targetWorker || navigator.serviceWorker.controller === targetWorker)) { clearTimeout(failureTimer); reloadUpdatedApp(); }
    else if (!applying && (hasExistingController || pending)) {
      controllerChanged = true;
      if (registration?.waiting) markPending();
    }
  });
  async function checkForUpdate() {
    if (!registration || !navigator.onLine) return;
    try { await registration.update(); } catch (error) { console.warn('ตรวจสอบเวอร์ชันใหม่ไม่สำเร็จ', error); }
    if (registration.waiting && navigator.serviceWorker.controller) markPending();
  }

  showSuccess();
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkForUpdate(); refreshDialog(); } });
  window.addEventListener('online', checkForUpdate);
  setInterval(() => { if (!document.hidden) checkForUpdate(); }, 5 * 60 * 1000);
  setInterval(refreshDialog, 1000);
})();
