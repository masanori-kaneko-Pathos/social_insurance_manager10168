// 月次確定：「この月はこの額で控除した」記録と、確定した後に計算が変わった人の差額（11/24）
// Angular・Firebase に依存しない純粋な関数
//
// たとえるとレジ締め。締めた後も売り場は開いていて（編集は止めない）、締めた記録と今の計算がずれたら、ずれた分だけが分かる。
// - 確定の記録は書き換えない（作成と取り消しだけ）。差額は「今の計算 − 確定時」で毎回出す
// - 差額は見せるだけ。実際に給与から引く・返すのは給与ソフトの仕事。精算した給与の月を記録すると「精算済み」になる
// - 精算した後にさらに計算が変わったら「精算後に変更あり」にして、もう一度見せる
// - 年金機構は、遡った届を処理した月の告知で、過去の月の差額を「前月までの精算額」として載せる（保険料増減内訳書の様式）
// - 保険料の徴収の時効は2年（健保法193条・厚年法92条）。納期限から2年を過ぎた月の差額は合計から外す（recalc.ts と同じ）

import type { DateStr, YearMonth } from '../../../shared/utils/date';
import { isExpired } from './recalc';

/** 1人分の確定した額（文書を小さくするため、キーは1文字） */
export interface ClosedAmount {
  /** 本人負担（円。保険料と支援金。拠出金は会社だけなので入らない） */
  e: number;
  /** 保険料の全額（1/1000円。健保・介護・支援金・厚年。拠出金は含まない） */
  t: number;
  /** 子ども・子育て拠出金（1/1000円） */
  c: number;
}

/** 従業員ID → 確定した額 */
export type ClosePeople = Record<string, ClosedAmount>;

/** 保険料の一覧の1行のうち、確定に要るもの */
export interface CloseSource {
  id: string;
  state: 'ok' | 'none' | 'missing' | 'error' | 'exempt';
  employeeYen: number;
  premiumTotalMilli: number;
  contributionMilli: number;
}

const ZERO: ClosedAmount = { e: 0, t: 0, c: 0 };

/** 確定できない人（計算できない人）の数。0 でなければ確定させない（0円で記録すると、あとで全部が差額に見えるため） */
export function closeBlockers(rows: readonly CloseSource[]): number {
  return rows.filter((r) => r.state === 'missing' || r.state === 'error').length;
}

/** 確認済みにする前に確かめること（11/27。Q3・Q4・Q5） */
export interface CloseCheckInput {
  /** まだ来ていない月か */
  future: boolean;
  /** 月額の保険料を計算できない人の数（closeBlockers） */
  blockers: number;
  /** この月に払った賞与で、計算できない人の数 */
  bonusProblems: number;
  /** 一覧の行の数（加入している人がいない月は 0） */
  rowCount: number;
  /** 定時決定がまだ反映されていない人の数 */
  regularPending: number;
  /** 給与ソフトとの照合（今の額で比べた結果。読んでいなければ null） */
  soft: { matched: number; diff: number } | null;
}

export type CloseNote = 'softMissing' | 'softDiff' | 'regularPending';

export interface CloseCheck {
  /** 確認済みにできない理由（monthClose.block.* のキーの末尾）。できるなら null */
  block: 'future' | 'problems' | 'bonusProblems' | 'empty' | null;
  /** 止めないが、押す前に知らせること（順に出す） */
  notes: CloseNote[];
}

/**
 * 確認済みにできるか
 * - 止める：まだ来ていない月・月額か賞与に計算できない人がいる（納付額が欠けたまま進むため）・加入している人がいない
 * - 知らせる：照合していない・照合で差がある・定時決定が反映されていない（決定通知書の前に控除する会社があるので止めない）
 * 確認済みの後も編集は止めず、変わった分は差額に出る（11/24の方針）
 */
export function closeCheck(x: CloseCheckInput): CloseCheck {
  const notes: CloseNote[] = [];
  if (!x.soft) notes.push('softMissing');
  else if (x.soft.diff > 0) notes.push('softDiff');
  if (x.regularPending > 0) notes.push('regularPending');
  const block = x.future
    ? 'future'
    : x.blockers > 0
      ? 'problems'
      : x.bonusProblems > 0
        ? 'bonusProblems'
        : x.rowCount === 0
          ? 'empty'
          : null;
  return { block, notes };
}

/**
 * その月の確定の記録（人ごと）
 * - 計算できた人はその額、免除の人は 0（免除だったことも記録する。あとで免除が外れたら差額に出る）
 * - その月に加入していない人は入れない（あとで遡って加入したら、確定時は 0 として差額に出る）
 */
export function buildPeople(rows: readonly CloseSource[]): ClosePeople {
  if (closeBlockers(rows) > 0) throw new Error('month-close: rows that cannot be calculated');
  const out: ClosePeople = {};
  for (const r of rows) {
    if (r.state === 'ok') out[r.id] = { e: r.employeeYen, t: r.premiumTotalMilli, c: r.contributionMilli };
    else if (r.state === 'exempt') out[r.id] = { ...ZERO };
  }
  return out;
}

/** 確定の記録の合計（文書に一緒に残す。告知額と見比べる材料） */
export function peopleTotals(people: ClosePeople): { count: number; employeeYen: number; premiumTotalMilli: number; contributionMilli: number } {
  let employeeYen = 0;
  let premiumTotalMilli = 0;
  let contributionMilli = 0;
  const list = Object.values(people);
  for (const p of list) {
    employeeYen += p.e;
    premiumTotalMilli += p.t;
    contributionMilli += p.c;
  }
  return { count: list.length, employeeYen, premiumTotalMilli, contributionMilli };
}

