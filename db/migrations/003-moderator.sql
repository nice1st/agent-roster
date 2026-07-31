ALTER TABLE rooms ADD COLUMN moderator_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN moderator_instruction TEXT;
