-- AI 캐릭터(성격) 설정 추적을 위한 컬럼 추가
-- conversation_records 테이블 참조: supabase/conversation_records.sql
-- Supabase SQL Editor에서 실행

-- character_voice_id: 사용한 AI 캐릭터의 voice id (sage, echo, alloy 등)
-- getCharacter(voice_id)로 label, emoji, personality 조회 가능
ALTER TABLE public.conversation_records
  ADD COLUMN IF NOT EXISTS character_voice_id TEXT;

-- 기존 데이터는 character_name으로 대략 추론 가능 (nullable 유지)
COMMENT ON COLUMN public.conversation_records.character_voice_id IS 'AI voice id (sage, echo, alloy, etc.) - maps to characters.js';
