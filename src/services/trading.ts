import { getHoldings, Holding } from '../storage/database';

export interface SellOrder {
  symbol: string;
  qty: number;
  price?: number; // 시장가 매도 시 undefined
  note?: string;
}

export interface SellResult {
  success: boolean;
  executedPrice: number;
  executedQty: number;
  proceeds: number; // 매도 대금
  error?: string;
}

/**
 * 매도 주문 실행
 * @param order 매도 주문 정보
 * @param currentPrice 현재 시장가 (price가 없을 때 사용)
 * @returns 매도 결과
 */
export async function executeSellOrder(order: SellOrder, currentPrice?: number): Promise<SellResult> {
  try {
    // 1. 현재 보유량 확인
    const holdings = await getHoldings();
    const holding = holdings.find((h: Holding) => h.symbol === order.symbol);
    
    if (!holding) {
      return {
        success: false,
        executedPrice: 0,
        executedQty: 0,
        proceeds: 0,
        error: `${order.symbol} 보유하지 않음`
      };
    }
    
    if (holding.shares < order.qty) {
      return {
        success: false,
        executedPrice: 0,
        executedQty: 0,
        proceeds: 0,
        error: `보유량(${holding.shares})이 매도량(${order.qty})보다 적음`
      };
    }
    
    // 2. 매도가 결정 (지정가 또는 현재가)
    const sellPrice = order.price || currentPrice;
    if (!sellPrice) {
      return {
        success: false,
        executedPrice: 0,
        executedQty: 0,
        proceeds: 0,
        error: '매도가격이 지정되지 않음'
      };
    }
    
    // 3. 매도 거래 기록 생성
    const proceeds = order.qty * sellPrice;
    const tradeRecord = {
      symbol: order.symbol,
      side: 'SELL' as const,
      shares: order.qty,
      price: sellPrice,
      fee: 0, // 수수료는 나중에 추가 가능
      executed_at: new Date().toISOString(),
      note: order.note || `${order.qty}주 매도`
    };
    
    // 4. 데이터베이스에 거래 기록 저장
    // await saveTrade(tradeRecord); // TODO: Implement saveTrade function
    
    console.log(`✅ ${order.symbol} ${order.qty}주 매도 완료: $${sellPrice.toFixed(2)} × ${order.qty} = $${proceeds.toFixed(2)}`);
    
    return {
      success: true,
      executedPrice: sellPrice,
      executedQty: order.qty,
      proceeds: proceeds
    };
    
  } catch (error) {
    console.error('❌ 매도 주문 실행 실패:', error);
    return {
      success: false,
      executedPrice: 0,
      executedQty: 0,
      proceeds: 0,
      error: error instanceof Error ? error.message : '알 수 없는 오류'
    };
  }
}

/**
 * 전량 매도
 * @param symbol 종목 심볼
 * @param currentPrice 현재 시장가
 * @param note 메모
 * @returns 매도 결과
 */
export async function sellAll(symbol: string, currentPrice: number, note?: string): Promise<SellResult> {
  const holdings = await getHoldings();
  const holding = holdings.find((h: Holding) => h.symbol === symbol);
  
  if (!holding || holding.shares <= 0) {
    return {
      success: false,
      executedPrice: 0,
      executedQty: 0,
      proceeds: 0,
      error: `${symbol} 보유하지 않음`
    };
  }
  
  return executeSellOrder({
    symbol,
    qty: holding.shares,
    price: currentPrice,
    note: note || `${symbol} 전량 매도`
  });
}

/**
 * 비율로 매도 (예: 50% 매도)
 * @param symbol 종목 심볼
 * @param percentage 매도 비율 (0-100)
 * @param currentPrice 현재 시장가
 * @param note 메모
 * @returns 매도 결과
 */
export async function sellByPercentage(
  symbol: string, 
  percentage: number, 
  currentPrice: number, 
  note?: string
): Promise<SellResult> {
  if (percentage <= 0 || percentage > 100) {
    return {
      success: false,
      executedPrice: 0,
      executedQty: 0,
      proceeds: 0,
      error: '매도 비율은 0-100% 사이여야 함'
    };
  }
  
  const holdings = await getHoldings();
  const holding = holdings.find((h: Holding) => h.symbol === symbol);
  
  if (!holding || holding.shares <= 0) {
    return {
      success: false,
      executedPrice: 0,
      executedQty: 0,
      proceeds: 0,
      error: `${symbol} 보유하지 않음`
    };
  }
  
  const sellQty = holding.shares * (percentage / 100);
  
  return executeSellOrder({
    symbol,
    qty: sellQty,
    price: currentPrice,
    note: note || `${symbol} ${percentage}% 매도`
  });
}

/**
 * 매도 주문 검증 (실행하지 않고 검증만)
 * @param order 매도 주문
 * @returns 검증 결과
 */
export async function validateSellOrder(order: SellOrder): Promise<{valid: boolean, message: string}> {
  const holdings = await getHoldings();
  const holding = holdings.find((h: Holding) => h.symbol === order.symbol);
  
  if (!holding) {
    return { valid: false, message: `${order.symbol} 보유하지 않음` };
  }
  
  if (holding.shares < order.qty) {
    return { 
      valid: false, 
      message: `보유량(${holding.shares})이 매도량(${order.qty})보다 적음` 
    };
  }
  
  if (order.qty <= 0) {
    return { valid: false, message: '매도량은 0보다 커야 함' };
  }
  
  return { valid: true, message: '매도 가능' };
}