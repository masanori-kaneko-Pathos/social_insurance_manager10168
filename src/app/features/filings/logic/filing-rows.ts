// 届書の一覧（CSV）の1行を作る：資格取得届・資格喪失届・算定基礎届・月額変更届・賞与支払届
// Angular・Firebase に依存しない純粋な関数
//
// 列は、日本年金機構の各届の記入例の欄の順（①〜）。届書の行を左から順に書き写せるように並べる
// - 日付は和暦（届書の欄が元号と年月日）。並べ替え用に、最後に西暦の列も足す
// - 個人番号・住所の欄は作らない（マイナンバーは扱いを確かめてから）
// - 備考は、アプリの記録から分かる項目だけ「番号．名前」で入れる（複数は「、」でつなぐ）
// - 届書作成プログラムの電子媒体（決まった桁の形式）ではない。e-Gov への送信は対象外（カタログ）

import { payTotal, type Payroll } from '../../../core/models/payroll';
import { addDays, DateStr, shiftMonth, YearMonth } from '../../../shared/utils/date';
import { ageReachDate } from '../../employees/logic/coverage';
import { toWareki, toWarekiMonth } from './wareki';

export type FilingKind = 'acquire' | 'loss' | 'regular' | 'irregular' | 'bonus';
export const FILING_KINDS: readonly FilingKind[] = ['acquire', 'loss', 'regular', 'irregular', 'bonus'];

export type FilingRow = Record<string, string>;

/** 届書に使う従業員の項目 */
export interface FilingEmployee {
  id: string;
  employeeNumber: string | null;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: DateStr;
  sex: 'male' | 'female' | null;
  retireDate: DateStr | null;
  health: { enrolled: boolean; acquiredDate: DateStr | null; lostDate: DateStr | null; lossReason: string | null };
  pension: { enrolled: boolean; acquiredDate: DateStr | null; lostDate: DateStr | null; lossReason: string | null };
  acquisitionType: 'standard' | 'mutualAidLoan' | 'seamenContinued';
  multipleOffices: boolean;
  rehired: boolean;
  needsConfirmationCard: boolean;
  optInDate: DateStr | null;
  optOutDate?: DateStr | null;
  insuredNumber: string | null;
  basicPensionNumber: string | null;
}

// ===== 列（見出しは画面で翻訳する：filing.col.<key>） =====

const PERSON = ['insuredNumber', 'name', 'birthDate'] as const;
const MONTHS = ['1', '2', '3'].flatMap((n) => [`m${n}Month`, `m${n}Days`, `m${n}Cash`, `m${n}InKind`, `m${n}Total`]);

export const FILING_COLUMNS: Record<FilingKind, readonly string[]> = {
  acquire: [
    'insuredNumber', 'name', 'kana', 'birthDate', 'kind', 'acquisitionType', 'basicPensionNumber',
    'acquiredDate', 'dependents', 'cash', 'inKind', 'total', 'remarks', 'confirmationCard',
    'employeeNumber', 'birthDateIso', 'dateIso',
  ],
  loss: [
    'insuredNumber', 'name', 'kana', 'birthDate', 'basicPensionNumber', 'lostDate', 'lossReason',
    'remarks', 'over70NotApplicable', 'employeeNumber', 'birthDateIso', 'dateIso',
  ],
  regular: [
    ...PERSON, 'applyMonth', 'prevHealth', 'prevPension', 'prevFrom', 'raise', 'retro',
    ...MONTHS, 'sum', 'average', 'corrected', 'basicPensionNumber70', 'remarks', 'employeeNumber', 'dateIso',
  ],
  irregular: [
    ...PERSON, 'revisedMonth', 'prevHealth', 'prevPension', 'prevFrom', 'raise', 'retro',
    ...MONTHS, 'sum', 'average', 'corrected', 'basicPensionNumber70', 'remarks', 'employeeNumber', 'dateIso',
  ],
  bonus: [
    ...PERSON, 'paidDate', 'cash', 'inKind', 'total1000', 'basicPensionNumber70', 'remarks',
    'employeeNumber', 'dateIso',
  ],
};

// ===== 小さな道具 =====

