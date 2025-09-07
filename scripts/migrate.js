#!/usr/bin/env node

/**
 * JSON 데이터베이스 초기화 스크립트
 * 사용법: npm run migrate
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function migrate() {
  try {
    console.log('🔄 JSON 데이터베이스 초기화 시작...');

    // 데이터 디렉토리 생성
    const dataDir = path.join(__dirname, '..', 'data', 'json');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log('✅ 데이터 디렉토리 생성 완료');
    }

    // 초기 데이터 삽입
    await insertInitialData(dataDir);

    console.log('✅ JSON 데이터베이스 초기화 완료');

  } catch (error) {
    console.error('❌ 초기화 실패:', error);
    process.exit(1);
  }
}

/**
 * 초기 데이터 삽입
 */
async function insertInitialData(dataDir) {
  try {
    console.log('📊 초기 데이터 생성 중...');

    // 섹터 데이터
    const sectors = [
      { code: 'ai', title: 'AI' },
      { code: 'computing', title: 'Computing' },
      { code: 'nuclear', title: 'Nuclear' }
    ];
    writeJsonFile(dataDir, 'sectors', sectors);

    // 심볼 데이터
    const symbols = [
      // AI 섹터
      { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', sector: 'ai', industry: 'Semiconductors', active: true },
      { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', sector: 'ai', industry: 'Technology', active: true },
      { symbol: 'AMD', name: 'Advanced Micro Devices', exchange: 'NASDAQ', sector: 'ai', industry: 'Semiconductors', active: true },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NASDAQ', sector: 'ai', industry: 'Technology', active: true },
      { symbol: 'META', name: 'Meta Platforms Inc.', exchange: 'NASDAQ', sector: 'ai', industry: 'Technology', active: true },
      
      // Computing 섹터
      { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', sector: 'computing', industry: 'Technology', active: true },
      { symbol: 'AVGO', name: 'Broadcom Inc.', exchange: 'NASDAQ', sector: 'computing', industry: 'Semiconductors', active: true },
      { symbol: 'CRM', name: 'Salesforce Inc.', exchange: 'NASDAQ', sector: 'computing', industry: 'Software', active: true },
      { symbol: 'ORCL', name: 'Oracle Corporation', exchange: 'NASDAQ', sector: 'computing', industry: 'Software', active: true },
      { symbol: 'INTC', name: 'Intel Corporation', exchange: 'NASDAQ', sector: 'computing', industry: 'Semiconductors', active: true },
      
      // Nuclear 섹터
      { symbol: 'SMR', name: 'NuScale Power Corporation', exchange: 'NASDAQ', sector: 'nuclear', industry: 'Energy', active: true },
      { symbol: 'UEC', name: 'Uranium Energy Corp.', exchange: 'NASDAQ', sector: 'nuclear', industry: 'Energy', active: true },
      { symbol: 'CCJ', name: 'Cameco Corporation', exchange: 'NASDAQ', sector: 'nuclear', industry: 'Energy', active: true },
      { symbol: 'NRG', name: 'NRG Energy Inc.', exchange: 'NASDAQ', sector: 'nuclear', industry: 'Utilities', active: true },
      { symbol: 'BWXT', name: 'BWX Technologies Inc.', exchange: 'NASDAQ', sector: 'nuclear', industry: 'Energy', active: true }
    ];
    writeJsonFile(dataDir, 'symbols', symbols);

    // 빈 파일들 생성
    const emptyFiles = ['prices_daily', 'indicators_daily', 'news', 'trades'];
    for (const fileName of emptyFiles) {
      writeJsonFile(dataDir, fileName, []);
    }

    // 초기 현금 예치 (예시)
    const initialCashEvents = [
      {
        id: 1,
        occurred_at: new Date().toISOString(),
        type: 'DEPOSIT',
        amount: 50000,
        note: '초기 계정 입금'
      }
    ];
    writeJsonFile(dataDir, 'cash_events', initialCashEvents);

    console.log('✅ 초기 데이터 생성 완료');

  } catch (error) {
    console.error('❌ 초기 데이터 생성 실패:', error);
    throw error;
  }
}

/**
 * JSON 파일 쓰기 헬퍼
 */
function writeJsonFile(dataDir, fileName, data) {
  const filePath = path.join(dataDir, `${fileName}.json`);
  const jsonData = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, jsonData, 'utf8');
  console.log(`  ✓ ${fileName}.json 생성 완료 (${data.length}개 항목)`);
}

// 스크립트 실행
if (require.main === module) {
  migrate().catch(console.error);
}

module.exports = { migrate };