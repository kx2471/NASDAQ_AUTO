import { utcToZonedTime } from 'date-fns-tz';

/**
 * 나스닥 시장 개장 여부 확인
 * @param date 확인할 날짜
 * @returns 개장일이면 true, 휴장일이면 false
 *
 * 나스닥 실제 휴장일:
 * - New Year's Day (1월 1일)
 * - Martin Luther King Jr. Day (1월 셋째 월요일)
 * - Presidents' Day (2월 셋째 월요일)
 * - Good Friday (부활절 전 금요일)
 * - Memorial Day (5월 마지막 월요일)
 * - Juneteenth (6월 19일)
 * - Independence Day (7월 4일)
 * - Labor Day (9월 첫째 월요일)
 * - Thanksgiving Day (11월 넷째 목요일)
 * - Christmas Day (12월 25일)
 *
 * 주의: Columbus Day, Veterans Day는 나스닥 개장일입니다!
 */
export function isNasdaqOpen(date: Date): boolean {
  try {
    // UTC 시간을 뉴욕 시간으로 변환
    const nyTime = utcToZonedTime(date, 'America/New_York');

    // 요일 확인 (0=일요일, 6=토요일)
    const dayOfWeek = nyTime.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      console.log(`📅 주말입니다: ${dayOfWeek === 0 ? '일요일' : '토요일'}`);
      return false;
    }

    // 나스닥 공식 휴장일 확인
    const dateString = nyTime.toISOString().split('T')[0];
    const nasdaqHolidays = getNasdaqHolidays(nyTime.getFullYear());

    if (nasdaqHolidays.includes(dateString)) {
      console.log(`📅 나스닥 휴장일입니다: ${dateString}`);
      return false;
    }

    console.log(`📈 나스닥 개장일입니다: ${dateString}`);
    return true;

  } catch (error) {
    console.error('❌ 시장 개장일 확인 중 오류:', error);
    // 오류 발생 시 안전하게 false 반환
    return false;
  }
}

/**
 * 나스닥 공식 휴장일 목록 반환
 * 매년 업데이트 필요
 * 출처: https://www.nasdaq.com/market-activity/stock-market-holiday-calendar
 */
function getNasdaqHolidays(year: number): string[] {
  const holidays: string[] = [];

  // New Year's Day (1월 1일, 주말이면 전후 평일로 대체)
  const newYear = new Date(year, 0, 1);
  if (newYear.getDay() === 0) { // 일요일이면 월요일
    holidays.push(`${year}-01-02`);
  } else if (newYear.getDay() === 6) { // 토요일이면 금요일
    holidays.push(`${year - 1}-12-31`);
  } else {
    holidays.push(`${year}-01-01`);
  }

  // Martin Luther King Jr. Day (1월 셋째 월요일)
  holidays.push(getNthWeekdayOfMonth(year, 0, 1, 3));

  // Presidents' Day (2월 셋째 월요일)
  holidays.push(getNthWeekdayOfMonth(year, 1, 1, 3));

  // Good Friday (부활절 전 금요일) - 계산 필요
  holidays.push(getGoodFriday(year));

  // Memorial Day (5월 마지막 월요일)
  holidays.push(getLastWeekdayOfMonth(year, 4, 1));

  // Juneteenth (6월 19일, 주말이면 전후 평일로 대체)
  const juneteenth = new Date(year, 5, 19);
  if (juneteenth.getDay() === 0) { // 일요일이면 월요일
    holidays.push(`${year}-06-20`);
  } else if (juneteenth.getDay() === 6) { // 토요일이면 금요일
    holidays.push(`${year}-06-18`);
  } else {
    holidays.push(`${year}-06-19`);
  }

  // Independence Day (7월 4일, 주말이면 전후 평일로 대체)
  const july4 = new Date(year, 6, 4);
  if (july4.getDay() === 0) { // 일요일이면 월요일
    holidays.push(`${year}-07-05`);
  } else if (july4.getDay() === 6) { // 토요일이면 금요일
    holidays.push(`${year}-07-03`);
  } else {
    holidays.push(`${year}-07-04`);
  }

  // Labor Day (9월 첫째 월요일)
  holidays.push(getNthWeekdayOfMonth(year, 8, 1, 1));

  // Thanksgiving Day (11월 넷째 목요일)
  holidays.push(getNthWeekdayOfMonth(year, 10, 4, 4));

  // Christmas Day (12월 25일, 주말이면 전후 평일로 대체)
  const christmas = new Date(year, 11, 25);
  if (christmas.getDay() === 0) { // 일요일이면 월요일
    holidays.push(`${year}-12-26`);
  } else if (christmas.getDay() === 6) { // 토요일이면 금요일
    holidays.push(`${year}-12-24`);
  } else {
    holidays.push(`${year}-12-25`);
  }

  return holidays;
}

