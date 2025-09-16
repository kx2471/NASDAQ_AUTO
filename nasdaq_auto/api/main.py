"""
FastAPI 메인 애플리케이션
포트폴리오 관리 및 AI 에이전트 서비스 제공
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import uvicorn
from pathlib import Path
from typing import Dict, Any
import logging

from nasdaq_auto.core.config import get_settings
from nasdaq_auto.services.storage.portfolio_storage import PortfolioStorage
from nasdaq_auto.services.storage.report_storage import ReportStorage
from nasdaq_auto.services.market.data_provider import MarketDataProvider
from nasdaq_auto.services.ai.agent_service import AgentService
from nasdaq_auto.models.portfolio import TradeInput, TradeType
from nasdaq_auto.models.reports import AgentReportResponse

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 설정 로드
settings = get_settings()

# FastAPI 앱 생성
app = FastAPI(
    title="Nasdaq AutoTrader",
    description="AI 기반 주식 자동 분석 및 리포트 시스템",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 프로덕션에서는 특정 도메인만 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 서비스 인스턴스
portfolio_storage = PortfolioStorage()
report_storage = ReportStorage()
market_provider = MarketDataProvider()
agent_service = AgentService()

# 정적 파일 서빙 (나중에 프론트엔드 추가 시)
static_path = Path("static")
if static_path.exists():
    app.mount("/static", StaticFiles(directory="static"), name="static")


@app.on_event("startup")
async def startup_event():
    """애플리케이션 시작 시 초기화"""
    logger.info("🚀 Nasdaq AutoTrader API 시작")

    # 데이터 디렉토리 확인 및 생성
    portfolio_storage.ensure_data_directories()
    report_storage.ensure_data_directories()

    logger.info("✅ 초기화 완료")


@app.on_event("shutdown")
async def shutdown_event():
    """애플리케이션 종료 시 정리"""
    logger.info("🛑 Nasdaq AutoTrader API 종료")


@app.get("/", response_class=HTMLResponse)
async def root():
    """루트 엔드포인트 - 간단한 대시보드"""
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Nasdaq AutoTrader</title>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .container { max-width: 800px; margin: 0 auto; }
            .status { background: #f0f0f0; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .endpoint { background: #e8f4f8; padding: 10px; margin: 10px 0; border-radius: 4px; }
            a { color: #0066cc; text-decoration: none; }
            a:hover { text-decoration: underline; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🏆 Nasdaq AutoTrader</h1>
            <p>AI 기반 주식 자동 분석 및 리포트 시스템</p>

            <div class="status">
                <h3>📊 시스템 상태</h3>
                <p>✅ 서버 실행 중</p>
                <p>✅ API 엔드포인트 활성화</p>
            </div>

            <h3>🔗 주요 엔드포인트</h3>
            <div class="endpoint">
                <strong>GET <a href="/portfolio">/portfolio</a></strong> - 포트폴리오 현황
            </div>
            <div class="endpoint">
                <strong>GET <a href="/portfolio/performance">/portfolio/performance</a></strong> - 성과 분석
            </div>
            <div class="endpoint">
                <strong>GET <a href="/reports/latest">/reports/latest</a></strong> - 최신 리포트
            </div>
            <div class="endpoint">
                <strong>GET <a href="/market/prices?symbols=AAPL,GOOGL">/market/prices</a></strong> - 시장 데이터
            </div>

            <h3>📚 문서</h3>
            <div class="endpoint">
                <strong><a href="/docs">API 문서 (Swagger)</a></strong>
            </div>
            <div class="endpoint">
                <strong><a href="/redoc">API 문서 (ReDoc)</a></strong>
            </div>
        </div>
    </body>
    </html>
    """


@app.get("/health")
async def health_check():
    """헬스 체크 엔드포인트"""
    return {"status": "healthy", "service": "nasdaq-autotrader"}


# 포트폴리오 관련 엔드포인트
@app.get("/portfolio")
async def get_portfolio():
    """현재 포트폴리오 조회"""
    try:
        portfolio = portfolio_storage.get_current_portfolio()
        return {
            "success": True,
            "data": portfolio.dict()
        }
    except Exception as e:
        logger.error(f"포트폴리오 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/portfolio/performance")
async def get_portfolio_performance():
    """포트폴리오 성과 분석"""
    try:
        # 현재 포트폴리오 가져오기
        portfolio = portfolio_storage.get_current_portfolio()

        # 보유 종목의 현재가 가져오기
        if portfolio.holdings:
            symbols = [holding.symbol for holding in portfolio.holdings]
            current_prices = await market_provider.get_current_prices(symbols)
        else:
            current_prices = {}

        # 환율 정보 가져오기
        exchange_rate = await market_provider.get_exchange_rate()

        # 성과 계산
        from nasdaq_auto.services.performance import calculate_performance
        performance = calculate_performance(
            holdings=portfolio.holdings,
            current_prices=current_prices,
            exchange_rate=exchange_rate
        )

        return {
            "success": True,
            "data": performance.dict()
        }
    except Exception as e:
        logger.error(f"성과 분석 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/portfolio/trade")
