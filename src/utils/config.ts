import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';

/**
 * 섹터 설정 인터페이스
 */
export interface SectorConfig {
  title: string;
  description: string;
  keywords: string[];
  industries: string[];
  market_cap_min: number;
  max_symbols: number;
}

/**
 * 섹터 설정 로드
 * config/sectors.yml 파일에서 섹터별 키워드 및 설정을 읽어옴
 */
export async function loadSectors(): Promise<Record<string, SectorConfig>> {
  try {
    const sectorsPath = path.join(process.cwd(), 'config', 'sectors.yml');
    const sectorsContent = await fs.readFile(sectorsPath, 'utf8');
    const sectors = yaml.parse(sectorsContent);
    
    console.log(`✅ 섹터 설정 로드 완료: ${Object.keys(sectors).length}개 섹터`);
    
    // 유효성 검증
    for (const [code, config] of Object.entries(sectors)) {
      const sectorConfig = config as SectorConfig;
      if (!sectorConfig.title || !Array.isArray(sectorConfig.keywords)) {
        throw new Error(`잘못된 섹터 설정: ${code}`);
      }
      if (sectorConfig.keywords.length === 0) {
        console.warn(`⚠️ 섹터 ${code}에 키워드가 없습니다`);
      }
      if (!sectorConfig.industries || sectorConfig.industries.length === 0) {
        console.warn(`⚠️ 섹터 ${code}에 업종 설정이 없습니다`);
      }
    }
    
    return sectors;
    
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      console.warn('⚠️ sectors.yml 파일을 찾을 수 없습니다. 기본 설정을 사용합니다.');
      return getDefaultSectors();
    }
    
    console.error('❌ 섹터 설정 로드 실패:', error);
    throw error;
  }
}

/**
 * 기본 섹터 설정 반환
 */
function getDefaultSectors(): Record<string, SectorConfig> {
  return {
    ai: {
      title: 'AI & Machine Learning',
      description: '인공지능, 머신러닝, AI 칩 관련 기업',
      keywords: ['artificial intelligence', 'machine learning', 'AI chip', 'GPU', 'neural network', 'deep learning'],
      industries: ['Semiconductors', 'Software', 'Technology Hardware'],
      market_cap_min: 1000000000,
      max_symbols: 20
    },
    computing: {
      title: 'Cloud & Computing',
      description: '클라우드 컴퓨팅, 엔터프라이즈 소프트웨어',
      keywords: ['cloud computing', 'enterprise software', 'SaaS', 'data center', 'virtualization'],
      industries: ['Software', 'Technology Hardware', 'Internet Services'],
      market_cap_min: 1500000000,
      max_symbols: 15
    },
    nuclear: {
      title: 'Nuclear & Clean Energy',
      description: '원자력, 청정에너지, 재생에너지',
      keywords: ['nuclear power', 'clean energy', 'uranium', 'renewable energy', 'solar', 'wind'],
      industries: ['Utilities', 'Oil, Gas & Consumable Fuels', 'Alternative Energy'],
      market_cap_min: 500000000,
      max_symbols: 25
    },
    technology: {
      title: 'Technology & Innovation',
      description: '혁신 기술, 소프트웨어, 하드웨어 기업',
      keywords: ['technology', 'innovation', 'software', 'hardware', 'digital transformation', 'automation'],
      industries: ['Technology Hardware', 'Software', 'Electronics', 'Communications Equipment'],
      market_cap_min: 800000000,
      max_symbols: 18
    },
    aerospace: {
      title: 'Aerospace & Satellite',
      description: '항공우주, 위성, 우주 기술 기업',
      keywords: ['aerospace', 'satellite', 'space', 'aviation', 'rocket', 'orbital', 'launch'],
      industries: ['Aerospace & Defense', 'Industrial Machinery', 'Technology Hardware'],
      market_cap_min: 300000000,
      max_symbols: 20
    },
    defense: {
      title: 'Defense & Security',
      description: '국방, 보안, 사이버 보안 기업',
      keywords: ['defense', 'military', 'security', 'cybersecurity', 'surveillance', 'weapons'],
      industries: ['Aerospace & Defense', 'Security Services', 'Software'],
      market_cap_min: 600000000,
      max_symbols: 15
    }
  };
}

/**
 * 데이터 공급자 설정 인터페이스
 */
export interface ProviderConfig {
  enabled: boolean;
  priority: number;
  rate_limit?: {
    calls_per_minute?: number;
    calls_per_day?: number;
  };
  options?: Record<string, any>;
}

/**
 * 데이터 공급자 설정 로드
 */
