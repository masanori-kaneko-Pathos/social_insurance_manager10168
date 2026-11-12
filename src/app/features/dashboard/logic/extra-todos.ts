// To-do の追加分：外国籍の人の在留・資格外活動・脱退一時金と、特定適用事業所の人数
// Angular・Firebase に依存しない純粋な関数。結果は保存せず、開くたびに計算する
//
// - residence：在留期間の満了日が60日以内（過ぎていて在籍中も）→ 在留カードの確認（更新の許可が出たか）
// - workPermit：資格外活動の許可の時間（週28時間など）を、今の契約の週の所定労働時間が超えている
// - lumpSum：外国籍で厚生年金に6か月以上入っていた人の退職（前後60日）→ 脱退一時金の案内
//   （請求は本人が出国後2年以内に日本年金機構へ。会社の届ではないので「案内した」で消せる）
// - specificOffice：特定適用事業所でないのに、今月の人数（厚生年金の被保険者の数え方）が基準以上
//   （直近12か月のうち6か月以上で基準を超えると該当。ここでは今月の人数で知らせる）
// - myNumberCheck：本人が提出したマイナンバーのチェック待ち（管理者だけ）
// - myNumberDispose：資格喪失から2年たった人のマイナンバー（廃棄する。ガイドライン「保管制限と廃棄」）
// - cardReturn：協会けんぽの事業所で、資格確認書が交付されている人が資格を喪失した（喪失届に添えて返す）
//   回収できなければ「資格確認書回収不能届」。組合健保は添付なし（日本年金機構「資格喪失届」の添付書類）
// - retireGuide：退職する人への案内（任意継続・国民健康保険・国民年金）。案内したら消せる
//   任意継続は、退職日までに継続して2か月以上加入していて、退職日の翌日から20日以内に本人が申し出る（協会けんぽ）
// - contractEnd：有期の雇用契約の満了が60日以内（過ぎていても、次の契約も退職日もなければ出す）
//   3回以上の更新か、入社から1年を超えて続いている人は、更新しないなら満了の30日前までに予告が要る
//   （有期労働契約の締結、更新、雇止め等に関する基準 第2条。あらかじめ「更新しない」と明示した契約は除く）
// - overseasCertificate：海外勤務の日本の適用証明書が6か月以内に切れる（帰任が期限までなら出さない）
//   延長するなら相手国の承認が要る。延長しないなら帰任するか、相手国の保険に切り替える
// - overseasPayAbroad：海外の会社だけが給与を払う海外勤務なのに、日本の保険に入っている（資格喪失の候補）

import { addDays, DateStr, daysInMonth, monthsBetween, shiftMonth, toYearMonth, YearMonth } from '../../../shared/utils/date';
import { contractAt } from '../../employees/logic/contract-form-model';
import type { MyNumberEntry } from '../../../core/models/my-number';
import { disposalDue, DisposalPerson } from '../../my-number/logic/my-number';
import { certificateEndingSoon, OverseasPerson, payAbroadEnrolled } from '../../employees/logic/overseas';
import { countHeadcount, criteriaAt, HeadcountTarget, isSpecificApplied, WorkSchedule } from '../../employees/logic/coverage';

export type ExtraKind =
  | 'residence'
  | 'workPermit'
  | 'lumpSum'
  | 'specificOffice'
  | 'myNumberCheck'
  | 'myNumberDispose'
  | 'contractEnd'
  | 'cardReturn'
  | 'retireGuide'
  | 'overseasCertificate'
  | 'overseasPayAbroad';

export interface ExtraTodo {
  kind: ExtraKind;
  employeeId: string | null;
  /** residence：満了日／workPermit：今の契約の始まる日／lumpSum：退職日／contractEnd：契約の満了日 */
  date: DateStr | null;
  /** 文の差し込み（時間・人数など） */
  params: Record<string, string | number>;
}

export const RESIDENCE_DAYS = 60;
export const LUMP_SUM_DAYS = 60;
/** 脱退一時金：厚生年金の加入期間がこの月数以上 */
export const LUMP_SUM_MIN_MONTHS = 6;

