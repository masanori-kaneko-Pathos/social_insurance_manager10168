/**
 * 被保険者区分の判定（ある日について）
 * Angular・Firebase に依存しない純粋な関数。結果は保存せず、毎回ここで計算する（設計書 v0.4 の決まり1）
 *
 * 区分（被保険者区分変更届の3つ ＋ 対象外 ＋ 判定できない）
 * - regular：通常の労働者（4分の3基準を満たす）
 * - shortTime：短時間労働者（4分の3未満だが、特定適用事業所で週20時間以上・学生でない など）
 * - reducedWage：特定減額特例対象者で、加入を申し出ている
 * - excluded：加入しない
 * - unknown：材料が足りなくて判定できない
 *
 * 根拠：健康保険法3条1項2・4・5・9号、厚生年金保険法12条・13条、
 *       日本年金機構「適用事業所と被保険者」、令和4年10月施行分の Q&A 集（問2・4〜9）
 * 年齢（70歳で厚年、75歳で健保を喪失）は coverage.ts が見る。ここでは特定減額特例の「70歳未満」だけ見る
 */
import { Contract } from '../../../core/models/contract';
import { CriteriaDoc } from '../../../core/models/master';
import { DateStr, monthsPeriodEnd, toYearMonth } from '../../../shared/utils/date';
import { formatHours, formatYen } from '../../../shared/utils/number';
import { contractAt, isShortPeriod } from './contract-form-model';
import {
  ageReachDate,
  criteriaAt,
  isSpecificApplied,
  threeQuartersOf,
  WorkSchedule,
} from './coverage';

/** 判定に使う契約の項目（11/9 より前の契約は、雇い方などの項目がない） */
export type ClassifyContract = Pick<
  Contract,
  | 'from'
  | 'weeklyMinutes'
  | 'monthlyDays'
  | 'scheduledWage'
  | 'periodEnd'
  | 'renewal'
  | 'student'
  | 'minimumWageReduction'
> &
  Partial<Pick<Contract, 'specialEmployment' | 'renewalPrecedent' | 'noExtensionAgreed'>>;

export interface ClassifyPerson {
  birthDate: DateStr;
  optInDate: DateStr | null; // 特定減額特例：加入の申出日
  optOutDate?: DateStr | null; // 特定減額特例：喪失の申出日
  contracts: ClassifyContract[];
}

export interface ClassifyOffice {
  standardHours: WorkSchedule | null;
  specificApplication?: { since: string | null };
}

export type ClassifyCriteria = Pick<
  CriteriaDoc,
  'from' | 'weeklyMinutesMin' | 'wageMin' | 'reducedWageMin'
>;

export type Category = 'regular' | 'shortTime' | 'reducedWage' | 'excluded' | 'unknown';

export type ClassifyReason =
  // 加入
  | 'threeQuarters' // 4分の3基準を満たす
  | 'shortTimeRequirements' // 短時間労働者の要件を満たす
  | 'optedIn' // 特定減額特例で、加入を申し出ている
  // 対象外：働き方
  | 'notSpecific' // 4分の3未満で、特定適用事業所ではない
  | 'under20h' // 週20時間未満
  | 'student' // 昼間の学生
  | 'lowWage' // 所定内賃金が賃金要件（2026-09 まで 8.8万円）未満
  | 'reducedWage' // 特定減額特例対象者で、申出がない
  // 対象外：雇い方と期間
  | 'daily' // 日々雇い入れ（1か月以内）
  | 'shortTerm' // 2か月以内の契約で、更新の見込みがない
  | 'seasonal' // 季節的業務（4か月以内）
  | 'temporaryBusiness' // 臨時的事業（6か月以内）
  // 判定できない
  | 'noContract'
  | 'noStandard' // 事業所の所定が空
  | 'noCriteria'; // 基準のマスタがない

/** 4分の3に届かなかった側（届いていれば null） */
export type Below = 'hours' | 'days' | 'both';

/** 理由の文に入れる数字（判定に使った値。分・日・円） */
export interface ClassifyNums {
  weeklyMinutes: number;
  monthlyDays: number;
  scheduledWage: number;
  /** 通常の労働者の所定（事業所の設定） */
  stdWeeklyMinutes: number | null;
  stdMonthlyDays: number | null;
  /** その月の基準（masterCriteria） */
  minWeeklyMinutes: number | null;
  wageMin: number | null;
  reducedWageMin: number | null;
}

