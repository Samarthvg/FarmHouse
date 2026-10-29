-- Lets "has this person left any history?" be answered from indexes, so a person can be deleted
-- only while nothing points at them.
CREATE INDEX entries_updated_by ON entries (updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX audit_user ON audit_log (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX photos_created_by ON photos (created_by) WHERE created_by IS NOT NULL;
