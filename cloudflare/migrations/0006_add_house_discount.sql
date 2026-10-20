-- D1 / SQLite ใช้ REAL สำหรับเลขทศนิยมแบบ Double
ALTER TABLE Cafe_Amazon_Promosion_House
  ADD COLUMN Discount REAL NOT NULL DEFAULT 0;
