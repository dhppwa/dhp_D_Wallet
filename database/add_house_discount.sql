-- D1 / SQLite: เพิ่มส่วนลดของสมาชิกโดยไม่ลบข้อมูลเดิม
ALTER TABLE Cafe_Amazon_Promosion_House
  ADD COLUMN Discount REAL NOT NULL DEFAULT 0;
