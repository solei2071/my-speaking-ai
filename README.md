# My Speaking AI

AI 영어 회화 연습을 위한 SvelteKit 앱입니다.

## 기능

- **AI 영어 회화 선생님** (`/`): Google Gemini 기반 대화(텍스트 응답 + 웹 음성 합성) + 대화 기록

## 배포 가이드

1. Vercel에 배포 후 환경변수 등록
   - `GEMINI_API_KEY` (필수)
   - `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` (필수)
   - `GEMINI_RATE_LIMIT_WINDOW_MS`, `GEMINI_RATE_LIMIT_MAX` (선택)
2. `npm run predeploy` 통과 확인
   - 이 명령은 로컬에서 실행 가능한 핵심 게이트(포맷/린트/서버 테스트/빌드)만 검사합니다.
3. 배포 전 `npm run build` 결과의 `vite` 경고(선택적 의존성) 확인
4. 브라우저 테스트까지 포함하려면 `npm run predeploy:full` 실행

## 환경 설정 (작업 환경이 바뀔 때마다)

1. [Google AI Studio](https://aistudio.google.com/app/apikey)에서 API 키 발급
2. `.env.example`을 복사해 `.env` 생성 후 키 입력:

```sh
cp .env.example .env
# .env 파일을 열어 GEMINI_API_KEY=실제_발급받은_키 로 수정
```

## 개발

```sh
npm install
npm run dev
```

`http://localhost:5173`에서 확인

## 빌드

```sh
npm run build
npm run preview
```

## 배포 원클릭 체크

```sh
npm run deploy:check
```

성공 메시지가 나오면 아래를 실행해 배포합니다.

```sh
npm run deploy:prod
```

`deploy:check`는 다음을 확인합니다.

1. `GEMINI_API_KEY` 또는 `GOOGLE_API_KEY`
2. `PUBLIC_SUPABASE_URL`
3. `PUBLIC_SUPABASE_ANON_KEY`
4. `src/routes/api/gemini-chat/+server.js` 존재
5. `npm run predeploy` (포맷/린트/서버 테스트/빌드)
