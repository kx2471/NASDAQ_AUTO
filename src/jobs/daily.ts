import { isNasdaqOpen } from '../utils/marketday';
import { db, getHoldings, getCashBalance } from '../storage/database';
import { fetchDailyPrices, computeIndicators } from '../services/market';
import { fetchNews } from '../services/news';
import { generateReport } from '../services/llm';
import { sendReportEmail, wrapInEmailTemplate } from '../services/mail';
import { generateReportFile } from '../logic/report';
import { loadSectors } from '../utils/config';
import fs from 'fs/promises';
import path from 'path';

/**
 * 데일리 파이프라인 실행
 * 한국시간 16:00 (미국 시장 개장일에만)
 */
export async function runDaily(): Promise<void> {
  const today = new Date();
  
  console.log(`🚀 데일리 파이프라인 시작: ${today.toISOString()}`);

  try {
    // 1. 미국 시장 휴장일 확인
    if (!isNasdaqOpen(today)) {
      console.log('📅 미국 시장 휴장일입니다. 파이프라인을 건너뜁니다.');
      return;
    }

    // 2. 섹터 설정 로드
    const sectors = await loadSectors();
    console.log(`📋 ${Object.keys(sectors).length}개 섹터 로드됨`);

    // 각 섹터별로 처리
    for (const [sectorCode, sectorConfig] of Object.entries(sectors)) {
      console.log(`\n🔄 섹터 처리 시작: ${sectorConfig.title} (${sectorCode})`);
      
      try {
        await processSector(sectorCode, sectorConfig);
        console.log(`✅ 섹터 처리 완료: ${sectorConfig.title}`);
      } catch (error) {
        console.error(`❌ 섹터 처리 실패 (${sectorCode}):`, error);
        // 한 섹터가 실패해도 다른 섹터 계속 처리
      }

      // API 호출 제한을 위한 지연
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    console.log('🎉 데일리 파이프라인 완료');

  } catch (error) {
    console.error('❌ 데일리 파이프라인 실패:', error);
    throw error;
  }
}

/**
 * 개별 섹터 처리
 */
async function processSector(
  sectorCode: string, 
  sectorConfig: { title: string; symbols: string[] }
): Promise<void> {
  const { title: sectorTitle, symbols } = sectorConfig;
  
  try {
    // 3. 가격 데이터 수집
    console.log(`📈 가격 데이터 수집 중... (${symbols.length}개 종목)`);
    const pricesData = await fetchDailyPrices(symbols);

    // 4. 기술지표 계산
    console.log('📊 기술지표 계산 중...');
    const indicatorsData = await calculateIndicators(pricesData);

    // 5. 뉴스 수집
    console.log('📰 뉴스 수집 중...');
    const newsData = await fetchNews({
      symbols,
      sector: sectorCode,
      limit: 20,
      fromDate: getDateDaysAgo(7) // 최근 7일
    });

    // 6. 보유 현황 새로고침 (JSON에서는 실시간 계산)
    console.log('💰 포트폴리오 데이터 계산 중...');

    // 7. 보고서 생성을 위한 데이터 준비
    const reportPayload = await prepareReportPayload({
      sectorCode,
      sectorTitle,
      symbols,
      pricesData,
      indicatorsData,
      newsData
    });

    // 8. AI 보고서 생성
    console.log('🤖 AI 보고서 생성 중...');
    const report = await generateReport(reportPayload);

    // 9. 보고서 파일 저장
    console.log('💾 보고서 파일 저장 중...');
    const { mdPath, htmlPath } = await saveReportFiles(sectorCode, report);

    // 10. 이메일 발송
    console.log('📧 이메일 발송 중...');
    const emailHtml = wrapInEmailTemplate(
      report.replace(/\n/g, '<br>'), 
      `데일리 리포트 - ${sectorTitle} (${new Date().toLocaleDateString('ko-KR')})`
    );
    
    await sendReportEmail({
      subject: `📊 ${sectorTitle} 데일리 리포트 - ${new Date().toLocaleDateString('ko-KR')}`,
      html: emailHtml,
      mdPath: mdPath
    });

  } catch (error) {
    console.error(`❌ 섹터 ${sectorCode} 처리 중 오류:`, error);
    throw error;
  }
}

/**
 * 기술지표 계산 (모든 심볼)
 */
async function calculateIndicators(pricesData: Record<string, any[]>): Promise<Record<string, any>> {
  const indicators: Record<string, any> = {};

  for (const [symbol, prices] of Object.entries(pricesData)) {
    try {
      if (prices.length >= 50) {
        const closePrices = prices.map(p => p.close);
        const computed = computeIndicators(closePrices);
        
        indicators[symbol] = {
          close: closePrices[closePrices.length - 1],
          ...computed
        };
      } else {
        console.warn(`⚠️ ${symbol}: 기술지표 계산을 위한 데이터 부족 (${prices.length}일)`);
      }
    } catch (error) {
      console.error(`❌ ${symbol} 기술지표 계산 실패:`, error);
    }
  }

  return indicators;
}

/**
 * 보고서 생성을 위한 페이로드 준비
 */
async function prepareReportPayload(params: {
  sectorCode: string;
  sectorTitle: string;
  symbols: string[];
  pricesData: Record<string, any[]>;
  indicatorsData: Record<string, any>;
  newsData: any[];
}): Promise<any> {
  const { sectorCode, sectorTitle, symbols, indicatorsData, newsData } = params;

  // 실제 포트폴리오 데이터 조회
  const [holdings, cashBalance] = await Promise.all([
    getHoldings(),
    getCashBalance()
  ]);

  const portfolio = {
    cash_usd: cashBalance,
    holdings: holdings
  };

  // 심볼별 점수 계산 (간단한 버전)
  const scores: Record<string, number> = {};
  for (const symbol of symbols) {
    const indicator = indicatorsData[symbol];
    if (indicator) {
      let score = 0;
      
      // EMA 기반 모멘텀
      if (indicator.ema20 > indicator.ema50) score += 0.3;
      else score -= 0.3;
      
      // RSI 기반 점수
      if (indicator.rsi14 < 35) score += 0.2; // 과매도
      else if (indicator.rsi14 > 70) score -= 0.2; // 과매수
      
      // 뉴스 감성 점수
      const symbolNews = newsData.filter(n => n.symbol === symbol);
      if (symbolNews.length > 0) {
        const avgSentiment = symbolNews.reduce((sum, n) => sum + n.sentiment, 0) / symbolNews.length;
        score += avgSentiment * 0.3;
      }
      
      scores[symbol] = Math.max(0, Math.min(1, (score + 1) / 2)); // 0-1 범위로 정규화
    }
  }

  return {
    lookback_days: parseInt(process.env.REPORT_LOOKBACK_DAYS || '30'),
    portfolio,
    market: {
      date: new Date().toISOString().split('T')[0],
      sector_code: sectorCode,
      sector_title: sectorTitle
    },
    indicators: indicatorsData,
    news: newsData.slice(0, 10), // 상위 10개 뉴스
    scores
  };
}

/**
 * 보고서 파일 저장
 */
async function saveReportFiles(sectorCode: string, report: string): Promise<{mdPath: string, htmlPath: string}> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const reportDir = path.join(process.cwd(), 'data', 'report');
  
  // 디렉토리 생성
  await fs.mkdir(reportDir, { recursive: true });
  
  const mdPath = path.join(reportDir, `${today}_${sectorCode}.md`);
  const htmlPath = path.join(reportDir, `${today}_${sectorCode}.html`);
  
  // 마크다운 파일 저장
  await fs.writeFile(mdPath, report, 'utf8');
  
  // HTML 파일 저장 (간단한 변환)
  const html = wrapInEmailTemplate(
    report.replace(/\n/g, '<br>'),
    `데일리 리포트 - ${sectorCode} (${today})`
  );
  await fs.writeFile(htmlPath, html, 'utf8');
  
  return { mdPath, htmlPath };
}

/**
 * N일 전 날짜 문자열 반환
 */
function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}