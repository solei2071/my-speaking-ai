# Windows ↔ Mac 작업 가이드 (GitHub 사용)

이 프로젝트를 Windows와 Mac에서 같이 작업하려면 GitHub에 올려두고, 각 기기에서 `push` / `pull` 하면 됩니다.

---

## 1단계: GitHub 저장소 만들기

1. [github.com](https://github.com) 로그인
2. 오른쪽 상단 **+** → **New repository**
3. Repository name: `my-speaking-ai` (또는 원하는 이름)
4. **Public** 선택
5. **Create repository** 클릭
6. 생성된 페이지에서 **HTTPS** 주소 복사 (예: `https://github.com/내아이디/my-speaking-ai.git`)

---

## 2단계: Windows에서 GitHub에 올리기

터미널(또는 Cursor 터미널)에서 프로젝트 폴더로 이동 후:

```bash
# 원격 저장소 연결 (아래 주소를 본인 GitHub 주소로 바꾸세요)
git remote add origin https://github.com/내아이디/my-speaking-ai.git

# GitHub에 올리기
git push -u origin master
```

- GitHub 로그인 창이 뜨면 로그인
- 처음이면 **GitHub CLI** 또는 **Personal Access Token** 사용 안내가 나올 수 있음

---

## 3단계: Mac에서 처음 받아오기

Mac에서 Cursor 또는 터미널을 열고:

```bash
# 프로젝트 받을 폴더로 이동 (예: Documents)
cd ~/Documents

# GitHub에서 프로젝트 복제
git clone https://github.com/내아이디/my-speaking-ai.git

# 폴더로 들어가서
cd my-speaking-ai

# 패키지 설치 (필수!)
npm install

# 개발 서버 실행
npm run dev
```

브라우저에서 `http://localhost:5173` 접속하면 됩니다.

---

## 4단계: 매일 작업 흐름

### Windows에서 작업 끝났을 때 (Mac에서 이어서 하기 전에)

```bash
git add .
git commit -m "작업 내용 요약"
git push
```

### Mac에서 작업 시작할 때 (Windows에서 최신 코드 가져오기)

```bash
git pull
```

### Mac에서 작업 끝났을 때 (Windows에서 이어서 하기 전에)

```bash
git add .
git commit -m "작업 내용 요약"
git push
```

### Windows에서 작업 시작할 때 (Mac에서 최신 코드 가져오기)

```bash
git pull
```

---

## 자주 쓰는 명령어 정리

| 명령어 | 의미 |
|--------|------|
| `git status` | 변경된 파일 확인 |
| `git add .` | 모든 변경사항 스테이징 |
| `git commit -m "메시지"` | 커밋 생성 |
| `git push` | GitHub에 올리기 |
| `git pull` | GitHub에서 최신 코드 받기 |

---

## 주의사항

- **작업 시작 전에 항상 `git pull`** 해서 최신 코드 받기
- **작업 끝나면 `git push`** 해서 GitHub에 올리기
- 같은 파일을 양쪽에서 수정하면 **충돌(conflict)** 이 날 수 있음 → 한쪽에서만 수정하거나, 충돌 해결 후 다시 push

---

## Mac에 Git이 없다면

```bash
# Homebrew로 설치 (Mac에 Homebrew가 있어야 함)
brew install git
```

또는 [Git 공식 사이트](https://git-scm.com/download/mac)에서 설치.
