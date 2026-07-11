import fs from 'fs/promises';
import path from 'path';
import * as toss from '../services/toss';

// Supabase 서비스 (조건부 import)
let supabaseService: any = null;
if (process.env.ENABLE_SUPABASE_MIGRATION === 'true') {
  try {
    supabaseService = require('../services/supabase');
  } catch (error) {
    console.warn('⚠️ Supabase 서비스 로드 실패, JSON 모드로 대체:', error);
  }
}

/**
 * JSON 데이터베이스 관리 클래스
 * PostgreSQL 대신 JSON 파일로 데이터 저장
 */
export class JsonDatabase {
  private dataDir: string;

  constructor() {
    this.dataDir = path.join(process.cwd(), 'data', 'json');
  }

  /**
   * 데이터 디렉토리 초기화
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      console.log('✅ JSON 데이터베이스 초기화 완료');
    } catch (error) {
      console.error('❌ JSON 데이터베이스 초기화 실패:', error);
      throw error;
    }
  }

  /**
   * JSON 파일에서 데이터 읽기
   */
  async read<T>(filename: string): Promise<T[]> {
    try {
      const filePath = path.join(this.dataDir, `${filename}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data) as T[];
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // 파일이 없으면 빈 배열 반환
        return [];
      }
      console.error(`❌ ${filename} 읽기 실패:`, error);
      throw error;
    }
  }

  /**
   * JSON 파일에 데이터 쓰기
   */
  async write<T>(filename: string, data: T[]): Promise<void> {
    try {
      const filePath = path.join(this.dataDir, `${filename}.json`);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.error(`❌ ${filename} 쓰기 실패:`, error);
      throw error;
    }
  }

  /**
   * 데이터 추가 (INSERT)
   */
  async insert<T extends { id?: string | number; [key: string]: any }>(filename: string, item: T): Promise<T> {
    const data = await this.read<T>(filename);
    
    // ID 자동 생성 (숫자형)
    if (!item.id) {
      const maxId = data.length > 0 
        ? Math.max(...data.map(d => typeof d.id === 'number' ? d.id : 0)) 
        : 0;
      (item as any).id = maxId + 1;
    }

    data.push(item);
    await this.write(filename, data);
    return item;
  }

  /**
   * 데이터 업데이트 (UPSERT)
   */
  async upsert<T extends { [key: string]: any }>(
    filename: string, 
    item: T, 
    keyField: string = 'id'
  ): Promise<T> {
    const data = await this.read<T>(filename);
    const existingIndex = data.findIndex(d => d[keyField] === item[keyField]);

    if (existingIndex >= 0) {
      // 기존 데이터 업데이트
      data[existingIndex] = { ...data[existingIndex], ...item };
    } else {
      // 새 데이터 추가
      data.push(item);
    }

    await this.write(filename, data);
    return item;
  }

  /**
   * 데이터 조회 (WHERE 조건)
   */
  async find<T>(
    filename: string, 
    condition?: (item: T) => boolean
  ): Promise<T[]> {
    const data = await this.read<T>(filename);
    
    if (condition) {
      return data.filter(condition);
    }
    
    return data;
  }

  /**
   * 단일 데이터 조회
   */
  async findOne<T>(
    filename: string, 
    condition: (item: T) => boolean
  ): Promise<T | null> {
    const results = await this.find(filename, condition);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * 데이터 삭제
   */
  async delete<T>(
    filename: string, 
    condition: (item: T) => boolean
  ): Promise<number> {
    const data = await this.read<T>(filename);
    const initialLength = data.length;
    const filteredData = data.filter(item => !condition(item));
    
    await this.write(filename, filteredData);
    return initialLength - filteredData.length;
  }

  /**
   * 파일 존재 확인
   */
  async exists(filename: string): Promise<boolean> {
    try {
      const filePath = path.join(this.dataDir, `${filename}.json`);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

// 전역 데이터베이스 인스턴스
export const db = new JsonDatabase();

/**
 * 데이터베이스 연결 테스트
 */
export async function testConnection(): Promise<boolean> {
  try {
    await db.initialize();
    console.log('✅ JSON 데이터베이스 연결 성공');
    return true;
  } catch (error) {
    console.error('❌ JSON 데이터베이스 연결 실패:', error);
    return false;
  }
}

/**
 * 기본 데이터 구조 정의
 */
export interface Symbol {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  active: boolean;
}

export interface Sector {
  code: string;
  title: string;
}

export interface PriceDaily {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorDaily {
  symbol: string;
  date: string;
  ema_20?: number;
  ema_50?: number;
  rsi_14?: number;
}

export interface NewsItem {
  id: string;
  symbol?: string;
  sector_code?: string;
  published_at: string;
  source: string;
  title: string;
  url: string;
  summary: string;
  sentiment: number;
  relevance: number;
}

export interface Trade {
  id: number;
  traded_at: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  fee: number;
  note?: string;
}

export interface CashEvent {
  id: number;
  occurred_at: string;
  type: 'DEPOSIT' | 'WITHDRAW';
  amount: number;
  note?: string;
}

export interface Holding {
  symbol: string;
  shares: number;
  avg_cost: number;
  currency?: string; // 거래 통화 (토스 조회 시 채워짐, 예: 'USD'/'KRW'. 미지정=USD 가정)
}

export interface Report {
  id?: number;
  generated_at: string;
  type: 'UNIFIED' | 'SECTOR' | 'MANUAL';
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  ai_model?: string;
  symbols_analyzed: number;
  file_path?: string;
  summary?: string;
  error_message?: string;
  processing_time_ms?: number;
}

/**
 * 보유종목 조회 — 토스 실계좌 전용 (source of truth)
 * - 로컬 장부(JSON 재생) 폴백 제거: 낡은 잔고로 리포트/매매가 진행되는 것을 막기 위해
 *   토스 조회 실패 시 조용히 대체하지 않고 명시적으로 실패한다.
 */
export async function getHoldings(): Promise<Holding[]> {
  if (!toss.isTossEnabled()) {
    throw new Error('토스 API 미설정 (TOSS_API_KEY/TOSS_SECRET_KEY 필요) — 보유종목은 토스 실계좌에서만 조회합니다.');
  }

  const tossHoldings = await toss.getHoldings();
  // TossHolding → 시스템 표준 Holding 매핑 (통화 보존 — KRW 종목을 USD로 오해하지 않도록)
  const nonUsd = tossHoldings.filter(h => h.currency !== 'USD');
  if (nonUsd.length > 0) {
    console.warn(`⚠️ USD가 아닌 보유종목 ${nonUsd.length}개 감지 (${nonUsd.map(h => `${h.symbol}:${h.currency}`).join(', ')}) — 평가/매매 시 통화 확인 필요`);
  }
  return tossHoldings.map(h => ({
    symbol: h.symbol,
    shares: h.shares,
    avg_cost: h.avg_cost,
    currency: h.currency
  }));
}

/**
 * 현금 잔액(매수 가능 USD) 조회 — 토스 실계좌 전용 (source of truth)
 * - cash_events.json 재생 폴백 제거: 잔고는 항상 토스 실시간 값만 사용한다.
 */
export async function getCashBalance(): Promise<number> {
  if (!toss.isTossEnabled()) {
    throw new Error('토스 API 미설정 (TOSS_API_KEY/TOSS_SECRET_KEY 필요) — 현금 잔고는 토스 실계좌에서만 조회합니다.');
  }
  return await toss.getBuyingPower('USD');
}

/**
 * 리포트 기록 저장 (JSON 또는 Supabase)
 */
export async function saveReportRecord(report: Omit<Report, 'id'>): Promise<Report> {
  // Supabase 사용 시
  if (supabaseService) {
    try {
      return await supabaseService.addReportRecord(report);
    } catch (error) {
      console.warn('⚠️ Supabase에서 리포트 기록 저장 실패, JSON으로 대체:', error);
    }
  }

  // JSON 파일 사용 (기본값 또는 fallback)
  return await db.insert<Report>('reports', report as Report);
}

/**
 * 리포트 기록 조회 (JSON 또는 Supabase)
 */
export async function getRecentReports(limit: number = 10): Promise<Report[]> {
  // Supabase 사용 시
  if (supabaseService) {
    try {
      return await supabaseService.getRecentReports(limit);
    } catch (error) {
      console.warn('⚠️ Supabase에서 리포트 기록 조회 실패, JSON으로 대체:', error);
    }
  }

  // JSON 파일 사용 (기본값 또는 fallback)
  const reports = await db.find<Report>('reports');
  return reports
    .sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime())
    .slice(0, limit);
}