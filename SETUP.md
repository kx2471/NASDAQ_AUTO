# 프로젝트 초기 설정 가이드

## 1. 저장소 클론 후 설정

```bash
git clone https://github.com/kx2471/NASDAQ_AUTO.git
cd NASDAQ_AUTO
npm install
```

## 2. 데이터 파일 초기화

main 브랜치에는 개인 거래 데이터가 포함되지 않습니다. 초기 설정을 위해 템플릿 파일들을 복사하세요:

```bash
# 거래 내역 파일 생성
cp data/json/trades.json.template data/json/trades.json

# 현금 입출금 내역 파일 생성
cp data/json/cash_events.json.template data/json/cash_events.json
```

## 3. 환경 변수 설정

`.env` 파일을 생성하고 다음 내용을 추가하세요:

```env
# LLM API Keys
OPENAI_API_KEY=your-openai-api-key
GEMINI_API_KEY=your-gemini-api-key
CLAUDE_API_KEY=your-claude-api-key

# Email
RESEND_API_KEY=your-resend-api-key
MAIL_TO=your-email@gmail.com

# Database (optional)
ENABLE_SUPABASE_MIGRATION=false
```

## 4. 첫 실행

```bash
# 개발 서버 시작
npm run dev

# 또는 매매 입력기 실행
node tools/interactive-trade.js
```

## 주의사항

- `data/json/` 폴더의 실제 거래 데이터는 `.gitignore`에 의해 main 브랜치에서 제외됩니다
- 개발은 `dev` 브랜치에서 진행하세요
- 코드 변경사항만 main 브랜치에 머지됩니다