export async function loadProviders(): Promise<Record<string, ProviderConfig>> {
  try {
    const providersPath = path.join(process.cwd(), 'config', 'providers.yml');
    const providersContent = await fs.readFile(providersPath, 'utf8');
    const providers = yaml.parse(providersContent);
    
    console.log(`✅ 공급자 설정 로드 완료: ${Object.keys(providers).length}개 공급자`);
    return providers;
    
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      console.warn('⚠️ providers.yml 파일을 찾을 수 없습니다. 기본 설정을 사용합니다.');
      return getDefaultProviders();
    }
    
    console.error('❌ 공급자 설정 로드 실패:', error);
    throw error;
  }
}

/**
 * 기본 공급자 설정 반환
 */
function getDefaultProviders(): Record<string, ProviderConfig> {
  return {
    alphavantage: {
      enabled: true,
      priority: 1,
      rate_limit: {
        calls_per_minute: 5,
        calls_per_day: 500
      },
      options: {
        timeout: 10000
      }
    },
    finnhub: {
      enabled: false,
      priority: 2,
      rate_limit: {
        calls_per_minute: 60,
        calls_per_day: 1000
      }
    },
    newsapi: {
      enabled: true,
      priority: 1,
      rate_limit: {
        calls_per_minute: 20,
        calls_per_day: 1000
      }
    }
  };
}

/**
 * 환경변수 기반 설정 검증
 */
export function validateConfig(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // 필수 환경변수 확인
  const requiredEnvVars = [
    'DATABASE_URL',
    'API_KEY'
  ];
  
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      errors.push(`필수 환경변수가 설정되지 않음: ${envVar}`);
    }
  }
  
  // LLM 설정 확인
  const llmProvider = process.env.LLM_PROVIDER || 'OPENAI';
  if (llmProvider === 'OPENAI' && !process.env.OPENAI_API_KEY) {
    errors.push('OPENAI_API_KEY가 설정되지 않음');
  }
  
  // 메일 설정 확인
  const mailProvider = process.env.MAIL_PROVIDER || 'RESEND';
  if (mailProvider === 'RESEND' && !process.env.RESEND_API_KEY) {
    errors.push('RESEND_API_KEY가 설정되지 않음');
  } else if (mailProvider === 'SMTP') {
    const smtpRequiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
    for (const envVar of smtpRequiredVars) {
      if (!process.env[envVar]) {
        errors.push(`SMTP 설정 누락: ${envVar}`);
      }
    }
  }
  
  // 데이터 공급자 확인
  if (!process.env.ALPHAVANTAGE_API_KEY && !process.env.FINNHUB_API_KEY) {
    errors.push('최소 하나의 데이터 공급자 API 키가 필요함 (ALPHAVANTAGE_API_KEY 또는 FINNHUB_API_KEY)');
  }
  
  if (errors.length === 0) {
    console.log('✅ 설정 검증 완료');
  } else {
    console.error('❌ 설정 검증 실패:');
    errors.forEach(error => console.error(`  - ${error}`));
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * 설정 요약 출력
 */
export function printConfigSummary(): void {
  console.log('\n📋 현재 설정 요약:');
  console.log(`  - NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  - PORT: ${process.env.PORT || 8080}`);
  console.log(`  - LLM Provider: ${process.env.LLM_PROVIDER || 'OPENAI'}`);
  console.log(`  - LLM Model: ${process.env.LLM_MODEL || 'gpt-4'}`);
  console.log(`  - Mail Provider: ${process.env.MAIL_PROVIDER || 'RESEND'}`);
  console.log(`  - Mail To: ${process.env.MAIL_TO || '설정되지 않음'}`);
  console.log(`  - Lookback Days: ${process.env.REPORT_LOOKBACK_DAYS || 30}`);
  console.log(`  - Send Hour (KST): ${process.env.SEND_HOUR_LOCAL || 16}시`);
  
  // API 키 설정 여부 (민감정보는 표시하지 않음)
  console.log('\n🔑 API 키 설정 상태:');
  console.log(`  - DATABASE_URL: ${process.env.DATABASE_URL ? '✅ 설정됨' : '❌ 미설정'}`);
  console.log(`  - ALPHAVANTAGE_API_KEY: ${process.env.ALPHAVANTAGE_API_KEY ? '✅ 설정됨' : '❌ 미설정'}`);
  console.log(`  - FINNHUB_API_KEY: ${process.env.FINNHUB_API_KEY ? '✅ 설정됨' : '❌ 미설정'}`);
  console.log(`  - NEWSAPI_API_KEY: ${process.env.NEWSAPI_API_KEY ? '✅ 설정됨' : '❌ 미설정'}`);
  console.log(`  - OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✅ 설정됨' : '❌ 미설정'}`);
  console.log(`  - RESEND_API_KEY: ${process.env.RESEND_API_KEY ? '✅ 설정됨' : '❌ 미설정'}`);
  console.log('');
}