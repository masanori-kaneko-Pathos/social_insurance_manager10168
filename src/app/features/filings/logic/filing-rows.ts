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
import { ageReachDate, birthdayAt } from '../../employees/logic/coverage';
import { toWareki, toWarekiMonth } from './wareki';
import { forWindow } from '../../payrolls/logic/spread';

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
    // 画面・CSV の列には出さない（届書作成プログラム向けの CSV で、誰の行かを知るため）
    employeeId: e.id,
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
  /** 資格取得時の賞与に係る報酬（同様の賞与を受ける者の平均。通貨に足す。局部長通知 2(2)。11/19） */
  bonusMonthly?: number;
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
  const bonus = x.bonusMonthly ?? 0;
  const ex = x.expected ? { cash: x.expected.cash + bonus, inKind: x.expected.inKind } : null;
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
      bonus > 0 && !!ex && `その他（賞与に係る報酬 ${yen(bonus)}円を含む）`,
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
  optOut: '12．特定減額特例対象者の任意喪失',
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
  /** 賞与に係る報酬（年4回以上の賞与の 年額÷12）。各月の通貨の額に足して書く（11/19） */
  bonusMonthly?: number;
}

function monthCells(x: RevisionRowInput): FilingRow {
  const row: FilingRow = {};
  const bonus = x.bonusMonthly ?? 0; // 賞与に係る報酬は各月の通貨の額に足す（11/19）
  // まとめて払った定期代の全部が3か月に入るときは、総額が変わらないように書く（余りは支給した月。月額変更届 15。11/26）
  const pays = forWindow(x.payrolls, [0, 1, 2].map((i) => shiftMonth(x.firstMonth, i)));
  [0, 1, 2].forEach((i) => {
    const month = shiftMonth(x.firstMonth, i);
    const p = pays.get(month);
    const n = i + 1;
    row[`m${n}Month`] = `${Number(month.slice(5))}月`;
    row[`m${n}Days`] = p ? `${p.days}日` : '';
    row[`m${n}Cash`] = p ? yen(p.cash + bonus) : '';
    row[`m${n}InKind`] = p ? yen(p.inKind) : '';
    // 現物が内訳なし（null）の月は、現物の欄を空にする（合計は支払額のままで正しい）
    row[`m${n}Total`] = p ? yen(payTotal(p) + bonus) : '';
  });
  return row;
}

/**
 * 賞与に係る報酬を足したときの備考（算定基礎届は「9．その他」、月額変更届は「6．その他」。11/19）
 * 書き方は算定基礎届の記入・提出ガイドブック ケース⑦：「賞与 9.12.3.6月 75,000円」（払った月と、合計÷12）
 */
export function bonusRemark(
  no: '6' | '9',
  bonusMonthly: number | null | undefined,
  months: readonly number[] = [],
): string | false {
  if (!bonusMonthly || bonusMonthly <= 0) return false;
  const paid = months.length > 0 ? ` ${months.join('.')}月` : '';
  return `${no}．その他（賞与${paid} ${yen(bonusMonthly)}円）`;
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
  // 75歳以上で健保がない人（70歳以上被用者だけの届）は、従前の「健」を書かない（11/19）
  const healthLost = birthdayAt(e.birthDate, 75) <= `${x.month}-01` || (!!e.health.lostDate && e.health.lostDate <= `${x.month}-01`);
  return {
    ...person(e),
    [kind === 'regular' ? 'applyMonth' : 'revisedMonth']: toWarekiMonth(x.month),
    prevHealth: x.previous && e.health.enrolled && !healthLost ? thousand(x.previous.health) : '',
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
  bonusMonthly?: number | null;
  /** 賞与に係る報酬の支給を払った月（備考に書く） */
  bonusMonths?: readonly number[];
  /** 70歳以上被用者の算定基礎月（70歳到達日以後の計算期間の月。備考に書く。11/25） */
  over70Months?: readonly number[];
}): string[] {
  const e = x.employee;
  const y = x.year;
  const acquired = acquiredDateOf(e);
  const months = ['04', '05', '06'].map((m) => x.payrolls.get(`${y}-${m}`));
  return [
    over70(e.birthDate, `${y}-07-01`) &&
      (x.over70Months && x.over70Months.length > 0
        ? `1．70歳以上被用者算定（算定基礎月：${x.over70Months.map((m) => `${m}月`).join('・')}）`
        : '1．70歳以上被用者算定'),
    e.multipleOffices && '2．二以上勤務',
    !!acquired && acquired > `${y}-04-01` && acquired <= `${y}-06-30` && '4．途中入社',
    // 一時帰休は「5」ではなく「9．その他」に書く（ガイドブック。11/19）
    months.some((p) => p && p.state === 'suspended') && '5．病休・育休・休職等',
    x.annual && '8．年間平均',
    furloughRemark(months, x.payrolls.get(`${y}-07`)),
    bonusRemark('9', x.bonusMonthly, x.bonusMonths),
  ].filter((s): s is string => !!s);
}

/**
 * 一時帰休の備考（算定基礎届の記入・提出ガイドブック：「9．その他」に休業手当の支払月と、解消したときはその旨。11/19）
 * 解消した日はアプリにないので「解消」とだけ書く（日付は届を書くときに足す）
 */
