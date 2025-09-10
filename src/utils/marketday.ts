import { utcToZonedTime } from 'date-fns-tz';
import Holidays from 'date-holidays';

// 미국 공휴일 객체 생성
const usHolidays = new Holidays('US');

/**
 * 나스닥 시장 개장 여부 확인
 * @param date 확인할 날짜
 * @returns 개장일이면 true, 휴장일이면 false
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
    
    // 미국 공휴일 확인
    const holidayCheck = usHolidays.isHoliday(nyTime);
    if (holidayCheck) {
      const holidayName = Array.isArray(holidayCheck) 
        ? holidayCheck[0]?.name || 'Unknown Holiday'
        : (holidayCheck as any)?.name || 'Unknown Holiday';
      console.log(`📅 미국 공휴일입니다: ${holidayName}`);
      return false;
    }
    
    // 특수 휴장일 확인 (필요시 확장)
    const specialClosures = getSpecialClosures();
    const dateString = nyTime.toISOString().split('T')[0];
    
    if (specialClosures.includes(dateString)) {
      console.log(`📅 특별 휴장일입니다: ${dateString}`);
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
 * 특별 휴장일 목록 반환
 * 매년 업데이트 필요 (조기 종료일, 특별 휴장일 등)
 */
function getSpecialClosures(): string[] {
  const currentYear = new Date().getFullYear();
  
  // 2024년 특별 휴장일 (예시)
  const closures2024 = [
    '2024-07-03',  // Independence Day observed (early close)
    '2024-11-29',  // Thanksgiving Day
    '2024-12-24',  // Christmas Eve (early close)
  ];
  
  // 2025년 특별 휴장일 (예시)
  const closures2025 = [
    '2025-07-03',  // Independence Day observed
    '2025-11-28',  // Thanksgiving Day
    '2025-12-24',  // Christmas Eve
  ];
  
  // 현재 연도에 따라 반환
  switch (currentYear) {
    case 2024:
      return closures2024;
    case 2025:
      return closures2025;
    default:
      console.warn(`⚠️ ${currentYear}년 특별 휴장일 정보가 없습니다`);
      return [];
  }
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