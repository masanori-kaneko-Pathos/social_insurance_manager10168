/** 'YYYY-MM-DD' を UTC の 0時の Date に変換（タイムゾーンのずれを防ぐ） */
export function parseYmd(ymd: string): Date {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  
  /** Date を 'YYYY-MM-DD' に */
  export function formatYmd(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
  
  /** 日付に日数を足す（マイナスで引く） */
  export function addDays(ymd: string, days: number): string {
    const d = parseYmd(ymd);
    d.setUTCDate(d.getUTCDate() + days);
    return formatYmd(d);
  }
  
  /** 'YYYY-MM-DD' → 'YYYY-MM' */
  export function monthOf(ymd: string): string {
    return ymd.slice(0, 7);
  }