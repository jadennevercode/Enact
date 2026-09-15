ALTER TABLE chat_message ADD COLUMN context_revision bigint NOT NULL DEFAULT 1;
CREATE FUNCTION enact_chat_input_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.content IS DISTINCT FROM OLD.content OR NEW.role IS DISTINCT FROM OLD.role OR NEW.message_kind IS DISTINCT FROM OLD.message_kind THEN
  NEW.context_revision := OLD.context_revision + 1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER chat_input_context_revision BEFORE UPDATE OF content,role,message_kind ON chat_message FOR EACH ROW EXECUTE FUNCTION enact_chat_input_revision();
