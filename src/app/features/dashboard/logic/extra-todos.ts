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
// - ratesMissing：2〜4月になっても、その年の3月分からの健康保険の料率が登録されていない（11/16）
//   協会けんぽは料率マスタ（アプリ側で入れる）、組合健保は事業所が入れる料率。料率が変わらない組合は「確認した」で消す
// - adjustmentDeadline：保険料調整制度を使える事業所なのに申出がまだで、申出の期限（月の末日）が90日以内（11/16）
// - insurerChange：健康保険の保険者が変わる（協会けんぽ ⇄ 組合、組合 ⇄ 別の組合）。切り替えの2か月前から3か月後まで（11/17）
//   手続きは保険者ごとに違うので、期限は決めず「案内」として出す。厚生年金保険の資格は続く（届は要らない）
//   根拠：健康保険組合の編入の案内（Q&A）の実例。書類と期限は新しい保険者の案内に従う
// - bonusNone：事業所の設定の「賞与の支払予定月」に、だれにも賞与を払っていない（11/19）
//   → 賞与不支給報告書（日本年金機構。支払予定月の翌月末日まで）。先月・先々月の分を出す
// - acquireAmount：資格取得届の報酬月額より、入社後3か月以内の給与の固定的賃金が多い（手当の入れ漏れ。11/19）
// - actualHours：所定は基準未満だが、実際の労働時間が連続する2か月とも基準以上（加入していない人。11/19）
// - bonusReport：賞与を払った（社会保険の対象の支給）→ 賞与支払届（支払日から5日以内。健保法施行規則27条・厚年法施行規則19条。11/20）
//   支払日ごとに1件。払った日から60日のあいだ出す（出したら「確認した」で消す）
// - acquireReport・lossReport：資格を取った・なくした（登録済みの人）→ 資格取得届・資格喪失届（その日から5日以内。
//   健保法施行規則24条・29条、厚年法施行規則15条・22条。11/20）。その日から60日のあいだ出す（出したら「確認した」で消す）
//   加入していない人の「加入の判断」（acquire）・「喪失の判断」（lose）とは別。こちらは届を出したかの確認
// - dependentReport：扶養家族が増えた・減った（事業所が画面か CSV で登録した）→ 被扶養者（異動）届（その日から5日以内。
//   健保法施行規則38条）。資格取得と同時の扶養も、取得届と一緒に出す。その日から60日のあいだ出す（11/20）
//   マイページの申請から来た届出の宿題（dependentChange）が残っている人は、そちらに任せて出さない
// - bonusCumulative：前の事業所の分と合わせて、健保の標準賞与額の年度の累計が上限（573万円）を超えた（11/19）
//   → 本人が保険者に「健康保険標準賞与額累計申出書」を出す（同じ保険者で転職した人。出さないと上限が効かない）
// - childcareSpecial：3歳未満の子を養育していて、厚生年金の標準報酬月額が子の生まれた月の前月より下がった（11/19）
//   → 「厚生年金保険 養育期間標準報酬月額特例申出書」（事業主経由。厚生年金保険法26条）。保険料は下がった額のまま、
//   年金の計算だけ前の額で数える。さかのぼれるのは申出の月の前月までの2年間。男女とも対象

import { addDays, DateStr, daysInMonth, fiscalYearOf, monthsBetween, shiftMonth, toYearMonth, YearMonth } from '../../../shared/utils/date';
import { contractAt } from '../../employees/logic/contract-form-model';
import type { MyNumberEntry } from '../../../core/models/my-number';
import { disposalDue, DisposalPerson, hasNumber } from '../../my-number/logic/my-number';
import { certificateEndingSoon, OverseasPerson, payAbroadEnrolled } from '../../employees/logic/overseas';
import type { Classification } from '../../employees/logic/classify';
import { countHeadcount, criteriaAt, HeadcountTarget, isSpecificApplied, WorkSchedule } from '../../employees/logic/coverage';
import { FROM_THE_START, insurerHistoryOf, insurerKeyOf } from '../../office/office-settings';
import type { HealthInsurer, InsurerPeriod } from '../../../core/models/office';
import { bonusStatus, healthBonusCapOf, priorHealthOf, PriorBonusHolder, standardBonusOf } from '../../premiums/logic/calc-bonus';
import { bonusesOf, BonusPaymentLike } from '../../premiums/logic/bonus-rows';
import { isNotCovered, recipientsOf } from '../../premiums/logic/bonus-nature';
import { CoverageInput, healthLostDate } from '../../employees/logic/coverage';
import { insuredDuring, Period, PayrollEmployee } from '../../payrolls/logic/payroll-rows';