export interface ExtraPerson {
  id: string;
  retireDate: DateStr | null;
  pension: { enrolled: boolean; acquiredDate: DateStr | null; lostDate: DateStr | null };
  foreign: {
    residenceExpiry: DateStr | null;
    workPermit: boolean;
    workPermitWeeklyMinutes: number | null;
  } | null;
}

const active = (p: Pick<ExtraPerson, 'retireDate'>, today: DateStr) => !p.retireDate || p.retireDate >= today;
const hours = (m: number) => Math.round((m / 60) * 10) / 10;

/** 在留期間の満了日が60日以内（過ぎていても在籍中なら出す） */
export function residenceTodo(p: ExtraPerson, today: DateStr, days = RESIDENCE_DAYS): ExtraTodo | null {
  const exp = p.foreign?.residenceExpiry;
  if (!exp || !active(p, today) || exp > addDays(today, days)) return null;
  return { kind: 'residence', employeeId: p.id, date: exp, params: { date: exp } };
}

/** 資格外活動：今の契約の週の時間が、許可の時間を超える */
export function workPermitTodo(
  p: ExtraPerson,
  contracts: (Pick<WorkSchedule, 'weeklyMinutes'> & { from: DateStr })[],
  today: DateStr,
): ExtraTodo | null {
  const f = p.foreign;
  if (!f?.workPermit || f.workPermitWeeklyMinutes == null || !active(p, today)) return null;
  const c = contractAt(contracts, today);
  if (!c || c.weeklyMinutes <= f.workPermitWeeklyMinutes) return null;
  return {
    kind: 'workPermit',
    employeeId: p.id,
    date: c.from,
    params: { hours: hours(c.weeklyMinutes), limit: hours(f.workPermitWeeklyMinutes) },
  };
}

/**
 * 厚生年金の被保険者期間の月数（資格を取った月 〜 喪失した月の前月。保険料を納める月と同じ数え方）
 * 喪失日がまだ入っていなければ、退職日の翌日を喪失日とみなす
 */
export function pensionMonths(p: ExtraPerson): number {
  const from = p.pension.acquiredDate;
  const lost = p.pension.lostDate ?? (p.retireDate ? addDays(p.retireDate, 1) : null);
  if (!from || !lost || lost <= from) return 0;
  return monthsBetween(toYearMonth(from), shiftMonth(toYearMonth(lost), -1)).length;
}

/** 外国籍で厚生年金に6か月以上入っていた人の退職（退職日の前後60日） */
export function lumpSumTodo(p: ExtraPerson, today: DateStr, days = LUMP_SUM_DAYS): ExtraTodo | null {
  if (!p.foreign || !p.retireDate || !p.pension.enrolled) return null;
  if (p.retireDate < addDays(today, -days) || p.retireDate > addDays(today, days)) return null;
  const months = pensionMonths(p);
  if (months < LUMP_SUM_MIN_MONTHS) return null;
  return { kind: 'lumpSum', employeeId: p.id, date: p.retireDate, params: { months } };
}

/** 特定適用事業所でないのに、今月の人数が基準以上 */
export function specificOfficeTodo(
  office: {
    standardHours: WorkSchedule | null;
    specificApplication?: { since: string | null; insuredCount?: number | null } | null;
  },
  people: HeadcountTarget[],
  criteria: { from: YearMonth; sizeMin: number | null }[],
  month: YearMonth,
): ExtraTodo | null {
  if (isSpecificApplied(office.specificApplication, month)) return null;
  const sizeMin = criteriaAt(criteria, month)?.sizeMin;
  if (sizeMin == null) return null; // 規模の要件がない（なくなった）
  const manual = office.specificApplication?.insuredCount;
  const count = manual ?? countHeadcount(people, office.standardHours, month)?.counted;
  if (count == null || count < sizeMin) return null;
  return {
    kind: 'specificOffice',
    employeeId: null,
    date: null,
    params: { count, min: sizeMin, how: manual != null ? 'manual' : 'app' },
  };
}

