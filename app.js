// app.js (ถอดโหมดกลางคืนออกเรียบร้อย)

// 📌 ป้องกัน Pinch-to-zoom และ Gesture Zoom บน iOS Safari / Mobile Browsers
document.addEventListener('gesturestart', function (e) {
  e.preventDefault();
});
document.addEventListener('gesturechange', function (e) {
  e.preventDefault();
});
document.addEventListener('gestureend', function (e) {
  e.preventDefault();
});
document.addEventListener('touchstart', function (e) {
  if (e.touches.length > 1) {
    e.preventDefault();
  }
}, { passive: false });

const getApi = () => window.api;
const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const SESSION_KEY = 'benefit-session';
const SAVED_LOGIN_KEY = 'benefit-saved-login';
const FIRST_LOGIN_ID_KEY = 'benefit-first-login-id';
const REMEMBER_LOGIN_ENABLED_KEY = 'benefit-remember-login-enabled';
let session = JSON.parse(localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || 'null');
let currentCoupon = null;
let couponTimer = null;
let couponChannel = null;
let currentView = 'auth'; 
let clientLockoutTimer = null;
let clientLockoutCheckInProgress = false;
let clientLockoutHandled = false;

// เมื่อคีย์บอร์ดมือถือเปิด ให้เลื่อนช่องที่กำลังกรอกขึ้นมาอยู่ในพื้นที่ที่มองเห็น
function keepFocusedFieldVisible() {
  const field = document.activeElement;
  if (!field?.matches('input, textarea, select')) return;
  // ฟอร์มล็อกอินให้เบราว์เซอร์จัดตำแหน่งตามคีย์บอร์ดเอง เพื่อไม่ให้ดันทั้งฟอร์มสูงเกินไป
  if (field.closest('#auth-form')) return;
  window.setTimeout(() => {
    // เลื่อนเท่าที่จำเป็น เพื่อให้ช่องกรอกอยู่ต่ำลงและยังไม่ถูกคีย์บอร์ดบัง
    field.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, 180);
}

document.addEventListener('focusin', keepFocusedFieldVisible);
window.visualViewport?.addEventListener('resize', keepFocusedFieldVisible);

async function clearCouponData(phone) {
  const userPhone = phone || session?.user?.phone || session?.user?.Phone_No || currentCoupon?.phone;
  if (!userPhone) return;
  try {
    if (window.api && typeof window.api.resetExpiredCoupon === 'function') {
      await window.api.resetExpiredCoupon(userPhone);
    }
  } catch (err) {
    console.error('ไม่สามารถเคลียร์ค่าคูปองได้:', err);
  }
}

// ไม่มีการออกจากระบบอัตโนมัติตามเวลา ผู้ใช้จะอยู่ในระบบจนกดออกจากระบบเอง
const resetInactivityTimer = () => {};

function cleanupSubscriptions() {
  if (couponChannel && window.supabaseClient) {
    window.supabaseClient.removeChannel(couponChannel);
    couponChannel = null;
  }
}

async function logoutUser() {
  stopClientLockoutMonitor();
  clearInterval(couponTimer);
  cleanupSubscriptions();
  if (session?.user) await clearCouponData();
  const phone = session?.user?.phone || session?.user?.Phone_No;
  if (phone && window.api?.releaseUserUsage) {
    try {
      await window.api.releaseUserUsage(phone);
    } catch (err) {
      console.error('ไม่สามารถคืนสถานะ IsUse:', err);
    }
  }
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  session = null;
  currentCoupon = null;
  renderAuth();
}

function stopClientLockoutMonitor() {
  clearInterval(clientLockoutTimer);
  clientLockoutTimer = null;
  clientLockoutCheckInProgress = false;
}

async function forceClientLockoutLogout(message = 'บัญชีนี้ถูกล๊อคเอ้าโดยผู้ดูแลระบบ กรุณาเข้าสู่ระบบใหม่') {
  if (clientLockoutHandled) return;
  clientLockoutHandled = true;
  stopClientLockoutMonitor();
  clearInterval(couponTimer);
  cleanupSubscriptions();
  const phone = session?.user?.phone || session?.user?.Phone_No;
  await clearCouponData(phone);
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  session = null;
  currentCoupon = null;
  renderAuth();
  showAppDialog(message, { title: 'ออกจากระบบ' });
}

async function checkClientLockout() {
  if (clientLockoutHandled || clientLockoutCheckInProgress || !session?.user || !window.api?.getMemberProfile) return;
  const phone = session.user.phone || session.user.Phone_No;
  if (!phone) return;
  clientLockoutCheckInProgress = true;
  try {
    const latestProfile = await window.api.getMemberProfile(phone);
    if (latestProfile?.isUse === false) {
      await forceClientLockoutLogout();
    } else if ([2, 3].includes(Number(latestProfile?.Access_Level ?? latestProfile?.accessLevel ?? 0))) {
      await forceClientLockoutLogout('สถานะผู้ใช้งานถูกเปลี่ยนเป็นแอดมินหรือทดสอบระบบ จึงไม่สามารถใช้ PWA Amazon Client ได้');
    }
  } catch (error) {
    // ความขัดข้องของเครือข่ายไม่ควรออกจากระบบเอง
    console.warn('ตรวจสอบสถานะเข้าใช้งานไม่สำเร็จ:', error);
  } finally {
    clientLockoutCheckInProgress = false;
  }
}

function startClientLockoutMonitor() {
  stopClientLockoutMonitor();
  clientLockoutHandled = false;
  checkClientLockout();
  clientLockoutTimer = setInterval(checkClientLockout, 2000);
}

// การสลับแท็บหรือพักแอปชั่วคราวต้องยังถือว่า Login อยู่
// คืน IsUse เฉพาะ logout, offline, pagehide หรือ beforeunload เท่านั้น
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    return;
  }

  const phone = session?.user?.phone || session?.user?.Phone_No;
  if (!phone || !window.api?.restoreUserUsage) return;
  try {
    await checkClientLockout();
    if (!session?.user) return;
    await window.api.restoreUserUsage(phone);
  } catch (error) {
    console.warn('ไม่สามารถคืนสถานะ IsUse เมื่อกลับเข้าแอป:', error);
  }
});

