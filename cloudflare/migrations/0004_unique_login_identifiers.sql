CREATE UNIQUE INDEX IF NOT EXISTS idx_house_username_unique
  ON Cafe_Amazon_Promosion_House(lower(trim(Username)))
  WHERE Username IS NOT NULL AND trim(Username) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_house_email_unique
  ON Cafe_Amazon_Promosion_House(lower(trim(Email)))
  WHERE Email IS NOT NULL AND trim(Email) <> '';
