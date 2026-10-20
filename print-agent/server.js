// Print Agent สำหรับ Windows: รับใบเสร็จจาก PWA แล้วพิมพ์ผ่านไดรเวอร์ Windows
// ใช้ Node.js เท่านั้น ไม่ต้องติดตั้ง package เพิ่ม
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const port = Number(process.env.PRINT_AGENT_PORT || 17891);
const token = process.env.PRINT_AGENT_TOKEN || '';
const script = path.join(__dirname, 'print-receipt.ps1');

function reply(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Print-Agent-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Private-Network': 'true'
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 100000) reject(new Error('ข้อมูลใบเสร็จมีขนาดใหญ่เกินไป'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('รูปแบบข้อมูลไม่ถูกต้อง')); }
    });
  });
}

function print(payload) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-PayloadBase64', encoded], {
      windowsHide: true
    });
    let stderr = '';
    ps.stderr.on('data', chunk => { stderr += chunk; });
    ps.on('error', reject);
    ps.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `พิมพ์ไม่สำเร็จ (รหัส ${code})`)));
  });
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return reply(res, 204, {});
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ok: true, printer: process.env.PRINTER_NAME || 'default' });
  if (req.method !== 'POST' || req.url !== '/print') return reply(res, 404, { error: 'ไม่พบปลายทาง' });
  if (token && req.headers['x-print-agent-token'] !== token) return reply(res, 401, { error: 'รหัส Print Agent ไม่ถูกต้อง' });
  try {
    const payload = await readJson(req);
    if (!Array.isArray(payload.lines) || payload.lines.length === 0) throw new Error('ไม่พบข้อความสำหรับพิมพ์');
    await print(payload);
    reply(res, 200, { ok: true });
  } catch (error) {
    console.error(error.message);
    reply(res, 500, { error: error.message });
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Print Agent พร้อมใช้งาน: http://127.0.0.1:${port}`);
  console.log('ทดสอบ: เปิด http://127.0.0.1:' + port + '/health');
});
