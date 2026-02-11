-- Saved Sentences table: users can bookmark AI responses for later review
CREATE TABLE IF NOT EXISTS saved_sentences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  character_name VARCHAR(50) NOT NULL,
  character_voice_id VARCHAR(50),
  session_id VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_saved_sentences_user_id ON saved_sentences(user_id);

-- Enable RLS
ALTER TABLE saved_sentences ENABLE ROW LEVEL SECURITY;

-- Users can only see their own saved sentences
CREATE POLICY "Users can select own saved sentences"
  ON saved_sentences FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own saved sentences
CREATE POLICY "Users can insert own saved sentences"
  ON saved_sentences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own saved sentences
CREATE POLICY "Users can delete own saved sentences"
  ON saved_sentences FOR DELETE
  USING (auth.uid() = user_id);