const removeVisibleProductCode = value => String(value ?? '')
  .replace(/สินค้า\s*รหัส\s*[-\w.]+/gi, '')
  .replace(/รหัสสินค้า\s*[:：]?\s*[-\w.]+/gi, '')
  .trim();
const esc = value => removeVisibleProductCode(value).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));

function getMemberLoginDisplay(member = {}) {
  const loginType = Number(member.LoginType ?? member.loginType ?? 0);
  if (loginType === 1) return { label: 'Username', value: member.Username || member.username || '-' };
  if (loginType === 2) return { label: 'Email', value: member.Email || member.email || '-' };
  return { label: 'โทร', value: member.Phone_No || member.phone || '-' };
}
let appDialogTimer = null;
function showAppDialog(message, {
  title = 'แจ้งเตือน',
  autoCloseMs = 0,
  actionLabel = 'ปิด',
  cancelLabel = '',
  onAction = null,
  onCancel = null
} = {}) {
  clearTimeout(appDialogTimer);
  document.querySelector('#app-message-dialog')?.remove();
  const isInternetError = String(message).includes('เชื่อมต่อ Internet ไม่ได้');
  const messageStyle = isInternetError
    ? 'margin:0 0 16px; white-space:pre-line; line-height:1.55; color:#dc2626; font-weight:700; animation:internet-blink .85s step-end infinite;'
    : 'margin:0 0 16px; white-space:pre-line; line-height:1.55; color:#766b5e;';
  document.body.insertAdjacentHTML('beforeend', `
    <div id="app-message-dialog" style="position:fixed; inset:0; z-index:50000; display:grid; place-items:center; padding:20px; background:rgba(20,40,29,.62);">
      <section role="dialog" aria-modal="true" aria-labelledby="app-message-title" style="width:min(100%,360px); padding:22px; border-radius:18px; background:#fffaf4; color:#2c241d; box-shadow:0 20px 45px rgba(0,0,0,.28); text-align:center;">
        <h2 id="app-message-title" style="margin:0 0 10px; font-size:1.2rem; color:#194832;">${esc(title)}</h2>
        <p style="${messageStyle}">${esc(message)}</p>
        <div style="display:flex; justify-content:center; gap:10px;">
          ${cancelLabel ? `<button id="btn-cancel-app-message" type="button" style="padding:10px 14px; border:0; border-radius:10px; background:#e8efe4; color:#194832; font-weight:700;">${esc(cancelLabel)}</button>` : ''}
          <button id="btn-close-app-message" type="button" style="padding:10px 14px; border:0; border-radius:10px; background:#256b45; color:#fff; font-weight:700;">${esc(actionLabel)}</button>
        </div>
      </section><style>@keyframes internet-blink { 50% { opacity:.18; } }</style>
    </div>`);
  const dialog = document.querySelector('#app-message-dialog');
  const close = () => {
    clearTimeout(appDialogTimer);
    dialog?.remove();
  };
  document.querySelector('#btn-close-app-message').onclick = () => {
    close();
    onAction?.();
  };
  document.querySelector('#btn-cancel-app-message')?.addEventListener('click', () => {
    close();
    onCancel?.();
  });
  if (autoCloseMs > 0) appDialogTimer = setTimeout(close, autoCloseMs);
}
function showConfirmDialog(message, {
  title = 'ยืนยันรายการ',
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก'
} = {}) {
  return new Promise(resolve => showAppDialog(message, {
    title,
    actionLabel: confirmLabel,
    cancelLabel,
    onAction: () => resolve(true),
    onCancel: () => resolve(false)
  }));
}
const showToast = (text, title = 'แจ้งเตือน') => showAppDialog(text, { title, autoCloseMs: 3000 });
window.alert = message => showAppDialog(message, { title: 'แจ้งเตือน' });
window.addEventListener('offline', () => showAppDialog('เชื่อมต่อ Internet ไม่ได้ กรุณาตรวจสอบหรือเชื่อมต่อ Internet แล้วลองอีกครั้ง', { title: 'Internet' }));
window.addEventListener('online', async () => {
  showToast('เชื่อมต่อ Internet แล้ว');
  const phone = session?.user?.phone || session?.user?.Phone_No;
  if (!phone || !window.api) return;
  try {
    // คืน false ก่อน แล้วตั้ง true เมื่อยืนยันว่าเชื่อมต่อกลับสำเร็จ
    await window.api.releaseUserUsage(phone);
    await window.api.restoreUserUsage(phone);
  } catch (error) {
    console.warn('ไม่สามารถคืนสถานะ IsUse หลังเชื่อมต่อ Internet:', error);
  }
});
const saveSession = (value, remember = localStorage.getItem(SESSION_KEY) !== null) => {
  session = value;
  if (remember) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    sessionStorage.removeItem(SESSION_KEY);
  } else {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    localStorage.removeItem(SESSION_KEY);
  }
};
const getSavedLogin = () => {
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_LOGIN_KEY) || 'null');
    return value?.loginId && value?.password ? value : null;
  } catch (error) {
    return null;
  }
};
const saveLoginCredentials = (loginId, password) => {
  localStorage.setItem(SAVED_LOGIN_KEY, JSON.stringify({ loginId: String(loginId || ''), password: String(password || '') }));
};
const buttonLoading = (button, on) => { button.disabled = on; button.dataset.label ||= button.innerHTML; button.innerHTML = on ? '<span class="spinner"></span> กรุณารอสักครู่' : button.dataset.label; };

