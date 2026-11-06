/**
 * 文字の道具（Angular・Firebase に依存しない）
 */

/** 全角の英数字・記号（！〜～）と全角スペースを半角にする。カタカナ・漢字はそのまま */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

/** 全角の数字（０〜９）だけを半角にする。入力欄の自動変換用（漢字・カナ・記号はそのまま） */
export function toHalfDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/** ひらがなをカタカナにする（検索で「ぐえん」でも「グエン」に当たるように） */
export function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/** 郵便番号の表示：'1000001' → '100-0001'（7桁でなければそのまま） */
export function formatPostalCode(v: string | null): string {
  if (!v) return '';
  return /^\d{7}$/.test(v) ? `${v.slice(0, 3)}-${v.slice(3)}` : v;
}

/** 基礎年金番号の表示：'1234567890' → '1234-567890'（10桁でなければそのまま） */
export function formatPensionNumber(v: string | null): string {
  if (!v) return '';
  return /^\d{10}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4)}` : v;
}
