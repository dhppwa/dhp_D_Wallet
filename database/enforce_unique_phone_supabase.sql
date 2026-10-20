-- รันครั้งเดียวใน Supabase SQL Editor เพื่อห้ามบันทึก Phone_No ซ้ำ
-- หากมีข้อมูลซ้ำอยู่แล้ว ให้แก้หรือรวมรายการที่ซ้ำก่อน แล้วจึงรันคำสั่งนี้
CREATE UNIQUE INDEX IF NOT EXISTS "UX_CafeAmazonHouse_Phone"
ON "Cafe_Amazon_Promosion_House" ("Phone_No");