let installGuideShown = false;
const INSTALL_GUIDE_DISMISSED_KEY = 'client-pwa-install-guide-dismissed';
function isInstalledPwa() {
  return Boolean(
    window.navigator.standalone ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    document.referrer.startsWith('android-app://')
  );
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function showInstallGuide() {
  if (installGuideShown || isInstalledPwa() || localStorage.getItem(INSTALL_GUIDE_DISMISSED_KEY) === '1') return;
  const ios = isIosDevice();
  installGuideShown = true;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="pwa-install-guide" style="position:fixed; inset:0; z-index:30000; display:grid; place-items:center; padding:20px; background:rgba(20,40,29,.62);">
      <div style="width:min(100%,360px); padding:22px; border-radius:18px; background:#fffaf4; color:#2c241d; box-shadow:0 20px 45px rgba(0,0,0,.28); text-align:center;">
        <div style="font-size:36px;">📲</div>
        <h2 style="margin:6px 0; font-size:1.3rem; color:#194832;">ติดตั้งแอป</h2>
        <p style="margin:0 0 16px; color:#766b5e; line-height:1.55;">${ios ? 'แตะปุ่ม Share (□↑) ใน Safari แล้วเลือก “Add to Home Screen” เพื่อเพิ่มแอปลงหน้าจอหลัก' : 'ติดตั้ง D Coupon เพื่อเปิดใช้งานได้สะดวกยิ่งขึ้น'}</p>
        <div style="display:flex; justify-content:center; gap:10px;">
          <button id="btn-dismiss-install-guide" type="button" style="padding:10px 14px; border-radius:10px; background:#e8efe4; color:#194832; font-weight:700;">ภายหลัง</button>
          ${ios ? '' : '<button id="btn-install-pwa" type="button" style="padding:10px 14px; border-radius:10px; background:#256b45; color:#fff; font-weight:700;">ติดตั้งแอป</button>'}
        </div>
      </div>
    </div>`);
  const guide = document.querySelector('#pwa-install-guide');
  document.querySelector('#btn-dismiss-install-guide').onclick = () => {
    localStorage.setItem(INSTALL_GUIDE_DISMISSED_KEY, '1');
    guide.remove();
  };
  document.querySelector('#btn-install-pwa')?.addEventListener('click', async () => {
    const opened = await window.requestPwaInstall?.();
    if (!opened) showToast('โปรดติดตั้งจากเมนูเบราว์เซอร์');
    localStorage.setItem(INSTALL_GUIDE_DISMISSED_KEY, '1');
    guide.remove();
  });
}

window.addEventListener('pwa-install-available', showInstallGuide);

function showInstalledPwaNotice() {
  document.querySelector('#pwa-install-guide')?.remove();
  localStorage.setItem(INSTALL_GUIDE_DISMISSED_KEY, '1');
  document.querySelector('#pwa-installed-notice')?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div id="pwa-installed-notice" style="position:fixed; inset:0; z-index:30001; display:grid; place-items:center; padding:20px; background:rgba(20,40,29,.62);">
      <section role="dialog" aria-modal="true" style="width:min(100%,360px); padding:22px; border-radius:18px; background:#fffaf4; color:#2c241d; box-shadow:0 20px 45px rgba(0,0,0,.28); text-align:center;">
        <div style="font-size:36px;">✅</div>
        <h2 style="margin:6px 0; font-size:1.3rem; color:#194832;">ติดตั้งแอปแล้ว</h2>
        <p style="margin:0 0 16px; color:#766b5e; line-height:1.55;">กรุณาปิดหน้าเว็บนี้ แล้วเปิดแอปจากไอคอนที่เพิ่งติดตั้งบนหน้าจอหลัก</p>
        <button id="btn-close-installed-notice" type="button" style="padding:10px 14px; border:0; border-radius:10px; background:#256b45; color:#fff; font-weight:700;">รับทราบ</button>
      </section>
    </div>`);
  document.querySelector('#btn-close-installed-notice').onclick = () => document.querySelector('#pwa-installed-notice')?.remove();
}

window.addEventListener('pwa-installed', showInstalledPwaNotice);

// เมื่อปิดหน้าเว็บ/แอป ให้คืนสถานะ IsUse โดยไม่รอให้หน้าเว็บทำงานต่อ
function releaseUsageOnDisconnect() {
  const phone = session?.user?.phone || session?.user?.Phone_No;
  if (phone && window.api?.releaseUserUsage) {
    window.api.releaseUserUsage(phone, { keepalive: true });
  }
}

window.addEventListener('pagehide', releaseUsageOnDisconnect);
window.addEventListener('beforeunload', releaseUsageOnDisconnect);
window.addEventListener('offline', releaseUsageOnDisconnect);