/** 精算の記録（1人1件。精算したときの差額を残し、その後に変わったかを見分ける） */
export interface Settlement {
  employeeId: string;
  /** 精算した給与の支払月 */
  payMonth: YearMonth;
  diffEmployeeYen: number;
  diffTotalMilli: number;
  diffContributionMilli: number;
}

/** open：精算していない／settled：精算済み／changedAfterSettle：精算した後にさらに変わった */
export type DiffStatus = 'open' | 'settled' | 'changedAfterSettle';

export interface CloseDiff {
  id: string;
  closed: ClosedAmount;
  now: ClosedAmount;
  /** 本人の差額（円。プラスなら追加で引く、マイナスなら返す） */
  diffEmployeeYen: number;
  /** 会社の保険料の差額（1/1000円） */
  diffEmployerMilli: number;
  /** 保険料の全額の差額（1/1000円） */
  diffTotalMilli: number;
  /** 拠出金の差額（1/1000円） */
  diffContributionMilli: number;
  status: DiffStatus;
  settlement: Settlement | null;
  /** 時効（納期限から2年）を過ぎた月 */
  expired: boolean;
  /** 退職済み（給与で精算できない。別に精算してもらう） */
  retired: boolean;
}

export interface DiffOptions {
  month: YearMonth;
  today: DateStr;
  /** 退職済みの人（呼ぶ側で、退職日が今日より前の人を入れる） */
  retiredIds?: ReadonlySet<string>;
}

/**
 * 確定時と今の計算の差がある人
 * 差がない人は出さない。ただし精算の記録がある人は、差が 0 に戻っても出す（精算した後に元に戻った）
 * 並びは呼ぶ側で決める（ここでは従業員IDの順）
 */
export function diffsOf(
  closed: ClosePeople,
  now: ClosePeople,
  settlements: Readonly<Record<string, Settlement>>,
  opt: DiffOptions,
): CloseDiff[] {
  const ids = [...new Set([...Object.keys(closed), ...Object.keys(now), ...Object.keys(settlements)])].sort();
  const expired = isExpired(opt.month, opt.today);
  const out: CloseDiff[] = [];
  for (const id of ids) {
    const c = closed[id] ?? ZERO;
    const n = now[id] ?? ZERO;
    const dE = n.e - c.e;
    const dT = n.t - c.t;
    const dC = n.c - c.c;
    const s = settlements[id] ?? null;
    if (dE === 0 && dT === 0 && dC === 0 && !s) continue;
    const status: DiffStatus = !s
      ? 'open'
      : s.diffEmployeeYen === dE && s.diffTotalMilli === dT && s.diffContributionMilli === dC
        ? 'settled'
        : 'changedAfterSettle';
    out.push({
      id,
      closed: c,
      now: n,
      diffEmployeeYen: dE,
      diffEmployerMilli: dT - dE * 1000,
      diffTotalMilli: dT,
      diffContributionMilli: dC,
      status,
      settlement: s,
      expired,
      retired: opt.retiredIds?.has(id) ?? false,
    });
  }
  return out;
}

/** 精算がまだの差額（時効の月・精算済みの人を除く）。「精算後に変更あり」は、前に精算した分を引いた残り */
export function openTotals(diffs: readonly CloseDiff[]): {
  count: number;
  employeeYen: number;
  employerMilli: number;
  totalMilli: number;
  contributionMilli: number;
} {
  let count = 0;
  let employeeYen = 0;
  let totalMilli = 0;
  let contributionMilli = 0;
  for (const d of diffs) {
    if (d.expired || d.status === 'settled') continue;
    const s = d.settlement;
    const e = d.diffEmployeeYen - (s?.diffEmployeeYen ?? 0);
    const t = d.diffTotalMilli - (s?.diffTotalMilli ?? 0);
    const c = d.diffContributionMilli - (s?.diffContributionMilli ?? 0);
    if (e === 0 && t === 0 && c === 0) continue;
    count++;
    employeeYen += e;
    totalMilli += t;
    contributionMilli += c;
  }
  return { count, employeeYen, employerMilli: totalMilli - employeeYen * 1000, totalMilli, contributionMilli };
}

/** 精算の記録を作る（今の差額をそのまま残す） */
export function settlementOf(d: CloseDiff, payMonth: YearMonth): Settlement {
  return {
    employeeId: d.id,
    payMonth,
    diffEmployeeYen: d.diffEmployeeYen,
    diffTotalMilli: d.diffTotalMilli,
    diffContributionMilli: d.diffContributionMilli,
  };
}

/**
 * 確定した月ごとの、全員の差額の合計（突き合わせの「前月までの精算額」と見比べる。精算の記録には関係なく、全額の差）
 * 年金機構の告知は事業所が納める全額なので、本人・会社に分けずに保険料と拠出金で出す
 */
export function monthDiffSummary(
  month: YearMonth,
  closed: ClosePeople,
  now: ClosePeople,
  today: DateStr,
): { month: YearMonth; count: number; totalMilli: number; contributionMilli: number; expired: boolean } {
  const diffs = diffsOf(closed, now, {}, { month, today });
  return {
    month,
    count: diffs.length,
    totalMilli: diffs.reduce((s, d) => s + d.diffTotalMilli, 0),
    contributionMilli: diffs.reduce((s, d) => s + d.diffContributionMilli, 0),
    expired: isExpired(month, today),
  };
}
