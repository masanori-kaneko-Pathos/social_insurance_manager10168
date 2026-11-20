/**
 * 事業所の設定と、保険者・都道府県の履歴
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 * 古いデータ（設定や履歴の項目がない事業所）も、ここで初期値に埋めてから使う。
 */
import {
  DeductionPeriod,
  HealthInsurer,
  InsurerPeriod,
  OfficeDoc,
  PayrollSettings,
  PremiumSettings,
} from '../../core/models/office';
import { DEFAULT_PREMIUM_OPTIONS } from '../../core/models/premium';
import { shiftMonth, YearMonth } from '../../shared/utils/date';
import { latest, noRates, OfficeForRates, pickRates, RateTables } from '../rates/logic/pick-rates';
import { MonthRange, RatesForMonth } from '../../core/models/rates';

/** 履歴の「最初から」を表す月 */
export const FROM_THE_START = '0000-01';

/** 給与の初期値：月末締め・翌月25日払い・翌月控除 */
export const DEFAULT_PAYROLL: PayrollSettings = {
  closingDay: 31,
  payDay: 25,
  payMonth: 'next',
  deduction: 'next',
};

/** 保険料の計算方法の初期値：給与控除・合算 */
export const DEFAULT_PREMIUM: PremiumSettings = { ...DEFAULT_PREMIUM_OPTIONS };

/** 設定の項目がまだない形も受け取れる（登録の途中・テストなど） */
type OfficeLike = Pick<OfficeDoc, 'prefecture' | 'healthInsurer'> &
  Partial<Pick<OfficeDoc, 'insurerHistory' | 'payroll' | 'premium'>>;

export function payrollOf(office: OfficeLike): PayrollSettings {
  return { ...DEFAULT_PAYROLL, ...(office.payroll ?? {}) };
}

export function premiumOf(office: OfficeLike): PremiumSettings {
  return { ...DEFAULT_PREMIUM, ...(office.premium ?? {}) };
}

/** 保険者・都道府県の履歴（古い順）。履歴がない古いデータは「最初から今の値」の1行にする */
export function insurerHistoryOf(office: OfficeLike): InsurerPeriod[] {
  const h = office.insurerHistory;
  if (h && h.length > 0) return [...h].sort((a, b) => a.from.localeCompare(b.from));
  return [
    { from: FROM_THE_START, prefecture: office.prefecture, healthInsurer: office.healthInsurer },
  ];
}

/** その月の保険者・都道府県（料率を選ぶのに使う形。履歴より前の月は null） */
export function insurerFor(office: OfficeLike, month: YearMonth): OfficeForRates | null {
  const history = insurerHistoryOf(office);
  const p = latest(history, month);
  if (!p) return null;
  const run = kumiaiRun(history, history.indexOf(p));
  return {
    prefecture: p.prefecture,
    healthInsurer: p.healthInsurer,
    ...(run ? { kumiaiSince: run.from } : {}),
  };
}

/**
 * 月 → その月の保険者を見分ける鍵（賞与の年度の累計を、保険者ごとに数えるため。11/17）
 * 協会けんぽは都道府県が変わっても同じ保険者。組合健保は同じ組合が続く期間（始まりの月）ごとに別
 */
export function insurerKeyOf(office: OfficeLike): (month: YearMonth) => string {
  return (month) => {
    const p = insurerFor(office, month);
    if (!p) return 'none';
    return p.healthInsurer.type === 'kyokai' ? 'kyokai' : `kumiai:${p.kumiaiSince ?? ''}`;
  };
}

/** 月 → その月の料率（その月の保険者・都道府県で選ぶ。履歴より前の月は全部「未登録」） */
export function ratesForOffice(
  office: OfficeLike,
  tables: RateTables,
): (month: YearMonth) => RatesForMonth {
  return (month) => {
    const insurer = insurerFor(office, month);
    return insurer ? pickRates(insurer, tables, month) : noRates(month);
  };
}

/** 過去も含めて、組合健保だった時期があるか（組合の料率を読む必要があるか） */
/** 画面に出す事業所の名前（英語の画面で、英語の名前があればそちら） */
export function officeDisplayName(o: { name: string; nameEn?: string | null }, lang: string): string {
  return lang === 'en' && o.nameEn ? o.nameEn : o.name;
}

export function everKumiai(office: OfficeLike): boolean {
  return insurerHistoryOf(office).some((p) => p.healthInsurer.type === 'kumiai');
}

function sameInsurer(a: HealthInsurer, b: HealthInsurer): boolean {
  return a.type === b.type && (a.kumiaiName ?? null) === (b.kumiaiName ?? null);
}

export function samePeriod(
  a: Omit<InsurerPeriod, 'from'>,
  b: Omit<InsurerPeriod, 'from'>,
): boolean {
  return a.prefecture === b.prefecture && sameInsurer(a.healthInsurer, b.healthInsurer);
}

