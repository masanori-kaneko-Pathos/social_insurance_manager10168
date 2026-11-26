// 照合で差が出たとき、アプリが持っているデータから「差の額と合う原因」を当てる（11/26）
// - ② 給与ソフトの控除額（1人ずつ）：前の月の額のまま・精算を含めた・最後の給与で2か月分・支援金や介護の有無・端数
// - ④ 告知額（事業所の合計・欄ごと）：改定・取得・喪失・賞与が、年金事務所でまだ処理されていない など
// 原因を一覧で並べるだけでなく、額が合うものだけを名前と額つきで出す。合うものがなければ「アプリでは分からない」と出す
// Angular・Firebase に依存しない純粋な関数

import type { PremiumPart, PremiumResult } from '../../../core/models/premium';
import type { NoticeCategory } from './notice-check';
import type { ChangeReason } from './premium-rows';

// ===== ② 給与ソフトの控除額（1人ずつ） =====

export type DeductionCause =
  | 'stale' // 給与ソフトが前の月の額のまま（改定などが給与ソフトに入っていない）
  | 'settlement' // 確認済みの月の差額を、同じ給与で精算して控除している
  | 'twoMonths' // 資格を失う前の最後の給与で、前月分と当月分の2か月分を控除している
  | 'noChildSupport' // 子ども・子育て支援金を控除していない
  | 'care' // 介護保険料の有無が違う
  | 'rounding'; // 1円の端数（50銭の扱い・健保と支援金を合算するか個別か）

/** 1人分の、原因を当てるための材料 */
export interface DeductionContext {
  /** アプリの本人負担の合計（今月） */
  appYen: number;
  /** 前の月の本人負担の合計（計算できない・かからない月は null） */
  previousYen: number | null;
  /** 前の月から変わった理由 */
  changes: readonly ChangeReason[];
  /** 資格を失う前の最後の月か */
  lastMonth: boolean;
  /** 本人負担のうち、支援金・介護（その人にかかっていなければ 0） */
  childSupportYen: number;
  careYen: number;
  /** この給与の月で精算した差額の合計（本人分。精算がなければ 0） */
  settlementYen: number;
}

export interface FoundCause<K extends string> {
  key: K;
  params?: Record<string, string | number>;
}

/** 前の月の額のままになりやすい変化（新しく入った人は、前の月の額がない） */
const STALE_CHANGES: readonly ChangeReason[] = ['grade', 'cap', 'careStart', 'careEnd', 'rate'];

/**
 * 給与ソフトの額（合計）と、アプリの材料から、差の額に合う原因を出す
 * - 額が合うものだけ。前の月の額のままは「改定など」があったときだけ（たまたま同じ額の人を誤って拾わない）
 * - 1円の端数は、ほかの原因が見つからないときだけ
 */
export function deductionCauses(softYen: number, x: DeductionContext): FoundCause<DeductionCause>[] {
  const diff = softYen - x.appYen;
  if (diff === 0) return [];
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  const out: FoundCause<DeductionCause>[] = [];

  const stale = x.changes.filter((c) => STALE_CHANGES.includes(c));
  if (x.previousYen != null && stale.length > 0 && near(softYen, x.previousYen)) {
    out.push({ key: 'stale', params: { changes: stale.join(','), previous: x.previousYen } });
  }
  if (x.settlementYen !== 0 && near(diff, x.settlementYen)) {
    out.push({ key: 'settlement', params: { amount: x.settlementYen } });
  }
  if (x.lastMonth && x.appYen > 0 && Math.abs(softYen - 2 * x.appYen) <= 2) {
    out.push({ key: 'twoMonths' });
  }
  if (x.childSupportYen > 0 && near(diff, -x.childSupportYen)) {
    out.push({ key: 'noChildSupport', params: { amount: x.childSupportYen } });
  }
  if (x.careYen > 0 && near(Math.abs(diff), x.careYen)) {
    out.push({ key: 'care', params: { amount: x.careYen } });
  }
  if (out.length === 0 && Math.abs(diff) === 1) out.push({ key: 'rounding' });
  return out;
}

// ===== ④ 告知額（事業所の合計・欄ごと） =====

export type NoticeCause =
  | 'gradePending' // 標準報酬の改定が、年金事務所でまだ処理されていない（告知は前の額）
  | 'acquirePending' // 今月から加入した人が、告知にまだ入っていない（資格取得届の処理待ち）
  | 'lossPending' // 前の月で資格を失った人が、告知にまだ入っている（資格喪失届の処理待ち）
  | 'bonusPending'; // この月の賞与が、告知にまだ入っていない（賞与支払届の処理待ち）

/** 欄ごとの全額（1/1000円） */
export type CategoryMilli = Record<NoticeCategory, number>;

export const ZERO_CATEGORY: CategoryMilli = { health: 0, pension: 0, childContribution: 0 };

