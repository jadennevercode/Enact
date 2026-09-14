DROP TRIGGER IF EXISTS chat_input_context_revision ON chat_message;
DROP FUNCTION IF EXISTS enact_chat_input_revision();
ALTER TABLE chat_message DROP COLUMN IF EXISTS context_revision;