export interface Classification {
  category: Category;
  reason: ClassifyReason;
  /** 判定に使った契約（その日に効いている契約）の始まる日 */
  contractFrom: DateStr | null;
  below: Below | null;
  nums: ClassifyNums | null;
}

export function isInsured(c: Pick<Classification, 'category'>): boolean {
  return c.category === 'regular' || c.category === 'shortTime' || c.category === 'reducedWage';
}

// ===== 1. 働き方での判定（期間は見ない） =====

/** 特定減額特例の申出：その日までの、いちばん新しい申出が「加入」か */
function optedInAt(p: ClassifyPerson, date: DateStr): boolean {
  const joined = p.optInDate && p.optInDate <= date ? p.optInDate : null;
  const left = p.optOutDate && p.optOutDate <= date ? p.optOutDate : null;
  return !!joined && (!left || joined > left);
}

function byWork(
  c: ClassifyContract,
  p: ClassifyPerson,
  office: ClassifyOffice,
  criteria: ClassifyCriteria[],
  date: DateStr,
): Omit<Classification, 'contractFrom'> {
  const std = office.standardHours;
  const month = toYearMonth(date);
  const k = criteriaAt(criteria, month);
  const nums: ClassifyNums = {
    weeklyMinutes: c.weeklyMinutes,
    monthlyDays: c.monthlyDays,
    scheduledWage: c.scheduledWage,
    stdWeeklyMinutes: std?.weeklyMinutes ?? null,
    stdMonthlyDays: std?.monthlyDays ?? null,
    minWeeklyMinutes: k?.weeklyMinutesMin ?? null,
    wageMin: k?.wageMin ?? null,
    reducedWageMin: k?.reducedWageMin ?? null,
  };
  const tq = threeQuartersOf(c, std);
  if (tq === 'unknown') return { category: 'unknown', reason: 'noStandard', below: null, nums };
  if (tq === 'meets') return { category: 'regular', reason: 'threeQuarters', below: null, nums };

  // 4分の3未満 → 短時間労働者の要件
  const below = belowSide(c, std!);
  const r = (category: Category, reason: ClassifyReason) => ({ category, reason, below, nums });
  if (!isSpecificApplied(office.specificApplication, month)) return r('excluded', 'notSpecific');
  if (!k) return r('unknown', 'noCriteria');
  if (c.weeklyMinutes < k.weeklyMinutesMin) return r('excluded', 'under20h');
  if (c.student === 'daytime') return r('excluded', 'student');
  if (k.wageMin !== null && c.scheduledWage < k.wageMin) return r('excluded', 'lowWage');
  // 特定減額特例対象者：70歳未満・最低賃金の減額の特例許可・所定内賃金が基準未満
  const reduced =
    k.reducedWageMin !== null &&
    c.minimumWageReduction &&
    c.scheduledWage < k.reducedWageMin &&
    date < ageReachDate(p.birthDate, 70);
  if (reduced) {
    return optedInAt(p, date) ? r('reducedWage', 'optedIn') : r('excluded', 'reducedWage');
  }
  return r('shortTime', 'shortTimeRequirements');
}

/** 4分の3に届かなかったのは、時間・日数・両方のどれか（threeQuartersOf が 'below' のときに呼ぶ） */
function belowSide(work: WorkSchedule, std: WorkSchedule): Below {
  const hours = work.weeklyMinutes * 4 < std.weeklyMinutes * 3;
  const days = work.monthlyDays * 4 < std.monthlyDays * 3;
  return hours && days ? 'both' : hours ? 'hours' : 'days';
}

// ===== 2. 雇い方と期間での判定 =====

/** 2か月以内の契約で、更新の見込みがあるか（Q&A 問2：書面に「更新する（場合がある）」か、同様の契約の実績。労使の合意があれば見込みなし） */
function extensionExpected(c: ClassifyContract): boolean {
  const hasGround = c.renewal !== 'none' || (c.renewalPrecedent ?? false);
  return hasGround && !(c.noExtensionAgreed ?? false);
}