/**
 * 특정 월의 N번째 요일 찾기
 * @param year 연도
 * @param month 월 (0-11)
 * @param weekday 요일 (0=일요일, 1=월요일, ...)
 * @param n N번째 (1, 2, 3, ...)
 * @returns YYYY-MM-DD 형식의 날짜 문자열
 */
function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const firstWeekday = firstDay.getUTCDay();

  // 해당 월의 첫 번째 해당 요일 찾기
  let firstOccurrence = 1 + ((weekday - firstWeekday + 7) % 7);

  // N번째 해당 요일 계산
  const targetDate = firstOccurrence + (n - 1) * 7;

  const date = new Date(Date.UTC(year, month, targetDate));
  const dateStr = date.toISOString().split('T')[0];

  return dateStr;
}

/**
 * 특정 월의 마지막 요일 찾기
 * @param year 연도
 * @param month 월 (0-11)
 * @param weekday 요일 (0=일요일, 1=월요일, ...)
 * @returns YYYY-MM-DD 형식의 날짜 문자열
 */
function getLastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const lastDayWeekday = lastDay.getUTCDay();

  // 마지막 날부터 거꾸로 해당 요일 찾기
  let daysBack = (lastDayWeekday - weekday + 7) % 7;
  const targetDate = lastDay.getUTCDate() - daysBack;

  const date = new Date(Date.UTC(year, month, targetDate));
  return date.toISOString().split('T')[0];
}

/**
 * Good Friday 계산 (부활절 전 금요일)
 * Meeus의 알고리즘 사용
 * @param year 연도
 * @returns YYYY-MM-DD 형식의 날짜 문자열
 */
function getGoodFriday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  // 부활절 일요일에서 2일 전 (금요일)
  const easter = new Date(Date.UTC(year, month - 1, day));
  const goodFriday = new Date(easter);
  goodFriday.setUTCDate(easter.getUTCDate() - 2);

  return goodFriday.toISOString().split('T')[0];
}

/**
 * 한국 시간 기준으로 현재가 발송 시각인지 확인
 * @returns 발송 시각이면 true
 */
export function isSendTime(): boolean {
  try {
    const now = new Date();
    const kstTime = utcToZonedTime(now, 'Asia/Seoul');
    const currentHour = kstTime.getHours();
    const expectedHour = parseInt(process.env.SEND_HOUR_LOCAL || '16');
    
    const isSendHour = currentHour === expectedHour;
    
    if (isSendHour) {
      console.log(`🕐 발송 시각입니다: ${currentHour}시 (KST)`);
    } else {
      console.log(`🕐 현재 시각: ${currentHour}시, 발송 시각: ${expectedHour}시 (KST)`);
    }
    
    return isSendHour;
    
  } catch (error) {
    console.error('❌ 발송 시각 확인 중 오류:', error);
    return false;
  }
}

/**
 * 다음 거래일 반환
 * @param date 기준 날짜
 * @returns 다음 거래일
 */
export function getNextTradingDay(date: Date = new Date()): Date {
  const nextDay = new Date(date);
  
  do {
    nextDay.setDate(nextDay.getDate() + 1);
  } while (!isNasdaqOpen(nextDay));
  
  return nextDay;
}

/**
 * 이전 거래일 반환
 * @param date 기준 날짜
 * @returns 이전 거래일
 */
export function getPreviousTradingDay(date: Date = new Date()): Date {
  const prevDay = new Date(date);
  
  do {
    prevDay.setDate(prevDay.getDate() - 1);
  } while (!isNasdaqOpen(prevDay));
  
  return prevDay;
}

/**
 * 지정된 기간 내 거래일 수 계산
 * @param startDate 시작 날짜
 * @param endDate 종료 날짜
 * @returns 거래일 수
 */
export function getTradingDaysBetween(startDate: Date, endDate: Date): number {
  let count = 0;
  const current = new Date(startDate);
  
  while (current <= endDate) {
    if (isNasdaqOpen(current)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  
  return count;
}