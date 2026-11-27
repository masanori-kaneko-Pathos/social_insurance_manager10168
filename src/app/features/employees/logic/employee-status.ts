// 従業員の概要の「状況」の札（11/28）：休業・海外勤務・協定・役員・介護の適用除外・特定被保険者を1か所で見せる
// 本人の点検で「休業だ・役員だ・海外勤務だ、の情報をどのタブで見ればいいか分からない」と言われたため。
// 札を押すと、その記録のあるタブを開く。Angular・Firebase に依存しない純粋な関数

import type { CareExemption, Leave, LeaveKind, Overseas, OverseasPayer } from '../../../core/models/employee';

export type EmployeeTabKey = 'employment' | 'person';

export type StatusChip =
  | { kind: 'leaveNow'; leave: LeaveKind; until: string | null; tab: EmployeeTabKey }
  | { kind: 'leaveSoon'; leave: LeaveKind; from: string; tab: EmployeeTabKey }
  | { kind: 'overseasNow'; country: string; payer: OverseasPayer; tab: EmployeeTabKey }
  | { kind: 'overseasSoon'; country: string; from: string; tab: EmployeeTabKey }
  | { kind: 'certificate'; country: string; until: string | null; tab: EmployeeTabKey }
  | { kind: 'officer'; tab: EmployeeTabKey }
  | { kind: 'careExempt'; tab: EmployeeTabKey };

export interface StatusSource {
  leaves: readonly Leave[];
  overseas?: readonly Overseas[] | null;
  careExemptions?: readonly CareExemption[] | null;
  certificate?: { country: string; to: string | null } | null;
  officer?: unknown | null;
}

const leaveEnd = (l: Leave) => l.end ?? l.plannedEnd;

export function statusChips(e: StatusSource, today: string): StatusChip[] {
  const out: StatusChip[] = [];
  // 休業：今日が入っている休業。なければ、これからの休業のいちばん近いもの
  const now = e.leaves.find((l) => l.start <= today && (!leaveEnd(l) || leaveEnd(l)! >= today));
  if (now) out.push({ kind: 'leaveNow', leave: now.kind, until: leaveEnd(now), tab: 'employment' });
  else {
    const soon = [...e.leaves].filter((l) => l.start > today).sort((a, b) => a.start.localeCompare(b.start))[0];
    if (soon) out.push({ kind: 'leaveSoon', leave: soon.kind, from: soon.start, tab: 'employment' });
  }
  // 海外勤務：今日が入っている期間。なければ、これからの赴任
  const ov = e.overseas ?? [];
  const ovNow = ov.find((o) => o.from <= today && (!o.to || o.to >= today));
  if (ovNow) out.push({ kind: 'overseasNow', country: ovNow.country, payer: ovNow.payer, tab: 'employment' });
  else {
    const soon = [...ov].filter((o) => o.from > today).sort((a, b) => a.from.localeCompare(b.from))[0];
    if (soon) out.push({ kind: 'overseasSoon', country: soon.country, from: soon.from, tab: 'employment' });
  }
  // 協定の適用証明書（外国から日本へ来ている人。期限が切れていても出す：切れたことに気づくため）
  if (e.certificate) out.push({ kind: 'certificate', country: e.certificate.country, until: e.certificate.to, tab: 'person' });
  if (e.officer) out.push({ kind: 'officer', tab: 'person' });
  // 介護保険の適用除外：今日が入っている期間
  if ((e.careExemptions ?? []).some((c) => c.from <= today && (!c.to || c.to > today))) out.push({ kind: 'careExempt', tab: 'employment' });
  return out;
}
