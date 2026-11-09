// 介護保険の適用除外（R4）
// Angular・Firebase に依存しない純粋な関数
//
// 40〜64歳の被保険者でも、次のあいだは介護保険の第2号被保険者ではないので、介護保険料はかからない
//   - overseas：海外に住んでいる（転勤で国外へ転居した など）
//   - facility：介護保険の適用除外施設に入所している
//   - residenceStatus：3か月を超える在留期間が決まっていない外国人
// 届書は「介護保険適用除外等該当・非該当届」。該当したとき・非該当になったとき、それぞれ遅滞なく出す
//
// 月の数え方（健康保険法156条2項）
//   第2号に該当しなくなった月から介護分はかからない。ただし、その月にまた第2号になったらかかる
//   → 該当した日の月 〜 非該当になった日の月の前月 が「かからない月」（同じ月なら、かからない月はない）

import type { CareExemption, CareExemptionReason } from '../../../core/models/employee';
import { DATE_RE, DateStr, toYearMonth, YearMonth } from '../../../shared/utils/date';

export type CareExemptionLike = Pick<CareExemption, 'from' | 'to'>;

/** その月は適用除外で、介護保険料がかからないか */
export function careExemptMonth(list: readonly CareExemptionLike[] | undefined, month: YearMonth): boolean {
  return (list ?? []).some((e) => {
    const from = toYearMonth(e.from);
    if (month < from) return false;
    if (!e.to) return true;
    return month < toYearMonth(e.to);
  });
}

/** 期間が重なっているか（終わりのない期間は、ずっと続くとみなす） */
export function careOverlaps(e: CareExemptionLike, others: readonly CareExemptionLike[]): boolean {
  const end = (x: CareExemptionLike) => x.to ?? '9999-12-31';
  return others.some((o) => e.from < end(o) && o.from < end(e));
}

// ===== 届の状態 =====

export type CareFiling = 'none' | 'needed' | 'done';

/** 該当届・非該当届のそれぞれが要るか、出したか */
export function careFilingStatus(e: CareExemption): { start: CareFiling; end: CareFiling } {
  return {
    start: e.filedOn ? 'done' : 'needed',
    end: !e.to ? 'none' : e.endFiledOn ? 'done' : 'needed',
  };
}

// ===== 入力フォーム =====

export interface CareExemptionFormValue {
  reason: CareExemptionReason;
  from: string;
  to: string;
  filedOn: string;
  endFiledOn: string;
  note: string;
}

export type CareExemptionField = 'from' | 'to' | 'filedOn' | 'endFiledOn';
export type CareExemptionError = 'required' | 'date' | 'order' | 'beforeFrom' | 'noEnd';

export function emptyCareExemptionForm(): CareExemptionFormValue {
  return { reason: 'overseas', from: '', to: '', filedOn: '', endFiledOn: '', note: '' };
}

export function toCareExemptionForm(e: CareExemption): CareExemptionFormValue {
  return {
    reason: e.reason,
    from: e.from,
    to: e.to ?? '',
    filedOn: e.filedOn ?? '',
    endFiledOn: e.endFiledOn ?? '',
    note: e.note ?? '',
  };
}

export function careExemptionErrors(
  v: CareExemptionFormValue,
): Partial<Record<CareExemptionField, CareExemptionError>> {
  const out: Partial<Record<CareExemptionField, CareExemptionError>> = {};
  const bad = (s: string) => s !== '' && !DATE_RE.test(s);
  if (!v.from) out.from = 'required';
  else if (bad(v.from)) out.from = 'date';
  if (bad(v.to)) out.to = 'date';
  else if (v.to && v.from && v.to <= v.from) out.to = 'order';
  if (bad(v.filedOn)) out.filedOn = 'date';
  else if (v.filedOn && v.from && v.filedOn < v.from) out.filedOn = 'beforeFrom';
  if (bad(v.endFiledOn)) out.endFiledOn = 'date';
  else if (v.endFiledOn && !v.to) out.endFiledOn = 'noEnd';
  else if (v.endFiledOn && v.to && v.endFiledOn < v.to) out.endFiledOn = 'beforeFrom';
  return out;
}

export function fromCareExemptionForm(v: CareExemptionFormValue): CareExemption | null {
  if (Object.keys(careExemptionErrors(v)).length > 0) return null;
  const opt = (s: string) => (s.trim() === '' ? null : s.trim());
  return {
    reason: v.reason,
    from: v.from,
    to: opt(v.to),
    filedOn: opt(v.filedOn),
    endFiledOn: opt(v.endFiledOn),
    note: opt(v.note)?.slice(0, 200) ?? null,
  };
}

/** 注意（保存はできる）：介護保険の年齢（40〜64歳）にかかっていない期間 */
export function careExemptionWarnings(
  v: CareExemptionFormValue,
  careAgeFrom: DateStr,
  careAgeTo: DateStr,
): 'outsideCareAge'[] {
  if (!v.from || !DATE_RE.test(v.from)) return [];
  const end = v.to && DATE_RE.test(v.to) ? v.to : '9999-12-31';
  return v.from >= careAgeTo || end <= careAgeFrom ? ['outsideCareAge'] : [];
}
