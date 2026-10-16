-- D1 / SQLite: Username และ Email ห้ามซ้ำแบบไม่แยกตัวพิมพ์เล็ก-ใหญ่
-- อนุญาตให้เป็น NULL หรือข้อความว่างได้หลายรายการ
CREATE UNIQUE INDEX IF NOT EXISTS idx_house_username_unique
  ON Cafe_Amazon_Promosion_House(lower(trim(Username)))
  WHERE Username IS NOT NULL AND trim(Username) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_house_email_unique
  ON Cafe_Amazon_Promosion_House(lower(trim(Email)))
  WHERE Email IS NOT NULL AND trim(Email) <> '';
