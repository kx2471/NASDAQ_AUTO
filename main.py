"""
Python Nasdaq AutoTrader 메인 실행 파일
FastAPI 서버 및 스케줄러 통합 실행
"""

import asyncio
import logging
import uvicorn
from contextlib import asynccontextmanager

from nasdaq_auto.api.main import app
from nasdaq_auto.scheduler.weekly_job import start_weekly_scheduler
from nasdaq_auto.core.config import get_settings

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('logs/nasdaq_autotrader.log', encoding='utf-8')
    ]
)

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app):
    """애플리케이션 생명주기 관리"""
    logger.info("🚀 Nasdaq AutoTrader 시작")

    # 백그라운드에서 주간 스케줄러 시작
    if settings.environment == "production":
        scheduler_task = asyncio.create_task(start_weekly_scheduler())
        logger.info("📅 주간 스케줄러 백그라운드 실행 시작")
    else:
        logger.info("🧪 개발 환경: 스케줄러 비활성화")
        scheduler_task = None

    yield

    # 정리 작업
    if scheduler_task:
        scheduler_task.cancel()
        try:
            await scheduler_task
        except asyncio.CancelledError:
            pass

    logger.info("🛑 Nasdaq AutoTrader 종료")


# FastAPI 앱에 생명주기 이벤트 추가
app.router.lifespan_context = lifespan


async def main():
    """메인 실행 함수"""
    logger.info(f"🌟 {settings.app_name} v{settings.version} 시작")
    logger.info(f"🔧 환경: {settings.environment}")

    # 개발 환경에서 서버 실행
    if settings.environment == "development":
        config = uvicorn.Config(
            app,
            host="0.0.0.0",
            port=8000,
            reload=True,
            log_level="info"
        )
        server = uvicorn.Server(config)
        await server.serve()
    else:
        # 프로덕션 환경
        logger.info("🚀 프로덕션 모드로 실행")
        config = uvicorn.Config(
            app,
            host="0.0.0.0",
            port=8000,
            log_level="info"
        )
        server = uvicorn.Server(config)
        await server.serve()


if __name__ == "__main__":
    # 로그 디렉토리 생성
    import os
    os.makedirs("logs", exist_ok=True)

    # 메인 함수 실행
    asyncio.run(main())