const PART_CATEGORY: Record<PremiumPart, NoticeCategory> = {
  health: 'health',
  care: 'health',
  childSupport: 'health',
  pension: 'pension',
  childContribution: 'childContribution',
};

/** 1人1か月の計算を、告知書の欄ごとの全額にまとめる */
export function categoryMilliOf(result: PremiumResult | null | undefined): CategoryMilli {
  const out = { ...ZERO_CATEGORY };
  for (const g of result?.groups ?? []) for (const l of g.lines) out[PART_CATEGORY[l.part]] += l.totalMilli;
  return out;
}

/** 告知の欄の差を説明する候補（額は 告知 − アプリ の向き） */
export interface NoticeCandidate {
  key: NoticeCause;
  /** この原因なら出るはずの差（円。欄ごと） */
  yen: CategoryMilli;
  /** 当てはまる人（氏名） */
  names: string[];
}

/** 1人分の材料（今月と前の月の欄ごとの全額） */
export interface NoticePerson {
  name: string;
  /** 今月の全額（かからなければ 0） */
  now: CategoryMilli;
  /** 前の月の全額（かからなければ 0） */
  before: CategoryMilli;
  /** 今月から加入した（前の月はかからず、今月かかる） */
  joined: boolean;
  /** 前の月まで加入していて、今月はかからない（資格喪失） */
  left: boolean;
  /** 今月から標準報酬が変わった（資格取得時決定を除く） */
  regraded: boolean;
}

const toYen = (m: CategoryMilli): CategoryMilli => ({
  health: Math.round(m.health / 1000),
  pension: Math.round(m.pension / 1000),
  childContribution: Math.round(m.childContribution / 1000),
});

function add(a: CategoryMilli, b: CategoryMilli, sign = 1): CategoryMilli {
  return {
    health: a.health + sign * b.health,
    pension: a.pension + sign * b.pension,
    childContribution: a.childContribution + sign * b.childContribution,
  };
}

/** 告知の差を説明しうる候補（人がいないものは出さない）。bonusMilli はこの月の賞与の全額 */
export function noticeCandidates(people: readonly NoticePerson[], bonusMilli: CategoryMilli | null): NoticeCandidate[] {
  const out: NoticeCandidate[] = [];
  const collect = (key: NoticeCause, pick: (p: NoticePerson) => boolean, amount: (p: NoticePerson) => CategoryMilli) => {
    const hit = people.filter(pick);
    if (hit.length === 0) return;
    const sum = hit.reduce((s, p) => add(s, amount(p)), { ...ZERO_CATEGORY });
    out.push({ key, yen: toYen(sum), names: hit.map((p) => p.name) });
  };
  // 告知が前の額のまま → 差 ＝ 前 − 今
  collect('gradePending', (p) => p.regraded && !p.joined, (p) => add(p.before, p.now, -1));
  // 告知に入っていない → 差 ＝ −今
  collect('acquirePending', (p) => p.joined, (p) => add(ZERO_CATEGORY, p.now, -1));
  // 告知にまだ入っている → 差 ＝ ＋前
  collect('lossPending', (p) => p.left, (p) => p.before);
  if (bonusMilli && (bonusMilli.health || bonusMilli.pension || bonusMilli.childContribution)) {
    out.push({ key: 'bonusPending', yen: toYen(add(ZERO_CATEGORY, bonusMilli, -1)), names: [] });
  }
  return out;
}

/**
 * 欄ごとの差（告知 − アプリ）に、合う候補の組み合わせを探す
 * - 候補を1つ以上足して、全部の欄で差と ±1円 で合えば一致（事業所の合計は欄ごとに1円未満を切り捨てるため）
 * - 候補は多くても数個なので、組み合わせを全部試す。合う組み合わせが複数なら、候補の少ないほう
 * - 合うものがなければ空（「アプリでは分からない」）
 */
export function matchNotice(diff: Record<NoticeCategory, number | null>, candidates: readonly NoticeCandidate[]): NoticeCause[] {
  const cats: NoticeCategory[] = ['health', 'pension', 'childContribution'];
  if (cats.every((c) => !diff[c])) return [];
  const n = Math.min(candidates.length, 8);
  let best: NoticeCause[] | null = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    const pick = candidates.filter((_, i) => mask & (1 << i));
    const ok = cats.every((c) => {
      const d = diff[c] ?? 0;
      const sum = pick.reduce((s, x) => s + x.yen[c], 0);
      return Math.abs(d - sum) <= pick.length;
    });
    if (ok && (!best || pick.length < best.length)) best = pick.map((x) => x.key);
  }
  return best ?? [];
}

/** 当てた原因を、告知の「差の理由」の印に直す（手で選ぶ欄の初期値に使う） */
export const NOTICE_CAUSE_REASON: Record<NoticeCause, 'gradeChange' | 'acquireLoss' | 'bonusFiling'> = {
  gradePending: 'gradeChange',
  acquirePending: 'acquireLoss',
  lossPending: 'acquireLoss',
  bonusPending: 'bonusFiling',
};
