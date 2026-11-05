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
  const s = toHalfWidth(input)
    .trim()
    .replace(/[%％]$/, '')
    .trim();
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

/** 入力と表示の単位 */
export type RateUnit = 'percent' | 'permille';

/** RateMicro の 1 単位あたり：1% ＝ 10,000、1‰ ＝ 1,000 */
const UNIT_SCALE: Record<RateUnit, number> = { percent: 10_000, permille: 1_000 };
/** 小数の最大桁数（どちらも 0.0001% まで表せる） */
const UNIT_DIGITS: Record<RateUnit, number> = { percent: 4, permille: 3 };
/** 末尾に付けてよい記号（単位と違う記号はエラーにする：‰ のつもりで % を付けた、などを防ぐ） */
const UNIT_SIGN: Record<RateUnit, RegExp> = { percent: /[%％]$/, permille: /‰$/ };

/** ルールの validRate と同じ上限（30%） */
export const MAX_RATE: RateMicro = 300_000;

/**
 * 単位つきで読む：'9.5'（%）→ 95000、'95'（‰）→ 95000、'42.371'（‰）→ 42371
 * 桁が多すぎる・負の数・数字以外は null（丸めない）
 */
export function parseRate(input: string, unit: RateUnit): RateMicro | null {
  const s = toHalfWidth(input).trim().replace(UNIT_SIGN[unit], '').trim();
  const digits = UNIT_DIGITS[unit];
  const m = new RegExp(`^(\\d{1,3})(?:\\.(\\d{1,${digits}}))?$`).exec(s);
  if (!m) return null;
  return Number(m[1]) * UNIT_SCALE[unit] + Number((m[2] ?? '').padEnd(digits, '0'));
}

/** 入力欄に入れる形（記号なし・余計な 0 なし）：95000 → '9.5'（%）／'95'（‰） */
export function formatRateInput(rate: RateMicro, unit: RateUnit): string {
  const scale = UNIT_SCALE[unit];
  const intPart = Math.floor(rate / scale);
  const frac = String(rate % scale)
    .padStart(UNIT_DIGITS[unit], '0')
    .replace(/0+$/, '');
  return frac ? `${intPart}.${frac}` : String(intPart);
}

/** 表示用（記号つき）：95000 → '9.5%'／'95‰' */
export function formatRate(rate: RateMicro, unit: RateUnit): string {
  return formatRateInput(rate, unit) + (unit === 'percent' ? '%' : '‰');
}

export type SplitError = 'format' | 'tooHigh' | 'mismatch';

/** 全体・本人分・会社分の3つを読み、「全体 ＝ 本人 ＋ 会社」を確かめる */
export function parseSplit(
  texts: { total: string; employee: string; employer: string },
  unit: RateUnit,
):
  | { ok: true; split: { employee: RateMicro; employer: RateMicro } }
  | { ok: false; error: SplitError } {
  const total = parseRate(texts.total, unit);
  const employee = parseRate(texts.employee, unit);
  const employer = parseRate(texts.employer, unit);
  if (total === null || employee === null || employer === null)
    return { ok: false, error: 'format' };
  if (total > MAX_RATE) return { ok: false, error: 'tooHigh' };
  if (employee + employer !== total) return { ok: false, error: 'mismatch' };
  return { ok: true, split: { employee, employer } };
}
