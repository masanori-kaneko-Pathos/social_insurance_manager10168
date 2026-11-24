// 事業所の間の異動（転勤。11/24）
// Angular・Firebase に依存しない純粋な関数：何をどう写すかを決める。書き込みは TransferService
//
// 根拠と考え方
// - 適用事業所が変わると、元の事業所で資格を失い、新しい事業所で資格を取る。喪失日・取得日はどちらも異動日
//   （退職日を異動日の前日にすると、喪失日 ＝ 退職日の翌日 ＝ 異動日。今の計算のしくみのまま正しく出る）
// - 保険料は資格を取った月からかかり、資格を失った月はかからない → 異動した月は新しい事業所だけで1か月分
// - 異動した月に元の事業所で払った賞与は、喪失月の賞与（保険料はかからない。健保の年度累計には入る。今の計算のまま）
// - 資格喪失届の喪失原因は「退職等」（喪失の理由 retire）。退職の理由に「異動」（transfer）を入れて見分ける
// - 新しい事業所では資格取得届を出し、標準報酬月額は資格取得時決定（報酬月額は異動のときの額。画面で確かめる）
// - 健保の標準賞与額の年度累計（573万円）は保険者ごと。異動先が同じ保険者なら、元の事業所の今年度の分を引き継ぐ
//   （協会けんぽは都道府県が違っても同じ保険者）。保険者が違えば数え直す

import type { ContractInput } from '../../../core/models/contract';
import type { DependentInput } from '../../../core/models/dependent';
import type { EmployeeFormInput, EmployeeFull, EnrollmentDoc } from '../../../core/models/employee';
import type { GradeTableDoc } from '../../../core/models/rates';
import type { RemunerationDoc, RemunerationInput } from '../../../core/models/remuneration';
import { addDays, DateStr, fiscalYearOf, toYearMonth, YearMonth } from '../../../shared/utils/date';
import { decideStandard } from '../../rates/logic/grade';
import { bonusTotalOf, NaturePaymentLike } from '../../premiums/logic/bonus-nature';

export interface TransferInput {
  /** 異動日（新しい事業所で働き始める日 ＝ 喪失日 ＝ 取得日） */
  date: DateStr;
  /** 異動先の社員番号（空 ＝ なし） */
  employeeNumber: string | null;
  /** 異動のときの報酬月額（資格取得届の報酬月額。空なら今の標準報酬の報酬月額） */
  monthlyAmount: number | null;
}

export interface TransferSource {
  employee: EmployeeFull;
  contracts: readonly ContractInput[];
  remunerations: readonly RemunerationDoc[];
  dependents: readonly DependentInput[];
  /** 元の事業所の賞与の支給（年度累計の引き継ぎに使う） */
  bonusPayments: readonly NaturePaymentLike[];
  /** 異動した月の保険者の鍵（insurerKeyOf）。同じなら年度累計を引き継ぐ */
  fromInsurer: string;
  toInsurer: string;
  /** 異動先の事業所名（履歴の1行に書く） */
  fromOfficeName: string;
  gradeTables: readonly GradeTableDoc[];
}

export type TransferError = 'date' | 'beforeHire' | 'retired' | 'noRemuneration' | 'amount';

