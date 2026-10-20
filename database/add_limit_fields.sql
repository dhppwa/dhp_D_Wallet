-- D1 / SQLite: เพิ่มฟิลด์กำหนดประเภทการจำกัดสิทธิ์ โดยไม่ลบข้อมูลเดิม
ALTER TABLE Cafe_Amazon_Promosion_House
  ADD COLUMN LimitAll INTEGER NOT NULL DEFAULT 0 CHECK (LimitAll IN (0, 1));

ALTER TABLE Cafe_Amazon_Promosion_House
  ADD COLUMN LimitType INTEGER NOT NULL DEFAULT 0;
