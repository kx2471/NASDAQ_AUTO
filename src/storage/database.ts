import fs from 'fs/promises';
import path from 'path';

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
  async insert<T extends { id?: string | number }>(filename: string, item: T): Promise<T> {
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
}

/**
 * 포트폴리오 계산 함수들
 */
export async function getHoldings(): Promise<Holding[]> {
  const trades = await db.find<Trade>('trades');
  const holdingsMap = new Map<string, { totalShares: number; totalCost: number; buyShares: number }>();

  for (const trade of trades) {
    const existing = holdingsMap.get(trade.symbol) || { totalShares: 0, totalCost: 0, buyShares: 0 };
    
    if (trade.side === 'BUY') {
      existing.totalShares += trade.qty;
      existing.totalCost += trade.qty * trade.price + trade.fee;
      existing.buyShares += trade.qty;
    } else {
      existing.totalShares -= trade.qty;
      // 매도시에는 평균 단가 조정하지 않음
    }
    
    holdingsMap.set(trade.symbol, existing);
  }

  const holdings: Holding[] = [];
  for (const [symbol, data] of holdingsMap) {
    if (data.totalShares > 0) {
      holdings.push({
        symbol,
        shares: data.totalShares,
        avg_cost: data.buyShares > 0 ? data.totalCost / data.buyShares : 0
      });
    }
  }

  return holdings;
}

/**
 * 현금 잔액 계산
 */
export async function getCashBalance(): Promise<number> {
  const [cashEvents, trades] = await Promise.all([
    db.find<CashEvent>('cash_events'),
    db.find<Trade>('trades')
  ]);

  // 입출금 합계
  let cashFlow = 0;
  for (const event of cashEvents) {
    cashFlow += event.type === 'DEPOSIT' ? event.amount : -event.amount;
  }

  // 거래로 인한 현금 변동
  let tradingCash = 0;
  for (const trade of trades) {
    if (trade.side === 'BUY') {
      tradingCash -= (trade.qty * trade.price + trade.fee);
    } else {
      tradingCash += (trade.qty * trade.price - trade.fee);
    }
  }

  return cashFlow + tradingCash;
}