export type ExtraKind =
  | 'registerGaps'
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
  | 'overseasPayAbroad'
  | 'ratesMissing'
  | 'payrollMissing'
  | 'adjustmentDeadline'
  | 'insurerChange'
  | 'bonusNone'
  | 'bonusReport'
  | 'acquireReport'
  | 'lossReport'
  | 'bonusCumulative'
  | 'actualHours'
  | 'acquireAmount'
  | 'childcareSpecial'
  | 'dependentReport';

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

/**
 * 今月払いの給与で、まだ入力していない人がいる（11/26）
 * 数え方は「月ごとの給与」の「未入力」と同じ：その人の対象期間に社会保険に加入していて、給与がまだない人。
 * 支払日を過ぎた最新の月だけ（呼ぶ側が latestPaidMonth を渡す）。入力すれば消えるので、確認済みにはしない
 */
export function payrollMissingTodo<E extends PayrollEmployee>(
  month: YearMonth,
  employees: readonly E[],
  periodOfEmployee: (e: E) => Period,
  saved: ReadonlySet<string>,
): ExtraTodo | null {
  const count = employees.filter((e) => insuredDuring(e, periodOfEmployee(e)) && !saved.has(e.id)).length;
  if (count === 0) return null;
  return { kind: 'payrollMissing', employeeId: null, date: null, params: { month, m: Number(month.slice(5, 7)), count } };
}

/** 来年度の料率を知らせ始める月・やめる月（協会けんぽの料率は2月上旬に決まり、3月分から変わる） */
export const RATES_NOTICE_FROM = 2;
export const RATES_NOTICE_TO = 4;

/**
 * 2〜4月になっても、その年の3月分からの健康保険の料率がない
 * rateFroms：今の保険者の料率の「何月分から」（協会けんぽ：料率マスタの kyokaiHealth、組合健保：事業所が入れた料率）
 * 日付は3月1日（鍵に入るので、確認済みにしても次の年にまた出る）
 */
export function ratesMissingTodo(insurer: 'kyokai' | 'kumiai', rateFroms: readonly YearMonth[], today: DateStr): ExtraTodo | null {
  const month = Number(today.slice(5, 7));
  if (month < RATES_NOTICE_FROM || month > RATES_NOTICE_TO) return null;
  const target = `${today.slice(0, 4)}-03`;
  if (rateFroms.some((f) => f >= target)) return null;
  return { kind: 'ratesMissing', employeeId: null, date: `${target}-01`, params: { insurer, year: today.slice(0, 4) } };
}

/** 保険者の切り替え：何か月前から・何か月後まで出すか */
export const INSURER_CHANGE_BEFORE_MONTHS = 2;
export const INSURER_CHANGE_AFTER_MONTHS = 3;

export type InsurerChangeDirection = 'toKumiai' | 'toKyokai' | 'kumiaiToKumiai';

/**
 * 健康保険の保険者が変わる月（事業所の「保険者・所在地の履歴」から計算する）
 * 都道府県だけが変わった行（協会けんぽのまま）は出さない。日付は切り替える月の1日
 */
export function insurerChangeTodos(
  office: { prefecture: string; healthInsurer: HealthInsurer; insurerHistory?: InsurerPeriod[] },
  today: DateStr,
): ExtraTodo[] {
  const history = insurerHistoryOf(office);
  const keyOf = insurerKeyOf(office);
  const out: ExtraTodo[] = [];
  for (let i = 1; i < history.length; i++) {
    const cur = history[i];
    if (cur.from === FROM_THE_START) continue;
    const before = shiftMonth(cur.from, -1);
    if (keyOf(before) === keyOf(cur.from)) continue;
    const showFrom = `${shiftMonth(cur.from, -INSURER_CHANGE_BEFORE_MONTHS)}-01`;
    const showUntil = `${shiftMonth(cur.from, INSURER_CHANGE_AFTER_MONTHS + 1)}-01`;
    if (today < showFrom || today >= showUntil) continue;
    const prev = history[i - 1].healthInsurer;
    const next = cur.healthInsurer;
    const direction: InsurerChangeDirection =
      next.type === 'kumiai' ? (prev.type === 'kumiai' ? 'kumiaiToKumiai' : 'toKumiai') : 'toKyokai';
    out.push({
      kind: 'insurerChange',
      employeeId: null,
      date: `${cur.from}-01`,
      params: { direction, month: cur.from, from: prev.kumiaiName ?? '', to: next.kumiaiName ?? '' },
    });
  }
  return out;
}

export const ADJUSTMENT_DEADLINE_DAYS = 90;

/**
 * 保険料調整制度：使える事業所で、申出がまだで、申出の期限（deadlineMonth の末日）が90日以内
 * 期限を過ぎたら出さない（もう申し出られない）
 */
export function adjustmentDeadlineTodo(
  deadlineMonth: YearMonth | null,
  using: boolean,
  today: DateStr,
  days = ADJUSTMENT_DEADLINE_DAYS,
): ExtraTodo | null {
  if (!deadlineMonth || using) return null;
  const date = `${deadlineMonth}-${String(daysInMonth(deadlineMonth)).padStart(2, '0')}`;
  if (date < today || date > addDays(today, days)) return null;
  return { kind: 'adjustmentDeadline', employeeId: null, date, params: { date } };
}

/** マイナンバー：チェック待ち・廃棄の時期（状態の一覧は管理者だけが読める） */
export function myNumberTodos(
  people: readonly DisposalPerson[],
  index: ReadonlyMap<string, MyNumberEntry>,
  today: DateStr,
  /** 家族の番号（従業員ID → 家族ID → 状態）。チェック待ちと、廃棄のときの件数に使う */
  family: ReadonlyMap<string, ReadonlyMap<string, MyNumberEntry>> = new Map(),
): ExtraTodo[] {
  const out: ExtraTodo[] = [];
  for (const p of people) {
    const e = index.get(p.id) ?? null;
    const fam = [...(family.get(p.id)?.values() ?? [])];
    // チェック待ち：本人の分と家族の分を1件にまとめる（同じ人の To-do が2つに分かれないように）
    const famSubmitted = fam.filter((f) => f.status === 'submitted');
    if (e?.status === 'submitted' || famSubmitted.length > 0) {
      const dates = [e?.status === 'submitted' ? e.updatedAt : '', ...famSubmitted.map((f) => f.updatedAt)]
        .map((d) => d.slice(0, 10))
        .filter(Boolean)
        .sort();
      out.push({
        kind: 'myNumberCheck',
        employeeId: p.id,
        date: dates[0] ?? null,
        params: { self: e?.status === 'submitted' ? 'yes' : 'no', family: famSubmitted.length },
      });
    }
    // 廃棄：本人の喪失から2年。家族の番号が残っていれば、その件数も知らせる
    const due = disposalDue(p, e, today);
    if (due) {
      const famHeld = fam.filter((f) => hasNumber(f.status)).length;
      out.push({ kind: 'myNumberDispose', employeeId: p.id, date: due, params: { date: due, family: famHeld } });
    }
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
  retireReason: 'resign' | 'dismissal' | 'death' | 'transfer' | 'other' | null;
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

// ===== 賞与（11/19） =====

/** 先月・先々月が支払予定月で、その月にだれにも賞与を払っていなければ To-do（期限：予定月の翌月末日） */
export function bonusNoneTodos(
  bonusMonths: readonly number[],
  payments: readonly Pick<BonusPaymentLike, 'paidDate' | 'amounts' | 'inKindAmounts' | 'rule'>[],
  today: DateStr,
): ExtraTodo[] {
  const thisMonth = toYearMonth(today);
  // 社会保険の対象外の項目（祝い金など）だけを払った月は、賞与を払っていない扱い
  const paid = new Set(
    payments
      .filter((p) => !isNotCovered(p) && recipientsOf(p).length > 0)
      .map((p) => toYearMonth(p.paidDate)),
  );
  const out: ExtraTodo[] = [];
  for (const back of [2, 1]) {
    const month = shiftMonth(thisMonth, -back);
    if (!bonusMonths.includes(Number(month.slice(5, 7))) || paid.has(month)) continue;
    const next = shiftMonth(month, 1);
    const date = `${next}-${String(daysInMonth(next)).padStart(2, '0')}`;
    out.push({ kind: 'bonusNone', employeeId: null, date, params: { year: month.slice(0, 4), month: Number(month.slice(5, 7)), date } });
  }
  return out;
}

/** 賞与を払った日ごとに「賞与支払届」（期限：支払日を含めて5日。60日より前の支払は出さない。11/20） */
export const BONUS_REPORT_DAYS = 60;
export function bonusReportTodos(
  payments: readonly Pick<BonusPaymentLike, 'paidDate' | 'amounts' | 'inKindAmounts' | 'rule'>[],
  today: DateStr,
): ExtraTodo[] {
  const since = addDays(today, -BONUS_REPORT_DAYS);
  const people = new Map<DateStr, Set<string>>();
  for (const p of payments) {
    if (isNotCovered(p) || p.paidDate > today || p.paidDate < since) continue;
    const ids = recipientsOf(p);
    if (ids.length === 0) continue;
    const set = people.get(p.paidDate) ?? new Set<string>();
    ids.forEach((id) => set.add(id));
    people.set(p.paidDate, set);
  }
  return [...people.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ids]) => ({ kind: 'bonusReport' as const, employeeId: null, date, params: { date, count: ids.size } }));
}