async def add_trade(trade_input: TradeInput):
    """거래 추가"""
    try:
        # 거래 유효성 검증
        current_portfolio = portfolio_storage.get_current_portfolio()

        if trade_input.trade_type == TradeType.SELL:
            # 매도 시 보유 수량 확인
            holding = next(
                (h for h in current_portfolio.holdings if h.symbol == trade_input.symbol),
                None
            )
            if not holding or holding.shares < trade_input.shares:
                raise HTTPException(
                    status_code=400,
                    detail=f"보유 수량 부족: {trade_input.symbol} (보유: {holding.shares if holding else 0}, 매도 요청: {trade_input.shares})"
                )

        # 거래 기록 추가
        trade = portfolio_storage.add_trade(
            symbol=trade_input.symbol,
            trade_type=trade_input.trade_type,
            shares=trade_input.shares,
            price=trade_input.price,
            memo=trade_input.memo
        )

        return {
            "success": True,
            "data": trade.dict(),
            "message": f"거래 기록 완료: {trade_input.trade_type.value} {trade_input.symbol} {trade_input.shares}주"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"거래 추가 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/portfolio/cash")
async def update_cash(amount: float, memo: str = ""):
    """현금 업데이트 (입금/출금)"""
    try:
        cash_event = portfolio_storage.add_cash_event(amount, memo)
        return {
            "success": True,
            "data": cash_event.dict(),
            "message": f"현금 {'입금' if amount > 0 else '출금'} 완료: ${amount:,.2f}"
        }
    except Exception as e:
        logger.error(f"현금 업데이트 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 시장 데이터 관련 엔드포인트
@app.get("/market/prices")
async def get_market_prices(symbols: str):
    """주식 현재가 조회"""
    try:
        symbol_list = [s.strip().upper() for s in symbols.split(",")]
        prices = await market_provider.get_current_prices(symbol_list)

        return {
            "success": True,
            "data": prices
        }
    except Exception as e:
        logger.error(f"시장 데이터 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/market/exchange-rate")
async def get_exchange_rate():
    """환율 조회 (USD/KRW)"""
    try:
        rate = await market_provider.get_exchange_rate()
        return {
            "success": True,
            "data": {"usd_krw": rate}
        }
    except Exception as e:
        logger.error(f"환율 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# AI 에이전트 관련 엔드포인트
@app.post("/agents/generate-report")
async def generate_agent_report(
    background_tasks: BackgroundTasks,
    agent_name: str = "all"
):
    """AI 에이전트 리포트 생성"""
    try:
        if agent_name.lower() == "all":
            # 모든 에이전트 리포트 생성 (백그라운드 실행)
            background_tasks.add_task(agent_service.generate_all_reports)
            return {
                "success": True,
                "message": "모든 에이전트 리포트 생성 시작 (백그라운드 실행)"
            }
        else:
            # 특정 에이전트 리포트 생성
            report = await agent_service.generate_single_report(agent_name)
            return {
                "success": True,
                "data": report.dict(),
                "message": f"{agent_name} 리포트 생성 완료"
            }
    except Exception as e:
        logger.error(f"에이전트 리포트 생성 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/reports/latest")
async def get_latest_reports():
    """최신 리포트 조회"""
    try:
        reports = report_storage.get_latest_reports()
        return {
            "success": True,
            "data": {
                "agent_gpt": reports.get("gpt"),
                "agent_gemini": reports.get("gemini"),
                "agent_claude": reports.get("claude"),
                "manager": reports.get("manager")
            }
        }
    except Exception as e:
        logger.error(f"리포트 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/reports/{agent_name}")
async def get_agent_reports(agent_name: str, limit: int = 10):
    """특정 에이전트의 리포트 기록 조회"""
    try:
        reports = report_storage.get_agent_reports(agent_name, limit)
        return {
            "success": True,
            "data": reports
        }
    except Exception as e:
        logger.error(f"에이전트 리포트 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 시스템 관리 엔드포인트
@app.get("/system/status")
async def get_system_status():
    """시스템 상태 조회"""
    try:
        # 각 서비스 상태 확인
        status = {
            "portfolio_storage": "healthy",
            "market_provider": "healthy",
            "agent_service": "healthy",
            "report_storage": "healthy"
        }

        # API 키 설정 확인 (값은 노출하지 않음)
        api_keys = {
            "openai": bool(settings.openai_api_key),
            "gemini": bool(settings.gemini_api_key),
            "claude": bool(settings.claude_api_key),
            "resend": bool(settings.resend_api_key)
        }

        return {
            "success": True,
            "data": {
                "services": status,
                "api_keys_configured": api_keys,
                "environment": settings.environment
            }
        }
    except Exception as e:
        logger.error(f"시스템 상태 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    # 개발 서버 실행
    uvicorn.run(
        "nasdaq_auto.api.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )