// 海外勤務（赴任・在籍出向）
// Angular・Firebase に依存しない純粋な関数
//
// 日本の会社に籍を置いたまま海外で働くとき、日本の健康保険・厚生年金に残るかは「給与をどこが払うか」で決まる
//   - 日本の会社が給与（の一部でも）を払う → 日本の被保険者のまま（日本の会社が払う分が報酬）
//   - 海外の会社だけが払う → 日本の会社との使用関係がないとみなされ、資格を喪失することがある
// 日本の被保険者のまま協定国で働くと、相手国の保険にも入ることになる（二重加入）。
// 5年以内の一時派遣なら、日本の年金事務所で「適用証明書」をもらうと、相手国の保険が免除される。
// 5年を超えそうなら、相手国の承認を得て延長するか、相手国の保険に切り替える。
// 住民票を抜いて海外へ転出した40〜64歳の人は、介護保険の適用除外（該当届）も要る。

import type { Overseas, OverseasPayer } from '../../../core/models/employee';
import type { AgreementDoc } from '../../../core/models/master';
import { addDays, DATE_RE, DateStr, daysInMonth, monthsPeriodEnd, shiftMonth, toYearMonth } from '../../../shared/utils/date';

export type AgreementLike = Pick<AgreementDoc, 'country' | 'covers'>;
export type OverseasLike = Pick<Overseas, 'from' | 'to'>;

/** 一時派遣として適用証明書が出る長さ（協定の原則。5年） */
export const TEMPORARY_MONTHS = 60;
/** 証明書の期限の何か月前から To-do に出すか（延長の申請・帰任・切り替えを決める時間） */
export const CERTIFICATE_NOTICE_MONTHS = 6;

/** 'YYYY-MM-DD' の n か月後（前）の同じ日（その月にない日は月末） */
export function shiftDate(date: DateStr, n: number): DateStr {
  const ym = shiftMonth(toYearMonth(date), n);
  const d = Math.min(Number(date.slice(8)), daysInMonth(ym));
  return `${ym}-${String(d).padStart(2, '0')}`;
}

/** その日に海外勤務の期間に入っているか（帰任の日は日本にいるとみなす） */
export function overseasOn(o: OverseasLike, date: DateStr): boolean {
  return o.from <= date && (!o.to || date < o.to);
}

/** 今の（なければ次の）海外勤務 */
export function currentOverseas<T extends OverseasLike>(list: readonly T[] | undefined, today: DateStr): T | null {
  const items = list ?? [];
  return (
    items.find((o) => overseasOn(o, today)) ??
    [...items].filter((o) => o.from > today).sort((a, b) => a.from.localeCompare(b.from))[0] ??
    null
  );
}

/** 期間が重なっているか（終わりのない期間は、ずっと続くとみなす） */
export function overseasOverlaps(o: OverseasLike, others: readonly OverseasLike[]): boolean {
  const end = (x: OverseasLike) => x.to ?? '9999-12-31';
  return others.some((x) => o.from < end(x) && x.from < end(o));
}

// ===== 注意（保存はできる） =====

export type OverseasWarning =
  | 'payAbroad' // 海外の会社だけが払う → 資格喪失の候補
  | 'noCertificate' // 協定国なのに日本の適用証明書がない → 相手国の保険にも入る（二重加入）
  | 'noAgreement' // 協定のない国 → 相手国の保険にも入ることがある
  | 'pensionOnly' // 協定が年金だけ → 医療保険は相手国でも入ることがある
  | 'overFiveYears' // 証明書の期間が5年を超えている → 延長の承認を確かめる
  | 'certificateOutside' // 証明書の期間が海外勤務の期間からはみ出している
  | 'careExemption'; // 40〜64歳 → 住民票を抜いたら介護保険の適用除外（該当届）

export interface OverseasCheckInput {
  item: Pick<Overseas, 'country' | 'from' | 'to' | 'payer' | 'certificateFrom' | 'certificateTo'>;
  agreements: readonly AgreementLike[];
  /** 介護保険の年齢（40歳到達日 〜 65歳到達日） */
  careAge: { from: DateStr; to: DateStr };
  /** 介護保険の適用除外の期間（もう登録してあれば、注意は出さない） */
  careExemptions: readonly OverseasLike[];
}