function furloughRemark(months: (Payroll | undefined)[], july: Payroll | undefined): string | false {
  const hit = months.map((p, i) => (p?.state === 'furlough' ? i + 4 : 0)).filter((m) => m > 0);
  if (hit.length === 0) return false;
  // 7/1に解消：6月の給与がふつう、または7月の給与がもう入っていてふつう（定時決定の計算と同じ。regular.ts）
  const resolved = (months[2] != null && months[2].state !== 'furlough') || (july != null && july.state !== 'furlough');
  return `9．その他（一時帰休 休業手当 ${hit.join('.')}月${resolved ? '・一時帰休解消' : ''}）`;
}

/** 月額変更届の備考 */
export function irregularRemarks(x: {
  employee: FilingEmployee;
  revisedFrom: YearMonth;
  annual: boolean;
  reasonNote: string | null;
  bonusMonthly?: number | null;
  bonusMonths?: readonly number[];
}): string[] {
  const e = x.employee;
  return [
    over70(e.birthDate, `${x.revisedFrom}-01`) && '1．70歳以上被用者月額変更',
    e.multipleOffices && '2．二以上勤務',
    !!x.reasonNote && `4．昇給・降給の理由（${x.reasonNote}）`,
    x.annual && '6．その他（年間平均）',
    bonusRemark('6', x.bonusMonthly, x.bonusMonths),
  ].filter((s): s is string => !!s);
}

/**
 * 特例改定（令和9年1月から）の備考（保保発0731第4号 別紙1-1・1-2。11/16）
 * 「6．その他」は様式にあらかじめ書いてある：下がったとき「特例改定（申立書兼同意書１.ⅰに該当）」、戻ったとき「報酬回復（申立書兼同意書1.ⅳに該当）」
 */
export function specialRemarks(x: {
  employee: FilingEmployee;
  revisedFrom: YearMonth;
  direction: 'down' | 'up';
}): string[] {
  const e = x.employee;
  return [
    over70(e.birthDate, `${x.revisedFrom}-01`) && '1．70歳以上被用者月額変更',
    e.multipleOffices && '2．二以上勤務',
    x.direction === 'down' ? '6．その他（特例改定（申立書兼同意書１.ⅰに該当））' : '6．その他（報酬回復（申立書兼同意書1.ⅳに該当））',
  ].filter((s): s is string => !!s);
}

/**
 * 特例改定の行（月額変更届（特例改定用）別紙1-1・1-2）
 * - 初月の報酬は、3か月の欄のうち一番下（3か月目）に書く。⑭総計・⑮平均額は書かない。⑯修正平均額 ＝ 合計 − 遡及支払額
 */
export function specialRow(x: RevisionRowInput & { corrected: number }): FilingRow {
  const row = revisionRow('irregular', { ...x, firstMonth: shiftMonth(x.firstMonth, -2) });
  return { ...row, sum: '', average: '', corrected: yen(x.corrected) };
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

/** 賞与支払届に出す1回分の支払い（人ごと） */
export interface BonusPaid {
  employeeId: string;
  paidDate: DateStr;
  cash: number;
  inKind: number;
}

/**
 * 同じ人・同じ月の賞与を1行にまとめる（日本年金機構の記入方法：同一月に2回以上支払ったときは合算額を記入し、
 * 支払日は最後に払った日、備考に「3．同一月内の賞与合算（初回支払日）」。11/19）
 * 並びは 人の出てきた順 → 月の順
 */
export function mergeSameMonth(list: readonly BonusPaid[]): (BonusPaid & { firstPaidInMonth: DateStr | null })[] {
  const groups = new Map<string, BonusPaid[]>();
  for (const b of list) {
    const key = `${b.employeeId}|${b.paidDate.slice(0, 7)}`;
    const g = groups.get(key);
    if (g) g.push(b);
    else groups.set(key, [b]);
  }
  return [...groups.values()].map((g) => {
    const sorted = [...g].sort((a, b) => a.paidDate.localeCompare(b.paidDate));
    const last = sorted[sorted.length - 1];
    const first = sorted[0];
    return {
      employeeId: last.employeeId,
      paidDate: last.paidDate,
      cash: sorted.reduce((s, b) => s + b.cash, 0),
      inKind: sorted.reduce((s, b) => s + b.inKind, 0),
      firstPaidInMonth: first.paidDate < last.paidDate ? first.paidDate : null,
    };
  });
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

/**
 * 資格取得時決定の報酬月額に、賞与に係る報酬の平均を足してあるか（足してあればその額、なければ 0。11/20）
 * 「同様の業務に従事し、同様の賞与を受ける者」はアプリでは決められないので、届に自動では足さない。
 * 報酬月額のカードで［報酬月額に足す］を押した（決定の額 ＝ 契約の見込み ＋ 平均）ときだけ、届にも足す
 */
export function addedAcquireBonus(decided: number | null, expected: number | null, average: number): number {
  if (average <= 0 || decided == null || expected == null) return 0;
  return decided - expected === average ? average : 0;
}