/** マイナンバー：チェック待ち・廃棄の時期（状態の一覧は管理者だけが読める） */
export function myNumberTodos(
  people: readonly DisposalPerson[],
  index: ReadonlyMap<string, MyNumberEntry>,
  today: DateStr,
): ExtraTodo[] {
  const out: ExtraTodo[] = [];
  for (const p of people) {
    const e = index.get(p.id) ?? null;
    if (e?.status === 'submitted') {
      out.push({ kind: 'myNumberCheck', employeeId: p.id, date: e.updatedAt.slice(0, 10) || null, params: {} });
    }
    const due = disposalDue(p, e, today);
    if (due) out.push({ kind: 'myNumberDispose', employeeId: p.id, date: due, params: { date: due } });
  }
  return out;
}

// ===== 契約の満了 =====

/** 満了の何日前から出すか */
export const CONTRACT_END_DAYS = 60;
/** 雇止めの予告：満了の何日前までか（基準 第2条） */
export const NOTICE_DAYS = 30;
/** 予告が要る更新の回数（3回以上） */
export const NOTICE_RENEWALS = 3;

export interface ContractTerm {
  from: DateStr;
  periodEnd: DateStr | null;
  renewal: 'none' | 'possible' | 'expected';
}

/** 1年後の同じ日（2/29 は 2/28 にする） */
function oneYearAfter(date: DateStr): DateStr {
  const y = Number(date.slice(0, 4)) + 1;
  const md = date.slice(5) === '02-29' ? '02-28' : date.slice(5);
  return `${y}-${md}`;
}

/**
 * 雇止めの予告が要るか（更新しないとき）
 * - 3回以上更新している（有期の契約が4つ目以上）か、入社から1年を超えて続いている
 * - ただし、この契約で「更新しない」とあらかじめ明示していれば要らない
 */
export function noticeRequired(hireDate: DateStr, terms: readonly ContractTerm[], last: ContractTerm): boolean {
  if (last.renewal === 'none' || !last.periodEnd) return false;
  const renewals = terms.filter((t) => t.periodEnd !== null && t.from <= last.from).length - 1;
  return renewals >= NOTICE_RENEWALS || last.periodEnd >= oneYearAfter(hireDate);
}

/** 2か月以内の契約か（更新して2か月を超える見込みになると、その時点で社会保険の対象になる） */
export function isShortTerm(t: ContractTerm): boolean {
  if (!t.periodEnd) return false;
  // 2か月後の同じ日の前の日（4/10 始まり → 6/9 まで）。その月にない日は月末にそろえる
  const ym = shiftMonth(toYearMonth(t.from), 2);
  const day = Math.min(Number(t.from.slice(8)), daysInMonth(ym));
  return t.periodEnd <= addDays(`${ym}-${String(day).padStart(2, '0')}`, -1);
}

/** 有期の契約の満了が近い（いちばん新しい契約で判断する） */
export function contractEndTodo(
  p: Pick<ExtraPerson, 'id' | 'retireDate'> & { hireDate: DateStr },
  terms: readonly ContractTerm[],
  today: DateStr,
  days = CONTRACT_END_DAYS,
): ExtraTodo | null {
  if (terms.length === 0) return null;
  const last = terms.reduce((a, b) => (b.from > a.from ? b : a));
  const end = last.periodEnd;
  if (!end || end > addDays(today, days)) return null;
  // 更新しないと決めて退職日が入っていれば、喪失の To-do に任せる
  if (p.retireDate && p.retireDate <= end) return null;
  if (p.retireDate && p.retireDate < today) return null;
  const notice = noticeRequired(p.hireDate, terms, last);
  return {
    kind: 'contractEnd',
    employeeId: p.id,
    date: end,
    params: {
      date: end,
      notice: notice ? 'yes' : 'no',
      noticeBy: notice ? addDays(end, -NOTICE_DAYS) : '',
      shortTerm: isShortTerm(last) ? 'yes' : 'no',
    },
  };
}

// ===== 資格確認書の回収 =====

/** 喪失の前後、何日のあいだ出すか */
export const CARD_RETURN_DAYS = 60;