function layout(content, back = false) {
  const isAuthPage = currentView === 'auth';
  document.body.classList.toggle('auth-login-page', isAuthPage);
  document.documentElement.classList.toggle('auth-login-page', isAuthPage);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = isAuthPage ? '#0b376d' : '#435f52';
  app.innerHTML = `<section class="shell ${currentView === 'auth' ? 'auth-shell' : ''} ${currentView === 'change-password' ? 'first-password-shell' : ''} ${currentView === 'history' ? 'history-shell' : ''}">
    <header class="topbar ${currentView === 'auth' ? 'topbar-login' : ''}" style="display: flex; justify-content: space-between; align-items: center;">
  <!-- ฝั่งซ้าย: ปุ่มย้อนกลับ (ถ้ามี) -->
  <div style="display: flex; align-items: center; gap: 0.75rem;">
    ${back ? '<button class="back" id="back" type="button" aria-label="ย้อนกลับ"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>' : ''}
  </div>

  <!-- ฝั่งขวา: ปุ่มออกจากระบบ -->
  <div class="topbar-actions" style="display: flex; align-items: center; gap: 0.5rem;">
    ${session && !['confirm', 'coupon', 'history'].includes(currentView) ? '<button class="logout" id="logout" type="button" aria-label="ออกจากระบบ" title="ออกจากระบบ"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 3v18"/></svg></button>' : ''}
  </div>
</header>
    ${content}
  </section>`;
  
  document.querySelector('#back')?.addEventListener('click', async () => {
    // หน้า QR: ปุ่มกลับมีความหมายเท่ากับยกเลิกคูปอง จึงดำเนินการทันที
    // เพื่อให้กลับไปเลือกสินค้าได้โดยไม่ต้องยืนยันซ้ำ
    if (['confirm', 'coupon', 'history'].includes(currentView)) {
      clearInterval(couponTimer);
      cleanupSubscriptions();
      if (currentView === 'coupon') await clearCouponData();
      currentCoupon = null;
      renderProducts();
    }
  });

  document.querySelector('#logout')?.addEventListener('click', async () => {
    if (await showConfirmDialog('คุณต้องการออกจากระบบใช่หรือไม่?', {
      title: 'ออกจากระบบ',
      confirmLabel: 'ออกจากระบบ',
      cancelLabel: 'ยกเลิก'
    })) await logoutUser();
  });
}

function setupPasswordVisibility(root = document) {
  root.querySelectorAll('[data-password-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const input = button.closest('.password-input-wrap')?.querySelector('input');
      if (!input) return;
      const willShow = input.type === 'password';
      input.type = willShow ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(willShow));
      button.setAttribute('aria-label', willShow ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
      button.title = willShow ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน';
      button.innerHTML = willShow ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 5 9 8a9.7 9.7 0 0 1-2 3.6"/><path d="M6.6 6.6C4.4 8 3 10.2 3 12c0 3 3.5 8 9 8a10.5 10.5 0 0 0 3.4-.6"/></svg>' : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    });
  });
}

// --- หน้าเข้าสู่ระบบ ---
function renderAuth() {
  currentView = 'auth';
  clearInterval(couponTimer);
  cleanupSubscriptions();

  const savedLogin = getSavedLogin();
  // ค่าเริ่มต้นสำหรับการเข้าใช้งานครั้งแรก: ติ๊กจำรหัส/เข้าใช้งานอัตโนมัติไว้ก่อน
  // หากผู้ใช้เอาติ๊กออก ระบบจะบันทึกเป็น '0' เพื่อเคารพการเลือกครั้งถัดไป
  const rememberLoginEnabled = localStorage.getItem(REMEMBER_LOGIN_ENABLED_KEY) !== '0';
  layout(`<div class="auth-wrap"><div class="hero"><img src="public/assets/image/icon-512.png?v=18" alt="D Coupon" class="hero-logo" style="width: 100px; height: 100px; object-fit: contain; margin-bottom: 0.5rem; border-radius: 8px;"><img src="public/assets/image/d-coupon-wordmark.png?v=1" alt="D Coupon" class="coupon-wordmark"><h2>เข้าสู่ระบบเพื่อรับสิทธิ์</h2></div>
  <form class="card auth-card" id="auth-form">
    <label>User (Username / โทรศัพท์ / Email)<input required name="loginId" type="text" autocomplete="username" value="${esc(savedLogin?.loginId || '')}"></label>
    <label>รหัสผ่าน<div class="password-input-wrap"><input required name="password" type="password" minlength="4" autocomplete="current-password" value="${esc(savedLogin?.password || '')}"><button class="password-toggle" data-password-toggle type="button" aria-label="แสดงรหัสผ่าน" title="แสดงรหัสผ่าน"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></div></label>
    <label style="display:flex; flex-direction:row; align-items:center; gap:9px; cursor:pointer; font-weight:600;"><input name="rememberLogin" type="checkbox" value="1" ${rememberLoginEnabled ? 'checked' : ''} style="width:18px; height:18px; margin:0;"> จำรหัส / เข้าใช้งานอัตโนมัติ</label>
    <button class="primary" type="submit">เข้าสู่ระบบ <span>→</span></button>
  </form></div>`);

  setupPasswordVisibility(document.querySelector('#auth-form'));
  setTimeout(showInstallGuide, 400);

  document.querySelector('#auth-form').onsubmit = async e => {
    e.preventDefault(); 
    const btn = e.submitter; 
    const values = Object.fromEntries(new FormData(e.currentTarget));

    buttonLoading(btn, true);
    try { 
      const loginRes = await api.login(values);
      const rememberLogin = values.rememberLogin === '1';
      if (rememberLogin) {
        saveLoginCredentials(values.loginId, values.password);
        localStorage.setItem(REMEMBER_LOGIN_ENABLED_KEY, '1');
      } else {
        localStorage.removeItem(SAVED_LOGIN_KEY);
        localStorage.setItem(REMEMBER_LOGIN_ENABLED_KEY, '0');
      }
      saveSession(loginRes, rememberLogin);

      if (loginRes.user?.isDefaultPassword) {
        // เก็บ User ชั่วคราวไว้จนเปลี่ยนรหัสครั้งแรกสำเร็จ แม้ผู้ใช้ยังไม่ได้ติ๊กจำรหัส
        sessionStorage.setItem(FIRST_LOGIN_ID_KEY, String(values.loginId || ''));
        renderForceChangePassword();
      } else {
        sessionStorage.removeItem(FIRST_LOGIN_ID_KEY);
        renderProducts();
      }
    }
    catch (err) { 
      showToast(err.message); 
      buttonLoading(btn, false); 
    }
  };
}