const yen = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('ja-JP'));
const thousand = (n: number) => String(Math.floor(n / 1000));
const join = (items: (string | false | null | undefined)[]) => items.filter(Boolean).join('、');

/** その日に70歳に達しているか（法律上の到達日 ＝ 誕生日の前日） */
export function over70(birthDate: DateStr, date: DateStr): boolean {
  return ageReachDate(birthDate, 70) <= date;
}

/** 種別：1．男 2．女（厚生年金基金に入っていれば 5．男（基金）6．女（基金）） */
export function kindCode(sex: FilingEmployee['sex'], pensionFund: boolean): string {
  if (!sex) return '';
  if (sex === 'male') return pensionFund ? '5．男（基金）' : '1．男';
  return pensionFund ? '6．女（基金）' : '2．女';
}

function person(e: FilingEmployee): FilingRow {
  return {
    insuredNumber: e.insuredNumber ?? '',
    name: `${e.lastName} ${e.firstName}`.trim(),
    kana: `${e.lastNameKana} ${e.firstNameKana}`.trim(),
    birthDate: toWareki(e.birthDate),
    employeeNumber: e.employeeNumber ?? '',
    birthDateIso: e.birthDate,
  };
}

// ===== 資格取得届 =====

/** 健保・厚年の早いほうの取得日（なければ null） */
export function acquiredDateOf(e: FilingEmployee): DateStr | null {
  const ds = [e.health, e.pension].filter((x) => x.enrolled && x.acquiredDate).map((x) => x.acquiredDate!);
  return ds.sort()[0] ?? null;
}

export interface AcquireInput {
  employee: FilingEmployee;
  pensionFund: boolean;
  /** 取得日に効いている契約の見込み（なければ null。報酬月額は空欄） */
  expected: { cash: number; inKind: number } | null;
  /** 扶養家族が1人以上いるか（読めなければ null で空欄） */
  hasDependents: boolean | null;
  /** 取得日の区分が短時間労働者 */
  shortTime: boolean;
}

const ACQUISITION_TYPE: Record<FilingEmployee['acquisitionType'], string> = {
  standard: '1．健保・厚年',
  mutualAidLoan: '3．共済出向',
  seamenContinued: '4．船保任継',
};

export function acquireRow(x: AcquireInput): FilingRow | null {
  const e = x.employee;
  const date = acquiredDateOf(e);
  if (!date) return null;
  const ex = x.expected;
  return {
    ...person(e),
    kind: kindCode(e.sex, x.pensionFund),
    acquisitionType: ACQUISITION_TYPE[e.acquisitionType] ?? '',
    basicPensionNumber: e.basicPensionNumber ?? '',
    acquiredDate: toWareki(date),
    dependents: x.hasDependents == null ? '' : x.hasDependents ? '1．有' : '0．無',
    cash: ex ? yen(ex.cash) : '',
    inKind: ex ? yen(ex.inKind) : '',
    total: ex ? yen(ex.cash + ex.inKind) : '',
    remarks: join([
      over70(e.birthDate, date) && '1．70歳以上被用者該当',
      e.multipleOffices && '2．二以上事業所勤務者の取得',
      x.shortTime && '3．短時間労働者の取得（特定適用事業所等）',
      e.rehired && '4．退職後の継続再雇用者の取得',
      !!e.optInDate && '6．特定減額特例対象者の任意取得',
    ]),
    confirmationCard: e.needsConfirmationCard ? '発行が必要' : '',
    dateIso: date,
  };
}

// ===== 資格喪失届 =====

/** 喪失の原因（届書の番号と名前） */
const LOSS_REASON: Record<string, string> = {
  retire: '4．退職等',
  death: '5．死亡',
  age75: '7．75歳到達（健康保険のみ喪失）',
  disability: '9．障害認定（健康保険のみ喪失）',
  agreement: '11．社会保障協定',
};

/** 期間に入る喪失（健保と厚年で日が同じなら1つ。違えばそれぞれ） */
export function lossesIn(e: FilingEmployee, from: DateStr, to: DateStr): { date: DateStr; reason: string | null }[] {
  const out = new Map<DateStr, string | null>();
  for (const x of [e.health, e.pension]) {
    if (x.enrolled && x.lostDate && x.lostDate >= from && x.lostDate <= to && !out.has(x.lostDate)) {
      out.set(x.lostDate, x.lossReason);
    }
  }
  return [...out.entries()].sort().map(([date, reason]) => ({ date, reason }));
}

