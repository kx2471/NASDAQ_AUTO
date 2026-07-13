/**
 * 포트폴리오 성과 추적 및 목표 분석 서비스
 * 목표 금액(TARGET_AMOUNT_KRW) 달성을 위한 성과 모니터링
 */

/**
 * 목표 금액(KRW) 조회 — TARGET_AMOUNT_KRW 환경변수 ($8,000 기준으로 설정됨)
 * @returns 목표 금액 (원)
 */
function getTargetAmountKrw(): number {
  return parseFloat(process.env.TARGET_AMOUNT_KRW || '') || 11950000;
}

export interface PerformanceData {
  date: string;
  total_investment_krw: number;
  current_value_krw: number;
  total_return_krw: number;
  total_return_percent: number;
  // 초기 자금 기준 수익률 (INITIAL_CAPITAL_KRW 환경변수 기준)
  initial_capital_krw: number;
  total_return_from_initial_krw: number;
  total_return_from_initial_percent: number;
  daily_return_krw: number;
  daily_return_percent: number;
  target_progress: number; // 목표 금액 대비 진행률
  days_to_target?: number; // 현재 수익률 유지 시 목표 달성까지 일수
}

export interface TargetAnalysis {
  target_amount_krw: number;
  current_amount_krw: number;
  remaining_amount_krw: number;
  progress_percent: number;
  required_return_percent: number; // 목표 달성을 위해 필요한 총 수익률
  current_return_percent: number;
  is_on_track: boolean;
  monthly_target_krw: number; // 월별 목표 증가액
  days_since_start: number;
}

/**
 * 현재 포트폴리오 성과 계산
 */
export function calculateCurrentPerformance(
  holdings: Array<{ symbol: string; shares: number; avg_cost: number; currency?: string }>,
  currentPrices: Record<string, number>,
  exchangeRate: number,
  previousValue?: number,
  // 초기 자금: 2026-07-11 기준점 리셋 시점의 총자산 (env로 조정 가능)
  initialCapitalKRW: number = parseFloat(process.env.INITIAL_CAPITAL_KRW || '') || 287208,
  // 현금(USD) — 총자산 평가에 포함 (초기자금이 현금 포함 총자산이므로 대칭 유지)
  cashUsd: number = 0
): PerformanceData {

  const currentDate = new Date().toISOString().split('T')[0];

  // 종목별 원화 환산: KRW 종목은 가격이 이미 원화이므로 환율을 곱하지 않는다
  // (미지정 시 USD 가정 — 토스 조회 시 currency가 채워짐)
  const toKrw = (holding: { shares: number; currency?: string }, price: number): number =>
    holding.currency === 'KRW' ? holding.shares * price : holding.shares * price * exchangeRate;

  // 총 투자금 (KRW)
  const totalInvestmentKRW = holdings.reduce((sum, holding) =>
    sum + toKrw(holding, holding.avg_cost), 0
  );

  // 현재 평가액 (KRW) = 보유종목 + 현금
  const currentValueKRW = holdings.reduce((sum, holding) => {
    const currentPrice = currentPrices[holding.symbol] || holding.avg_cost;
    return sum + toKrw(holding, currentPrice);
  }, 0) + cashUsd * exchangeRate;

  // 수익 계산 (투자원금 기준, 원금 0이면 0%)
  const totalReturnKRW = currentValueKRW - totalInvestmentKRW;
  const totalReturnPercent = totalInvestmentKRW > 0 ? (totalReturnKRW / totalInvestmentKRW) * 100 : 0;

  // 초기 자금 기준 전체 수익률 계산
  const totalReturnFromInitialKRW = currentValueKRW - initialCapitalKRW;
  const totalReturnFromInitialPercent = (totalReturnFromInitialKRW / initialCapitalKRW) * 100;

  // 일일 수익 계산 (이전값이 있는 경우)
  const dailyReturnKRW = previousValue ? currentValueKRW - previousValue : 0;
  const dailyReturnPercent = previousValue ?
    ((currentValueKRW - previousValue) / previousValue) * 100 : 0;

  // 목표 대비 진행률 (TARGET_AMOUNT_KRW — $8,000 기준, 미설정 시 기본값)
  const targetProgress = (currentValueKRW / getTargetAmountKrw()) * 100;
  
  return {
    date: currentDate,
    total_investment_krw: Math.round(totalInvestmentKRW),
    current_value_krw: Math.round(currentValueKRW),
    total_return_krw: Math.round(totalReturnKRW),
    total_return_percent: Math.round(totalReturnPercent * 100) / 100,
    // 초기 자금 기준 수익률
    initial_capital_krw: initialCapitalKRW,
    total_return_from_initial_krw: Math.round(totalReturnFromInitialKRW),
    total_return_from_initial_percent: Math.round(totalReturnFromInitialPercent * 100) / 100,
    daily_return_krw: Math.round(dailyReturnKRW),
    daily_return_percent: Math.round(dailyReturnPercent * 100) / 100,
    target_progress: Math.round(targetProgress * 100) / 100
  };
}

