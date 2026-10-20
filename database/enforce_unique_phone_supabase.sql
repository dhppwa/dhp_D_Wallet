-- รันครั้งเดียวใน Supabase SQL Editor เพื่อป้องกันเบอร์โทรศัพท์ซ้ำ
-- หากคำสั่งนี้แจ้ง error ให้ลบหรือแก้ไขข้อมูล Phone_No ที่ซ้ำกันก่อน แล้วรันอีกครั้ง
CREATE UNIQUE INDEX IF NOT EXISTS "UX_CafeAmazonHouse_Phone"
ON "Cafe_Amazon_Promosion_House" ("Phone_No");
