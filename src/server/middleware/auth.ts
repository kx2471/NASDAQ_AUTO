import { Request, Response, NextFunction } from 'express';

/**
 * API 키 인증 미들웨어
 * x-api-key 헤더를 통해 API 접근을 제한
 */
export function auth(req: Request, res: Response, next: NextFunction): void {
  // 헬스체크 엔드포인트는 인증 제외
  if (req.path === '/v1/health') {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  const expectedApiKey = process.env.API_KEY;

  if (!expectedApiKey) {
    console.error('❌ API_KEY 환경변수가 설정되지 않았습니다');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  if (!apiKey || apiKey !== expectedApiKey) {
    res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    return;
  }

  next();
}