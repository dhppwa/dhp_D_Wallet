PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Cafe_Amazon_Promosion_House (
  ID INTEGER PRIMARY KEY AUTOINCREMENT,
  Detail TEXT,
  Remark TEXT,
  Name TEXT,
  Phone_No TEXT NOT NULL UNIQUE,
  Day_Limit INTEGER NOT NULL DEFAULT 1,
  All_Limit INTEGER NOT NULL DEFAULT 50,
  All_Use INTEGER NOT NULL DEFAULT 0,
  LastUse_Date TEXT,
  IsUse INTEGER NOT NULL DEFAULT 0,
  InsertDate TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  InsertUser TEXT,
  UpdateDate TEXT,
  UpdateUser TEXT,
  PassWord TEXT,
  Confirm_Coupon INTEGER NOT NULL DEFAULT 0,
  Coupon_No TEXT,
  Product_ID TEXT,
  Access_Level INTEGER NOT NULL DEFAULT 0,
  Username TEXT,
  LoginType INTEGER NOT NULL DEFAULT 0,
  Email TEXT,
  LimitAll INTEGER NOT NULL DEFAULT 0 CHECK (LimitAll IN (0, 1)),
  LimitType INTEGER NOT NULL DEFAULT 0,
  Discount REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Cafe_Amazon_Bill (
  ID INTEGER PRIMARY KEY AUTOINCREMENT,
  Bill_No TEXT,
  Cafe_Amazon_PK INTEGER,
  Product_Type TEXT,
  ItemDetail TEXT,
  Price REAL NOT NULL DEFAULT 0,
  Discount REAL NOT NULL DEFAULT 0,
  Change REAL NOT NULL DEFAULT 0,
  InsertDate TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  IsUse INTEGER NOT NULL DEFAULT 1,
  Coupon_No TEXT,
  FOREIGN KEY (Cafe_Amazon_PK) REFERENCES Cafe_Amazon_Promosion_House(ID) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_house_coupon ON Cafe_Amazon_Promosion_House(Coupon_No);
CREATE UNIQUE INDEX IF NOT EXISTS idx_house_username_unique
  ON Cafe_Amazon_Promosion_House(lower(trim(Username)))
  WHERE Username IS NOT NULL AND trim(Username) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_house_email_unique
  ON Cafe_Amazon_Promosion_House(lower(trim(Email)))
  WHERE Email IS NOT NULL AND trim(Email) <> '';
CREATE INDEX IF NOT EXISTS idx_bill_member ON Cafe_Amazon_Bill(Cafe_Amazon_PK);
CREATE INDEX IF NOT EXISTS idx_bill_date ON Cafe_Amazon_Bill(InsertDate);
