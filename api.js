// api.js (ระบบลูกค้า - Cloudflare Worker + D1)

const INTERNET_ERROR_MESSAGE = 'เชื่อมต่อ Internet ไม่ได้ กรุณาตรวจสอบหรือเชื่อมต่อ Internet แล้วลองอีกครั้ง';
const nativeFetch = window.fetch.bind(window);
let lastInternetCheckAt = 0;
let lastInternetCheckPassed = true;

// ตรวจสอบก่อนเรียกข้อมูล และทดสอบซ้ำอย่างน้อยทุก 5 วินาที
async function ensureInternetConnection() {
  if (!navigator.onLine) throw new Error(INTERNET_ERROR_MESSAGE);
  const now = Date.now();
  if (now - lastInternetCheckAt < 5000) {
    if (!lastInternetCheckPassed) throw new Error(INTERNET_ERROR_MESSAGE);
    return true;
  }
  lastInternetCheckAt = now;
  try {
    await nativeFetch(`${window.API_BASE_URL}/health`, { method: 'GET', cache: 'no-store' });
    lastInternetCheckPassed = true;
    return true;
  } catch (error) {
    lastInternetCheckPassed = false;
    throw new Error(INTERNET_ERROR_MESSAGE);
  }
}

async function onlineFetch(...args) {
  await ensureInternetConnection();
  try {
    return await nativeFetch(...args);
  } catch (error) {
    throw new Error(INTERNET_ERROR_MESSAGE);
  }
}

window.ensureInternetConnection = ensureInternetConnection;
setInterval(() => ensureInternetConnection().catch(() => {}), 5000);

function getSupabase() {
  if (!window.createD1Client) throw new Error('ระบบเชื่อมต่อ Cloudflare D1 ยังโหลดไม่สมบูรณ์ กรุณาลองใหม่อีกครั้ง');
  if (!window._supabaseInstance) {
    window._supabaseInstance = window.createD1Client();
  }
  return window._supabaseInstance;
}

function cleanString(val) {
  return String(val || '').trim();
}

function getCurrentUserPhone() {
  try {
    const savedUser = localStorage.getItem('user') || sessionStorage.getItem('user');
    if (savedUser) {
      const parsed = JSON.parse(savedUser);
      return cleanString(parsed.phone || parsed.Phone_No);
    }
  } catch (e) {
    console.warn('Cannot parse stored user:', e);
  }
  return '';
}

const PENDING_USAGE_RELEASE_KEY = 'client-pending-isuse-release';
function queueUsageRelease(phone) {
  if (phone) localStorage.setItem(PENDING_USAGE_RELEASE_KEY, cleanString(phone));
}
function clearQueuedUsageRelease(phone) {
  if (!phone || localStorage.getItem(PENDING_USAGE_RELEASE_KEY) === cleanString(phone)) {
    localStorage.removeItem(PENDING_USAGE_RELEASE_KEY);
  }
}

function getLimitPeriod(limitType, now = new Date()) {
  const type = [0, 1, 2].includes(Number(limitType)) ? Number(limitType) : 0;
  if (type === 1) {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      label: 'เดือน'
    };
  }
  if (type === 2) {
    return {
      start: new Date(now.getFullYear(), 0, 1),
      end: new Date(now.getFullYear() + 1, 0, 1),
      label: 'ปี'
    };
  }
  return {
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
    label: 'วัน'
  };
}