/** 資格取得届・資格喪失届の期限（取得日・喪失日を含めて5日）。60日より前と、これからの日は出さない（11/20） */
export const ENROLLMENT_REPORT_DAYS = 60;
export interface EnrollmentReportPerson {
  id: string;
  birthDate: DateStr;
  retireDate: DateStr | null;
  health: { enrolled: boolean; acquiredDate: DateStr | null; lostDate: DateStr | null };
  pension: { enrolled: boolean; acquiredDate: DateStr | null; lostDate: DateStr | null };
}
export function enrollmentReportTodos(p: EnrollmentReportPerson, today: DateStr): ExtraTodo[] {
  const since = addDays(today, -ENROLLMENT_REPORT_DAYS);
  const inRange = (d: DateStr | null): d is DateStr => !!d && d >= since && d <= today;
  const out: ExtraTodo[] = [];
  const parts = [p.health, p.pension].filter((x) => x.enrolled);
  // 健保と厚年で日が違えば、それぞれ1件（70歳で厚年だけ、など。届は同じ様式）
  const acquired = [...new Set(parts.map((x) => x.acquiredDate).filter(inRange))].sort();
  for (const date of acquired) out.push({ kind: 'acquireReport', employeeId: p.id, date, params: { date } });
  // 喪失日：記録の日か退職日の翌日。健保は75歳の誕生日も（後期高齢者。喪失届が要る）
  // 厚年の70歳到達は「70歳到達届」なので、年齢の To-do に任せてここでは出さない
  const left = (x: { lostDate: DateStr | null }) => x.lostDate ?? (p.retireDate ? addDays(p.retireDate, 1) : null);
  const healthLost = p.health.enrolled
    ? healthLostDate({ birthDate: p.birthDate, health: { ...p.health, lostDate: left(p.health) }, pension: p.pension })
    : null;
  const pensionLost = p.pension.enrolled ? left(p.pension) : null;
  const lost = [...new Set([healthLost, pensionLost].filter(inRange))].sort();
  for (const date of lost) out.push({ kind: 'lossReport', employeeId: p.id, date, params: { date } });
  return out;
}

export type CumulativePerson = CoverageInput & PriorBonusHolder & { id: string };

/** 前の事業所の分がある人で、今年度・前年度の健保の標準賞与額の累計が上限を超えたら To-do */
export function bonusCumulativeTodos(
  p: CumulativePerson,
  payments: BonusPaymentLike[],
  today: DateStr,
): ExtraTodo[] {
  const thisYear = fiscalYearOf(toYearMonth(today));
  const lost = healthLostDate(p);
  const bonuses = bonusesOf(p.id, payments).filter(
    (b) => bonusStatus(p.health.enrolled, p.health.acquiredDate, lost, b.paidDate) !== 'none',
  );
  const out: ExtraTodo[] = [];
  for (const year of [thisYear - 1, thisYear]) {
    const prior = priorHealthOf(p, year);
    if (prior <= 0) continue;
    // 同じ月の賞与は合計で千円未満を切り捨てる
    const byMonth = new Map<string, number>();
    for (const b of bonuses) {
      const m = toYearMonth(b.paidDate);
      if (fiscalYearOf(m) === year) byMonth.set(m, (byMonth.get(m) ?? 0) + b.amount);
    }
    const own = [...byMonth.values()].reduce((s, a) => s + standardBonusOf(a), 0);
    const cap = healthBonusCapOf(year);
    if (prior + own > cap) {
      out.push({ kind: 'bonusCumulative', employeeId: p.id, date: null, params: { year, total: (prior + own).toLocaleString('ja-JP'), cap: cap.toLocaleString('ja-JP') } });
    }
  }
  return out;
}

// ===== 実際の労働時間（11/19。調査指摘事例集 事例1） =====

/**
 * 契約の時間では加入しない人の、実際の労働時間で見る基準（週の分）
 * - 4分の3に届かず、特定適用事業所でない：所定労働時間の4分の3
 * - 特定適用事業所で、週20時間に届かない：週20時間（基準の表の値）
 * - それ以外（加入している・学生・賃金など時間以外の理由）：見ない（null）
 */
export function actualHoursThreshold(c: Pick<Classification, 'category' | 'reason' | 'nums'>): number | null {
  if (c.category !== 'excluded' || !c.nums) return null;
  if (c.reason === 'notSpecific' && c.nums.stdWeeklyMinutes) return Math.ceil((c.nums.stdWeeklyMinutes * 3) / 4);
  if (c.reason === 'under20h' && c.nums.minWeeklyMinutes) return c.nums.minWeeklyMinutes;
  return null;
}

/** 1か月の実労働時間（分）→ 週（分）：× 12 ÷ 52（1分未満切り捨て） */
export function weeklyOfMonthly(minutes: number): number {
  return Math.floor((minutes * 12) / 52);
}

/**
 * 所定は基準未満でも、実際の労働時間が連続する2か月とも基準以上なら To-do（加入していない人だけ）
 * 引き続き同じ状態が続いている（見込まれる）なら、「実際の労働時間が週20時間以上となった月の3月目の初日」に資格取得
 * （日本年金機構「調査指摘・改善指導事例集」事例1）。続くかどうかは人が判断する（「確認した」で消せる）
 * 月は働いた月で数える（11/25）。workMonthOf：支払月 → その給与の計算期間の月（翌月払いなら前の月）。省くと支払月のまま
 */
export function actualHoursTodo(
  p: { id: string; health: { enrolled: boolean }; pension: { enrolled: boolean } },
  threshold: number | null,
  months: readonly { paidMonth: string; workMinutes: number | null }[],
  workMonthOf: (paidMonth: string) => string = (m) => m,
): ExtraTodo | null {
  if (threshold === null || p.health.enrolled || p.pension.enrolled) return null;
  const sorted = [...months].sort((a, b) => a.paidMonth.localeCompare(b.paidMonth)).slice(-2);
  if (sorted.length < 2) return null;
  const [w1, w2] = sorted.map((m) => workMonthOf(m.paidMonth));
  if (shiftMonth(w1, 1) !== w2) return null;
  const weekly = sorted.map((m) => (m.workMinutes === null ? null : weeklyOfMonthly(m.workMinutes)));
  if (weekly.some((w) => w === null || w < threshold)) return null;
  const date = `${shiftMonth(w2, 1)}-01`;
  const h = (m: number) => Math.round((m / 60) * 10) / 10;
  return {
    kind: 'actualHours',
    employeeId: p.id,
    date,
    params: {
      first: sorted[0].paidMonth,
      second: sorted[1].paidMonth,
      h1: h(weekly[0]!),
      h2: h(weekly[1]!),
      limit: h(threshold),
      date,
    },
  };
}

