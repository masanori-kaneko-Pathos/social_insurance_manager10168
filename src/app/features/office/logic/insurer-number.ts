/**
 * 健康保険組合の保険者番号（11/26。台帳 R107）
 * - 8桁：法別番号2桁・都道府県番号2桁・保険者別番号3桁・検証番号1桁
 * - 組合管掌健康保険の法別番号は 06（協会けんぽ＝旧政府管掌は 01）
 * - 都道府県番号は組合の所在地の県（01〜47）。事業所の都道府県とは比べない（東京の組合に大阪の支店が入ることもある）
 * - 検証番号：前の7桁に、末尾の桁から 2・1・2・1… を掛け、積が2桁なら各桁を足して合計する。10 −（合計の下1桁）。下1桁が 0 なら 0
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 */

export type InsurerNumberError = 'format' | 'notKumiai' | 'prefecture' | 'checkDigit';

/** 入力をそろえる（全角の数字を半角に、空白・ハイフンを外す） */
export function normalizeInsurerNumber(v: string | null | undefined): string {
  return (v ?? '').normalize('NFKC').replace(/[\s\-‐－ー]/g, '');
}

/** 前の7桁から検証番号を出す */
export function insurerCheckDigit(first7: string): number {
  let sum = 0;
  [...first7].reverse().forEach((c, i) => {
    const p = Number(c) * (i % 2 === 0 ? 2 : 1);
    sum += Math.floor(p / 10) + (p % 10);
  });
  const last = sum % 10;
  return last === 0 ? 0 : 10 - last;
}

/** 組合の保険者番号として正しくなければ、その理由（空は null。必須かどうかは呼ぶ側が決める） */
export function insurerNumberError(v: string | null | undefined): InsurerNumberError | null {
  const n = normalizeInsurerNumber(v);
  if (n === '') return null;
  if (!/^\d{8}$/.test(n)) return 'format';
  if (!n.startsWith('06')) return 'notKumiai';
  const pref = Number(n.slice(2, 4));
  if (pref < 1 || pref > 47) return 'prefecture';
  if (insurerCheckDigit(n.slice(0, 7)) !== Number(n[7])) return 'checkDigit';
  return null;
}
