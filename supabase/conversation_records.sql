-- 영어회화 기록 테이블
-- Supabase SQL Editor에서 실행

CREATE TABLE public.conversation_records (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE public.conversation_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own records" ON public.conversation_records
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own records" ON public.conversation_records
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own records" ON public.conversation_records
  FOR DELETE USING (auth.uid() = user_id);

-- 조회용 인덱스
CREATE INDEX idx_conversation_records_user_session ON public.conversation_records(user_id, session_id);