// ===== 資格取得時の報酬月額（11/19。調査指摘事例集 事例2） =====

/**
 * 資格取得届に書いた報酬月額（契約の見込み）より、入社後に払った給与の固定的賃金のほうが多い月があれば To-do
 * 通勤手当・住宅手当などを、申請待ちで翌月以降に払い始めても、取得時の報酬月額に含める（訂正届が要る）
 * 見るのは、取得した月から3か月以内に払った給与だけ（それより後の変動は随時改定の話）
 */
export function acquireAmountTodo(
  p: { id: string; health: { enrolled: boolean; acquiredDate: DateStr | null }; pension: { enrolled: boolean; acquiredDate: DateStr | null } },
  reported: number | null,
  months: readonly { paidMonth: string; fixed: number }[],
): ExtraTodo | null {
  const acquired = [p.health, p.pension].filter((x) => x.enrolled && x.acquiredDate).map((x) => x.acquiredDate!).sort()[0];
  if (!acquired || reported === null || reported <= 0) return null;
  const from = toYearMonth(acquired);
  const over = [...months]
    .filter((m) => m.paidMonth >= from && m.paidMonth <= shiftMonth(from, 3) && m.fixed > reported)
    .sort((a, b) => a.paidMonth.localeCompare(b.paidMonth))[0];
  if (!over) return null;
  return {
    kind: 'acquireAmount',
    employeeId: p.id,
    date: acquired,
    params: { reported: reported.toLocaleString('ja-JP'), month: over.paidMonth, fixed: over.fixed.toLocaleString('ja-JP') },
  };
}

// ===== 養育期間標準報酬月額特例（厚生年金保険法26条。11/19） =====

/** 子が3歳になるまでの最後の月：3歳に達した日（誕生日の前日）の翌日＝誕生日の属する月の前月 */
export function childcareSpecialEnd(childBirthDate: DateStr): YearMonth {
  const [y, m] = childBirthDate.split('-').map(Number);
  return shiftMonth(`${y + 3}-${String(m).padStart(2, '0')}`, -1);
}

/** その月に効いている厚生年金の標準報酬月額（その月より前の最新の決定） */
function pensionStandardAt(history: readonly { from: YearMonth; pension: number }[], month: YearMonth): number | null {
  const h = history.filter((x) => x.from <= month).sort((a, b) => b.from.localeCompare(a.from))[0];
  return h ? h.pension : null;
}

/**
 * 3歳未満の子を養育している人で、子の生まれた月（養育を始めた月）から今月までのうち、
 * 厚生年金の標準報酬月額が「基準月（生まれた月の前月）」より低い月がある → 養育期間標準報酬月額特例申出書の案内
 * - 子の生年月日は、休業（産休の出産日・育休の子の生年月日／実子以外は養育開始日）と、扶養家族の「子」から集める
 * - 基準月に厚生年金に入っていない人（子が生まれたあとに入社した人など）は、前の会社の額がわからないので出さない
 *   （本当は基準月の前1年以内の直近の月の額。本人に聞いて申し出る）
 * - さかのぼれるのは、申出の月の前月までの2年間（今月を申出の月と考える）
 * - 育休・産休（保険料の免除）が始まると特例は終わり、終わったあとにもう一度申し出る（保険料の免除中は額が変わらないので、ここでは分けない）
 */
export function childcareSpecialTodo(
  p: { id: string; retireDate: DateStr | null; pension: { enrolled: boolean; acquiredDate: DateStr | null } },
  childStarts: readonly DateStr[],
  history: readonly { from: YearMonth; pension: number }[],
  today: DateStr,
): ExtraTodo | null {
  if (!active(p, today) || !p.pension.enrolled || !p.pension.acquiredDate) return null;
  const thisMonth = toYearMonth(today);
  for (const start of [...new Set(childStarts)].sort().reverse()) {
    const from = toYearMonth(start);
    const base = shiftMonth(from, -1);
    if (toYearMonth(p.pension.acquiredDate) > base) continue;
    const pre = pensionStandardAt(history, base);
    if (pre === null) continue;
    const lower = [from, shiftMonth(thisMonth, -24)].sort()[1];
    const upper = [childcareSpecialEnd(start), thisMonth].sort()[0];
    if (lower > upper) continue;
    // 範囲の中で効いている決定（範囲の初めに効いているものと、範囲の中で始まるもの）
    const months = [lower, ...history.map((h) => h.from).filter((m) => m > lower && m <= upper)];
    const low = months.map((m) => ({ m, v: pensionStandardAt(history, m) })).find((x) => x.v !== null && x.v < pre);
    if (!low) continue;
    return {
      kind: 'childcareSpecial',
      employeeId: p.id,
      date: start,
      params: { child: start, base, pre: pre.toLocaleString('ja-JP'), month: low.m, now: low.v!.toLocaleString('ja-JP'), until: childcareSpecialEnd(start) },
    };
  }
  return null;
}