/** 履歴の1行の期間（次の行の from まで） */
export function spanOf(history: InsurerPeriod[], index: number): MonthRange {
  return { from: history[index].from, to: history[index + 1]?.from ?? null };
}

/**
 * 同じ組合が続いている期間（都道府県だけ変わった行はつなげる。組合の料率は都道府県に関係ないため）
 * 協会けんぽの行なら null。history は古い順（insurerHistoryOf の結果）
 */
export function kumiaiRun(history: InsurerPeriod[], index: number): MonthRange | null {
  const row = history[index];
  if (!row || row.healthInsurer.type !== 'kumiai') return null;
  const same = (p: InsurerPeriod | undefined) =>
    !!p && sameInsurer(p.healthInsurer, row.healthInsurer);
  let start = index;
  while (same(history[start - 1])) start--;
  let end = index;
  while (same(history[end + 1])) end++;
  return { from: history[start].from, to: history[end + 1]?.from ?? null };
}

/**
 * 保険者・都道府県の変更を履歴に足す
 * - その月より前の行は残す。同じ月とそれより後の行は、新しい内容で置き換える（新しい内容が最新になる）
 * - 1つ前の行と内容が同じなら、行は足さない
 */
export function withInsurerChange(
  history: InsurerPeriod[],
  change: InsurerPeriod,
): InsurerPeriod[] {
  const kept = [...history]
    .sort((a, b) => a.from.localeCompare(b.from))
    .filter((p) => p.from < change.from);
  const prev = kept[kept.length - 1];
  if (prev && samePeriod(prev, change)) return kept;
  return [...kept, change];
}

/** 控除の時期の履歴の「最初から」（11/20） */
export const DEDUCTION_FROM_START = '0000-01';

/**
 * その月分の保険料の控除の時期（11/20）
 * 履歴があれば「from がその月以前の最後の行」、なければ今の設定。履歴は保存のたびに「最後の行 ＝ 今の設定」になる
 */
export function deductionAt(
  month: YearMonth,
  payroll: PayrollSettings,
  history?: readonly DeductionPeriod[] | null,
): PayrollSettings['deduction'] {
  if (!history || history.length === 0) return payroll.deduction;
  let hit: DeductionPeriod | null = null;
  for (const h of history) if (h.from <= month && (!hit || h.from >= hit.from)) hit = h;
  return (hit ?? history[0]).deduction;
}

/** 何月に支払う給与から控除するか（翌月控除なら、11月分の保険料は12月に支払う給与から） */
export function deductionPayMonth(
  month: YearMonth,
  payroll: PayrollSettings,
  history?: readonly DeductionPeriod[] | null,
): YearMonth {
  return deductionAt(month, payroll, history) === 'next' ? shiftMonth(month, 1) : month;
}

/**
 * その月に払う給与から控除する保険料の月（0〜2か月。11/20）
 * 翌月控除 → 当月控除に変えた月は2か月分（前の月の分と、その月の分）、当月控除 → 翌月控除に変えた月は0か月（控除なし）
 */
export function premiumMonthsOfPay(
  paidMonth: YearMonth,
  payroll: PayrollSettings,
  history?: readonly DeductionPeriod[] | null,
): YearMonth[] {
  return [shiftMonth(paidMonth, -1), paidMonth].filter((m) => deductionPayMonth(m, payroll, history) === paidMonth);
}

/**
 * 控除の時期を「from 月分から deduction に」変えた履歴（11/20）
 * from 以降の古い行は捨て、最初の行がなければ「最初から今の設定」を置く。同じ時期なら行を足さない
 */
export function withDeductionChange(
  history: readonly DeductionPeriod[] | null | undefined,
  current: PayrollSettings['deduction'],
  change: DeductionPeriod,
): DeductionPeriod[] {
  const base: DeductionPeriod[] =
    history && history.length > 0 ? [...history] : [{ from: DEDUCTION_FROM_START, deduction: current }];
  const kept = base.sort((a, b) => a.from.localeCompare(b.from)).filter((h) => h.from < change.from);
  if (kept.length > 0 && kept[kept.length - 1].deduction === change.deduction) return kept;
  return [...kept, change];
}

/**
 * deductionPayMonth の逆：その月に払う給与から控除するのは、何月分の保険料か（11/16）
 * 翌月控除なら前の月の分（11月25日払いの給与から10月分）、当月控除なら同じ月の分
 * 給与の取り込み・入力のあとの「この給与から控除する保険料を見る」で使う
 */
export function premiumMonthOfPay(
  paidMonth: YearMonth,
  payroll: PayrollSettings,
  history?: readonly DeductionPeriod[] | null,
): YearMonth {
  // 切り替えの月（0か月・2か月）は、その時期で見た月を返す（リンク用。中身は premiumMonthsOfPay で見る。11/20）
  const months = premiumMonthsOfPay(paidMonth, payroll, history);
  if (months.length > 0) return months[months.length - 1];
  return deductionAt(paidMonth, payroll, history) === 'next' ? shiftMonth(paidMonth, -1) : paidMonth;
}
