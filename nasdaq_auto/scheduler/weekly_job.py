"""
주간 스케줄링 작업
매주 월요일 오후 3시 자동 리포트 생성 및 이메일 발송
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional
import pytz

from nasdaq_auto.core.config import get_settings
from nasdaq_auto.services.ai.agent_service import AgentService
from nasdaq_auto.services.email.email_service import EmailService

logger = logging.getLogger(__name__)


class WeeklyReportJob:
    """주간 리포트 자동 생성 작업"""

    def __init__(self):
        self.settings = get_settings()
        self.agent_service = AgentService()
        self.email_service = EmailService()
        self.kst = pytz.timezone('Asia/Seoul')

    async def run_weekly_reports(self) -> bool:
        """주간 리포트 생성 및 이메일 발송"""
        logger.info("🚀 주간 리포트 자동 생성 시작")

        try:
            # 모든 에이전트 리포트 생성
            reports = await self.agent_service.generate_all_reports()

            # 성공한 리포트 확인
            successful_reports = [name for name, report in reports.items() if report is not None]
            failed_reports = [name for name, report in reports.items() if report is None]

            if failed_reports:
                logger.warning(f"⚠️ 일부 리포트 생성 실패: {failed_reports}")

            if successful_reports:
                logger.info(f"✅ 성공한 리포트: {successful_reports}")

                # Manager 리포트가 성공했다면 이메일 발송
                if "manager" in successful_reports:
                    manager_report = reports["manager"]
                    await self.email_service.send_weekly_report(
                        content=manager_report.content,
                        subject=f"📊 Nasdaq AutoTrader 주간 리포트 - {manager_report.created_at.strftime('%Y-%m-%d')}"
                    )
                    logger.info("📧 주간 리포트 이메일 발송 완료")

                return True
            else:
                logger.error("❌ 모든 리포트 생성 실패")
                return False

        except Exception as e:
            logger.error(f"❌ 주간 리포트 작업 실패: {e}")
            return False

    def get_next_monday_3pm(self) -> datetime:
        """다음 월요일 오후 3시 시간 계산"""
        now = datetime.now(self.kst)

        # 현재가 월요일이고 오후 3시 이전이면 오늘, 아니면 다음 월요일
        days_until_monday = (7 - now.weekday()) % 7
        if days_until_monday == 0 and now.hour < 15:
            # 오늘이 월요일이고 오후 3시 이전
            target_date = now.date()
        else:
            # 다음 월요일
            if days_until_monday == 0:
                days_until_monday = 7
            target_date = now.date() + timedelta(days=days_until_monday)

        # 오후 3시로 설정
        target_datetime = datetime.combine(target_date, datetime.min.time().replace(hour=15))
        return self.kst.localize(target_datetime)

    async def schedule_next_run(self):
        """다음 실행 시간까지 대기 후 실행"""
        next_run = self.get_next_monday_3pm()
        now = datetime.now(self.kst)

        wait_seconds = (next_run - now).total_seconds()

        logger.info(f"📅 다음 주간 리포트 예정: {next_run.strftime('%Y-%m-%d %H:%M:%S KST')}")
        logger.info(f"⏰ 대기 시간: {wait_seconds:.0f}초 ({wait_seconds/3600:.1f}시간)")

        if wait_seconds > 0:
            await asyncio.sleep(wait_seconds)

        # 리포트 실행
        await self.run_weekly_reports()

    async def start_scheduler(self):
        """스케줄러 시작 (무한 루프)"""
        logger.info("🔄 주간 리포트 스케줄러 시작")

        while True:
            try:
                await self.schedule_next_run()

                # 다음 주까지 대기 (7일)
                await asyncio.sleep(7 * 24 * 3600)

            except Exception as e:
                logger.error(f"❌ 스케줄러 오류: {e}")
                # 오류 시 1시간 후 재시도
                await asyncio.sleep(3600)


# 스케줄러 인스턴스
weekly_job = WeeklyReportJob()


async def run_manual_report():
    """수동으로 리포트 생성 (테스트용)"""
    return await weekly_job.run_weekly_reports()


async def start_weekly_scheduler():
    """주간 스케줄러 시작"""
    await weekly_job.start_scheduler()