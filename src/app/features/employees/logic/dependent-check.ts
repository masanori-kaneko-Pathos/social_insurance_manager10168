/**
 * 扶養家族が「扶養の基準を満たしていそうか」の候補（最後に決めるのは年金機構）
 * 根拠：日本年金機構「従業員が家族を被扶養者にするとき」、19歳以上23歳未満の年収要件（2025-10-01）、
 *       労働契約内容による年間収入の判定（2026-04-01）
 * Angular・Firebase に依存しない純粋な関数
 */
import { DependentDoc, Relationship } from '../../../core/models/dependent';
import { addDays, ageAt } from '../../../shared/utils/date';

export type CheckLevel = 'ok' | 'review' | 'ng';

/** 年収の上限の種類 */
export type LimitReason = 'base' | 'young' | 'senior' | 'disabled';

/** 引っかかった決まり（ng：基準外／review：要確認） */
export type CheckIssue =
  | 'age75' // 75歳以上は後期高齢者医療へ（ng）
  | 'cohabitationRequired' // 同居が要る続柄なのに別居（ng）
  | 'overLimit' // 年収が上限以上（ng）
  | 'overInsured' // 同居で、被保険者の年収を上回る（ng）
  | 'halfOrMore' // 同居で、被保険者の年収の半分以上（review：総合的に判断されることがある）
  | 'insuredIncomeUnknown' // 被保険者の年収がわからない（review）
  | 'overRemittance' // 別居で、仕送りの年額以上（ng）
  | 'noRemittance'; // 別居なのに仕送りの額がない（review）

/** 労働契約の方式が使えない理由 */
export type ContractIssue =
  | 'notYet' // 2026-04-01 より前の判定
  | 'shortContract' // 契約期間が、扶養に入った日から1年未満
  | 'unclearHours' // 「シフト制による」など時間がはっきりしない
  | 'unclearAllowances'; // 「通勤手当有」など手当の額がはっきりしない

export interface DependentCheck {
  level: CheckLevel;
  issues: CheckIssue[];
  limit: number;
  limitReason: LimitReason;
  /** 判定に使った年収と、その出どころ */
  income: number;
  incomeSource: 'estimate' | 'contract';
  /** 労働契約の方式を選んだのに使えなかった理由（使えたときは空） */
  contractIssues: ContractIssue[];
  /** 別居のときの仕送りの年額（ないときは null） */
  remittanceYear: number | null;
  /** 国民年金の第3号被保険者（配偶者で20歳以上60歳未満） */
  thirdInsured: boolean;
  age: number;
}

export type CheckedDependent = Pick<
  DependentDoc,
  | 'birthDate'
  | 'relationship'
  | 'livingTogether'
  | 'remittance'
  | 'remittanceTimes'
  | 'annualIncome'
  | 'disabled'
  | 'incomeBasis'
  | 'contractIncome'
  | 'from'
  | 'to'
>;

export const LIMITS: Record<LimitReason, number> = {
  base: 1_300_000,
  young: 1_500_000,
  senior: 1_800_000,
  disabled: 1_800_000,
};

/** 19〜22歳の特例が始まった日・労働契約の方式が始まった日 */
export const YOUNG_RULE_FROM = '2025-10-01';
export const CONTRACT_RULE_FROM = '2026-04-01';

/** 同居していなくてもよい続柄（配偶者・子・孫・兄弟姉妹・直系尊属）。それ以外は同居が要る */
const NO_COHABITATION_NEEDED: readonly Relationship[] = [
  'spouse',
  'child',
  'grandchild',
  'youngerSibling',
  'olderSibling',
  'parent',
  'grandparent',
  'greatGrandparent',
];

export function needsCohabitation(r: Relationship): boolean {
  return !NO_COHABITATION_NEEDED.includes(r);
}

/** その日に扶養に入っているか（入った日以降で、外れた日より前） */
export function isActiveOn(d: Pick<DependentDoc, 'from' | 'to'>, date: string): boolean {
  return d.from <= date && (d.to === null || date < d.to);
}

/** 年収の上限：60歳以上・障害者 180万／19〜22歳（その年の12月31日の年齢。配偶者は除く）150万／ほか 130万 */
export function limitOf(d: CheckedDependent, date: string): { limit: number; reason: LimitReason } {
  const age = ageAt(d.birthDate, date);
  if (age >= 60) return { limit: LIMITS.senior, reason: 'senior' };
  if (d.disabled) return { limit: LIMITS.disabled, reason: 'disabled' };
  const yearEndAge = ageAt(d.birthDate, `${date.slice(0, 4)}-12-31`);
  if (d.relationship !== 'spouse' && date >= YOUNG_RULE_FROM && yearEndAge >= 19 && yearEndAge <= 22) {
    return { limit: LIMITS.young, reason: 'young' };
  }
  return { limit: LIMITS.base, reason: 'base' };
}