export interface TransferPlan {
  /** 元の事業所の従業員に書く項目 */
  source: Pick<EmployeeFull, 'retireDate' | 'retireReason' | 'health' | 'pension'>;
  /** 新しい事業所に作る従業員 */
  employee: EmployeeFormInput;
  /** 新しい事業所の従業員に、作ったあとで書く配列（休業・介護保険の適用除外・海外勤務。今も続いているものだけ） */
  lists: Pick<EmployeeFull, 'leaves'> & { careExemptions: NonNullable<EmployeeFull['careExemptions']>; overseas: NonNullable<EmployeeFull['overseas']> };
  contracts: ContractInput[];
  remuneration: RemunerationInput;
  dependents: DependentInput[];
  /** 年度累計の引き継ぎ（年度 → 円）。引き継がなければ null */
  priorBonusTotals: Record<string, number> | null;
  /** 引き継いだ年度累計（画面に出す。引き継がなければ 0） */
  carriedBonus: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** 異動できるか（できなければ理由） */
export function transferErrors(src: TransferSource, input: TransferInput): TransferError[] {
  const e = src.employee;
  const errs: TransferError[] = [];
  if (!ISO.test(input.date)) return ['date'];
  if (input.date <= e.hireDate) errs.push('beforeHire');
  // 退職日が異動日の前日より前なら、もう在籍していない
  if (e.retireDate && e.retireDate < addDays(input.date, -1)) errs.push('retired');
  if (input.monthlyAmount !== null && (!Number.isSafeInteger(input.monthlyAmount) || input.monthlyAmount <= 0)) errs.push('amount');
  if (input.monthlyAmount === null && !latestBefore(src.remunerations, toYearMonth(input.date))) errs.push('noRemuneration');
  return errs;
}

/** その月より前（その月を含む）の最後の標準報酬 */
function latestBefore(list: readonly RemunerationDoc[], month: YearMonth): RemunerationDoc | null {
  let found: RemunerationDoc | null = null;
  for (const r of list) if (r.from <= month && (!found || r.from > found.from)) found = r;
  return found;
}

/** 異動日に資格を失う（加入していた保険だけ。喪失の理由は「退職等」） */
function lose(en: EnrollmentDoc, date: DateStr): EnrollmentDoc {
  if (!en.enrolled || (en.lostDate && en.lostDate <= date)) return en;
  return { ...en, lostDate: date, lossReason: 'retire' };
}

/** 異動日に資格を取る（元の事業所で加入していた保険だけ） */
function gain(en: EnrollmentDoc, date: DateStr): EnrollmentDoc {
  return en.enrolled && (!en.lostDate || en.lostDate > date)
    ? { enrolled: true, acquiredDate: date, lostDate: null, lossReason: null }
    : { enrolled: false, acquiredDate: null, lostDate: null, lossReason: null };
}

/**
 * 元の事業所の、その年度の健保の標準賞与額（異動日より前に払った分）
 * 標準賞与額 ＝ 1回ごとの賞与額（通貨＋現物）の1,000円未満を切り捨てた額。前の事業所から引き継いだ分も足す
 */
export function bonusCarryOf(employeeId: string, payments: readonly NaturePaymentLike[], date: DateStr, prior: Record<string, number> | null | undefined): { year: number; total: number } {
  const year = fiscalYearOf(toYearMonth(date));
  let total = prior?.[String(year)] ?? 0;
  for (const p of payments) {
    if (p.paidDate >= date || fiscalYearOf(toYearMonth(p.paidDate)) !== year) continue;
    total += Math.floor(bonusTotalOf(p, employeeId) / 1000) * 1000;
  }
  return { year, total };
}

export function planTransfer(src: TransferSource, input: TransferInput): TransferPlan {
  const e = src.employee;
  const date = input.date;
  const month = toYearMonth(date);

  // 元の事業所：退職日 ＝ 異動日の前日、喪失日 ＝ 異動日（喪失の理由は「退職等」、退職の理由は「異動」）
  const source = {
    retireDate: addDays(date, -1),
    retireReason: 'transfer' as const,
    health: lose(e.health, date),
    pension: lose(e.pension, date),
  };

  // 年度累計：同じ保険者なら引き継ぐ
  const carry = bonusCarryOf(e.id, src.bonusPayments, date, e.priorBonusTotals);
  const same = src.fromInsurer === src.toInsurer && src.fromInsurer !== 'none';
  const priorBonusTotals = same && carry.total > 0 ? { [String(carry.year)]: carry.total } : null;

  // 新しい事業所の従業員：入社日 ＝ 異動日（その事業所で働き始めた日）、取得日 ＝ 異動日
  const {
    id: _id, createdAt: _c, updatedAt: _u, userUid: _uid, leaves: _l, careExemptions: _ce, overseas: _o,
    annualIncomeEstimate: _a, spouseAnnualIncome: _s, priorBonusTotals: _p, ...rest
  } = e;
  const register = e.register ?? { history: [], retireDetail: null };
  const employee: EmployeeFormInput = {
    ...rest,
    employeeNumber: input.employeeNumber?.trim() || null,
    hireDate: date,
    retireDate: null,
    retireReason: null,
    health: gain(e.health, date),
    pension: gain(e.pension, date),
    // 履歴の1行に、どこから異動したかと元の入社日を残す
    register: {
      ...register,
      history: [...register.history, { month, text: `${src.fromOfficeName}から異動（入社日 ${e.hireDate}）` }],
    },
    priorBonusTotals,
  } as EmployeeFormInput;

  // 休業・介護保険の適用除外・海外勤務は、異動日にまだ続いているものだけ写す
  // 休業は「終了日、なければ終了予定日」（両方なければ未定 ＝ 続いている）。適用除外・海外勤務は to（空 ＝ 続いている）
  const open = (end: string | null | undefined) => end == null || end >= date;
  const lists: TransferPlan['lists'] = {
    leaves: e.leaves.filter((l) => open(l.end ?? l.plannedEnd)),
    careExemptions: (e.careExemptions ?? []).filter((c) => open(c.to)),
    overseas: (e.overseas ?? []).filter((o) => open(o.to)),
  };

  // 雇用契約：異動日に効いている契約と、それより後の契約。効いている契約は異動日から始まるものとして写す
  const sorted = [...src.contracts].sort((a, b) => a.from.localeCompare(b.from));
  const current = [...sorted].reverse().find((c) => c.from <= date) ?? null;
  const contracts: ContractInput[] = [
    ...(current ? [{ ...current, from: date }] : []),
    ...sorted.filter((c) => c.from > date),
  ];

  // 標準報酬：資格取得時決定（異動した月から。報酬月額は入れた額、なければ今の報酬月額）
  const now = latestBefore(src.remunerations, month);
  const amount = input.monthlyAmount ?? now?.monthlyAmount ?? 0;
  const d = decideStandard([...src.gradeTables], month, amount);
  const remuneration: RemunerationInput = {
    from: month,
    reason: 'acquisition',
    monthlyAmount: amount,
    health: d.health ?? now?.health ?? { grade: 0, standard: 0 },
    pension: d.pension ?? now?.pension ?? { grade: 0, standard: 0 },
  };

  // 扶養家族：異動日に扶養に入っている人を、異動日から扶養に入った人として写す（新しい事業所の被扶養者（異動）届）
  const dependents = src.dependents
    .filter((x) => !x.to || x.to > date)
    .map((x) => ({ ...x, from: x.from > date ? x.from : date, startReason: null, startReasonText: null }));

  return { source, employee, lists, contracts, remuneration, dependents, priorBonusTotals, carriedBonus: priorBonusTotals ? carry.total : 0 };
}
