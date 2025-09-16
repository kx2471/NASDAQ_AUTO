"""
포트폴리오 성과 추적 및 목표 분석 서비스
1년 1000만원 목표 달성을 위한 성과 모니터링
"""

from datetime import datetime, date
from typing import List, Optional, Dict
from pydantic import BaseModel

from nasdaq_auto.models.portfolio import Holding


class PerformanceData(BaseModel):
    """포트폴리오 성과 데이터"""
    date: str
    total_investment_krw: int
    current_value_krw: int
    total_return_krw: int
    total_return_percent: float
    # 초기 자금 기준 수익률 (220만원 기준)
    initial_capital_krw: int
    total_return_from_initial_krw: int
    total_return_from_initial_percent: float
    daily_return_krw: int
    daily_return_percent: float
    target_progress: float  # 1000만원 목표 대비 진행률
    days_to_target: Optional[int] = None  # 현재 수익률 유지 시 목표 달성까지 일수


class TargetAnalysis(BaseModel):
    """목표 달성 분석"""
    target_amount_krw: int
    current_amount_krw: int
    remaining_amount_krw: int
    progress_percent: float
    required_return_percent: float  # 목표 달성을 위해 필요한 총 수익률
    current_return_percent: float
    is_on_track: bool
    monthly_target_krw: int  # 월별 목표 증가액
    days_since_start: int


def calculate_performance(
    holdings: List[Holding],
    current_prices: Dict[str, float],
    exchange_rate: float,
    previous_value: Optional[float] = None,
    initial_capital_krw: int = 2200000  # 초기 자금 220만원
) -> PerformanceData:
    """현재 포트폴리오 성과 계산"""

    current_date = datetime.now().strftime("%Y-%m-%d")

    # 총 투자금 계산 (USD) - 실제 투자에 사용된 금액
    total_investment_usd = sum(
        holding.shares * holding.avg_cost for holding in holdings
    )

    # 현재 평가액 계산 (USD)
    current_value_usd = sum(
        holding.shares * current_prices.get(holding.symbol, holding.avg_cost)
        for holding in holdings
    )

    # KRW 변환
    total_investment_krw = total_investment_usd * exchange_rate
    current_value_krw = current_value_usd * exchange_rate

    # 수익 계산 (투자원금 기준)
    total_return_krw = current_value_krw - total_investment_krw
    total_return_percent = (total_return_krw / total_investment_krw) * 100 if total_investment_krw > 0 else 0

    # 초기 자금 기준 전체 수익률 계산
    total_return_from_initial_krw = current_value_krw - initial_capital_krw
    total_return_from_initial_percent = (total_return_from_initial_krw / initial_capital_krw) * 100

    # 일일 수익 계산 (이전값이 있는 경우)
    daily_return_krw = current_value_krw - previous_value if previous_value else 0
    daily_return_percent = ((current_value_krw - previous_value) / previous_value) * 100 if previous_value else 0

    # 1000만원 목표 대비 진행률
    target_progress = (current_value_krw / 10000000) * 100

    return PerformanceData(
        date=current_date,
        total_investment_krw=round(total_investment_krw),
        current_value_krw=round(current_value_krw),
        total_return_krw=round(total_return_krw),
        total_return_percent=round(total_return_percent, 2),
        # 초기 자금 기준 수익률
        initial_capital_krw=initial_capital_krw,
        total_return_from_initial_krw=round(total_return_from_initial_krw),
        total_return_from_initial_percent=round(total_return_from_initial_percent, 2),
        daily_return_krw=round(daily_return_krw),
        daily_return_percent=round(daily_return_percent, 2),
        target_progress=round(target_progress, 2)
    )