/** n 年後（または前）の同じ日。2月29日は3月1日に寄せる */
function shiftYears(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y + n, m - 1, d)).toISOString().slice(0, 10);
}

/** 扶養に入った日から1年後の前日（契約期間がこれより前に終わるなら1年未満） */
function oneYearFrom(from: string): string {
  return addDays(shiftYears(from, 1), -1);
}

/** 労働契約の方式が使えない理由 */
export function contractIssuesOf(d: CheckedDependent, date: string): ContractIssue[] {
  const c = d.contractIncome;
  if (d.incomeBasis !== 'contract' || !c) return [];
  const out: ContractIssue[] = [];
  if (date < CONTRACT_RULE_FROM) out.push('notYet');
  if (c.periodEnd !== null && c.periodEnd < oneYearFrom(d.from)) out.push('shortContract');
  if (!c.hoursClear) out.push('unclearHours');
  if (!c.allowancesClear) out.push('unclearAllowances');
  return out;
}

/**
 * その日時点の判定の候補
 * @param insuredIncome 被保険者の年収の見込み（わからなければ null）
 * @param date 判定する日（新しく入れるときは扶養に入った日、今の確認は今日）
 */
export function checkDependent(
  d: CheckedDependent,
  insuredIncome: number | null,
  date: string,
): DependentCheck {
  const age = ageAt(d.birthDate, date);
  const { limit, reason } = limitOf(d, date);
  const contractIssues = contractIssuesOf(d, date);
  const useContract = d.incomeBasis === 'contract' && !!d.contractIncome && contractIssues.length === 0;
  const income = useContract ? d.contractIncome!.annualWage : d.annualIncome;
  const remittanceYear =
    d.remittance !== null && d.remittanceTimes !== null ? d.remittance * d.remittanceTimes : null;

  const issues: CheckIssue[] = [];
  if (age >= 75) issues.push('age75');
  if (!d.livingTogether && needsCohabitation(d.relationship)) issues.push('cohabitationRequired');
  if (income >= limit) issues.push('overLimit');
  if (d.livingTogether) {
    if (insuredIncome === null) issues.push('insuredIncomeUnknown');
    else if (income > insuredIncome) issues.push('overInsured');
    else if (income * 2 >= insuredIncome) issues.push('halfOrMore');
  } else if (remittanceYear === null) {
    issues.push('noRemittance');
  } else if (income >= remittanceYear) {
    issues.push('overRemittance');
  }

  const NG: CheckIssue[] = ['age75', 'cohabitationRequired', 'overLimit', 'overInsured', 'overRemittance'];
  const level: CheckLevel = issues.some((i) => NG.includes(i)) ? 'ng' : issues.length ? 'review' : 'ok';

  return {
    level,
    issues,
    limit,
    limitReason: reason,
    income,
    incomeSource: useContract ? 'contract' : 'estimate',
    contractIssues,
    remittanceYear,
    thirdInsured: d.relationship === 'spouse' && age >= 20 && age < 60,
    age,
  };
}

// ===== 被保険者の年収の候補 =====

export interface IncomeSources {
  /** 支払った月 'YYYY-MM' と、通貨＋現物の額 */
  payrolls: { paidMonth: string; amount: number }[];
  /** 支払日と、通貨＋現物の額 */
  bonuses: { paidDate: string; amount: number }[];
}

/**
 * 被保険者の年収の候補：直近12か月の給与（12か月に足りなければ平均 × 12）＋ 直近1年の賞与
 * 給与の実績が1件もなければ null（標準報酬月額 × 12 などを人が入れる）
 */
export function insuredIncomeCandidate(
  src: IncomeSources,
  today: string,
): { amount: number; months: number } | null {
  const thisMonth = today.slice(0, 7);
  const [y, m] = thisMonth.split('-').map(Number);
  const oldest = `${y - 1}-${String(m).padStart(2, '0')}`; // 12か月前の同じ月（今月の分がまだなら、ここまで使う）
  // 新しい順に最大12か月分
  const rows = src.payrolls
    .filter((p) => p.paidMonth >= oldest && p.paidMonth <= thisMonth)
    .sort((a, b) => b.paidMonth.localeCompare(a.paidMonth))
    .slice(0, 12);
  if (rows.length === 0) return null;
  const pay = rows.reduce((s, p) => s + p.amount, 0);
  const yearPay = rows.length >= 12 ? pay : Math.round((pay / rows.length) * 12);
  const startDate = addDays(shiftYears(today, -1), 1); // 1年前の翌日から今日まで
  const bonus = src.bonuses
    .filter((b) => b.paidDate >= startDate && b.paidDate <= today)
    .reduce((s, b) => s + b.amount, 0);
  return { amount: yearPay + bonus, months: rows.length };
}