export function lossRow(e: FilingEmployee, loss: { date: DateStr; reason: string | null }): FilingRow {
  const day = addDays(loss.date, -1); // 退職日・死亡日（喪失日の前日）
  let reason = loss.reason ? (LOSS_REASON[loss.reason] ?? '') : '';
  if (!loss.reason && e.optOutDate) reason = '12．特定減額特例対象者の任意喪失';
  if (loss.reason === 'retire') reason += `（${toWareki(e.retireDate ?? day)}退職等）`;
  if (loss.reason === 'death') reason += `（${toWareki(day)}死亡）`;
  return {
    ...person(e),
    basicPensionNumber: e.basicPensionNumber ?? '',
    lostDate: toWareki(loss.date),
    lossReason: reason,
    remarks: join([e.multipleOffices && '1．二以上事業所勤務者の喪失', e.rehired && '2．退職後の継続再雇用者の喪失']),
    // 70歳以上で働いていた人が退職・死亡したとき（不該当年月日 ＝ 退職日・死亡日）
    over70NotApplicable:
      (loss.reason === 'retire' || loss.reason === 'death') && over70(e.birthDate, day) ? toWareki(day) : '',
    dateIso: loss.date,
  };
}

// ===== 算定基礎届・月額変更届 =====

export interface RevisionRowInput {
  employee: FilingEmployee;
  /** 適用年月（算定：その年の9月）／改定年月（月変） */
  month: YearMonth;
  /** 3か月の最初の月（算定：4月／月変：起算月） */
  firstMonth: YearMonth;
  payrolls: ReadonlyMap<string, Payroll>;
  /** 従前の標準報酬（円）と、それが始まった月。なければ null */
  previous: { health: number; pension: number; from: YearMonth } | null;
  /** 昇（降）給：変わった支払月と向き（なければ null） */
  raise: { month: YearMonth; direction: 'up' | 'down' } | null;
  total: number;
  average: number;
  corrected: number | null;
  /** 届に書く備考 */
  remarks: string[];
}

function monthCells(x: RevisionRowInput): FilingRow {
  const row: FilingRow = {};
  [0, 1, 2].forEach((i) => {
    const month = shiftMonth(x.firstMonth, i);
    const p = x.payrolls.get(month);
    const n = i + 1;
    row[`m${n}Month`] = `${Number(month.slice(5))}月`;
    row[`m${n}Days`] = p ? `${p.days}日` : '';
    row[`m${n}Cash`] = p ? yen(p.cash) : '';
    row[`m${n}InKind`] = p ? yen(p.inKind) : '';
    // 現物が内訳なし（null）の月は、現物の欄を空にする（合計は支払額のままで正しい）
    row[`m${n}Total`] = p ? yen(payTotal(p)) : '';
  });
  return row;
}

/** ⑧遡及支払額：3か月のうち遡及支払のあった月と額（複数あれば足す。月は最初の月） */
function retroOf(x: RevisionRowInput): string {
  const months = [0, 1, 2].map((i) => shiftMonth(x.firstMonth, i));
  const hits = months.map((m) => ({ m, p: x.payrolls.get(m) })).filter((h) => (h.p?.retro ?? 0) > 0);
  if (hits.length === 0) return '';
  const sum = hits.reduce((s, h) => s + h.p!.retro, 0);
  return `${Number(hits[0].m.slice(5))}月 ${yen(sum)}円`;
}

