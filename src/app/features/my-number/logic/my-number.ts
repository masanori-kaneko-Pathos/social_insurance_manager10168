// マイナンバーの決まり（画面側の写し。関数側は functions/src/mynumber-rules.ts。どちらも spec あり）
// Angular・Firebase に依存しない純粋な関数

import type { MyNumberAction, MyNumberEntry, MyNumberStatus } from '../../../core/models/my-number';
import { addDays, DateStr } from '../../../shared/utils/date';

const WEIGHTS = [6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** 全角・空白・ハイフンをのぞく */
export function normalizeMyNumber(s: string): string {
  return s.normalize('NFKC').replace(/[\s\-‐ー－]/g, '');
}

export function checkDigitOf(first11: string): number {
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += Number(first11[i]) * WEIGHTS[i];
  const mod = sum % 11;
  return mod <= 1 ? 0 : 11 - mod;
}

export function isValidMyNumber(s: string): boolean {
  return /^\d{12}$/.test(s) && checkDigitOf(s.slice(0, 11)) === Number(s[11]);
}

/** 入力欄の確かめ：空欄は ok（任意）。それ以外は 12桁・チェックデジット */
export function myNumberProblem(s: string): 'digits' | 'checkDigit' | null {
  const n = normalizeMyNumber(s);
  if (n === '') return null;
  if (!/^\d{12}$/.test(n)) return 'digits';
  return isValidMyNumber(n) ? null : 'checkDigit';
}

/** 見せるときは 4桁ずつ */
export function formatMyNumber(n: string): string {
  return n.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1 $2 $3');
}

/** その状態で管理者が押せる操作（set ＝ 登録・変更はいつでも） */
export function adminActions(status: MyNumberStatus | null): MyNumberAction[] {
  switch (status) {
    case null:
      return ['set', 'request', 'refuse'];
    case 'requested':
      return ['set', 'cancel', 'refuse'];
    case 'submitted':
      return ['approve', 'return', 'dispose'];
    case 'returned':
      return ['set', 'cancel', 'refuse'];
    case 'registered':
      return ['set', 'dispose'];
    case 'refused':
      return ['set', 'request'];
  }
}

/** 番号を持っている（全桁を見られる）状態 */
export const hasNumber = (s: MyNumberStatus | null) => s === 'registered' || s === 'submitted';

// ===== 廃棄の目安 =====
// 健康保険・厚生年金の届出の書類は「完結の日」から2年保存（健保則34条・厚年則28条）
// ここでは資格喪失日（なければ退職日の翌日）から2年たったら廃棄の To-do を出す

export const KEEP_YEARS = 2;

export interface DisposalPerson {
  id: string;
  retireDate: DateStr | null;
  health: { enrolled: boolean; lostDate: DateStr | null };
  pension: { enrolled: boolean; lostDate: DateStr | null };
}

function addYears(d: DateStr, years: number): DateStr {
  const md = d.slice(5) === '02-29' ? '03-01' : d.slice(5);
  return `${Number(d.slice(0, 4)) + years}-${md}`;
}

/** 喪失日：両方の保険の遅いほう。加入中（喪失日なし）なら null。加入していなければ退職日の翌日 */
export function lossDateOf(p: DisposalPerson): DateStr | null {
  const parts = [p.health, p.pension];
  if (parts.some((x) => x.enrolled && !x.lostDate)) return null;
  const lost = parts.map((x) => x.lostDate).filter((x): x is DateStr => !!x);
  if (lost.length > 0) return lost.sort().at(-1)!;
  return p.retireDate ? addDays(p.retireDate, 1) : null;
}

/** 廃棄してよい日（喪失から2年）。まだ在籍・番号がない人は null */
export function disposalDate(p: DisposalPerson, entry: MyNumberEntry | null): DateStr | null {
  if (!entry || !hasNumber(entry.status) || !p.retireDate) return null;
  const lost = lossDateOf(p);
  return lost ? addYears(lost, KEEP_YEARS) : null;
}

export function disposalDue(p: DisposalPerson, entry: MyNumberEntry | null, today: DateStr): DateStr | null {
  const d = disposalDate(p, entry);
  return d && d <= today ? d : null;
}
