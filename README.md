# สิทธิ์ของฉัน PWA

แอปเว็บสำหรับสมัครสมาชิก เข้าสู่ระบบ เลือกสิทธิ์สินค้า และสร้าง QR coupon ที่หมดอายุภายใน 15 นาที

## เริ่มใช้งาน

เปิดผ่าน local web server (PWA/service worker ไม่ทำงานหากเปิด `index.html` ตรง ๆ) เช่น VS Code Live Server หรือ `npx serve .` แล้วเปิด URL ที่ได้บนโทรศัพท์หรือคอมพิวเตอร์

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