/** 養育する子の「養育を始めた日」：休業の記録（産休の出産日・育休の子の生年月日、実子以外は養育開始日）と、扶養家族の子の生年月日 */
export function childStartsOf(
  leaves: readonly { kind: string; birthDate: DateStr | null; childBirthDate: DateStr | null; childType: string | null; custodyStart: DateStr | null }[],
  dependents: readonly { relationship: string; birthDate: DateStr }[],
): DateStr[] {
  const out = new Set<DateStr>();
  for (const l of leaves) {
    if (l.kind === 'maternity' && l.birthDate) out.add(l.birthDate);
    if (l.kind === 'childcare' || l.kind === 'paternity') {
      const d = l.childType === 'other' ? (l.custodyStart ?? l.childBirthDate) : l.childBirthDate;
      if (d) out.add(d);
    }
  }
  for (const d of dependents) if (d.relationship === 'child' && d.birthDate) out.add(d.birthDate);
  return [...out];
}

// ===== 被扶養者（異動）届（11/20） =====

export interface DependentReportPerson {
  id: string;
  health: { enrolled: boolean; acquiredDate: DateStr | null; lostDate: DateStr | null };
}

/** 扶養家族の「扶養になった日」「外れた日」 */
export interface DependentSpan {
  from: DateStr;
  to: DateStr | null;
}

/**
 * 被扶養者（異動）届の To-do（1人の1日につき1件。増えた人数・減った人数を文に入れる）
 * - 健康保険に入っている間の日だけ（被扶養者は健康保険の制度。取得日と同じ日は出す＝取得届と一緒に出す）
 * - 今日から60日前〜今日の日だけ（資格取得届と同じ。出したら「確認した」で消す）
 * - skip：マイページの申請から来た届出の宿題が残っている人（二重に出さない）
 */
export function dependentReportTodos(
  p: DependentReportPerson,
  dependents: readonly DependentSpan[],
  today: DateStr,
  skip: ReadonlySet<string> = new Set(),
): ExtraTodo[] {
  if (skip.has(p.id) || !p.health.enrolled || !p.health.acquiredDate) return [];
  const acquired = p.health.acquiredDate;
  const lost = p.health.lostDate;
  const since = addDays(today, -ENROLLMENT_REPORT_DAYS);
  const covered = (d: DateStr) => d >= since && d <= today && d >= acquired && (!lost || d < lost);
  const byDate = new Map<DateStr, { start: number; end: number }>();
  const add = (d: DateStr, k: 'start' | 'end') => {
    const c = byDate.get(d) ?? { start: 0, end: 0 };
    c[k]++;
    byDate.set(d, c);
  };
  for (const d of dependents) {
    if (d.from && covered(d.from)) add(d.from, 'start');
    if (d.to && covered(d.to)) add(d.to, 'end');
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, c]) => ({ kind: 'dependentReport' as const, employeeId: p.id, date, params: { date, start: c.start, end: c.end } }));
}

// ===== 労働者名簿の記入漏れ（事業所で1件にまとめる。人ごとに並べると届出の To-do が埋もれるため。11/24） =====

/** people：記入漏れのある人の数、by：何の漏れが何人か（labor-register の countGaps） */
export function registerGapsTodo(count: { people: number; by: Partial<Record<string, number>> }): ExtraTodo | null {
  if (count.people === 0) return null;
  return { kind: 'registerGaps', employeeId: null, date: null, params: { n: count.people, ...count.by } as Record<string, number> };
}
