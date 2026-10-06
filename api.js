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

window.api = {
  isDemo: false,

  // 📌 ตรวจสอบการใช้สิทธิ์วันนี้
  async checkTodayBillUsage(phone) {
    const supabase = getSupabase();
    const cleanPhone = cleanString(phone) || getCurrentUserPhone();
    if (!cleanPhone) return false;

    const { data: user, error: userErr } = await supabase
      .from('Cafe_Amazon_Promosion_House')
      .select('ID')
      .eq('Phone_No', cleanPhone)
      .maybeSingle();

    if (userErr || !user) return false;

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const startOfDay = new Date(year, now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(year, now.getMonth(), now.getDate() + 1).toISOString();

    const { data: bill, error: billErr } = await supabase
      .from('Cafe_Amazon_Bill')
      .select('ID')
      .eq('Cafe_Amazon_PK', user.ID)
      .gte('InsertDate', startOfDay)
      .lt('InsertDate', endOfDay)
      .limit(1);

    if (billErr) return false;
    return bill && bill.length > 0;
  },

  // 1. เข้าสู่ระบบ (เช็ก PassWord)
  // ใน api.js ตรงฟังก์ชัน login
async login({ phone, password }) {
  const supabase = getSupabase();
  const cleanPhone = cleanString(phone);

  // หากปิด/ออฟไลน์ครั้งก่อนจนคืนสถานะไม่สำเร็จ ให้คืนค่าเดิมก่อนตรวจเข้าสู่ระบบใหม่
  if (localStorage.getItem(PENDING_USAGE_RELEASE_KEY) === cleanPhone) {
    await supabase.from('Cafe_Amazon_Promosion_House')
      .update({ IsUse: false, UpdateDate: new Date().toISOString() })
      .eq('Phone_No', cleanPhone);
    clearQueuedUsageRelease(cleanPhone);
  }

  const { data, error } = await supabase
    .from('Cafe_Amazon_Promosion_House')
    .select('*')
    .eq('Phone_No', cleanPhone)
    .maybeSingle();

  if (error) throw new Error(`เกิดข้อผิดพลาดฐานข้อมูล: ${error.message}`);
  if (!data) throw new Error('ไม่พบข้อมูลเบอร์โทรศัพท์นี้ในระบบ');
  
  // แปลงค่ารหัสผ่านใน DB เป็น String เพื่อป้องกันปัญหา Type mismatch
  const dbPassword = String(data.PassWord ?? '').trim();
  const inputPassword = String(password ?? '').trim();

  // ถ้ารหัสผ่านใน DB ไม่ใช่ค่าว่าง/1234 และกรอกมาไม่ตรง ให้แจ้งเตือน
  if (dbPassword && dbPassword !== '1234' && dbPassword !== inputPassword) {
    throw new Error('รหัสผ่านไม่ถูกต้อง');
  }

  // 📌 ตรวจสอบว่าเป็นรหัสผ่านเริ่มต้น (1234 หรือ ค่าว่าง) หรือไม่
  const isDefaultPassword = (dbPassword === '' || dbPassword === '1234' || inputPassword === '1234');

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
    All_Limit: data.All_Limit || 50,
    Day_Limit: data.Day_Limit || 1,
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
      .select('ID, Phone_No, Name, Detail, Remark, All_Use, All_Limit, Day_Limit, Access_Level')
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
      Access_Level: Number(data.Access_Level ?? 0)
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

  async verifyPasswordRecovery({ phone, address }) {
    const supabase = getSupabase();
    const cleanPhone = cleanString(phone);
    const cleanAddress = cleanString(address);
    if (!cleanPhone || !cleanAddress) throw new Error('กรุณากรอกเบอร์โทรศัพท์และรายละเอียดให้ครบถ้วน');
    const { data, error } = await supabase.from('Cafe_Amazon_Promosion_House').select('*').eq('Phone_No', cleanPhone).eq('Detail', cleanAddress).maybeSingle();
    if (error) throw new Error(`เกิดข้อผิดพลาดฐานข้อมูล: ${error.message}`);
    if (!data) throw new Error('ไม่พบข้อมูลที่ตรงกับเบอร์โทรศัพท์และรายละเอียด');
    const usedCount = data.All_Use ?? 0;
    return { token: `sb-token-${data.ID}`, user: { id: data.ID, phone: data.Phone_No, Phone_No: data.Phone_No, name: data.Name || 'ลูกค้า Cafe Amazon', Name: data.Name || 'ลูกค้า Cafe Amazon', address: data.Detail || '-', Detail: data.Detail || '-', usedCount, All_Use: usedCount, All_Limit: data.All_Limit || 50, Day_Limit: data.Day_Limit || 1, isDefaultPassword: false } };
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

    const cleanPhone = cleanString(phone) || getCurrentUserPhone();
    if (!cleanPhone) throw new Error('ไม่พบเบอร์โทรศัพท์ของผู้ใช้งาน');
    if (!productId) throw new Error('กรุณาเลือกรายการสินค้า');

    const { data: userRecord, error: fetchErr } = await supabase
      .from('Cafe_Amazon_Promosion_House')
      .select('All_Use, All_Limit, Detail')
      .eq('Phone_No', cleanPhone)
      .maybeSingle();

    if (fetchErr || !userRecord) throw new Error('ไม่พบข้อมูลเบอร์โทรศัพท์ในระบบ');
    
    if ((userRecord.All_Use ?? 0) >= (userRecord.All_Limit ?? 50)) {
      throw new Error(`คุณใช้สิทธิ์ครบจำนวนเต็ม ${userRecord.All_Limit} แก้วแล้ว`);
    }

    const strProductId = String(productId);
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
      .select('ID, InsertDate, Coupon_No, Bill_No')
      .eq('Cafe_Amazon_PK', user.ID)
      .order('InsertDate', { ascending: false });

    if (billErr) throw new Error(`ไม่สามารถดึงข้อมูลประวัติได้: ${billErr.message}`);

    return (bills || []).map(item => {
      let productId = '1';
      if (item.Coupon_No && item.Coupon_No.startsWith('CPN-')) {
        const parts = item.Coupon_No.split('-');
        if (parts.length >= 2) productId = String(parts[1]).replace(/\.0+$/, '');
      }

      return {
        id: item.ID,
        billNo: item.Bill_No || '-',
        couponNo: item.Coupon_No || '-',
        productId: String(productId),
        useDate: item.InsertDate ? new Date(item.InsertDate).toLocaleString('th-TH', {
          year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '-'
      };
    });
  }
};