// --- หน้าบังคับเปลี่ยนรหัสผ่านครั้งแรก ---
function renderForceChangePassword() {
  currentView = 'change-password';
  cleanupSubscriptions();

  layout(`
    <div class="auth-wrap">
      <div class="hero">
        <span class="hero-icon">🔒</span>
        <h2>เปลี่ยนรหัสผ่านเข้าใช้งานครั้งแรก</h2>
        <p>เนื่องจากนี่เป็นการเข้าใช้งานครั้งแรก กรุณาตั้งรหัสผ่านใหม่เพื่อความปลอดภัย</p>
      </div>
      <form class="card auth-card" id="change-pwd-form">
        <label>รหัสผ่านใหม่<div class="password-input-wrap"><input required name="newPassword" type="password" minlength="4" autocomplete="new-password"><button class="password-toggle" data-password-toggle type="button" aria-label="แสดงรหัสผ่าน" title="แสดงรหัสผ่าน"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></div></label>
        <label>ยืนยันรหัสผ่านใหม่<div class="password-input-wrap"><input required name="confirmPassword" type="password" minlength="4" autocomplete="new-password"><button class="password-toggle" data-password-toggle type="button" aria-label="แสดงรหัสผ่าน" title="แสดงรหัสผ่าน"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></div></label>
        <button class="primary" type="submit">ยืนยันเปลี่ยนรหัสผ่าน <span>→</span></button>
      </form>
    </div>
  `, false);

  setupPasswordVisibility(document.querySelector('#change-pwd-form'));
  document.querySelector('#change-pwd-form').onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter;
    const { newPassword, confirmPassword } = Object.fromEntries(new FormData(e.currentTarget));

    if (newPassword === '1234') {
      showToast('รหัสผ่านต้องไม่เป็น 1234 กรุณาตั้งรหัสผ่านอื่น');
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }

    buttonLoading(btn, true);
    try {
      await api.changePassword({ phone: session.user.phone, newPassword });
      const savedLogin = getSavedLogin();
      const firstLoginId = sessionStorage.getItem(FIRST_LOGIN_ID_KEY);
      const loginType = Number(session.user?.LoginType ?? 0);
      const fallbackLoginId = loginType === 1
        ? session.user?.Username
        : loginType === 2
          ? session.user?.Email
          : session.user?.phone || session.user?.Phone_No;
      const loginId = savedLogin?.loginId || firstLoginId || fallbackLoginId;
      if (loginId) saveLoginCredentials(loginId, newPassword);
      // หลังเปลี่ยนรหัสครั้งแรก ให้หน้า Login เปิดจำรหัสและติ๊กช่องนี้เสมอ
      localStorage.setItem(REMEMBER_LOGIN_ENABLED_KEY, '1');
      sessionStorage.removeItem(FIRST_LOGIN_ID_KEY);
      await logoutUser();
      showToast('เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่');
    } catch (err) {
      showToast(err.message);
      buttonLoading(btn, false);
    }
  };
}

