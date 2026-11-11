// マイナンバー（個人番号）の決まり：番号の形・チェックデジット・状態の移り変わり
// 純粋な関数（spec あり）。画面側にも同じ決まりの写しがある（src/app/features/my-number/logic/my-number.ts）
//
// 状態（未登録は「記録なし」）
//   requested 提供を依頼中 → submitted 本人が提出（チェック待ち）→ registered 登録済み
//                                     ↘ returned 差し戻し（修正を依頼中）→ submitted …
//   refused 提供を受けられない（本人が拒否など。理由のメモ付き）

export type MyNumberStatus = 'requested' | 'submitted' | 'returned' | 'registered' | 'refused';
export type MyNumberDocType = 'card' | 'noticeCard' | 'residentRecord' | 'other';
export const DOC_TYPES: readonly MyNumberDocType[] = ['card', 'noticeCard', 'residentRecord', 'other'];

export type AdminAction = 'set' | 'request' | 'cancel' | 'approve' | 'return' | 'refuse' | 'dispose';
export const ADMIN_ACTIONS: readonly AdminAction[] = ['set', 'request', 'cancel', 'approve', 'return', 'refuse', 'dispose'];

const WEIGHTS = [6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** 全角・空白・ハイフンをのぞいた数字だけ */
export function normalizeMyNumber(s: string): string {
  return s.normalize('NFKC').replace(/[\s\-‐ー－]/g, '');
}

/** 先頭11桁からチェックデジット（12桁目）を出す */
export function checkDigitOf(first11: string): number {
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += Number(first11[i]) * WEIGHTS[i];
  const mod = sum % 11;
  return mod <= 1 ? 0 : 11 - mod;
}

export function isValidMyNumber(s: string): boolean {
  return /^\d{12}$/.test(s) && checkDigitOf(s.slice(0, 11)) === Number(s[11]);
}

/** 管理者の操作：今の状態（null ＝ 未登録）からできるか → 次の状態（null ＝ 未登録に戻す） */
export function nextStatus(
  current: MyNumberStatus | null,
  action: AdminAction,
): { ok: true; next: MyNumberStatus | null } | { ok: false } {
  const from = (list: (MyNumberStatus | null)[], next: MyNumberStatus | null) =>
    list.includes(current) ? { ok: true as const, next } : { ok: false as const };
  switch (action) {
    case 'set': // 担当者が登録・変更（どの状態からでも）
      return { ok: true, next: 'registered' };
    case 'request':
      return from([null, 'refused'], 'requested');
    case 'cancel':
      return from(['requested', 'returned'], null);
    case 'approve':
      return from(['submitted'], 'registered');
    case 'return':
      return from(['submitted'], 'returned');
    case 'refuse':
      return from([null, 'requested', 'returned'], 'refused');
    case 'dispose':
      return from(['registered', 'submitted'], null);
  }
}

/** 本人が提出できる状態 */
export function canSubmit(current: MyNumberStatus | null): boolean {
  return current === 'requested' || current === 'returned';
}

/** その操作のあと、暗号化した番号を残すか（残さない → 金庫から消す） */
export function keepsVault(next: MyNumberStatus | null): boolean {
  return next === 'registered' || next === 'submitted';
}

/** 全桁を見る・書き出すとき：ログインし直してからの秒数の上限 */
export const RECENT_AUTH_SECONDS = 5 * 60;

export function isRecentAuth(authTimeSec: number | undefined, nowSec: number): boolean {
  return typeof authTimeSec === 'number' && nowSec - authTimeSec <= RECENT_AUTH_SECONDS;
}
