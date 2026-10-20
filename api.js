// api.js (ระบบพนักงานขาย - Cloudflare Worker + D1)

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

/**
 * ฟังก์ชันสร้าง/ดึง Client Instance ของ Cloudflare D1 Worker
 */
function getSupabase() {
  if (!window.createD1Client) throw new Error('ระบบเชื่อมต่อ Cloudflare D1 ยังโหลดไม่สมบูรณ์ กรุณาลองใหม่อีกครั้ง');
  if (!window._supabaseInstance) {
    window._supabaseInstance = window.createD1Client();
  }
  return window._supabaseInstance;
}

/**
 * ฟังก์ชันทำความสะอาดข้อความ (Trim)
 */
function cleanString(val) {
  return String(val || '').trim();
}

function getLimitPeriodRange(limitType, now = new Date()) {
  const type = [0, 1, 2].includes(Number(limitType)) ? Number(limitType) : 0;
  if (type === 1) return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1)
  };
  if (type === 2) return {
    start: new Date(now.getFullYear(), 0, 1),
    end: new Date(now.getFullYear() + 1, 0, 1)
  };
  return {
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  };
}

async function getPeriodUsageCount(memberId, limitType) {
  if (!memberId) return 0;
  const range = getLimitPeriodRange(limitType);
  const { data, error } = await getSupabase()
    .from('Cafe_Amazon_Bill')
    .select('ID')
    .eq('Cafe_Amazon_PK', memberId)
    .gte('InsertDate', range.start.toISOString())
    .lt('InsertDate', range.end.toISOString());
  if (error) throw new Error(`ตรวจสอบสิทธิ์ตามช่วงเวลาไม่สำเร็จ: ${error.message}`);
  return (data || []).length;
}

const STAFF_PENDING_USAGE_RELEASE_KEY = 'staff-pending-isuse-release';
function queueStaffUsageRelease(phone) {
  if (phone) localStorage.setItem(STAFF_PENDING_USAGE_RELEASE_KEY, cleanString(phone));
}

async function updateStaffUsage(phone, isUse, { keepalive = false } = {}) {
  const cleanPhone = cleanString(phone);
  if (!cleanPhone) return;
  const payload = { IsUse: isUse, UpdateDate: new Date().toISOString() };
  if (keepalive) {
    await window.d1Request({ table: 'Cafe_Amazon_Promosion_House', action: 'update', values: payload, filters: [{ column: 'Phone_No', op: 'eq', value: cleanPhone }], orFilters: [] }, { keepalive: true });
    return;
  }
  const { error } = await getSupabase()
    .from('Cafe_Amazon_Promosion_House')
    .update(payload)
    .eq('Phone_No', cleanPhone);
  if (error) throw error;
}

/**
 * แผนที่รายการสินค้า (Product Map)
 */
const PRODUCT_MAP = {
  '1': { name: 'แบล็คคอฟฟี (เย็น)', detail: 'เย็น มูลค่า 60 บาท', image: 'public/assets/image/black-coffee.webp', color: 'orange', price: 60 },
  '2': { name: 'เอสเปรสโซ (เย็น)', detail: 'เย็น มูลค่า 60 บาท', image: 'public/assets/image/espresso.webp', color: 'green', price: 60 },
  '3': { name: 'ชานม (เย็น)', detail: 'เย็น มูลค่า 50 บาท', image: 'public/assets/image/tea-with-milk.webp', color: 'gold', price: 50 }
};

const normalizeProductId = value => String(value ?? '').trim().replace(/\.0+$/, '');
const getVisibleProductName = (storedName, product) => {
  const name = cleanString(storedName);
  if (!name || /^สินค้า\s*รหัส\s*/i.test(name)) return product?.name || 'รายการสินค้า';
  return name;
};