// --- หน้าเลือกสินค้า ---
async function renderProducts() {
  currentView = 'products';
  cleanupSubscriptions();
  resetInactivityTimer();
  layout('<div class="page-title"><h2>เลือกรายการสินค้า</h2></div><div class="loading"><span class="spinner dark"></span> กำลังโหลดรายการ</div>', false);
  
  try {
    let user = session?.user || {};
    const userPhone = user.phone || user.Phone_No;

    // เมื่อเปิดแอปใหม่จาก Session ที่จำไว้ ให้คืนสถานะออนไลน์ก่อนใช้งาน
    if (api && typeof api.restoreUserUsage === 'function' && userPhone) {
      await api.restoreUserUsage(userPhone);
    }

    // รีเฟรชจำนวนสิทธิ์จากฐานข้อมูลก่อนวาดหน้า เพื่อให้ค่าหลังใช้คูปองแสดงทันที
    if (api && typeof api.getMemberProfile === 'function' && userPhone) {
      const latestUser = await api.getMemberProfile(userPhone);
      session.user = { ...user, ...latestUser };
      saveSession(session);
      user = session.user;
    }
    startClientLockoutMonitor();

    const products = await api.products(session.token);

    const usageStatus = (api && typeof api.getUsageLimitStatus === 'function')
      ? await api.getUsageLimitStatus(userPhone)
      : { blocked: false, usedCount: Number(user.All_Use ?? 0), allLimit: Number(user.All_Limit ?? 0), unlimitedAll: Boolean(user.LimitAll), periodUsed: 0, periodLimit: Number(user.Day_Limit ?? 0), periodLabel: ['วัน', 'เดือน', 'ปี'][Number(user.LimitType ?? 0)] || 'วัน', reason: '' };

    const usedCount = usageStatus.usedCount;
    const allLimitDisplay = usageStatus.allLimit;
    const customerDetail = String(user.address || user.Detail || '').trim();
    const customerRemark = String(user.project || user.Remark || '').trim();
    const customerDetailLine = [customerDetail, customerRemark].filter(value => value && value !== '-').join('  ') || '-';

    const userInfoHtml = `
      <div class="card user-info-card product-user-info">
        <div class="product-user-info-main">
          <div>
            <p><strong>ยินดีต้อนรับ</strong> ${esc(user.name || user.Name || '-')}</p>
            <p><strong>โทร : </strong> ${esc(userPhone || '-')}</p>
            <p style="white-space:pre-wrap;">${esc(customerDetailLine)}</p>
          </div>
        </div>
        <p class="product-user-info-usage" style="color: #059669; font-weight: bold;">
          ${usageStatus.unlimitedAll ? 'สิทธิ์ทั้งหมด : ไม่จำกัด' : `สิทธิ์ทั้งหมด : ${usedCount}/${allLimitDisplay} สิทธิ์`}
        </p>
        ${usageStatus.unlimitedAll ? '' : `<p class="product-user-info-period" style="color:#475569; font-weight:600;">ใช้ได้ ${usageStatus.periodLimit} สิทธิ์ / ${usageStatus.periodLabel} (ใช้แล้ว ${usageStatus.periodUsed})</p>`}
        ${usageStatus.blocked ? `<p class="product-user-info-warning" style="color:#ef4444; font-size:0.82rem; font-weight:bold;">⚠️ ${esc(usageStatus.reason)}</p>` : ''}
      </div>
    `;

    const isVipUser = Number(user.Access_Level ?? user.accessLevel ?? 0) === 1;
    const historyActionHtml = `<div class="history-action">${isVipUser ? '<button id="btn-custom-amount" type="button" class="secondary"><span class="amount-button-icon" aria-hidden="true">$</span>ใส่จำนวนเงิน</button>' : ''}<button id="btn-history" type="button" class="secondary">📜 ประวัติการใช้สิทธิ์</button></div>`;

    const productListHtml = `
      <div class="product-list">
        ${products.map(p => `
          <button class="product" data-id="${esc(p.id)}" ${usageStatus.blocked ? 'style="opacity: 0.6; cursor: not-allowed;"' : ''}>
            <span class="product-icon ${esc(p.color)}">
              ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" />` : esc(p.icon || '☕')}
            </span>
            <span>
              <strong>${esc(p.name)}</strong>
              <small>${esc(p.detail)}</small>
            </span>
            ${usageStatus.blocked ? '<i>ใช้สิทธิ์ครบแล้ว</i>' : ''}
          </button>
        `).join('')}
      </div>
    `;

    layout(`<div class="product-selection-screen">${userInfoHtml}<div class="page-title product-page-title"><h2>เลือกรายการสินค้า</h2></div>${productListHtml}${historyActionHtml}</div>`, false);
    
    document.querySelector('#btn-history')?.addEventListener('click', () => renderHistory());
    document.querySelector('#btn-custom-amount')?.addEventListener('click', () => {
      if (usageStatus.blocked) {
        showAppDialog(usageStatus.reason, { title: 'ไม่สามารถใช้สิทธิ์ได้' });
        return;
      }
      openCustomAmountDialog();
    });

    document.querySelectorAll('.product').forEach(el => el.onclick = () => {
      if (usageStatus.blocked) {
        showAppDialog(usageStatus.reason, { title: 'ไม่สามารถใช้สิทธิ์ได้' });
        return;
      }
      renderConfirm(products.find(p => p.id === el.dataset.id));
    });

  } catch (err) { 
    showToast(err.message); 
    app.innerHTML = `<div class="card" style="text-align:center; padding: 2rem;">
      <p style="color:red; margin-bottom:1rem;">${esc(err.message)}</p>
      <button class="primary" onclick="renderProducts()">ลองใหม่อีกครั้ง</button>
    </div>`;
  }
}

