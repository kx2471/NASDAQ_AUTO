# 웹 기반 매매 입력 시스템

어디서나 trades.json 파일을 읽고 쓸 수 있는 웹 인터페이스입니다.

## 🚀 배포 방법

### 1. Vercel 배포 (추천)

```bash
# Vercel CLI 설치
npm install -g vercel

# 로그인
vercel login

# 배포
vercel --prod
```

배포 후 URL: `https://your-project.vercel.app`

### 2. 로컬 테스트

```bash
# Vercel Dev 서버 실행
vercel dev

# 또는 Node.js로 직접 실행
node test-api-local.js
```

## 🔑 GitHub Token 생성

1. https://github.com/settings/tokens 접속
2. "Generate new token (classic)" 클릭
3. 이름: `NASDAQ AutoTrader Web`
4. 권한 선택:
   - ✅ **repo** (Full control of private repositories)
5. "Generate token" 클릭
6. 생성된 토큰 복사 (한 번만 표시됨!)

**중요**: 토큰을 안전하게 보관하세요. 이 토큰으로 저장소에 접근할 수 있습니다.

## 📖 API 사용법

### 거래 목록 조회

```bash
curl -X GET https://your-project.vercel.app/api/trades \
  -H "Authorization: Bearer YOUR_GITHUB_TOKEN"
```

**응답 예시**:
```json
{
  "success": true,
  "count": 42,
  "trades": [
    {
      "id": 1,
      "traded_at": "2025-10-10T12:00:00.000Z",
      "symbol": "AAPL",
      "side": "BUY",
      "qty": 10,
      "price": 180.5,
      "fee": 0,
      "note": "매수 거래"
    }
  ]
}
```

### 새 거래 추가

```bash
curl -X POST https://your-project.vercel.app/api/trades \
  -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "side": "BUY",
    "qty": 10,
    "price": 180.5,
    "note": "추가 매수"
  }'
```

**응답 예시**:
```json
{
  "success": true,
  "trade": {
    "id": 43,
    "traded_at": "2025-10-10T12:05:00.000Z",
    "symbol": "AAPL",
    "side": "BUY",
    "qty": 10,
    "price": 180.5,
    "fee": 0,
    "note": "추가 매수"
  }
}
```

## 🌐 웹 UI 사용법

1. 배포된 URL 접속: `https://your-project.vercel.app`
2. GitHub Token 입력 (자동 저장됨)
3. 매매 정보 입력:
   - 종목 코드 (예: AAPL)
   - 매매 구분 (매수/매도)
   - 수량
   - 가격
   - 메모 (선택사항)
4. "거래 추가" 클릭
5. 최근 거래 내역 자동 표시

## 🔒 보안

- GitHub Token은 브라우저 로컬 스토리지에 저장됩니다
- 모든 API 요청은 HTTPS로 암호화됩니다
- Token 없이는 어떤 작업도 수행할 수 없습니다
- GitHub API를 직접 사용하므로 중간 서버에 데이터가 저장되지 않습니다

## 📱 모바일 사용

- 반응형 디자인으로 모바일에서도 사용 가능
- 홈 화면에 추가하여 앱처럼 사용 가능
- PWA 지원 (추후 업데이트 예정)

## 🛠️ 개발

### 프로젝트 구조

```
├── api/
│   └── trades.js          # Serverless API 함수
├── public/
│   └── index.html         # 웹 UI
├── vercel.json            # Vercel 설정
└── README_WEB.md          # 이 파일
```

### API 엔드포인트

- `GET /api/trades` - 전체 거래 내역 조회
- `POST /api/trades` - 새 거래 추가

### 환경 변수 (선택사항)

Vercel 대시보드에서 설정 가능:

- `GITHUB_TOKEN` - 기본 토큰 (웹 UI에서 입력 가능하므로 선택사항)

## 🐛 문제 해결

### "Authorization header required" 오류

- GitHub Token이 올바르게 입력되었는지 확인
- Token에 `repo` 권한이 있는지 확인

### "Failed to read trades" 오류

- 저장소 이름이 `NASDAQ_AUTO`인지 확인
- 브랜치가 `dev`인지 확인
- `data/json/trades.json` 파일이 존재하는지 확인

### 로컬 테스트 시 CORS 오류

- `vercel dev` 명령어로 실행하면 CORS 문제 없이 테스트 가능

## 📝 Todo

- [ ] PWA 지원 (오프라인 사용)
- [ ] 거래 내역 필터링 (날짜, 종목별)
- [ ] 포트폴리오 통계 대시보드
- [ ] 차트 연동
- [ ] Telegram Bot 연동

---

**현재 버전**: v1.0
**최종 업데이트**: 2025-10-10
