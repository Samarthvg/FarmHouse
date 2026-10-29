-- Optional Devanagari spelling of a person's name, shown on the Hindi screens.
ALTER TABLE users ADD COLUMN name_hi TEXT CHECK (name_hi IS NULL OR length(name_hi) BETWEEN 1 AND 40);
