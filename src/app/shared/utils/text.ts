/**
 * 文字の道具（Angular・Firebase に依存しない）
 */

/** 全角の英数字・記号（！〜～）と全角スペースを半角にする。カタカナ・漢字はそのまま */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}
