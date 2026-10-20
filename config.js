// Cloudflare Worker API ที่เชื่อมกับฐานข้อมูล D1
window.API_BASE_URL = 'https://pwa-amazon-api.dhp-pwa.workers.dev';

// API Timeout
window.API_TIMEOUT_MS = 12000;

// Print Agent สำหรับพิมพ์อัตโนมัติจาก PWA บนคอมพิวเตอร์เครื่องร้าน
// รัน print-agent/start.bat ก่อน แล้วระบุ URL นี้ เช่น 'http://127.0.0.1:17891'
// ปล่อยเป็นค่าว่างหากไม่ได้ใช้ Print Agent
//window.PRINT_AGENT_URL = '';
window.PRINT_AGENT_TOKEN = '';
// ชื่อเครื่องพิมพ์ตามที่แสดงใน Windows; ปล่อยว่างให้ใช้เครื่องพิมพ์ค่าเริ่มต้น
//window.PRINT_AGENT_PRINTER_NAME = '';
// ปรับให้ตรงกับ API ของคุณได้ในไฟล์ api.js

window.PRINT_AGENT_URL = 'http://127.0.0.1:17891';
window.PRINT_AGENT_PRINTER_NAME = 'ชื่อ XP-Q90EC ตามใน Windows';

