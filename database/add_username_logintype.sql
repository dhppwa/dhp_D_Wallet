-- D1 / SQLite: เพิ่มคอลัมน์ในฐานเดิมโดยไม่ลบข้อมูล
ALTER TABLE Cafe_Amazon_Promosion_House ADD COLUMN Username TEXT;
ALTER TABLE Cafe_Amazon_Promosion_House ADD COLUMN LoginType INTEGER NOT NULL DEFAULT 0;
