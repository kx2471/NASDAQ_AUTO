import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { getStockInfos } from './toss';

/**
 * 미국 전시장 종목 유니버스 관리
 *
 * - AlphaVantage LISTING_STATUS(전체 상장 목록, 1콜)로 후보를 수집하고
 *   토스 /stocks(200개/콜)로 실거래 가능 여부를 검증해 유니버스를 구축한다.
 * - 결과는 data/json/universe.json에 캐시하고 기본 7일마다 갱신한다.
 * - 여기서 걸러지는 것: 상장폐지·거래정지, 워런트/유닛(토스 미조회), ETF/우선주,
 *   비USD 종목 — 스크리닝 단계의 404 소음과 통화 오염을 원천 차단한다.
 */

/** 유니버스 종목 (스크리닝 1단계 입력) */
export interface UniverseStock {
  symbol: string;
  name: string;
  market: string;             // NASDAQ / NYSE
  sharesOutstanding: number;  // 발행주식수 (시총 추정용)
}

interface UniverseCache {
  updated_at: string;
  count: number;
  stocks: UniverseStock[];
}

const UNIVERSE_PATH = path.join(process.cwd(), 'data', 'json', 'universe.json');

/**
 * 나스닥 공식 심볼 디렉토리에서 미국 상장 종목 심볼 목록 수집 (API 키 불필요)
 * - nasdaqlisted.txt: Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
 * - otherlisted.txt:  ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
 *   (Exchange: N=NYSE, A=NYSE American, P=NYSE Arca, Z=Cboe)
 * - 심볼 표기가 토스와 동일 (클래스 주식 'BRK.B' 등) — 변환 불필요
 * - 여기선 ETF/테스트 종목만 1차 제외하고, 최종 판정은 토스 /stocks 검증에 맡긴다
 * @returns NASDAQ/NYSE(American 포함) 비ETF 심볼 배열
 */
async function fetchUsListingSymbols(): Promise<string[]> {
  const base = 'https://www.nasdaqtrader.com/dynamic/SymDir';
  const symbols = new Set<string>();

  // NASDAQ 상장 종목
  const nasdaqRes = await axios.get(`${base}/nasdaqlisted.txt`, { responseType: 'text', timeout: 60000 });
  for (const line of String(nasdaqRes.data).split('\n').slice(1)) {
    const cols = line.split('|');
    if (cols.length < 8) continue; // 푸터(File Creation Time) 등 스킵
    const [symbol, , , testIssue, , , etf] = cols;
    if (testIssue !== 'N' || etf !== 'N') continue;
    symbols.add(symbol.trim());
  }

  // NYSE 계열 상장 종목
  const otherRes = await axios.get(`${base}/otherlisted.txt`, { responseType: 'text', timeout: 60000 });
  for (const line of String(otherRes.data).split('\n').slice(1)) {
    const cols = line.split('|');
    if (cols.length < 8) continue;
    const [symbol, , exchange, , etf, , testIssue] = cols;
    if (testIssue !== 'N' || etf !== 'N') continue;
    if (exchange !== 'N' && exchange !== 'A') continue; // NYSE / NYSE American만
    symbols.add(symbol.trim());
  }

  // 토스 심볼 패턴(영숫자/./-)에 맞는 것만 — '$'(우선주), '+'(워런트), '='(유닛) 등은
  // 보통주가 아니므로 여기서 제외 (토스 API가 패턴 위반 시 요청 전체를 400으로 거부)
  const list = Array.from(symbols).filter(s => /^[A-Za-z0-9.\-]+$/.test(s));

  // 정상이라면 수천 개 — 너무 적으면 응답 이상으로 간주
  if (list.length < 1000) {
    throw new Error(`상장 목록이 비정상적으로 적습니다 (${list.length}개) — 나스닥 디렉토리 응답 확인 필요`);
  }

  return list;
}

/**
 * 유니버스 구축: 상장 목록 → 토스 검증 → 캐시 저장
 * @returns 토스에서 거래 가능한 미국 보통주 목록
 */
export async function buildUniverse(): Promise<UniverseStock[]> {
  console.log('🌐 미국 전시장 유니버스 구축 시작...');

  const listed = await fetchUsListingSymbols();
  console.log(`📋 상장 목록 수집: ${listed.length}개 (NYSE/NASDAQ 활성 보통주)`);

  // 토스 /stocks 일괄 검증 — 토스에 없는 심볼(워런트 등)은 응답에서 조용히 빠진다
  const infos = await getStockInfos(listed);

  const stocks: UniverseStock[] = infos
    .filter(s =>
      s.status === 'ACTIVE' &&
      s.securityType === 'STOCK' &&   // ETF/우선주 제외 (isCommonShare는 ETF도 true라 사용 불가)
      s.currency === 'USD' &&
      !s.delistDate
    )
    .map(s => ({
      symbol: s.symbol,
      name: s.name,
      market: s.market,
      sharesOutstanding: s.sharesOutstanding
    }));

  const cache: UniverseCache = {
    updated_at: new Date().toISOString(),
    count: stocks.length,
    stocks
  };
  await fs.mkdir(path.dirname(UNIVERSE_PATH), { recursive: true });
  await fs.writeFile(UNIVERSE_PATH, JSON.stringify(cache, null, 2), 'utf-8');

  console.log(`✅ 유니버스 구축 완료: 토스 거래가능 미국 보통주 ${stocks.length}개 (universe.json 캐시됨)`);
  return stocks;
}

/**
 * 유니버스 조회 — 캐시가 신선하면 재사용, 오래됐으면 재구축
 * @param maxAgeDays 캐시 유효 기간 (기본 7일)
 * @returns 유니버스 종목 배열
 */
export async function getUniverse(maxAgeDays: number = 7): Promise<UniverseStock[]> {
  try {
    const raw = await fs.readFile(UNIVERSE_PATH, 'utf-8');
    const cache: UniverseCache = JSON.parse(raw);
    const ageDays = (Date.now() - new Date(cache.updated_at).getTime()) / (1000 * 60 * 60 * 24);

    if (ageDays <= maxAgeDays && cache.stocks.length > 0) {
      console.log(`🌐 유니버스 캐시 사용: ${cache.stocks.length}개 (${ageDays.toFixed(1)}일 경과)`);
      return cache.stocks;
    }
  } catch {
    // 캐시 없음/손상 — 새로 구축
  }

  try {
    return await buildUniverse();
  } catch (error) {
    // 구축 실패 시 오래된 캐시라도 있으면 사용 (없으면 에러 전파)
    console.warn('⚠️ 유니버스 구축 실패 — 기존 캐시로 폴백 시도:', error);
    const raw = await fs.readFile(UNIVERSE_PATH, 'utf-8');
    const cache: UniverseCache = JSON.parse(raw);
    console.warn(`⚠️ 오래된 유니버스 캐시 사용: ${cache.stocks.length}개 (${cache.updated_at})`);
    return cache.stocks;
  }
}