export function overseasWarnings(input: OverseasCheckInput): OverseasWarning[] {
  const { item, agreements, careAge, careExemptions } = input;
  const out: OverseasWarning[] = [];
  const agreement = agreements.find((a) => a.country === item.country) ?? null;
  const hasCert = !!item.certificateFrom;

  if (item.payer === 'abroad') out.push('payAbroad');
  else if (!agreement) out.push('noAgreement');
  else {
    // 日本の被保険者のまま、協定国で働く
    if (!hasCert) out.push('noCertificate');
    if (agreement.covers === 'pension') out.push('pensionOnly');
  }

  if (hasCert && item.certificateTo && item.certificateTo > monthsPeriodEnd(item.certificateFrom!, TEMPORARY_MONTHS)) {
    out.push('overFiveYears');
  }
  if (
    hasCert &&
    (item.certificateFrom! < item.from || (item.to && item.certificateTo && item.certificateTo >= item.to))
  ) {
    out.push('certificateOutside');
  }

  // 介護保険：40〜64歳にかかる期間で、適用除外がまだ登録されていない
  const end = item.to ?? '9999-12-31';
  const inCareAge = item.from < careAge.to && careAge.from < end;
  if (inCareAge && !careExemptions.some((c) => overseasOverlaps(c, [item]))) out.push('careExemption');
  return out;
}

// ===== 入力フォーム =====

export interface OverseasFormValue {
  country: string;
  from: string;
  to: string;
  payer: OverseasPayer;
  certificateFrom: string;
  certificateTo: string;
  note: string;
}

export type OverseasField = 'country' | 'from' | 'to' | 'certificateFrom' | 'certificateTo';
export type OverseasError = 'required' | 'date' | 'order' | 'country' | 'pair';

export function emptyOverseasForm(): OverseasFormValue {
  return { country: '', from: '', to: '', payer: 'japan', certificateFrom: '', certificateTo: '', note: '' };
}

export function toOverseasForm(o: Overseas): OverseasFormValue {
  return {
    country: o.country,
    from: o.from,
    to: o.to ?? '',
    payer: o.payer,
    certificateFrom: o.certificateFrom ?? '',
    certificateTo: o.certificateTo ?? '',
    note: o.note ?? '',
  };
}

export function overseasErrors(v: OverseasFormValue): Partial<Record<OverseasField, OverseasError>> {
  const out: Partial<Record<OverseasField, OverseasError>> = {};
  const bad = (s: string) => s !== '' && !DATE_RE.test(s);
  if (!v.country) out.country = 'required';
  else if (!/^[A-Z]{2}$/.test(v.country) || v.country === 'JP') out.country = 'country';
  if (!v.from) out.from = 'required';
  else if (bad(v.from)) out.from = 'date';
  if (bad(v.to)) out.to = 'date';
  else if (v.to && v.from && v.to <= v.from) out.to = 'order';
  if (bad(v.certificateFrom)) out.certificateFrom = 'date';
  if (bad(v.certificateTo)) out.certificateTo = 'date';
  else if (v.certificateTo && !v.certificateFrom) out.certificateFrom = 'pair';
  else if (v.certificateFrom && !v.certificateTo) out.certificateTo = 'pair';
  else if (v.certificateFrom && v.certificateTo && v.certificateTo <= v.certificateFrom) out.certificateTo = 'order';
  return out;
}

export function fromOverseasForm(v: OverseasFormValue): Overseas | null {
  if (Object.keys(overseasErrors(v)).length > 0) return null;
  const opt = (s: string) => (s.trim() === '' ? null : s.trim());
  return {
    country: v.country,
    from: v.from,
    to: opt(v.to),
    payer: v.payer,
    certificateFrom: opt(v.certificateFrom),
    certificateTo: opt(v.certificateTo),
    note: opt(v.note)?.slice(0, 200) ?? null,
  };
}

// ===== To-do の材料 =====

export interface OverseasPerson {
  id: string;
  retireDate: DateStr | null;
  overseas?: readonly Overseas[];
  health: { enrolled: boolean; lostDate: DateStr | null };
  pension: { enrolled: boolean; lostDate: DateStr | null };
}

/** 証明書の期限が近い海外勤務（期限の6か月前から、期限を過ぎて60日まで。帰任が期限までなら出さない） */
export function certificateEndingSoon(
  p: OverseasPerson,
  today: DateStr,
  months = CERTIFICATE_NOTICE_MONTHS,
): Overseas | null {
  if (p.retireDate && p.retireDate < today) return null;
  return (
    (p.overseas ?? []).find((o) => {
      if (!o.certificateTo) return false;
      if (o.to && o.to <= addDays(o.certificateTo, 1)) return false; // 期限までに帰任する
      return today >= shiftDate(o.certificateTo, -months) && today <= addDays(o.certificateTo, 60);
    }) ?? null
  );
}

/** 海外の会社だけが給与を払う海外勤務で、まだ日本の保険に入っている（赴任の60日前から） */
export function payAbroadEnrolled(p: OverseasPerson, today: DateStr, days = 60): Overseas | null {
  if (p.retireDate && p.retireDate < today) return null;
  const enrolled = (e: OverseasPerson['health']) => e.enrolled && !e.lostDate;
  if (!enrolled(p.health) && !enrolled(p.pension)) return null;
  return (
    (p.overseas ?? []).find(
      (o) => o.payer === 'abroad' && o.from <= addDays(today, days) && (!o.to || today < o.to),
    ) ?? null
  );
}
