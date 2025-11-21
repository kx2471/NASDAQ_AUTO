/**
 * 스크리닝 시스템 실시간 데이터 테스트
 *
 * 사용법:
 *   node tools/test-screening.js
 *
 * 기능:
 *   - 실시간 시장 데이터로 종목 스크리닝
 *   - 모멘텀, 뉴스 감성, 기술지표 분석
 *   - 추천 종목 상위 5개 출력
 */

require('dotenv').config();

async function main() {
  console.log('🔍 실시간 스크리닝 시스템 테스트\n');

  try {
    const { DynamicStockScreener } = require('../dist/services/screening');
    const screener = new DynamicStockScreener();

    console.log('📊 스크리닝 시작...\n');

    // 테스트할 섹터 설정 (청정에너지 섹터)
    const sectorConfig = {
      code: 'CLEAN_ENERGY',
      title: 'Clean Energy',
      keywords: ['solar', 'renewable', 'clean energy'],
      max_symbols: 10,
      refresh_interval: 7
    };

    // 스크리닝 실행
    const recommendations = await screener.screenSector('CLEAN_ENERGY', sectorConfig);

    console.log('\n✅ 스크리닝 완료!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 추천 종목 리스트\n');

    for (let i = 0; i < recommendations.length; i++) {
      const rec = recommendations[i];
      console.log(`${i + 1}. ${rec.symbol} (${rec.name}) - ${rec.recommendation}`);
      console.log(`   종합 점수: ${(rec.overall_score * 100).toFixed(1)}%`);
      console.log(`   모멘텀: ${(rec.momentum_score * 100).toFixed(1)}%, 뉴스: ${(rec.news_sentiment * 100).toFixed(1)}%, 기술: ${(rec.technical_score * 100).toFixed(1)}%`);
      console.log(`   이유: ${rec.reason}`);
      if (rec.current_price) console.log(`   현재가: $${rec.current_price.toFixed(2)}`);
      console.log();
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 결과 요약
    const buyCount = recommendations.filter(r => r.recommendation === 'BUY').length;
    const holdCount = recommendations.filter(r => r.recommendation === 'HOLD').length;
    const sellCount = recommendations.filter(r => r.recommendation === 'SELL').length;

    console.log('\n📊 추천 분포:');
    console.log(`   BUY:  ${buyCount}개`);
    console.log(`   HOLD: ${holdCount}개`);
    console.log(`   SELL: ${sellCount}개`);

    // 데이터 소스 확인
    console.log('\n💡 데이터 소스:');
    console.log('   ✅ 가격 데이터: Yahoo Finance + Alpaca 실시간');
    console.log('   ✅ 뉴스 데이터: Alpha Vantage + NewsAPI 실시간');
    console.log('   ✅ 기술지표: 실시간 계산 (EMA20/50, RSI14)');

  } catch (error) {
    console.error('\n❌ 스크리닝 테스트 실패:', error.message);
    console.error('상세 오류:', error);
    process.exit(1);
  }
}

main().catch(console.error);