function openCustomAmountDialog() {
  document.querySelector('#custom-amount-dialog')?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div id="custom-amount-dialog" style="position:fixed; inset:0; z-index:50000; display:grid; place-items:center; padding:20px; background:rgba(20,40,29,.62);">
      <form id="custom-amount-form" role="dialog" aria-modal="true" style="width:min(100%,360px); padding:22px; border-radius:18px; background:#fffaf4; color:#2c241d; box-shadow:0 20px 45px rgba(0,0,0,.28);">
        <h3 style="margin:0 0 8px; color:#14532d;">อาหาร / เครื่องดื่ม</h3>
        <label for="custom-amount-input" style="display:block; margin:14px 0 7px; font-weight:700;">จำนวนเงิน (บาท)</label>
        <input id="custom-amount-input" type="number" inputmode="decimal" min="0.01" max="999999.99" step="0.01" required autofocus style="width:100%; box-sizing:border-box; padding:12px; border:1px solid #cbd5e1; border-radius:10px; font-size:1rem;">
        <div style="display:flex; gap:10px; margin-top:20px;">
          <button id="btn-cancel-custom-amount" type="button" style="flex:1; width:0; min-height:46px; margin:0; border:1px solid var(--green); border-radius:13px; background:#fff; color:var(--green); font-weight:700;">ยกเลิก</button>
          <button type="submit" style="flex:1; width:0; min-height:46px; margin:0; border:0; border-radius:13px; background:var(--green); color:#fff; font-weight:700;">ตกลง</button>
        </div>
      </form>
    </div>`);

  const dialog = document.querySelector('#custom-amount-dialog');
  const input = document.querySelector('#custom-amount-input');
  input?.focus();
  document.querySelector('#btn-cancel-custom-amount')?.addEventListener('click', () => dialog?.remove());
  document.querySelector('#custom-amount-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const amount = Number(input?.value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 999999.99) {
      showAppDialog('กรุณาระบุจำนวนเงินตั้งแต่ 0.01 ถึง 999,999.99 บาท', { title: 'จำนวนเงินไม่ถูกต้อง' });
      return;
    }
    const submitButton = event.submitter;
    buttonLoading(submitButton, true);
    try {
      await createCouponAndShowQR({
        id: 'CUSTOM',
        name: 'อาหาร / เครื่องดื่ม',
        detail: `จำนวนเงิน ${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`,
        icon: '💵',
        price: amount,
        customAmount: amount
      }, () => dialog?.remove());
    } catch (error) {
      showAppDialog(error.message || 'ไม่สามารถสร้าง QR Code ได้', { title: 'สร้าง QR Code ไม่สำเร็จ' });
      buttonLoading(submitButton, false);
    }
  });
}

// --- หน้า ประวัติการใช้สิทธิ์ ---
async function renderHistory() {
  currentView = 'history';
  cleanupSubscriptions();
  resetInactivityTimer();

  layout('<div class="page-title"><h2>รายงานประวัติการใช้สิทธิ์</h2></div><div class="loading"><span class="spinner dark"></span> กำลังดึงข้อมูล...</div>', true);

  try {
    const user = session?.user || {};
    const userPhone = user.phone || user.Phone_No;
    const memberName = user.name || user.Name || '-';
    
    const [historyList, products] = await Promise.all([
      window.api.checkHistory(userPhone),
      window.api.products(session.token)
    ]);

    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });

    const historyRows = historyList.length > 0 
      ? historyList.map((item, index) => {
        const product = productMap[item.productId] || { name: item.productName || 'เครื่องดื่ม Cafe Amazon' };
        
        const imgHtml = product.image 
          ? `<img src="${esc(product.image)}" alt="${esc(product.name)}" style="width:40px; height:40px; object-fit:cover; border-radius:8px; flex-shrink:0;">`
          : `<div style="width:40px; height:40px; background:#e3f6ed; border-radius:8px; display:grid; place-items:center; font-size:18px; flex-shrink:0;">☕</div>`;

        return `
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 0.75rem 0.25rem; text-align: center; vertical-align: middle;">${index + 1}</td>
            <td style="padding: 0.75rem 0.5rem; text-align: left; vertical-align: middle; font-size: 0.8rem; color: #000; line-height: 1.45;">
              <div>${esc(item.useDate)}</div>
              <div style="font-size: 0.72rem; color: #6b7280;">เลขที่บิล: ${esc(item.billNo)}</div>
            </td>
            <td style="padding: 0.75rem 0.5rem; text-align: center; vertical-align: middle;">
              <div style="display: inline-flex; flex-direction: column; align-items: center; gap: 5px; max-width: 92px;">
                ${imgHtml}
                <strong style="font-size: 0.8rem; line-height: 1.25; display: block; overflow-wrap: anywhere;">${esc(product.name)}</strong>
              </div>
            </td>
          </tr>
        `;
      }).join('')
      : `<tr><td colspan="3" style="text-align: center; padding: 2rem; color: #6b7280;">ยังไม่มีประวัติการใช้สิทธิ์</td></tr>`;

    layout(`
      <div class="page-title"><h2>ประวัติการใช้สิทธิ์</h2><span>${esc(memberName)}</span></div>
      <div id="client-history-scroll" class="history-scroll-area">
      <div class="card" style="padding: 0.5rem; overflow: visible;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 2px solid #d1d5db; background: #f3f4f6;">
              <th style="padding: 0.5rem; text-align: center;">ลำดับ</th>
              <th style="padding: 0.5rem; text-align: left;">วันที่-เวลา</th>
              <th style="padding: 0.5rem; text-align: center;">สินค้า</th>
            </tr>
          </thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>
      </div>
    `, true);
  } catch (err) {
    showToast(err.message);
  }
}

// สร้างคูปองแล้วเปิดหน้า QR โดยตรง ใช้ร่วมกันทั้งรายการปกติและรายการใส่จำนวนเงิน
async function createCouponAndShowQR(product, beforeShow = null) {
  const user = session?.user || {};
  currentCoupon = await api.createCoupon({
    productId: product.id,
    customAmount: product.customAmount,
    phone: user.phone || user.Phone_No,
    address: user.address || user.Detail,
    Confirm_Coupon: false
  }, session?.token);
  currentCoupon.product = product;
  beforeShow?.();
  renderCoupon();
}

// --- หน้า ยืนยันสิทธิ์ ---
function renderConfirm(product) {
  currentView = 'confirm';
  cleanupSubscriptions();
  resetInactivityTimer();
  const user = session.user || {};

  const productVisual = product.image ? `<img class="confirm-product-image" src="${esc(product.image)}" alt="${esc(product.name)}">` : `<span class="confirm-product-fallback" aria-hidden="true">${esc(product.icon || '☕')}</span>`;
  layout(`<div class="page-title"></div><div class="card selected product-confirm">${productVisual}<div><strong>${esc(product.name)}</strong><em>${esc(product.detail || '')}</em></div></div><form class="card details confirmation-action" id="coupon-form"><button class="primary" type="submit">ยืนยันการใช้สิทธิ์ <span>→</span></button></form>`, true);
  
  document.querySelector('#coupon-form').onsubmit = async e => {
    e.preventDefault(); 
    const btn = e.submitter; 
    buttonLoading(btn, true);
    try { 
      await createCouponAndShowQR(product);
    } catch (err) { 
      showToast(err.message); 
      buttonLoading(btn, false); 
    }
  };
}

// --- หน้า แสดง QR Code ---
function renderCoupon() {
  currentView = 'coupon';
  cleanupSubscriptions();
  resetInactivityTimer();
  const c = currentCoupon;
  const customAmount = Number(c?.product?.customAmount);
  const hasCustomAmount = Number.isFinite(customAmount) && customAmount > 0;

  layout(`
    <div class="coupon-head">
      <h2>แสดง QR Code ให้พนักงานสแกน</h2>
    </div>
    <section class="coupon">
      <div class="qr-wrap">
        <div id="qrcode"></div>
      </div>
      <p class="coupon-id">รหัสคูปอง: <b>${esc(c.id)}</b></p>
    </section>
    ${hasCustomAmount ? `<p class="coupon-custom-amount">จำนวนเงิน ฿${customAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>` : ''}
    <div class="expiry coupon-expiry">
      <span>⏱</span><strong id="countdown">03:00</strong>
    </div>
  `, true);
  
  // ใส่เฉพาะข้อมูลที่ Staff ใช้จริง เพื่อให้ QR เล็ก อ่านได้เร็วและชัดขึ้น
  const payload = JSON.stringify({
    couponId: c.id,
    productId: c.productId,
    customAmount: c.product?.customAmount || null
  });
  if (window.QRCode) {
    const qrElement = document.querySelector('#qrcode');
    const qrWrap = document.querySelector('.qr-wrap');
    const availableWidth = Math.floor(qrWrap?.getBoundingClientRect().width || 302);
    const qrSize = Math.min(260, Math.max(120, availableWidth - 42));
    qrElement.style.setProperty('--qr-size', `${qrSize}px`);
    qrElement.style.width = `${qrSize + 18}px`;
    qrElement.style.height = `${qrSize + 18}px`;
    new QRCode(qrElement, {
      text: payload, 
      width: qrSize,
      height: qrSize,
      colorDark: '#102b23', 
      colorLight: '#ffffff' 
    });
  }

  let completionHandled = false;
  const completeAndRefresh = async () => {
    if (completionHandled) return;
    completionHandled = true;
    clearInterval(couponTimer);
    cleanupSubscriptions();
    currentCoupon = null;
    showToast('ใช้คูปองสำเร็จแล้ว!');
    await renderProducts();
  };

  if (window.supabaseClient && c.phone) {
    couponChannel = window.supabaseClient
      .channel(`coupon-check-${c.id}`)
      .on(
        'postgres_changes',
        { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'Cafe_Amazon_Promosion_House', 
          filter: `Phone_No=eq.${c.phone}` 
        },
        payload => {
          if (payload.new && payload.new.Confirm_Coupon === true) {
            completeAndRefresh();
          }
        }
      )
      .subscribe();
  }

  const update = async () => { 
    const secs = Math.max(0, Math.ceil((c.expiresAt - Date.now()) / 1000)); 
    const el = document.querySelector('#countdown'); 
    if (el) {
      el.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`; 
    }

    // ตรวจทุกวินาที เพื่อกลับหน้าสินค้าทันทีเมื่อ Staff บันทึกใช้สิทธิ์
    // โดยไม่ต้องรอให้งานพิมพ์ใบเสร็จเสร็จสิ้น
    if (window.api?.isCouponConfirmed && c.phone) {
      try {
        const isConfirmed = await window.api.isCouponConfirmed(c.phone, c.id);
        if (isConfirmed) {
          await completeAndRefresh();
          return;
        }
      } catch (err) {
        console.warn('Error checking coupon status:', err);
      }
    }

    if (secs <= 0) { 
      clearInterval(couponTimer); 
      cleanupSubscriptions();
      await clearCouponData(c.phone);
      showToast('คูปองหมดอายุแล้ว');
      renderProducts();
    } 
  }; 
  
  update(); 
  couponTimer = setInterval(update, 1000);

}

// --- หน้าสำเร็จ ---
function renderSuccessView() {
  currentView = 'success';
  cleanupSubscriptions();

  layout(`
    <div style="min-height: 70vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
      <div style="width: 80px; height: 80px; background: #d1fae5; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; color: #059669; margin-bottom: 1rem;">✓</div>
      <h2 style="font-size: 1.5rem; color: #fff;">ใช้สิทธิ์สำเร็จแล้ว!</h2>
      <p style="color: #fff; margin-bottom: 1.5rem;">ระบบบันทึกรายการสิทธิ์และออกใบเสร็จเรียบร้อยแล้ว</p>
      <button id="btn-confirm-success" class="primary" style="width: 100%; max-width: 280px;">ตกลง</button>
    </div>
  `, false);

  document.querySelector('#btn-confirm-success').onclick = () => {
    currentCoupon = null;
    renderProducts();
  };
}

// เริ่มต้นแอป
if (session) {
  if (session.user?.isDefaultPassword) {
    renderForceChangePassword();
  } else {
    renderProducts();
  }
} else {
  renderAuth();
}