/**
 * 期間で除外されるなら、その理由（除外されなければ null）
 * chain：働き方の要件を続けて満たしている契約の行（古い順。先頭が「要件を満たした最初の契約」＝ Q&A 問9 の起点）
 */
function periodExclusion(chain: ClassifyContract[], date: DateStr): ClassifyReason | null {
  const first = chain[0];
  const current = chain[chain.length - 1];
  const start = first.from;

  switch (current.specialEmployment ?? 'none') {
    case 'daily':
      // 1か月を超えて続けて使われた日から加入（健保法3条1項2号イ・厚年法12条1号イ）
      return date <= monthsPeriodEnd(start, 1) ? 'daily' : null;
    case 'seasonal':
      // 続けて4か月を超える予定なら最初から加入。期間の定めがなければ予定は4か月を超える
      return current.periodEnd && current.periodEnd <= monthsPeriodEnd(start, 4)
        ? 'seasonal'
        : null;
    case 'temporaryBusiness':
      return current.periodEnd && current.periodEnd <= monthsPeriodEnd(start, 6)
        ? 'temporaryBusiness'
        : null;
    case 'none': {
      if (!isShortPeriod(first.from, first.periodEnd)) return null;
      // 定めた期間を超えて続けて使われたら、超えた日から加入（同 2号ロ のかっこ書き）
      if (first.periodEnd && date > first.periodEnd) return null;
      // 期間の中：どれかの行で一度でも見込みありになれば加入。途中で見込みがなくなっても外れない（問4〜7）
      return chain.some(extensionExpected) ? null : 'shortTerm';
    }
  }
}

// ===== 3. まとめ =====

/** その日の区分と理由 */
export function classify(
  p: ClassifyPerson,
  office: ClassifyOffice,
  criteria: ClassifyCriteria[],
  date: DateStr,
): Classification {
  const current = contractAt(p.contracts, date);
  if (!current) {
    return {
      category: 'unknown',
      reason: 'noContract',
      contractFrom: null,
      below: null,
      nums: null,
    };
  }

  const work = byWork(current, p, office, criteria, date);
  if (!isInsured(work)) return { ...work, contractFrom: current.from };

  // その日の契約から古いほうへ、働き方の要件を満たし続けている行をたどる
  const rows = p.contracts
    .filter((c) => c.from <= date)
    .sort((a, b) => a.from.localeCompare(b.from));
  let i = rows.indexOf(current);
  while (i > 0 && isInsured(byWork(rows[i - 1], p, office, criteria, rows[i - 1].from))) i--;
  const chain = rows.slice(i, rows.indexOf(current) + 1);

  const excluded = periodExclusion(chain, date);
  return excluded
    ? { ...work, category: 'excluded', reason: excluded, contractFrom: current.from }
    : { ...work, contractFrom: current.from };
}

// ===== 4. 画面に出す数字 =====

/**
 * 理由の文（翻訳ファイルの {{ }}）に渡す値。時間は「40:00」、金額は「88,000」の形にする
 * 例：「月の所定労働日数が、通常の労働者の4分の3未満です（{{stdDays}}日のうち {{days}}日）。」
 */
export function reasonParams(c: Pick<Classification, 'nums'>): Record<string, string | number> {
  const n = c.nums;
  if (!n) return {};
  const hm = (v: number | null) => (v === null ? '' : formatHours(v));
  const yen = (v: number | null) => (v === null ? '' : formatYen(v));
  return {
    work: hm(n.weeklyMinutes),
    days: n.monthlyDays,
    std: hm(n.stdWeeklyMinutes),
    stdDays: n.stdMonthlyDays ?? '',
    // 4分の3の線（「40:00 のうち 20:00」だと、何と比べたか分かりにくいので、線そのものも出す。11/13）
    stdQ: n.stdWeeklyMinutes === null ? '' : hm(Math.ceil((n.stdWeeklyMinutes * 3) / 4)),
    stdDaysQ:
      n.stdMonthlyDays === null
        ? ''
        : String(Math.round(n.stdMonthlyDays * 0.75 * 100) / 100),
    minHours: hm(n.minWeeklyMinutes),
    wage: yen(n.scheduledWage),
    wageMin: yen(n.wageMin),
    reducedWageMin: yen(n.reducedWageMin),
  };
}
