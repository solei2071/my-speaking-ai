# My Speaking AI

AI 영어 회화 연습을 위한 SvelteKit 앱입니다.

## 기능

- **AI 영어 회화 선생님** (`/`): OpenAI Realtime API 기반 음성 대화 + 대화 기록

## 환경 설정 (작업 환경이 바뀔 때마다)

1. [OpenAI Platform](https://platform.openai.com/api-keys)에서 API 키 발급
2. `.env.example`을 복사해 `.env` 생성 후 키 입력:

```sh
cp .env.example .env
# .env 파일을 열어 OPENAI_API_KEY=실제_발급받은_키 로 수정
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
