// 給与の内訳の「この入力で決まること」（11/26）
// Angular・Firebase に依存しない純粋な関数
//
// 1人・1か月分の入力から、随時改定の起算月になりそうか・平均に入る月かを、入力したその場で知らせる。
// 決めるのは改定の候補の画面（irregular.ts の findStartMonths）。ここは同じ決まりを1か月分だけ当てた「案内」で、保存も判定もしない。
// 1か月分の額だけで「改定の候補」とは言わない（随時改定は起算月から3か月の平均で決まる）。
//
// 決まり（findStartMonths と同じ順）
// - 雇用契約の時給・日給・所定労働時間・給与の形が変わった月 → 起算月（契約の変更）
// - 日割りの月（月の途中で変わった）→ この月ではなく次の月から数える
// - 固定的賃金（欠勤控除を引く前。時給・日給の人は時給×時間を除いた額）が前の月から変わった → 起算月
// - 現物給与の額が変わった → 起算月（現物給与も固定的賃金）
// - 遡及支払額がある → 起算月
// - 時給・日給の人で内訳がない月 → 額では比べない（働いた時間の増減は固定的賃金の変動ではない。事例集 問1-3）
// - 前の月の入力がない・0円 → 比べられない
// 支払基礎日数が基準（17日。特定適用事業所の短時間労働者は11日）に届かない月は、定時決定・随時改定の平均に入らない

import type { Direction } from './irregular';

/** 月の画面が内訳の部品に渡す、その人の材料（内訳を開いたときに読む） */
export interface EntryCheckContext {
  /** 前の月の給与（入力がなければ null） */
  prev: { fixed: number; fixedFull: number | null; inKind: number | null } | null;
  /** 今の標準報酬月額（円。未登録は null） */
  standard: { health: number | null; pension: number | null } | null;
  /** 支払基礎日数の基準（17日・短時間労働者は11日） */
  minDays: number;
  /** この月が、雇用契約の変更の起算月か（向き。なければ null） */
  contractChange: Direction | null;
  /** 時給・日給の人か */
  byUnit: boolean;
}

export interface EntryCheckInput {
  /** 時給・日給の人か（契約が分からなければ false） */
  byUnit: boolean;
  /** この月の、変動を見る固定的賃金（内訳があれば欠勤控除を引く前の額。時給・日給の人は時給×時間を除く）。未入力は null */
  fixedNow: number | null;
  /** 内訳があるか（時給・日給の人は、内訳がないと額で比べられない） */
  hasLines: boolean;
  /** 前の月の、変動を見る固定的賃金（入力がなければ null） */
  fixedPrev: number | null;
  /** この月・前の月の現物給与の額（分からない・総支給額に含まれているなら null） */
  inKindNow: number | null;
  inKindPrev: number | null;
  /** 遡及支払額 */
  retro: number;
  /** 日割りの月か */
  prorated: boolean;
  /** この月が、雇用契約の変更の起算月か（向き。なければ null） */
  contractChange: Direction | null;
  /** 支払基礎日数（未入力は null） */
  days: number | null;
  /** 支払基礎日数の基準（17日・短時間労働者は11日） */
  minDays: number;
}

export type EntryCheckKind =
  | 'empty' // まだ入力がない
  | 'contract' // 雇用契約の変更の起算月
  | 'prorated' // 日割りの月（次の月から数える）
  | 'up' // 固定的賃金が上がった
  | 'down' // 固定的賃金が下がった
  | 'inKind' // 現物給与の額が変わった
  | 'retro' // 遡及支払額がある
  | 'byContract' // 時給・日給の人（内訳なし）：額では比べない
  | 'noPrev' // 前の月の入力がない
  | 'same'; // 前の月と同じ

export interface EntryCheck {
  kind: EntryCheckKind;
  /** 支払基礎日数が基準に届かない（平均に入らない） */
  shortDays: boolean;
}

export function entryCheck(x: EntryCheckInput): EntryCheck {
  const shortDays = x.days !== null && x.days < x.minDays;
  if (x.fixedNow === null) return { kind: 'empty', shortDays: false };
  return { kind: kindOf(x), shortDays };
}

function kindOf(x: EntryCheckInput): EntryCheckKind {
  if (x.contractChange) return 'contract';
  const comparable = !x.byUnit || x.hasLines;
  const prevOk = x.fixedPrev !== null && x.fixedPrev > 0;
  const fixedChanged = comparable && prevOk && x.fixedNow !== null && x.fixedNow > 0 && x.fixedNow !== x.fixedPrev;
  const inKindChanged = x.inKindNow !== null && x.inKindPrev !== null && x.inKindNow !== x.inKindPrev;
  if ((fixedChanged || inKindChanged) && x.prorated) return 'prorated';
  if (fixedChanged) return x.fixedNow! > x.fixedPrev! ? 'up' : 'down';
  if (inKindChanged) return 'inKind';
  if (x.retro > 0) return 'retro';
  if (!comparable) return 'byContract';
  if (!prevOk) return 'noPrev';
  return 'same';
}

/** 起算月になる種類か（この月から3か月の平均で確かめる） */
export function startsHere(kind: EntryCheckKind): boolean {
  return kind === 'contract' || kind === 'up' || kind === 'down' || kind === 'inKind' || kind === 'retro';
}