async function getUsageLimitStatus(phone) {
  const supabase = getSupabase();
  const cleanPhone = cleanString(phone) || getCurrentUserPhone();
  if (!cleanPhone) throw new Error('ไม่พบเบอร์โทรศัพท์ของผู้ใช้งาน');

  const { data: user, error: userErr } = await supabase
    .from('Cafe_Amazon_Promosion_House')
    .select('ID, All_Use, All_Limit, Day_Limit, LimitAll, LimitType')
    .eq('Phone_No', cleanPhone)
    .maybeSingle();
  if (userErr || !user) throw new Error('ไม่พบข้อมูลสมาชิกในระบบ');

  const usedCount = Number(user.All_Use ?? 0);
  const allLimit = Number(user.All_Limit ?? 0);
  const unlimitedAll = Boolean(user.LimitAll);
  const periodLimit = Number(user.Day_Limit ?? 0);
  const period = getLimitPeriod(user.LimitType);

  const { data: bills, error: billErr } = await supabase
    .from('Cafe_Amazon_Bill')
    .select('ID')
    .eq('Cafe_Amazon_PK', user.ID)
    .gte('InsertDate', period.start.toISOString())
    .lt('InsertDate', period.end.toISOString());
  if (billErr) throw new Error(`ตรวจสอบจำนวนการใช้สิทธิ์ไม่สำเร็จ: ${billErr.message}`);

  const periodUsed = (bills || []).length;

  // LimitAll = ไม่จำกัด: ข้ามทั้งเพดานสิทธิ์สะสมและเพดานตามวัน/เดือน/ปี
  // หากเป็นแบบจำกัด ต้องมีค่าทั้งสองส่วนมากกว่า 0 เสมอ (ค่าผิดปกติจะไม่อนุญาตให้ใช้สิทธิ์)
  const invalidTotalLimit = !unlimitedAll && (!Number.isFinite(allLimit) || allLimit <= 0);
  const invalidPeriodLimit = !unlimitedAll && (!Number.isFinite(periodLimit) || periodLimit <= 0);
  const totalBlocked = !unlimitedAll && !invalidTotalLimit && usedCount >= allLimit;
  const periodBlocked = !unlimitedAll && !invalidPeriodLimit && periodUsed >= periodLimit;
  const reason = invalidTotalLimit || invalidPeriodLimit
    ? 'ข้อมูลการจำกัดสิทธิ์ไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ'
    : totalBlocked
      ? `คุณใช้สิทธิ์ครบทั้งหมด ${allLimit} สิทธิ์แล้ว`
      : periodBlocked
        ? `คุณใช้สิทธิ์ครบ ${periodLimit} สิทธิ์ต่อ${period.label}แล้ว`
        : '';

  return {
    blocked: invalidTotalLimit || invalidPeriodLimit || totalBlocked || periodBlocked,
    reason,
    usedCount,
    allLimit,
    unlimitedAll,
    periodUsed,
    periodLimit,
    limitType: Number(user.LimitType ?? 0),
    periodLabel: period.label
  };
}

