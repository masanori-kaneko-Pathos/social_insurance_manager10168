/**
 * 数の入力の道具（Angular・Firebase に依存しない）
 * 画面や CSV の文字を、0以上の整数・時間（分）として読む
 */
import { toHalfWidth } from './text';

/**
 * 0以上の整数として読む。「320,000」「３２００００」も読める
 * 空欄は null、読めないものは undefined
 */
export function parseNat(s: string): number | null | undefined {
  const t = toHalfWidth(s).replace(/[,\s]/g, '');
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : undefined;
}

/**
 * 時間を分として読む。「160」→ 9600、「160:30」→ 9630、「160.5」→ 9630
 * 空欄は null、読めないものは undefined
 */
export function parseHours(s: string): number | null | undefined {
  const t = toHalfWidth(s).replace(/\s/g, '');
  if (t === '') return null;
  let m = /^(\d+)(?::([0-5]\d))?$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0);
  m = /^(\d+)\.(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 60 + Math.round(Number(`0.${m[2]}`) * 60);
  return undefined;
}

/** 分 → 「160:30」 */
export function formatHours(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** 金額の表示：300000 → '300,000' */
export function formatYen(n: number): string {
  return n.toLocaleString('ja-JP');
}
