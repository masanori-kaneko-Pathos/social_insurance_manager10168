import { toHalfWidth } from '../utils/text';

/**
 * 取り込みで、ファイルの社員番号から登録済みの人を探す（11/28。どの取り込みも同じ決まりにする）
 *
 * - まず、そのままの番号で探す（全角・半角、空白、長音やハイフンのような文字の違いは無視）
 * - 見つからず、数字だけの番号なら、先頭の0を落とした形で探す
 *   （Excel で開くと「0019」が「19」になるため。登録が「19」でファイルが「0019」でも同じ）
 * - どちらも、2人以上に当たるときは ambiguous（黙ってどちらかに結ばない）
 *
 * 前は取り込みごとに書き方が違い、履歴・休業は先頭の0を補わず、扶養・海外・賞与などは
 * 「012」と「12」が両方いると、あとから入れた人に黙って結んでいた。
 */
export type NumberMatch<T> =
  | { kind: 'ok'; item: T; zeroPadded: boolean }
  | { kind: 'none' }
  | { kind: 'ambiguous' };

/** 社員番号をそろえる（比べるための形） */
export function numberKey(raw: string): string {
  return toHalfWidth(raw.replace(/^﻿/, ''))
    .normalize('NFKC')
    .replace(/[ー‐－−]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
}

const stripZeros = (s: string) => s.replace(/^0+(?=\d)/, '');

export function makeNumberMatcher<T>(
  items: readonly T[],
  numberOf: (item: T) => string | null | undefined,
): (raw: string) => NumberMatch<T> {
  const exact = new Map<string, T[]>();
  const loose = new Map<string, T[]>();
  for (const it of items) {
    const no = numberOf(it);
    if (!no) continue;
    const k = numberKey(no);
    if (!k) continue;
    exact.set(k, [...(exact.get(k) ?? []), it]);
    if (/^\d+$/.test(k)) {
      const z = stripZeros(k);
      loose.set(z, [...(loose.get(z) ?? []), it]);
    }
  }
  return (raw: string) => {
    const k = numberKey(raw);
    if (!k) return { kind: 'none' };
    const a = exact.get(k);
    if (a) return a.length === 1 ? { kind: 'ok', item: a[0], zeroPadded: false } : { kind: 'ambiguous' };
    if (/^\d+$/.test(k)) {
      const b = loose.get(stripZeros(k));
      if (b) return b.length === 1 ? { kind: 'ok', item: b[0], zeroPadded: true } : { kind: 'ambiguous' };
    }
    return { kind: 'none' };
  };
}
