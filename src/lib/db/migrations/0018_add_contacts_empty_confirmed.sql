ALTER TABLE orders
ADD COLUMN IF NOT EXISTS contacts_empty_confirmed boolean NOT NULL DEFAULT false;
