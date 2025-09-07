import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { auth } from './middleware/auth';
import { runDaily } from '../jobs/daily';
import tradesRoutes from './routes/trades';
import cashRoutes from './routes/cash';

// 환경 변수 로드
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 인증 미들웨어 적용
app.use(auth);

// 라우트 설정
app.use('/v1/trades', tradesRoutes);
app.use('/v1/cash', cashRoutes);

/**
 * 헬스체크 엔드포인트
 * GET /v1/health
 */
app.get('/v1/health', (req, res) => {
  res.json({ 
    ok: true, 
    timestamp: new Date().toISOString(),
    service: 'Stock Report System'
  });
});

/**
 * 가격 데이터 수집 엔드포인트
 * POST /v1/ingest/prices
 */
app.post('/v1/ingest/prices', async (req, res) => {
  try {
    // TODO: 가격 데이터 수집 로직 구현
    console.log('📈 가격 데이터 수집 시작');
    
    res.json({ 
      success: true, 
      message: '가격 데이터 수집 완료' 
    });
  } catch (error) {
    console.error('❌ 가격 데이터 수집 실패:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 기술지표 계산 엔드포인트
 * POST /v1/ingest/indicators
 */
app.post('/v1/ingest/indicators', async (req, res) => {
  try {
    // TODO: 기술지표 계산 로직 구현
    console.log('📊 기술지표 계산 시작');
    
    res.json({ 
      success: true, 
      message: '기술지표 계산 완료' 
    });
  } catch (error) {
    console.error('❌ 기술지표 계산 실패:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 뉴스 수집 엔드포인트
 * POST /v1/ingest/news
 */
app.post('/v1/ingest/news', async (req, res) => {
  try {
    // TODO: 뉴스 수집 로직 구현
    console.log('📰 뉴스 수집 시작');
    
    res.json({ 
      success: true, 
      message: '뉴스 수집 완료' 
    });
  } catch (error) {
    console.error('❌ 뉴스 수집 실패:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 리포트 생성 엔드포인트
 * POST /v1/report/generate
 */
app.post('/v1/report/generate', async (req, res) => {
  try {
    // TODO: 리포트 생성 로직 구현
    console.log('📝 리포트 생성 시작');
    
    res.json({ 
      success: true, 
      message: '리포트 생성 완료' 
    });
  } catch (error) {
    console.error('❌ 리포트 생성 실패:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 리포트 이메일 발송 엔드포인트
 * POST /v1/report/send
 */
app.post('/v1/report/send', async (req, res) => {
  try {
    // TODO: 이메일 발송 로직 구현
    console.log('📧 이메일 발송 시작');
    
    res.json({ 
      success: true, 
      message: '이메일 발송 완료' 
    });
  } catch (error) {
    console.error('❌ 이메일 발송 실패:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 전체 데일리 파이프라인 실행 엔드포인트
 * POST /v1/run/daily
 */
app.post('/v1/run/daily', async (req, res) => {
  try {
    console.log('🚀 데일리 파이프라인 시작');
    await runDaily();
    
    res.json({ 
      success: true, 
      message: '데일리 파이프라인 실행 완료' 
    });
  } catch (error) {
    console.error('❌ 데일리 파이프라인 실패:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 에러 핸들링 미들웨어
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('서버 오류:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`🚀 Stock Report System 서버가 포트 ${PORT}에서 실행 중입니다`);
  console.log(`📊 API 문서: http://localhost:${PORT}/v1/health`);
});