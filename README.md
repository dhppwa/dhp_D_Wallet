# สิทธิ์ของฉัน PWA

แอปเว็บสำหรับสมัครสมาชิก เข้าสู่ระบบ เลือกสิทธิ์สินค้า และสร้าง QR coupon ที่หมดอายุภายใน 15 นาที

## เริ่มใช้งาน

เปิดผ่าน local web server (PWA/service worker ไม่ทำงานหากเปิด `index.html` ตรง ๆ) เช่น VS Code Live Server หรือ `npx serve .` แล้วเปิด URL ที่ได้บนโทรศัพท์หรือคอมพิวเตอร์

## การพิมพ์ใบเสร็จ

หน้าใบเสร็จมีวิธีพิมพ์ 2 แบบ:

- **หน้าต่างพิมพ์ระบบ** (ค่าเริ่มต้น): ใช้ได้กับเครื่องพิมพ์ที่ระบบติดตั้งไดรเวอร์หรือ print service แล้ว เช่น Xprinter XP-Q90EC ผ่าน USB, Bluetooth Classic หรือ LAN รวมถึงเครื่องพิมพ์ทั่วไป ให้เลือกเครื่องพิมพ์และกระดาษ 58 มม. ในหน้าต่างพิมพ์
- **Bluetooth BLE**: ใช้กับเครื่องพิมพ์ที่รองรับ BLE/GATT และ Web Bluetooth เท่านั้น ต้องเปิดด้วย Chrome/Edge บน HTTPS หรือ localhost

XP-Q90EC เป็น Bluetooth Classic จึงต้องเลือก **หน้าต่างพิมพ์ระบบ**; ไม่สามารถเชื่อมต่อโดยตรงด้วย Web Bluetooth จาก PWA ได้. บนคอมพิวเตอร์ให้ติดตั้งไดรเวอร์ Xprinter ก่อน ส่วน Android ต้องติดตั้ง print service หรือแอปของเครื่องพิมพ์ที่ทำให้เครื่องปรากฏในเมนูพิมพ์ของระบบ.

### พิมพ์อัตโนมัติด้วย Print Agent (Windows)

Print Agent ใช้กับ PWA ที่เปิดบน **คอมพิวเตอร์ Windows เครื่องเดียวกับที่เชื่อมและติดตั้งไดรเวอร์เครื่องพิมพ์**. เหมาะกับ XP-Q90EC ผ่าน USB, Bluetooth Classic หรือ LAN และไม่ต้องเปิดหน้าต่างเลือกเครื่องพิมพ์ทุกใบเสร็จ.

1. ติดตั้งไดรเวอร์ XP-Q90EC ใน Windows และพิมพ์ทดสอบจาก Windows ให้สำเร็จก่อน
2. ติดตั้ง [Node.js รุ่น LTS](https://nodejs.org/) แล้วดับเบิลคลิก `print-agent/start.bat` (ต้องเปิดหน้าต่างนี้ทิ้งไว้)
3. เปิด `http://127.0.0.1:17891/health` บนคอมพิวเตอร์เดียวกัน ต้องเห็น `{"ok":true,...}`
4. ตั้งค่าใน `config.js`:

```js
window.PRINT_AGENT_URL = 'http://127.0.0.1:17891';
window.PRINT_AGENT_PRINTER_NAME = 'ชื่อเครื่องพิมพ์ใน Windows'; // หรือ '' เพื่อใช้ Default printer
```

5. รีเฟรช PWA แล้วเลือก **พิมพ์อัตโนมัติผ่าน Print Agent (Windows)**

เมื่อ Print Agent ตอบสำเร็จ แอปจึงบันทึกการตัดสิทธิ์. Print Agent รับคำสั่งจากเครื่องเดียวกันเท่านั้น (`127.0.0.1`).

## เชื่อม Web API SQL

แก้ `API_BASE_URL` ใน [config.js](config.js) และทำ endpoint ตามนี้:

| Method | Path | request | response หลัก |
|---|---|---|---|
| POST | `/auth/register` | `name,address,phone,password` | `token,user` |
| POST | `/auth/login` | `phone,password` | `token,user` |
| GET | `/products` | Bearer token | รายการ `{id,name,detail,icon,color}` |
| POST | `/coupons` | `productId,address,phone` | `{id,expiresAt,...}` |

ข้อมูลใน QR เป็น JSON ประกอบด้วย `couponId`, `productId`, `address`, `phone`, และ `expiresAt` โดยรหัสคูปองในโหมดทดสอบมีรูปแบบ `CPN-{productId}-{random}` เช่น `CPN-1-A1B2C3D4`

`expiresAt` ต้องเป็น Unix timestamp หน่วย milliseconds หรือปรับตัวแปลงใน `app.js` ให้ตรงกับ API ของคุณ ควรให้ backend เป็นผู้กำหนดอายุ 15 นาทีและตรวจสอบซ้ำเมื่อมีการสแกน เพื่อป้องกันการแก้ไข QR ทางฝั่ง client

## สร้างตาราง MySQL

รันไฟล์ [create_cafe_amazon_promotion.sql](database/create_cafe_amazon_promotion.sql) ใน MySQL Workbench หรือ phpMyAdmin เพื่อสร้างฐานข้อมูล `Cafe_Amazon` และตาราง `Cafe_Amazon_Promosion_House`

MySQL ไม่มีชนิด `nvarchar(MAX)` จึงใช้ `LONGTEXT` สำหรับ `Name`; ฟิลด์ข้อความอื่นใช้ `VARCHAR` พร้อม UTF-8 (`utf8mb4`) ซึ่งรองรับภาษาไทยได้ ทุกฟิลด์เป็น `NULL` ได้ ยกเว้น `ID` ซึ่งเป็น Primary Key และเพิ่มอัตโนมัติ (`AUTO_INCREMENT`)

## ฐานข้อมูล MySQL

สคริปต์สร้างฐานข้อมูล `cafe_amazon_promotion` และตาราง `Cafe_Amazon_Promosion_House` อยู่ที่ [database/Cafe_Amazon_Promosion_House.sql](database/Cafe_Amazon_Promosion_House.sql) นำไปรันใน MySQL Workbench หรือ MySQL command line ได้โดยตรง

สคริปต์สร้างตารางสินค้าอยู่ที่ [database/Item_Data.sql](database/Item_Data.sql) โดย `Item_Name` ใช้ `LONGTEXT` แทน `nvarchar(max)`, `Item_Price` ใช้ `DECIMAL(19,4)` แทน `money`, และ `Item_Image` ใช้ `LONGBLOB` แทน `image` ของ SQL Server ทุกฟิลด์เป็น `NULL` ได้ ยกเว้น `ID` ซึ่งเป็น Primary Key และเพิ่มค่าอัตโนมัติ