window.staffApi = {
  async releaseUserUsage(phone, { keepalive = false } = {}) {
    const cleanPhone = cleanString(phone);
    try {
      await updateStaffUsage(cleanPhone, false, { keepalive });
      localStorage.removeItem(STAFF_PENDING_USAGE_RELEASE_KEY);
    } catch (error) {
      queueStaffUsageRelease(cleanPhone);
      throw error;
    }
  },

  async restoreUserUsage(phone) {
    const cleanPhone = cleanString(phone);
    await updateStaffUsage(cleanPhone, true);
    localStorage.removeItem(STAFF_PENDING_USAGE_RELEASE_KEY);
  },

  /** ตรวจว่ามีบัญชีผู้ดูแลสำหรับเปิดหน้าจัดการสมาชิกแล้วหรือไม่ */
  async hasAdminUser() {
    const { data, error } = await getSupabase()
      .from('Cafe_Amazon_Promosion_House')
      .select('ID')
      .eq('Access_Level', 1)
      .limit(1);

    if (error) throw new Error(`ตรวจสอบผู้ดูแลระบบไม่สำเร็จ: ${error.message}`);
    return (data || []).length > 0;
  },

  /** ตรวจสอบสิทธิ์ก่อนเปิดหน้าจัดการสมาชิกตาม LoginType ของบัญชี */
  async verifyAdminCredentials(username, password) {
    const supabase = getSupabase();
    const user = cleanString(username);
    const pass = String(password ?? '');

    if (!user || !pass) throw new Error('กรุณากรอก User และ Password ให้ครบถ้วน');

    const loginLookups = [
      { column: 'Phone_No', value: user, loginType: 0 },
      { column: 'Username', value: user, loginType: 1 },
      { column: 'Email', value: user.toLowerCase(), loginType: 2 }
    ];
    const results = await Promise.all(loginLookups.map(item => supabase
      .from('Cafe_Amazon_Promosion_House')
      .select('ID, Name, Phone_No, Username, Email, LoginType, Access_Level')
      .eq(item.column, item.value)
      .eq('LoginType', item.loginType)
      .eq('PassWord', pass)
      .eq('Access_Level', 1)
      .maybeSingle()));
    const failedResult = results.find(result => result.error);
    if (failedResult) throw new Error(`ตรวจสอบสิทธิ์ไม่สำเร็จ: ${failedResult.error.message}`);
    const matches = results.map(result => result.data).filter(Boolean);
    if (matches.length > 1) throw new Error('พบข้อมูลเข้าสู่ระบบซ้ำ กรุณาติดต่อผู้ดูแลระบบ');
    const data = matches[0];
    if (!data) throw new Error('User หรือ Password ไม่ถูกต้อง หรือบัญชีนี้ไม่มีสิทธิ์แอดมิน');

    await updateStaffUsage(data.Phone_No, true);

    return { id: data.ID, name: data.Name, username: data.Phone_No, phone: data.Phone_No, loginType: Number(data.LoginType ?? 0), accessLevel: data.Access_Level };
  },

  /**
   * 0. ฟังก์ชันเจนเลขบิลอัตโนมัติ (YYYYMMDD0001)
   * เลขรัน 4 หลัก และรีเซ็ตเป็น 0001 เมื่อเป็นบิลแรกของวัน
   */
  async generateBillNo() {
    const supabase = getSupabase();
    const now = new Date();
    
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yyyy}${mm}${dd}`; // เช่น 20260922

    // ค้นหาบิลล่าสุดของวันนี้ในตาราง Cafe_Amazon_Bill
    const { data, error } = await supabase
      .from('Cafe_Amazon_Bill')
      .select('Bill_No')
      .like('Bill_No', `${datePrefix}%`)
      .order('Bill_No', { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextSequence = 1;
    if (data && data.Bill_No && data.Bill_No.length >= 12) {
      // ดึงเลขรัน 4 หลักสุดท้ายมาแปลงเป็นตัวเลข
      const lastSeqStr = data.Bill_No.substring(8, 12);
      const lastSeqInt = parseInt(lastSeqStr, 10);
      if (!isNaN(lastSeqInt)) {
        nextSequence = lastSeqInt + 1;
      }
    }

    const seqString = String(nextSequence).padStart(4, '0');
    return `${datePrefix}${seqString}`;
  },

  // api.js (เฉพาะส่วน generateBillNo)

/**
 * 0. ฟังก์ชันเจนเลขบิลอัตโนมัติ (YYYYMMDD0001)
 * เลขรัน 4 หลัก และรีเซ็ตเป็น 0001 เมื่อเป็นบิลแรกของวัน (ไม่มีตัวหนังสือ)
 */
async generateBillNo() {
  const supabase = getSupabase();
  const now = new Date();
  
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${yyyy}${mm}${dd}`; // เช่น 20260922

  // ค้นหาบิลล่าสุดของวันนี้ในตาราง Cafe_Amazon_Bill
  const { data, error } = await supabase
    .from('Cafe_Amazon_Bill')
    .select('Bill_No')
    .like('Bill_No', `${datePrefix}%`)
    .order('Bill_No', { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextSequence = 1;
  if (data && data.Bill_No && data.Bill_No.length === 12) {
    // ดึงเลขรัน 4 หลักสุดท้ายมาแปลงเป็นตัวเลข
    const lastSeqStr = data.Bill_No.substring(8, 12);
    const lastSeqInt = parseInt(lastSeqStr, 10);
    if (!isNaN(lastSeqInt)) {
      nextSequence = lastSeqInt + 1;
    }
  }

  const seqString = String(nextSequence).padStart(4, '0');
  return `${datePrefix}${seqString}`;
},
  /**
   * 1. ค้นหาและตรวจสอบข้อมูลสิทธิ์ก่อนทำรายการ
   * @param {string} searchKey - เบอร์โทรศัพท์ หรือ รหัสคูปอง
   */
  // api.js (ดึง Detail และ Remark ของสมาชิก)
  async checkCouponInfo(searchKey, fallbackPhone = null) {
  const supabase = getSupabase();
  const cleanKey = cleanString(searchKey);
  const cleanFallbackPhone = cleanString(fallbackPhone);

  if (!cleanKey) throw new Error('ข้อมูลเบอร์โทรศัพท์หรือรหัสคูปองไม่ถูกต้อง');

  let { data, error } = await supabase
    .from('Cafe_Amazon_Promosion_House')
    .select('ID, Name, Phone_No, Detail, Remark, All_Use, All_Limit, Day_Limit, LimitAll, LimitType, Confirm_Coupon, LastUse_Date, Coupon_No, Product_ID, Username, LoginType, Email, Discount')
    .or(`Phone_No.eq.${cleanKey},Coupon_No.eq.${cleanKey}`)
    .maybeSingle();

  // เมื่อ Coupon_No ถูกล้างหลังหมดอายุ ให้ใช้เบอร์ใน QR เพื่อพบรายการเดิมและแจ้งสถานะให้ถูกต้อง
  if (!data && !error && cleanFallbackPhone) {
    ({ data, error } = await supabase
      .from('Cafe_Amazon_Promosion_House')
      .select('ID, Name, Phone_No, Detail, Remark, All_Use, All_Limit, Day_Limit, LimitAll, LimitType, Confirm_Coupon, LastUse_Date, Coupon_No, Product_ID, Username, LoginType, Email, Discount')
      .eq('Phone_No', cleanFallbackPhone)
      .maybeSingle());
  }

  if (error) throw new Error(`เกิดข้อผิดพลาดในการดึงข้อมูล: ${error.message}`);
  if (!data) throw new Error(`ไม่พบข้อมูลสมาชิกหรือคูปอง (${cleanKey}) ในระบบ`);

  if (data.Confirm_Coupon === true) {
    throw new Error('❌ คูปองนี้ถูกใช้งานไปแล้ว ไม่สามารถใช้ซ้ำได้');
  }

  if (!data.Coupon_No || (cleanKey.startsWith('CPN-') && data.Coupon_No !== cleanKey)) {
    throw new Error('คูปองหมดอายุแล้ว กรุณาให้ลูกค้าสร้างคูปองใหม่');
  }

  const productIdStr = data.Product_ID != null ? normalizeProductId(data.Product_ID) : null;
  const product = productIdStr ? PRODUCT_MAP[productIdStr] : null;
  const productName = product?.name || (productIdStr ? 'รายการสินค้า' : 'ไม่ได้เลือกสินค้า');
  const periodUsed = await getPeriodUsageCount(data.ID, data.LimitType);

  return {
    id: data.ID,
    name: data.Name || 'ลูกค้า Cafe Amazon',
    phone: data.Phone_No,
    username: data.Username || '',
    loginType: Number(data.LoginType ?? 0),
    email: data.Email || '',
    address: data.Detail || '-',
    project: data.Remark || '-',
    usedCount: data.All_Use ?? 0,
    allLimit: Number(data.All_Limit ?? 0),
    quotaPerPeriod: Number(data.Day_Limit ?? 0),
    limitAll: Boolean(data.LimitAll),
    limitType: Number(data.LimitType ?? 0),
    periodUsed,
    confirmCoupon: data.Confirm_Coupon ?? false,
    lastUseDate: data.LastUse_Date,
    couponNo: data.Coupon_No || 'ไม่มีคูปองที่ใช้งานอยู่',
    productId: productIdStr,
    productName: productName,
    productImage: product?.image || null,
    productPrice: Number(product?.price || 0),
    discount: Math.min(100, Math.max(0, Number(data.Discount ?? 0)))
  };
  },

  // ตรวจสถานะล่าสุดก่อนสร้างบิลหรือเชื่อมต่อเครื่องพิมพ์
  async validateCouponForRedeem(phone, couponNo) {
    const cleanPhone = cleanString(phone);
    const cleanCouponNo = cleanString(couponNo);
    if (!cleanPhone || !cleanCouponNo) {
      throw new Error('คูปองหมดอายุแล้ว กรุณาให้ลูกค้าสร้างคูปองใหม่');
    }

    const { data, error } = await getSupabase()
      .from('Cafe_Amazon_Promosion_House')
      .select('ID, Coupon_No, Confirm_Coupon, Discount, All_Use, All_Limit, Day_Limit, LimitAll, LimitType')
      .eq('Phone_No', cleanPhone)
      .maybeSingle();

    if (error) throw new Error(`ตรวจสอบคูปองไม่สำเร็จ: ${error.message}`);
    if (!data || data.Confirm_Coupon === true || data.Coupon_No !== cleanCouponNo) {
      throw new Error('คูปองหมดอายุแล้ว กรุณาให้ลูกค้าสร้างคูปองใหม่');
    }
    return {
      discount: Math.min(100, Math.max(0, Number(data.Discount ?? 0))),
      usedCount: Number(data.All_Use ?? 0),
      allLimit: Number(data.All_Limit ?? 0),
      quotaPerPeriod: Number(data.Day_Limit ?? 0),
      limitAll: Boolean(data.LimitAll),
      limitType: Number(data.LimitType ?? 0),
      periodUsed: await getPeriodUsageCount(data.ID, data.LimitType)
    };
  },

  /**
   * 2. ดึงประวัติการใช้สิทธิ์/ออกใบเสร็จย้อนหลังของลูกค้า
   * @param {string} userPhone - เบอร์โทรศัพท์ลูกค้า
   */
  // api.js (เฉพาะส่วน getHistory)

async getHistory(userPhone) {
  const supabase = getSupabase();
  const cleanPhone = cleanString(userPhone);

  if (!cleanPhone) throw new Error('ไม่พบข้อมูลเบอร์โทรศัพท์สำหรับค้นหาประวัติ');

  // 1. ดึงข้อมูลสมาชิกจากเบอร์โทร
  const { data: userData, error: userErr } = await supabase
    .from('Cafe_Amazon_Promosion_House')
    .select('ID, Phone_No')
    .eq('Phone_No', cleanPhone)
    .maybeSingle();

  if (userErr) throw new Error(`เกิดข้อผิดพลาดในการค้นหาผู้ใช้งาน: ${userErr.message}`);
  if (!userData) return [];

  // 2. ดึงประวัติบิลจาก Cafe_Amazon_Bill
  const { data: bills, error: billErr } = await supabase
    .from('Cafe_Amazon_Bill')
    .select('Bill_No, ItemDetail, InsertDate, Coupon_No, Product_Type')
    .eq('Cafe_Amazon_PK', userData.ID)
    .order('InsertDate', { ascending: false });

  if (billErr) throw new Error(`เกิดข้อผิดพลาดในการดึงประวัติการใช้สิทธิ์: ${billErr.message}`);

  return (bills || []).map((bill) => {
    const pId = bill.Product_Type != null ? normalizeProductId(bill.Product_Type) : null;
    const mappedProduct = pId ? PRODUCT_MAP[pId] : null;

    const formattedDate = bill.InsertDate
      ? new Date(bill.InsertDate).toLocaleString('th-TH', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '-';

    return {
      billNo: bill.Bill_No || '-',
      useDate: formattedDate,
      phone: cleanPhone,
      productName: getVisibleProductName(bill.ItemDetail, mappedProduct),
      productImage: mappedProduct?.image || null,
      couponNo: bill.Coupon_No || '-'
    };
  });
  },

  /**
   * 3. บันทึกข้อมูลลง Cafe_Amazon_Bill และ อัปเดต Cafe_Amazon_Promosion_House
   * @param {Object} userData - ข้อมูลสมาชิก/คูปองที่ได้จาก checkCouponInfo
   * @param {string} billNo - เลขที่บิล
   * @param {string} staffCode - รหัสพนักงาน
   */
  async commitRedeemTransaction(userData, billNo, staffCode = 'STAFF_001') {
    const supabase = getSupabase();
    const cleanPhone = cleanString(userData.phone);
    const pkValue = userData.id ? parseInt(userData.id, 10) : null;
    const nextUsedCount = (userData.usedCount || 0) + 1;

    const rawProductId = userData.productId ? normalizeProductId(userData.productId) : '1';

    const { error: billErr } = await supabase
      .from('Cafe_Amazon_Bill')
      .insert([
        {
          Bill_No: billNo,
          Cafe_Amazon_PK: pkValue,
          Product_Type: rawProductId.substring(0, 13),
          ItemDetail: userData.productName,
           // ราคาเก็บเป็นราคาสินค้าจริง ไม่หักเปอร์เซ็นต์ส่วนลดของสมาชิก
           Price: Number(userData.productPrice || 0),
           Discount: Math.min(100, Math.max(0, Number(userData.discount ?? 0))),
          Change: 0.00,
          InsertDate: new Date().toISOString(),
          IsUse: true,
          Coupon_No: userData.couponNo !== 'ไม่มีคูปองที่ใช้งานอยู่' ? userData.couponNo : null
        }
      ]);

    if (billErr) {
      throw new Error(`บันทึกข้อมูลใบเสร็จ (Bill) ล้มเหลว: ${billErr.message}`);
    }

    const { error: updateErr } = await supabase
      .from('Cafe_Amazon_Promosion_House')
      .update({
        All_Use: nextUsedCount,
        LastUse_Date: new Date().toISOString(),
        Confirm_Coupon: true,
        Coupon_No: null,
        Product_ID: null,
        UpdateDate: new Date().toISOString(),
        UpdateUser: staffCode
      })
      .eq('Phone_No', cleanPhone)
      .eq('Confirm_Coupon', false);

    if (updateErr) {
      throw new Error(`บันทึก Bill สำเร็จ แต่ใช้สิทธิ์ในตารางหลักล้มเหลว: ${updateErr.message}`);
    }

    return {
      success: true,
      phone: cleanPhone,
      billNo: billNo,
      usedCount: nextUsedCount
    };
  },

  /**
   * 4. ดึงตารางข้อมูลสมาชิกทั้งหมด
   */
  async getHouseTableData() {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('Cafe_Amazon_Promosion_House')
      .select('ID, Name, Phone_No, Detail, Remark, All_Use, All_Limit, Day_Limit, IsUse, Access_Level, Confirm_Coupon, Product_ID, Username, LoginType, Email, LimitAll, LimitType, Discount')
      .order('Name', { ascending: true });

    if (error) throw new Error(`ดึงข้อมูลตารางล้มเหลว: ${error.message}`);

    return (data || []).map(item => ({
      id: item.ID,
      name: item.Name || '-',
      phone: item.Phone_No || '-',
      address: item.Detail || '-',
      project: item.Remark || '-',
      usedCount: item.All_Use ?? 0,
      allLimit: item.All_Limit ?? 10,
      quotaPerDay: item.Day_Limit ?? 1, // อ่านค่า Day_Limit จากเบส
      isUse: item.IsUse ?? false,
      accessLevel: item.Access_Level ?? 0,
      username: item.Username || '',
      loginType: Number(item.LoginType ?? 0),
      email: item.Email || '',
      limitAll: Boolean(item.LimitAll),
      limitType: Number(item.LimitType ?? 0),
      discount: Number(item.Discount ?? 0)
    }));
  },

  /** ดึงรายการขายตามช่วงวันที่สำหรับรายงาน Staff (รวมวันที่สิ้นสุดทั้งวัน) */
  async getSalesReport(startDateValue, endDateValue = startDateValue) {
    const supabase = getSupabase();
    const selectedStartDate = String(startDateValue || '').trim();
    const selectedEndDate = String(endDateValue || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(selectedEndDate)) {
      throw new Error('กรุณาเลือกช่วงวันที่ให้ถูกต้อง');
    }

    const start = new Date(`${selectedStartDate}T00:00:00`);
    const end = new Date(`${selectedEndDate}T00:00:00`);
    if (start > end) throw new Error('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
    end.setDate(end.getDate() + 1);
    const { data, error } = await supabase
      .from('Cafe_Amazon_Bill')
      .select('Bill_No, Cafe_Amazon_PK, Product_Type, ItemDetail, Price, Discount, Change, InsertDate, IsUse')
      .gte('InsertDate', start.toISOString())
      .lt('InsertDate', end.toISOString())
      .order('InsertDate', { ascending: false });

    if (error) throw new Error(`ดึงรายงานการขายล้มเหลว: ${error.message}`);
    const memberIds = [...new Set((data || []).map(bill => bill.Cafe_Amazon_PK).filter(Boolean))];
    let members = [];
    if (memberIds.length) {
      const { data: memberRows, error: memberError } = await supabase
        .from('Cafe_Amazon_Promosion_House')
        .select('ID, Name, Phone_No, Detail, Remark, All_Use, All_Limit, Day_Limit, Access_Level')
        .or(memberIds.map(id => `ID.eq.${id}`).join(','));
      if (memberError) throw new Error(`ดึงข้อมูลสมาชิกในรายงานล้มเหลว: ${memberError.message}`);
      members = memberRows || [];
    }
    const memberMap = new Map(members.map(member => [String(member.ID), member]));
    return (data || []).map(bill => {
      const productId = normalizeProductId(bill.Product_Type);
      const product = PRODUCT_MAP[productId];
      const member = memberMap.get(String(bill.Cafe_Amazon_PK)) || {};
      const productPrice = Number(bill.Price ?? product?.price ?? 0);
      const discount = Math.min(100, Math.max(0, Number(bill.Discount ?? 0)));
      return {
        ...bill,
        productId,
        productName: getVisibleProductName(bill.ItemDetail, product),
        productImage: product?.image || null,
        productPrice,
        discount,
        netPrice: productPrice * (1 - discount / 100),
        memberName: member.Name || '-',
        memberPhone: member.Phone_No || '-',
        memberAddress: member.Detail || '-',
        memberRemark: member.Remark || '-',
        memberUsedCount: Number(member.All_Use ?? 0),
        memberAllLimit: Number(member.All_Limit ?? 0),
        memberDayLimit: Number(member.Day_Limit ?? 1),
        memberAccessLevel: Number(member.Access_Level ?? 0)
      };
    });
  },

  /**
   * 5. เพิ่ม หรือ แก้ไขข้อมูลสมาชิก
   */
    async saveHouseData(payload) {
    const supabase = getSupabase();
    const cleanPhone = cleanString(payload.phone);
    const cleanName = cleanString(payload.name);
    const usernameValue = cleanString(payload.username);
    const emailValue = cleanString(payload.email);
    const loginTypeValue = [0, 1, 2].includes(Number(payload.loginType)) ? Number(payload.loginType) : 0;
    const discountValue = Number(payload.discount ?? 0);
    const limitAllValue = Boolean(payload.limitAll);
    const limitTypeValue = [0, 1, 2].includes(Number(payload.limitType)) ? Number(payload.limitType) : 0;

    if (!cleanPhone || !cleanName) {
      throw new Error('กรุณากรอกชื่อ-นามสกุล และ เบอร์โทรศัพท์ ให้ครบถ้วน');
    }
    if (loginTypeValue === 1 && !usernameValue) {
      throw new Error('กรุณากรอก Username สำหรับเข้าสู่ระบบ');
    }
    if (loginTypeValue === 2 && (!emailValue || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue))) {
      throw new Error('กรุณากรอก Email ให้ถูกต้องสำหรับเข้าสู่ระบบ');
    }
    if (!Number.isFinite(discountValue) || discountValue < 0 || discountValue > 100) {
      throw new Error('ส่วนลดต้องเป็นตัวเลขตั้งแต่ 0 ถึง 100 เปอร์เซ็นต์');
    }

    const accessLevelValue = Number(payload.accessLevel) === 1 ? 1 : 0;
    if (accessLevelValue === 0) {
      const dayLimit = Number(payload.quotaPerDay ?? payload.Day_Limit);
      const usedCount = Number(payload.usedCount);
      const allLimit = Number(payload.allLimit);
      if (
        !Number.isInteger(dayLimit) || dayLimit <= 0 ||
        !Number.isInteger(usedCount) || usedCount < 0 ||
        (!limitAllValue && (!Number.isInteger(allLimit) || allLimit <= 0))
      ) {
        throw new Error(limitAllValue
          ? 'สิทธิ์ตามช่วงเวลาต้องมากกว่า 0 และสิทธิ์ที่ใช้แล้วต้องไม่น้อยกว่า 0'
          : 'สิทธิ์ / วัน และสิทธิ์ทั้งหมดต้องมากกว่า 0 ส่วนสิทธิ์ที่ใช้แล้วต้องไม่น้อยกว่า 0');
      }
    }

    // ห้ามใช้เบอร์โทรศัพท์เดียวกันกับสมาชิกคนอื่น
    // กรณีแก้ไข จะไม่นับข้อมูลรายการเดิมของตนเองว่าเป็นเบอร์ซ้ำ
    let duplicatePhoneQuery = supabase
      .from('Cafe_Amazon_Promosion_House')
      .select('ID, Name')
      .eq('Phone_No', cleanPhone);

    if (payload.id) {
      duplicatePhoneQuery = duplicatePhoneQuery.neq('ID', payload.id);
    }

    const { data: duplicateMember, error: duplicateError } = await duplicatePhoneQuery.maybeSingle();
    if (duplicateError) throw new Error(`ตรวจสอบเบอร์โทรศัพท์ซ้ำไม่สำเร็จ: ${duplicateError.message}`);
    if (duplicateMember) {
      throw new Error('เบอร์โทรศัพท์นี้มีข้อมูลสมาชิกอยู่แล้ว กรุณาใช้เบอร์โทรศัพท์อื่น');
    }

    // Username และ Email ต้องไม่ซ้ำเมื่อมีการกรอก แต่อนุญาตให้เว้นว่างได้
    if (usernameValue) {
      let duplicateUsernameQuery = supabase
        .from('Cafe_Amazon_Promosion_House')
        .select('ID, Username')
        .eq('Username', usernameValue);
      if (payload.id) duplicateUsernameQuery = duplicateUsernameQuery.neq('ID', payload.id);
      const { data: duplicateUsername, error: usernameError } = await duplicateUsernameQuery.maybeSingle();
      if (usernameError) throw new Error(`ตรวจสอบ Username ซ้ำไม่สำเร็จ: ${usernameError.message}`);
      if (duplicateUsername) throw new Error('Username นี้มีผู้ใช้งานแล้ว กรุณาใช้ Username อื่น');
    }

    if (emailValue) {
      let duplicateEmailQuery = supabase
        .from('Cafe_Amazon_Promosion_House')
        .select('ID, Email')
        .eq('Email', emailValue.toLowerCase());
      if (payload.id) duplicateEmailQuery = duplicateEmailQuery.neq('ID', payload.id);
      const { data: duplicateEmail, error: emailError } = await duplicateEmailQuery.maybeSingle();
      if (emailError) throw new Error(`ตรวจสอบ Email ซ้ำไม่สำเร็จ: ${emailError.message}`);
      if (duplicateEmail) throw new Error('Email นี้มีผู้ใช้งานแล้ว กรุณาใช้ Email อื่น');
    }

    const dayLimitValue = accessLevelValue === 1 ? 0 : (payload.quotaPerDay ?? payload.Day_Limit);

    const recordData = {
      Name: cleanName,
      Phone_No: cleanPhone,
      Username: usernameValue || null,
      LoginType: loginTypeValue,
      Email: emailValue ? emailValue.toLowerCase() : null,
      Detail: cleanString(payload.address),
      Remark: cleanString(payload.project),
      Day_Limit: dayLimitValue,  // ✅ บันทึกตรงตามค่าที่กรอก (หรือ quotaPerDay)
      Access_Level: accessLevelValue,
      IsUse: payload.id ? Boolean(payload.isUse) : false,
      All_Use: accessLevelValue === 1 ? 0 : (payload.usedCount ?? 0),
      All_Limit: accessLevelValue === 1 || limitAllValue ? 0 : (payload.allLimit ?? 10),
      LimitAll: limitAllValue,
      LimitType: limitTypeValue,
      Discount: discountValue,
      UpdateDate: new Date().toISOString()
    };

    if (payload.id) {
      // ✏️ กรณีแก้ไขข้อมูลเดิม (UPDATE)
      const { error } = await supabase
        .from('Cafe_Amazon_Promosion_House')
        .update(recordData)
        .eq('ID', payload.id);

      if (error) throw new Error(`อัปเดตข้อมูลล้มเหลว: ${error.message}`);
    } else {
      // ➕ กรณีเพิ่มข้อมูลใหม่ครั้งแรก (INSERT)
      recordData.PassWord = '1234'; 

      const { error } = await supabase
        .from('Cafe_Amazon_Promosion_House')
        .insert([recordData]);

      if (error) throw new Error(`เพิ่มข้อมูลใหม่ล้มเหลว: ${error.message}`);
    }

    return { success: true };
    },

  /**
   * 6. ลบข้อมูลสมาชิก
   */
  async deleteHouseData(id) {
    const supabase = getSupabase();
    const { data: billData, error: billError } = await supabase
      .from('Cafe_Amazon_Bill')
      .select('Bill_No')
      .eq('Cafe_Amazon_PK', id)
      .limit(1);

    if (billError) throw new Error(`ตรวจสอบประวัติการใช้สิทธิ์ไม่สำเร็จ: ${billError.message}`);
    if (billData?.length) {
      throw new Error('ไม่สามารถลบได้ เนื่องจากมีการใช้สิทธิ์ไปแล้ว');
    }

    const { error } = await supabase
      .from('Cafe_Amazon_Promosion_House')
      .delete()
      .eq('ID', id);

    if (error) throw new Error(`ลบข้อมูลล้มเหลว: ${error.message}`);
    return { success: true };
  },

  /**
   * 7. รีเซ็ตรหัสผ่านกลับเป็น 1234
   */
  async resetPassword(id, newPassword = '1234') {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('Cafe_Amazon_Promosion_House')
      .update({ 
        PassWord: newPassword, // ใช้อักษรตัวพิมพ์เล็กให้ตรงกับใน Supabase
        UpdateDate: new Date().toISOString()
      })
      .eq('ID', id);

    if (error) throw new Error(`รีเซ็ตรหัสผ่านล้มเหลว: ${error.message}`);
    return { success: true };
  }
};
