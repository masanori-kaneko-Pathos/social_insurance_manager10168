/**
 * 料率の文字列 ⇔ 整数（RateMicro）の変換
 * 小数の計算を一切使わず、文字列のまま桁を組み立てる。
 */
import { RateMicro } from '../../../core/models/rates';

/** 全角の数字・点を半角に */
function toHalfWidth(s: string): string {
  return s.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * '10.06' → 100600、'4.2371' → 42371、'0.23' → 2300
 * 「%」は付けても付けなくてもよい。小数点以下5桁以上・負の数・数字以外は null
 */
export function parsePercent(input: string): RateMicro | null {
  const s = toHalfWidth(input).trim().replace(/[%％]$/, '').trim();
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) return null;
  const intPart = Number(m[1]);
  const fracPart = Number((m[2] ?? '').padEnd(4, '0'));
  return intPart * 10_000 + fracPart;
}

/** 100600 → '10.06%'、42371 → '4.2371%'、183000 → '18.30%'（小数は最低2桁） */
export function formatPercent(rate: RateMicro): string {
  const intPart = Math.floor(rate / 10_000);
  let frac = String(rate % 10_000).padStart(4, '0');
  while (frac.length > 2 && frac.endsWith('0')) frac = frac.slice(0, -1);
  return `${intPart}.${frac}%`;
}