window.api = {
  isDemo: false,

  // 📌 ตรวจสอบการใช้สิทธิ์วันนี้
  async checkTodayBillUsage(phone) {
    return (await getUsageLimitStatus(phone)).blocked;
  },

  async getUsageLimitStatus(phone) {
    return getUsageLimitStatus(phone);
  },

  async isCouponConfirmed(phone, couponNo) {
    const cleanPhone = cleanString(phone) || getCurrentUserPhone();
    if (!cleanPhone || !couponNo) return false;
    // หลัง Staff ยืนยัน ระบบจะสร้างบิลแล้วล้าง Coupon_No ในตารางสมาชิก
    // จึงต้องตรวจจากบิลแทนการเทียบ Coupon_No ที่ถูกล้างไปแล้ว
    const { data: bills, error: billError } = await getSupabase()
      .from('Cafe_Amazon_Bill')
      .select('ID')
      .eq('Coupon_No', String(couponNo))
      .limit(1);
    if (billError) return false;
    if (bills && bills.length > 0) return true;

    // สำรองกรณี Worker รุ่นเก่ายังไม่ล้าง Coupon_No หลังยืนยัน
    const { data: member, error: memberError } = await getSupabase()
      .from('Cafe_Amazon_Promosion_House')
      .select('Confirm_Coupon, Coupon_No')
      .eq('Phone_No', cleanPhone)
      .maybeSingle();
    if (memberError || !member) return false;
    return Boolean(member.Confirm_Coupon) && String(member.Coupon_No || '') === String(couponNo);
  },

  // 1. เข้าสู่ระบบ (เช็ก PassWord)
  // ใน api.js ตรงฟังก์ชัน login
async login({ loginId, phone, password }) {
  const supabase = getSupabase();
  const identifier = cleanString(loginId ?? phone);
  if (!identifier) throw new Error('กรุณากรอก Username เบอร์โทรศัพท์ หรือ Email');

  const loginLookups = [
    { column: 'Phone_No', value: identifier, loginType: 0 },
    { column: 'Username', value: identifier, loginType: 1 },
    { column: 'Email', value: identifier.toLowerCase(), loginType: 2 }
  ];
  const results = await Promise.all(loginLookups.map(item => supabase
    .from('Cafe_Amazon_Promosion_House')
    .select('*')
    .eq(item.column, item.value)
    .eq('LoginType', item.loginType)
    .maybeSingle()));
  const failedResult = results.find(result => result.error);
  if (failedResult) throw new Error(`เกิดข้อผิดพลาดฐานข้อมูล: ${failedResult.error.message}`);
  const matches = results.map(result => result.data).filter(Boolean);
  if (matches.length > 1) throw new Error('พบข้อมูลเข้าสู่ระบบซ้ำ กรุณาติดต่อผู้ดูแลระบบ');
  const data = matches[0];
  if (!data) throw new Error('ไม่พบข้อมูลผู้ใช้งาน หรือประเภทการเข้าสู่ระบบไม่ถูกต้อง');
  const cleanPhone = cleanString(data.Phone_No);

  // หากปิด/ออฟไลน์ครั้งก่อนจนคืนสถานะไม่สำเร็จ ให้คืนค่าจากเบอร์อ้างอิงของบัญชี
  if (localStorage.getItem(PENDING_USAGE_RELEASE_KEY) === cleanPhone) {
    await supabase.from('Cafe_Amazon_Promosion_House')
      .update({ IsUse: false, UpdateDate: new Date().toISOString() })
      .eq('Phone_No', cleanPhone);
    clearQueuedUsageRelease(cleanPhone);
  }
  
  // ตรวจรหัสผ่านทุกตัวแบบตรงกันทั้งหมด รหัสว่างเดิมให้ใช้ 1234 เป็นรหัสเริ่มต้น
  const dbPassword = String(data.PassWord ?? '');
  const expectedPassword = dbPassword === '' ? '1234' : dbPassword;
  const inputPassword = String(password ?? '');

  if (inputPassword !== expectedPassword) {
    throw new Error('รหัสผ่านไม่ถูกต้อง');
  }

  // Client อนุญาตสมาชิกทั่วไปและ VIP เท่านั้น ส่วนแอดมิน/ทดสอบระบบใช้ฝั่ง Staff
  if ([2, 3].includes(Number(data.Access_Level ?? 0))) {
    throw new Error('สถานะแอดมินหรือทดสอบระบบไม่สามารถใช้งานได้ เฉพาะผู้ใช้งานทั่วไปและ VIP เท่านั้น');
  }

  // 📌 บังคับเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบด้วยรหัสเริ่มต้น 1234 เท่านั้น
  const isDefaultPassword = expectedPassword === '1234';

  // ยึดสิทธิ์การใช้งานแบบมีเงื่อนไข เพื่อไม่ให้เบอร์เดียวกันเข้าได้พร้อมกัน 2 เครื่อง
  // ตรวจสอบก่อนเพื่อแสดงข้อความที่ชัดเจน และ update แบบมีเงื่อนไขเพื่อกันการกดพร้อมกัน
  if (data.IsUse === true || String(data.IsUse).toLowerCase() === 'true') {
    throw new Error('ไม่สามารถเข้าสู่ระบบได้ เนื่องจากบัญชีนี้กำลังใช้งานอยู่บนอุปกรณ์อื่น');
  }

  const { data: claimedUser, error: claimError } = await supabase
    .from('Cafe_Amazon_Promosion_House')
    .update({ IsUse: true, UpdateDate: new Date().toISOString() })
    .eq('Phone_No', cleanPhone)
    .or('IsUse.is.false,IsUse.is.null')
    .select('ID')
    .maybeSingle();

  if (claimError) throw new Error(`ไม่สามารถตั้งค่าสถานะการใช้งาน: ${claimError.message}`);
  if (!claimedUser) {
    throw new Error('ไม่สามารถเข้าสู่ระบบได้ เนื่องจากบัญชีนี้กำลังใช้งานอยู่บนอุปกรณ์อื่น');
  }

  const usedCount = data.All_Use ?? 0;
  const user = {
    id: data.ID,
    phone: data.Phone_No,
    Phone_No: data.Phone_No,
    name: data.Name || 'ลูกค้า Cafe Amazon',
    Name: data.Name || 'ลูกค้า Cafe Amazon',
    address: data.Detail || '-',
    Detail: data.Detail || '-',
    usedCount: usedCount,
    All_Use: usedCount,
    All_Limit: Number(data.All_Limit ?? 0),
    Day_Limit: Number(data.Day_Limit ?? 0),
    LimitAll: Boolean(data.LimitAll),
    LimitType: Number(data.LimitType ?? 0),
    Username: data.Username || '',
    Email: data.Email || '',
    LoginType: Number(data.LoginType ?? 0),
    Access_Level: Number(data.Access_Level ?? 0),
    isDefaultPassword: isDefaultPassword // ส่งค่านี้ไปยัง app.js
  };

  return { token: `sb-token-${data.ID}`, user };
  },

  async restoreUserUsage(phone) {
    const cleanPhone = cleanString(phone) || getCurrentUserPhone();
    if (!cleanPhone) return;
    const { error } = await getSupabase()
      .from('Cafe_Amazon_Promosion_House')
      .update({ IsUse: true, UpdateDate: new Date().toISOString() })
      .eq('Phone_No', cleanPhone);
    if (error) throw new Error(`ไม่สามารถตั้งค่าสถานะการใช้งาน: ${error.message}`);
    clearQueuedUsageRelease(cleanPhone);
  },

  // ดึงข้อมูลสมาชิกและจำนวนสิทธิ์ล่าสุด เพื่อไม่ใช้ค่าที่ค้างอยู่ใน Session ตอนเข้าสู่ระบบ
  async getMemberProfile(phone) {
    const cleanPhone = cleanString(phone) || getCurrentUserPhone();
    if (!cleanPhone) throw new Error('ไม่พบเบอร์โทรศัพท์ของผู้ใช้งาน');
    const { data, error } = await getSupabase()
      .from('Cafe_Amazon_Promosion_House')
      .select('ID, Phone_No, Name, Detail, Remark, All_Use, All_Limit, Day_Limit, LimitAll, LimitType, Access_Level, IsUse, Username, LoginType, Email')
      .eq('Phone_No', cleanPhone)
      .maybeSingle();
    if (error) throw new Error(`ไม่สามารถดึงข้อมูลสมาชิกล่าสุด: ${error.message}`);
    if (!data) throw new Error('ไม่พบข้อมูลสมาชิกในระบบ');
    const usedCount = Number(data.All_Use ?? 0);
    return {
      id: data.ID,
      phone: data.Phone_No,
      Phone_No: data.Phone_No,
      name: data.Name || 'ลูกค้า Cafe Amazon',
      Name: data.Name || 'ลูกค้า Cafe Amazon',
      address: data.Detail || '-',
      Detail: data.Detail || '-',
      project: data.Remark || '-',
      Remark: data.Remark || '-',
      usedCount,
      All_Use: usedCount,
      All_Limit: Number(data.All_Limit ?? 50),
      Day_Limit: Number(data.Day_Limit ?? 1),
      LimitAll: Boolean(data.LimitAll),
      LimitType: Number(data.LimitType ?? 0),
      Access_Level: Number(data.Access_Level ?? 0),
      isUse: Boolean(data.IsUse),
      IsUse: Boolean(data.IsUse),
      Username: data.Username || '',
      LoginType: Number(data.LoginType ?? 0),
      Email: data.Email || ''
    };
  },

  // คืนสิทธิ์ให้บัญชี เมื่อผู้ใช้ออกจากระบบหรือปิดหน้าแอป
  async releaseUserUsage(phone, { keepalive = false } = {}) {
    const cleanPhone = cleanString(phone) || getCurrentUserPhone();
    if (!cleanPhone) return;

    const payload = { IsUse: false, UpdateDate: new Date().toISOString() };

    // pagehide/beforeunload ต้องใช้ keepalive เพื่อให้คำขอยังส่งได้แม้หน้าเว็บกำลังปิด
    if (keepalive) {
      try {
        await window.d1Request({ table: 'Cafe_Amazon_Promosion_House', action: 'update', values: payload, filters: [{ column: 'Phone_No', op: 'eq', value: cleanPhone }], orFilters: [] }, { keepalive: true });
        clearQueuedUsageRelease(cleanPhone);
      } catch (err) {
        queueUsageRelease(cleanPhone);
        console.warn('ไม่สามารถคืนสถานะ IsUse ขณะปิดหน้าแอป:', err);
      }
      return;
    }

    try {
      const { error } = await getSupabase()
        .from('Cafe_Amazon_Promosion_House')
        .update(payload)
        .eq('Phone_No', cleanPhone);
      if (error) throw error;
      clearQueuedUsageRelease(cleanPhone);
    } catch (error) {
      queueUsageRelease(cleanPhone);
      throw new Error(`ไม่สามารถคืนสถานะการใช้งาน: ${error.message}`);
    }
  },

  // 📌 ฟังก์ชันเปลี่ยนรหัสผ่านแรกเข้า (บังคับไม่ให้ใช้ 1234)
  async changePassword({ phone, newPassword }) {
    const supabase = getSupabase();
    const cleanPhone = cleanString(phone) || getCurrentUserPhone();

    if (newPassword === '1234') {
      throw new Error('ไม่อนุญาตให้ใช้รหัสผ่าน 1234 กรุณาตั้งรหัสผ่านอื่น');
    }

    const { error } = await supabase
      .from('Cafe_Amazon_Promosion_House')
      .update({
        PassWord: newPassword,
        UpdateDate: new Date().toISOString(),
        UpdateUser: 'FIRST_LOGIN_CHANGE'
      })
      .eq('Phone_No', cleanPhone);

    if (error) throw new Error(`ไม่สามารถอัปเดตรหัสผ่านได้: ${error.message}`);
    return { success: true };
  },

  // 2. รายการสินค้า
  async products(token) {
    return [
      { id: '1', name: 'แบล็คคอฟฟี (Free)', detail: 'เย็น มูลค่า 60 บาท', image: 'public/assets/image/black-coffee.webp', color: 'orange', price: 60 },
      { id: '2', name: 'เอสเปรสโซ (Free)', detail: 'เย็น มูลค่า 60 บาท', image: 'public/assets/image/espresso.webp', color: 'green', price: 60 },
      { id: '3', name: 'ชานม (Free)', detail: 'เย็น มูลค่า 50 บาท', image: 'public/assets/image/tea-with-milk.webp', color: 'gold', price: 50 }
    ];
  },

  // 3. สร้างคูปอง
  async createCoupon(payload, token) {
    const supabase = getSupabase();
    let productId = typeof payload === 'object' ? (payload.productId || payload.id) : payload;
    let phone = typeof payload === 'object' ? payload.phone : null;
    let address = typeof payload === 'object' ? payload.address : '';
    const customAmount = typeof payload === 'object' ? Number(payload.customAmount) : null;

    const cleanPhone = cleanString(phone) || getCurrentUserPhone();
    if (!cleanPhone) throw new Error('ไม่พบเบอร์โทรศัพท์ของผู้ใช้งาน');
    if (!productId) throw new Error('กรุณาเลือกรายการสินค้า');

    const { data: userRecord, error: fetchErr } = await supabase
      .from('Cafe_Amazon_Promosion_House')
      .select('All_Use, All_Limit, Day_Limit, LimitAll, LimitType, Detail')
      .eq('Phone_No', cleanPhone)
      .maybeSingle();

    if (fetchErr || !userRecord) throw new Error('ไม่พบข้อมูลเบอร์โทรศัพท์ในระบบ');
    
    const usageStatus = await getUsageLimitStatus(cleanPhone);
    if (usageStatus.blocked) throw new Error(usageStatus.reason);

    const isCustomAmount = String(productId).toUpperCase() === 'CUSTOM';
    if (isCustomAmount && (!Number.isFinite(customAmount) || customAmount <= 0 || customAmount > 999999.99)) {
      throw new Error('จำนวนเงินไม่ถูกต้อง');
    }
    // เก็บยอดเป็นสตางค์ใน Product_ID เพื่อให้ Staff อ่านยอดจริงจากฐานข้อมูลได้ทุกเครื่อง
    const strProductId = isCustomAmount ? `C-${Math.round(customAmount * 100)}` : String(productId);
    const couponId = `CPN-${strProductId}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const finalProductId = isNaN(Number(productId)) ? strProductId : Number(productId);

    const { error: updateErr } = await supabase
      .from('Cafe_Amazon_Promosion_House')
      .update({ 
        Confirm_Coupon: false,
        Coupon_No: couponId,
        Product_ID: finalProductId,
        UpdateDate: new Date().toISOString(),
        UpdateUser: 'COUPON_APP'
      })
      .eq('Phone_No', cleanPhone);

    if (updateErr) throw new Error(`ปรับสถานะคูปองไม่สำเร็จ: ${updateErr.message}`);

    const issuedAt = Date.now();
    return {
      id: couponId,
      issuedAt,
      expiresAt: issuedAt + 3 * 60 * 1000,
      productId: strProductId,
      address: address || userRecord.Detail || '-',
      phone: cleanPhone,
      Confirm_Coupon: false,
      Coupon_No: couponId
    };
  },

  // 📌 ฟังก์ชันสร้างเลขบิลแบบปี ค.ศ. เดือน วัน รัน 4 หลัก (รีเซ็ตวันต่อวัน)
  async generateNextBillNo() {
    const supabase = getSupabase();
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${year}${month}${day}`; // เช่น "20260922"

    const startOfDay = new Date(year, now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(year, now.getMonth(), now.getDate() + 1).toISOString();

    // ดึงบิลล่าสุดของวันนี้
    const { data: latestBills, error } = await supabase
      .from('Cafe_Amazon_Bill')
      .select('Bill_No')
      .gte('InsertDate', startOfDay)
      .lt('InsertDate', endOfDay)
      .order('InsertDate', { ascending: false })
      .limit(1);

    let nextSeq = 1;
    if (!error && latestBills && latestBills.length > 0) {
      const lastBillNo = String(latestBills[0].Bill_No || '');
      // ดึงเลขรัน 4 หลักสุดท้ายออกมา
      if (lastBillNo.startsWith(datePrefix) && lastBillNo.length >= 12) {
        const lastSeqStr = lastBillNo.slice(-4);
        const lastSeq = parseInt(lastSeqStr, 10);
        if (!isNaN(lastSeq)) {
          nextSeq = lastSeq + 1;
        }
      }
    }

    const seqFormatted = String(nextSeq).padStart(4, '0');
    return `${datePrefix}${seqFormatted}`; // ตัวอย่าง: 202609220001
  },

  async resetExpiredCoupon(phone) {
    const supabase = getSupabase();
    const cleanPhone = cleanString(phone) || getCurrentUserPhone();
    if (!cleanPhone) return;

    await supabase
      .from('Cafe_Amazon_Promosion_House')
      .update({ 
        Confirm_Coupon: false,
        Coupon_No: null,
        Product_ID: null,
        UpdateDate: new Date().toISOString()
      })
      .eq('Phone_No', cleanPhone);
  },

  async checkHistory(phone) {
    const supabase = getSupabase();
    const cleanPhone = cleanString(phone) || getCurrentUserPhone();
    if (!cleanPhone) throw new Error('ไม่พบเบอร์โทรศัพท์ของผู้ใช้งาน');

    const { data: user } = await supabase
      .from('Cafe_Amazon_Promosion_House')
      .select('ID')
      .eq('Phone_No', cleanPhone)
      .maybeSingle();

    if (!user) throw new Error('ไม่พบข้อมูลผู้ใช้งาน');

    const { data: bills, error: billErr } = await supabase
      .from('Cafe_Amazon_Bill')
      .select('ID, InsertDate, Coupon_No, Bill_No, Product_Type, ItemDetail')
      .eq('Cafe_Amazon_PK', user.ID)
      .order('InsertDate', { ascending: false });

    if (billErr) throw new Error(`ไม่สามารถดึงข้อมูลประวัติได้: ${billErr.message}`);

    return (bills || []).map(item => {
      let productId = item.Product_Type != null ? String(item.Product_Type).replace(/\.0+$/, '') : '1';
      if (item.Product_Type == null && item.Coupon_No && item.Coupon_No.startsWith('CPN-')) {
        const parts = item.Coupon_No.split('-');
        if (parts.length >= 2) productId = String(parts[1]).replace(/\.0+$/, '');
      }

      return {
        id: item.ID,
        billNo: item.Bill_No || '-',
        couponNo: item.Coupon_No || '-',
        productId: String(productId),
        productName: item.ItemDetail || (/^C-\d+$/i.test(String(productId)) ? 'อาหาร / เครื่องดื่ม' : ''),
        useDate: item.InsertDate ? new Date(item.InsertDate).toLocaleString('th-TH', {
          year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '-'
      };
    });
  }
};