/**
 * 목표 금액 달성 분석 ($8,000 — TARGET_AMOUNT_KRW)
 */
export function analyzeTargetProgress(
  currentPerformance: PerformanceData,
  startDate: string = process.env.INVEST_START_DATE || '2026-07-11' // 기준점 리셋일
): TargetAnalysis {
  
  const targetAmount = getTargetAmountKrw(); // 목표 금액 (env)
  const currentAmount = currentPerformance.current_value_krw;
  const remainingAmount = targetAmount - currentAmount;
  const progressPercent = (currentAmount / targetAmount) * 100;
  
  // 목표 달성을 위해 필요한 총 수익률
  const requiredTotalReturn = ((targetAmount - currentPerformance.total_investment_krw) / 
    currentPerformance.total_investment_krw) * 100;
  
  // 시작일부터 경과 일수
  const startDateObj = new Date(startDate);
  const currentDateObj = new Date();
  const daysSinceStart = Math.floor((currentDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24));
  
  // 목표 달성 여부 판단 (현재 수익률 기준)
  const isOnTrack = currentPerformance.total_return_percent > 0 && progressPercent > 20; // 최소 20% 달성 기준
  
  // 월별 목표 증가액 (12개월 기준)
  const monthlyTargetIncrease = remainingAmount / 12;
  
  return {
    target_amount_krw: targetAmount,
    current_amount_krw: currentAmount,
    remaining_amount_krw: remainingAmount,
    progress_percent: Math.round(progressPercent * 100) / 100,
    required_return_percent: Math.round(requiredTotalReturn * 100) / 100,
    current_return_percent: currentPerformance.total_return_percent,
    is_on_track: isOnTrack,
    monthly_target_krw: Math.round(monthlyTargetIncrease),
    days_since_start: daysSinceStart
  };
}

/**
 * 성과 데이터를 JSON 파일에 저장
 */
export async function savePerformanceHistory(
  performance: PerformanceData,
  filePath: string = 'data/json/performance_history.json'
): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    // 기존 데이터 읽기
    let history: PerformanceData[] = [];
    try {
      const existingData = await fs.readFile(filePath, 'utf-8');
      history = JSON.parse(existingData);
    } catch {
      // 파일이 없으면 빈 배열로 시작
    }
    
    // 같은 날짜 데이터가 있으면 업데이트, 없으면 추가
    const existingIndex = history.findIndex(h => h.date === performance.date);
    if (existingIndex >= 0) {
      history[existingIndex] = performance;
    } else {
      history.push(performance);
    }
    
    // 날짜순 정렬
    history.sort((a, b) => a.date.localeCompare(b.date));
    
    // 파일 저장
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
    
    console.log(`💾 성과 데이터 저장 완료: ${performance.date}`);
    
  } catch (error) {
    console.error('❌ 성과 데이터 저장 실패:', error);
    throw error;
  }
}

/**
 * 성과 리포트 텍스트 생성
 */
export function generatePerformanceReport(
  performance: PerformanceData,
  targetAnalysis: TargetAnalysis
): string {
  // 진행률을 0~100%로 클램프해 음수/초과 시 repeat()가 터지지 않도록 방어
  const filledCount = Math.max(0, Math.min(20, Math.floor(targetAnalysis.progress_percent / 5)));
  const progressBar = '█'.repeat(filledCount) + '░'.repeat(20 - filledCount);
  
  return `
## 🎯 목표 진행 현황

**현재 포트폴리오**
- 투자원금: ₩${performance.total_investment_krw.toLocaleString()}
- 현재가치: ₩${performance.current_value_krw.toLocaleString()}
- 총 수익: ${performance.total_return_krw >= 0 ? '+' : ''}₩${performance.total_return_krw.toLocaleString()} (${performance.total_return_percent >= 0 ? '+' : ''}${performance.total_return_percent}%)

**목표 달성률**
[${progressBar}] ${targetAnalysis.progress_percent}%
- 목표 금액: ₩${targetAnalysis.target_amount_krw.toLocaleString()}
- 남은 금액: ₩${targetAnalysis.remaining_amount_krw.toLocaleString()}
- 필요 수익률: ${targetAnalysis.required_return_percent}%
- 현재 수익률: ${targetAnalysis.current_return_percent}%

**진행 상태**
- ${targetAnalysis.is_on_track ? '✅ 목표 달성 가능' : '⚠️ 전략 재검토 필요'}
- 시작 후 ${targetAnalysis.days_since_start}일 경과
- 월평균 목표: ₩${targetAnalysis.monthly_target_krw.toLocaleString()} 증가
${performance.daily_return_krw !== 0 ? `- 오늘 수익: ${performance.daily_return_krw >= 0 ? '+' : ''}₩${performance.daily_return_krw.toLocaleString()} (${performance.daily_return_percent >= 0 ? '+' : ''}${performance.daily_return_percent}%)` : ''}
`.trim();
}