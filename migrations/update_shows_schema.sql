-- Migration to update the shows table schema
-- 1. First create a temporary table with the new schema
CREATE TABLE IF NOT EXISTS shows_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  date TEXT NOT NULL,
  imageUrl TEXT,
  ticketUrl TEXT,
  soldOut BOOLEAN DEFAULT FALSE
);

-- 2. Insert data from the old table to the new one, generating new IDs
INSERT INTO shows_new (id, title, url, date, imageUrl, ticketUrl, soldOut)
SELECT 
  -- Generate a new ID based on url and first date
  substring(md5(url || (dates->0)) from 1 for 16),
  title,
  url,
  dates->0 as date,
  imageUrl,
  ticketUrl,
  soldOut
FROM shows;

-- 3. Drop the old table
DROP TABLE shows;

-- 4. Rename the new table to the original name
ALTER TABLE shows_new RENAME TO shows;

-- 5. Create indexes
CREATE INDEX IF NOT EXISTS shows_date_idx ON shows (date);
CREATE INDEX IF NOT EXISTS shows_soldout_idx ON shows (soldOut); 