export function revisionRow(kind: 'regular' | 'irregular', x: RevisionRowInput): FilingRow {
  const e = x.employee;
  const reach70 = over70(e.birthDate, `${x.month}-01`);
  return {
    ...person(e),
    [kind === 'regular' ? 'applyMonth' : 'revisedMonth']: toWarekiMonth(x.month),
    prevHealth: x.previous ? thousand(x.previous.health) : '',
    prevPension: x.previous ? thousand(x.previous.pension) : '',
    prevFrom: x.previous ? toWarekiMonth(x.previous.from) : '',
    raise: x.raise ? `${Number(x.raise.month.slice(5))}月 ${x.raise.direction === 'up' ? '1．昇給' : '2．降給'}` : '',
    retro: retroOf(x),
    ...monthCells(x),
    sum: yen(x.total),
    average: yen(x.average),
    corrected: x.corrected == null ? '' : yen(x.corrected),
    basicPensionNumber70: reach70 ? (e.basicPensionNumber ?? '') : '',
    remarks: join(x.remarks),
    dateIso: x.month,
  };
}

/** 算定基礎届の備考（記録から分かるものだけ） */
export function regularRemarks(x: {
  employee: FilingEmployee;
  year: number;
  annual: boolean;
  payrolls: ReadonlyMap<string, Payroll>;
}): string[] {
  const e = x.employee;
  const y = x.year;
  const acquired = acquiredDateOf(e);
  const months = ['04', '05', '06'].map((m) => x.payrolls.get(`${y}-${m}`));
  return [
    over70(e.birthDate, `${y}-07-01`) && '1．70歳以上被用者算定',
    e.multipleOffices && '2．二以上勤務',
    !!acquired && acquired > `${y}-04-01` && acquired <= `${y}-06-30` && '4．途中入社',
    months.some((p) => p && p.state !== 'normal') && '5．病休・育休・休職等',
    x.annual && '8．年間平均',
  ].filter((s): s is string => !!s);
}

/** 月額変更届の備考 */
export function irregularRemarks(x: {
  employee: FilingEmployee;
  revisedFrom: YearMonth;
  annual: boolean;
  reasonNote: string | null;
}): string[] {
  const e = x.employee;
  return [
    over70(e.birthDate, `${x.revisedFrom}-01`) && '1．70歳以上被用者月額変更',
    e.multipleOffices && '2．二以上勤務',
    !!x.reasonNote && `4．昇給・降給の理由（${x.reasonNote}）`,
    x.annual && '6．その他（年間平均）',
  ].filter((s): s is string => !!s);
}

// ===== 賞与支払届 =====

export interface BonusRowInput {
  employee: FilingEmployee;
  paidDate: DateStr;
  cash: number;
  inKind: number;
  /** 同じ月に先に払った賞与の支払日（合算するとき。なければ null） */
  firstPaidInMonth: DateStr | null;
}

export function bonusRow(x: BonusRowInput): FilingRow {
  const e = x.employee;
  const total = x.cash + x.inKind;
  const reach70 = over70(e.birthDate, x.paidDate);
  return {
    ...person(e),
    paidDate: toWareki(x.paidDate),
    cash: yen(x.cash),
    inKind: yen(x.inKind),
    total1000: yen(Math.floor(total / 1000) * 1000),
    basicPensionNumber70: reach70 ? (e.basicPensionNumber ?? '') : '',
    remarks: join([
      reach70 && '1．70歳以上被用者',
      e.multipleOffices && '2．二以上勤務',
      !!x.firstPaidInMonth && `3．同一月内の賞与合算（初回支払日：${Number(x.firstPaidInMonth.slice(8))}日）`,
    ]),
    dateIso: x.paidDate,
  };
}

/** 同じ人に、同じ月に先に払った賞与の支払日（いちばん早いもの） */
export function firstPaidInMonth(
  employeeId: string,
  paidDate: DateStr,
  payments: readonly { paidDate: DateStr; amounts: Record<string, number> }[],
): DateStr | null {
  const earlier = payments
    .filter((p) => p.paidDate.slice(0, 7) === paidDate.slice(0, 7) && p.paidDate < paidDate && (p.amounts[employeeId] ?? 0) > 0)
    .map((p) => p.paidDate)
    .sort();
  return earlier[0] ?? null;
}

// ===== 表にする =====

/** 行を列の順に並べる（CSV の1行） */
export function toCells(kind: FilingKind, row: FilingRow): string[] {
  return FILING_COLUMNS[kind].map((c) => row[c] ?? '');
}

/** ファイル名：届書の名前_期間_出力日.csv */
export function filingFileName(label: string, period: string, today: DateStr): string {
  return `${label}_${period}_${today}.csv`;
}
