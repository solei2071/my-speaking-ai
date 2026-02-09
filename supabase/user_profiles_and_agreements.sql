-- 사용자 프로필 및 이용동의 테이블
-- Supabase SQL Editor에서 실행
-- 기존 auth.users와 연결되는 추가 프로필 정보 + 약관 동의 기록

-- ============================================
-- 1. 사용자 프로필 테이블
-- ============================================
CREATE TABLE public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- ============================================
-- 2. 이용동의 기록 테이블
-- ============================================
-- agreement_type: 'terms_of_service' (서비스 이용약관), 'privacy_policy' (개인정보 처리방침)
CREATE TABLE public.user_agreements (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  agreement_type TEXT NOT NULL CHECK (agreement_type IN ('terms_of_service', 'privacy_policy')),
  agreed BOOLEAN NOT NULL DEFAULT TRUE,
  agreed_at TIMESTAMPTZ DEFAULT NOW(),
  -- 동의 버전 관리 (약관 변경 시 재동의 요청 가능)
  agreement_version TEXT NOT NULL DEFAULT '1.0',
  UNIQUE(user_id, agreement_type, agreement_version)
);

-- Row Level Security
ALTER TABLE public.user_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own agreements" ON public.user_agreements
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own agreements" ON public.user_agreements
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 조회용 인덱스
CREATE INDEX idx_user_agreements_user ON public.user_agreements(user_id);
CREATE INDEX idx_user_profiles_phone ON public.user_profiles(phone);

-- ============================================
-- 3. updated_at 자동 갱신 트리거
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
