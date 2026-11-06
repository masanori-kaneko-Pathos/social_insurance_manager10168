/**
 * 事業所の設定と、保険者・都道府県の履歴
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 * 古いデータ（設定や履歴の項目がない事業所）も、ここで初期値に埋めてから使う。
 */
import {
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

type OfficeLike = Pick<
  OfficeDoc,
  'prefecture' | 'healthInsurer' | 'insurerHistory' | 'payroll' | 'premium'
>;

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

/** 何月に支払う給与から控除するか（翌月控除なら、11月分の保険料は12月に支払う給与から） */
export function deductionPayMonth(month: YearMonth, payroll: PayrollSettings): YearMonth {
  return payroll.deduction === 'next' ? shiftMonth(month, 1) : month;
}