export interface CardPerson {
  id: string;
  retireDate: DateStr | null;
  needsConfirmationCard: boolean;
  health: { enrolled: boolean; lostDate: DateStr | null };
}

/** 協会けんぽで、資格確認書が交付されている人の喪失（喪失日の60日前〜60日後） */
export function cardReturnTodo(
  p: CardPerson,
  insurer: 'kyokai' | 'kumiai',
  today: DateStr,
  days = CARD_RETURN_DAYS,
): ExtraTodo | null {
  if (insurer !== 'kyokai' || !p.needsConfirmationCard || !p.health.enrolled) return null;
  const lost = p.health.lostDate ?? (p.retireDate ? addDays(p.retireDate, 1) : null);
  if (!lost || lost < addDays(today, -days) || lost > addDays(today, days)) return null;
  return { kind: 'cardReturn', employeeId: p.id, date: lost, params: { date: lost } };
}

// ===== 退職する人への案内（任意継続など） =====

/** 退職日の前後、何日のあいだ出すか */
export const RETIRE_GUIDE_DAYS = 30;
/** 任意継続：退職日の翌日から20日以内（翌日を1日目に数えて20日目 ＝ 退職日＋20日） */
export const VOLUNTARY_DAYS = 20;

export interface RetirePerson {
  id: string;
  retireDate: DateStr | null;
  retireReason: 'resign' | 'death' | 'transfer' | 'other' | null;
  health: { enrolled: boolean; acquiredDate: DateStr | null };
}

/** 'YYYY-MM-DD' の n か月後の同じ日（その月にない日は月末） */
function addMonthsTo(date: DateStr, n: number): DateStr {
  const ym = shiftMonth(toYearMonth(date), n);
  const d = Math.min(Number(date.slice(8)), daysInMonth(ym));
  return `${ym}-${String(d).padStart(2, '0')}`;
}

/** 退職日までに、継続して2か月以上健康保険に入っていたか（任意継続の条件） */
export function voluntaryEligible(p: RetirePerson): boolean {
  if (!p.retireDate || !p.health.enrolled || !p.health.acquiredDate) return false;
  // 資格を失う日（退職日の翌日）が、取得日の2か月後以降
  return addDays(p.retireDate, 1) >= addMonthsTo(p.health.acquiredDate, 2);
}

/** 退職する人への案内（死亡・転勤は除く） */
export function retireGuideTodo(
  p: RetirePerson,
  insurer: 'kyokai' | 'kumiai',
  today: DateStr,
  days = RETIRE_GUIDE_DAYS,
): ExtraTodo | null {
  if (!p.retireDate || !p.health.enrolled) return null;
  if (p.retireReason === 'death' || p.retireReason === 'transfer') return null;
  if (p.retireDate < addDays(today, -days) || p.retireDate > addDays(today, days)) return null;
  return {
    kind: 'retireGuide',
    employeeId: p.id,
    date: p.retireDate,
    params: {
      date: p.retireDate,
      voluntary: voluntaryEligible(p) ? 'yes' : 'no',
      deadline: addDays(p.retireDate, VOLUNTARY_DAYS),
      insurer,
    },
  };
}

// ===== 海外勤務 =====

/** 日本の適用証明書の期限が近い（日付 ＝ 証明書の期限） */
export function overseasCertificateTodo(p: OverseasPerson, today: DateStr): ExtraTodo | null {
  const o = certificateEndingSoon(p, today);
  if (!o) return null;
  return {
    kind: 'overseasCertificate',
    employeeId: p.id,
    date: o.certificateTo,
    params: { date: o.certificateTo!, country: o.country, from: o.from },
  };
}

/** 海外の会社だけが給与を払う（日付 ＝ 赴任した日。喪失するならその日が資格喪失日） */
export function overseasPayAbroadTodo(p: OverseasPerson, today: DateStr): ExtraTodo | null {
  const o = payAbroadEnrolled(p, today);
  if (!o) return null;
  return { kind: 'overseasPayAbroad', employeeId: p.id, date: o.from, params: { date: o.from, country: o.country } };
}
