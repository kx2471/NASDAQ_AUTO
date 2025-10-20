import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { auth } from '../src/server/middleware/auth';
import tradesRoutes from '../src/server/routes/trades';
import cashRoutes from '../src/server/routes/cash';
import dashboardRoutes from '../src/server/routes/dashboard';
import databaseRoutes from '../src/server/routes/database';
import databaseViewerRoutes from '../src/server/routes/database-viewer';

// 환경 변수 로드
dotenv.config();

const app = express();

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 대시보드는 인증 없이 접근 가능
app.use('/dashboard', dashboardRoutes);
app.use('/database-viewer', databaseViewerRoutes);

// 인증 미들웨어 적용 (API 전용)
app.use('/v1', auth);

// 라우트 설정
app.use('/v1/trades', tradesRoutes);
app.use('/v1/cash', cashRoutes);
app.use('/v1/database', databaseRoutes);

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
 * 루트 엔드포인트
 */
app.get('/', (req, res) => {
  res.json({
    message: 'Nasdaq AutoTrader API',
    endpoints: {
      dashboard: '/dashboard',
      health: '/v1/health',
      trades: '/v1/trades',
      cash: '/v1/cash',
      database: '/v1/database'
    }
  });
});

// 에러 핸들링 미들웨어
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('서버 오류:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Vercel serverless functions를 위한 export
export default app;