def analyze_target_progress(
    current_performance: PerformanceData,
    start_date: str = "2025-09-10"
) -> TargetAnalysis:
    """1000만원 목표 달성 분석"""

    target_amount = 10000000  # 1000만원
    current_amount = current_performance.current_value_krw
    remaining_amount = target_amount - current_amount
    progress_percent = (current_amount / target_amount) * 100

    # 목표 달성을 위해 필요한 총 수익률
    required_total_return = (
        (target_amount - current_performance.total_investment_krw) /
        current_performance.total_investment_krw
    ) * 100 if current_performance.total_investment_krw > 0 else 0

    # 시작일부터 경과 일수
    start_date_obj = datetime.strptime(start_date, "%Y-%m-%d").date()
    current_date_obj = date.today()
    days_since_start = (current_date_obj - start_date_obj).days

    # 목표 달성 여부 판단 (현재 수익률 기준)
    is_on_track = current_performance.total_return_percent > 0 and progress_percent > 20  # 최소 20% 달성 기준

    # 월별 목표 증가액 (12개월 기준)
    monthly_target_increase = remaining_amount / 12

    return TargetAnalysis(
        target_amount_krw=target_amount,
        current_amount_krw=current_amount,
        remaining_amount_krw=remaining_amount,
        progress_percent=round(progress_percent, 2),
        required_return_percent=round(required_total_return, 2),
        current_return_percent=current_performance.total_return_percent,
        is_on_track=is_on_track,
        monthly_target_krw=round(monthly_target_increase),
        days_since_start=days_since_start
    )


def generate_performance_report(
    performance: PerformanceData,
    target_analysis: TargetAnalysis
) -> str:
    """성과 리포트 텍스트 생성"""
    progress_bar = '█' * int(target_analysis.progress_percent // 5) + \
                   '░' * (20 - int(target_analysis.progress_percent // 5))

    return f"""
## 🎯 1000만원 목표 진행 현황

**현재 포트폴리오**
- 투자원금: ₩{performance.total_investment_krw:,}
- 현재가치: ₩{performance.current_value_krw:,}
- 총 수익: {'+" if performance.total_return_krw >= 0 else ""}₩{performance.total_return_krw:,} ({"+" if performance.total_return_percent >= 0 else ""}{performance.total_return_percent}%)

**목표 달성률**
[{progress_bar}] {target_analysis.progress_percent}%
- 목표 금액: ₩10,000,000
- 남은 금액: ₩{target_analysis.remaining_amount_krw:,}
- 필요 수익률: {target_analysis.required_return_percent}%
- 현재 수익률: {target_analysis.current_return_percent}%

**진행 상태**
- {'✅ 목표 달성 가능' if target_analysis.is_on_track else '⚠️ 전략 재검토 필요'}
- 시작 후 {target_analysis.days_since_start}일 경과
- 월평균 목표: ₩{target_analysis.monthly_target_krw:,} 증가
{f'- 오늘 수익: {"+" if performance.daily_return_krw >= 0 else ""}₩{performance.daily_return_krw:,} ({"+" if performance.daily_return_percent >= 0 else ""}{performance.daily_return_percent}%)' if performance.daily_return_krw != 0 else ''}
""".strip()


async def save_performance_history(
    performance: PerformanceData,
    file_path: str = "data/json/performance_history.json"
) -> None:
    """성과 데이터를 JSON 파일에 저장"""
    import json
    import os
    from pathlib import Path

    try:
        # 기존 데이터 읽기
        history = []
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                history = json.load(f)

        # 같은 날짜 데이터가 있으면 업데이트, 없으면 추가
        existing_index = next(
            (i for i, h in enumerate(history) if h['date'] == performance.date),
            -1
        )

        performance_dict = performance.dict()
        if existing_index >= 0:
            history[existing_index] = performance_dict
        else:
            history.append(performance_dict)

        # 날짜순 정렬
        history.sort(key=lambda x: x['date'])

        # 파일 저장
        Path(file_path).parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, indent=2)

        print(f"💾 성과 데이터 저장 완료: {performance.date}")

    except Exception as error:
        print(f"❌ 성과 데이터 저장 실패: {error}")
        raise error