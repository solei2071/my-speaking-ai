# My Speaking AI

목소리 녹음 및 AI 영어 회화 연습을 위한 SvelteKit 앱입니다.

## 기능

- **AI 영어 회화 선생님** (`/`): OpenAI Realtime API 기반 음성 대화 + 대화 기록

## AI 영어 회화 선생님 설정

1. [OpenAI Platform](https://platform.openai.com/api-keys)에서 API 키 발급
2. 프로젝트 루트에 `.env` 파일 생성:

```
OPENAI_API_KEY=sk-proj-xxxxx
```

3. `.env.example`을 참고하여 설정

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
