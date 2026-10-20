-- D1 / SQLite: Boolean เก็บเป็น INTEGER 0/1
ALTER TABLE Cafe_Amazon_Promosion_House
  ADD COLUMN LimitAll INTEGER NOT NULL DEFAULT 0 CHECK (LimitAll IN (0, 1));

ALTER TABLE Cafe_Amazon_Promosion_House
  ADD COLUMN LimitType INTEGER NOT NULL DEFAULT 0;
