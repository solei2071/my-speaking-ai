-- Optimize conversation records queries
CREATE INDEX IF NOT EXISTS idx_conversation_records_user_session
  ON conversation_records(user_id, session_id);

CREATE INDEX IF NOT EXISTS idx_conversation_records_user_created
  ON conversation_records(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_records_session
  ON conversation_records(session_id);

-- Optimize user agreements lookup
CREATE INDEX IF NOT EXISTS idx_user_agreements_lookup
  ON user_agreements(user_id, agreement_version, agreement_type);
