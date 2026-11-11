// 健康保険組合の料率の PDF から、料率らしい数字を拾って「どの欄か」を推す
// Angular・Firebase に依存しない純粋な関数。組合ごとに書式がばらばらなので、表としては読まず、行の文字から拾う
//
// 拾う数字：「9.5%」「9.5 ％」「95‰」「1000分の95」「千分の95」
// どの保険か：同じ行に「介護」→ 介護保険、「支援金」→ 子ども・子育て支援金、それ以外 → 健康保険
// どの欄か  ：数字のすぐ前に「被保険者・本人・従業員」→ 本人、「事業主・会社」→ 会社、「合計・計」→ 全体
//             言葉がなく、1行に3つあって1つが残り2つの和なら → 和が全体、残りは見出しの行の順（「事業主 被保険者」なら
//             会社が先。見出しがなければ本人が先）。合計は入れ替わっても合うので、本人・会社の取り違えは確かめでは見つからないため
//             それ以外 → 全体
// 推しが外れても、画面で候補を押せば直せる。入れたあとは「全体 ＝ 本人 ＋ 会社」の確かめも効く

import { RateMicro } from '../../../core/models/rates';
import { toHalfWidth } from '../../../shared/utils/text';
import { MAX_RATE, parseRate } from './rate-format';

export type RateKind = 'health' | 'care' | 'childSupport';
export type RateField = 'total' | 'employee' | 'employer';

export interface RateCandidate {
  rate: RateMicro;
  /** PDF に書いてあったとおりの形（「9.5%」「95‰」） */
  shown: string;
  /** その数字があった行（候補に添えて、どこの数字か分かるように） */
  line: string;
  kind: RateKind;
  field: RateField;
}

const NUM = String.raw`(\d{1,3}(?:\.\d{1,4})?)`;
// 1つめ：% ‰ がうしろ、2つめ：「1000分の」「千分の」がまえ
const PATTERN = new RegExp(String.raw`${NUM}\s*([%‰])|(?:1000|千)分の\s*${NUM}`, 'g');

function kindOf(line: string): RateKind {
  if (/介護/.test(line)) return 'care';
  if (/支援金/.test(line)) return 'childSupport';
  return 'health';
}

/** 数字のすぐ前（前の数字のうしろから）にある言葉で欄を決める */
function fieldOf(before: string): RateField | null {
  if (/(被保険者|本人|従業員|労働者)/.test(before)) return 'employee';
  if (/(事業主|会社|使用者)/.test(before)) return 'employer';
  if (/(合計|総計|計|全体)/.test(before)) return 'total';
  return null;
}

/** 見出しの行（被保険者と事業主の両方がある行）から、本人と会社のどちらが先か。見出しでなければ null */
export function headerOrder(raw: string): 'employeeFirst' | 'employerFirst' | null {
  const e = raw.search(/被保険者|本人|従業員/);
  const r = raw.search(/事業主|会社/);
  if (e < 0 || r < 0 || PATTERN.test(raw)) {
    PATTERN.lastIndex = 0;
    return null;
  }
  return e < r ? 'employeeFirst' : 'employerFirst';
}

/** 1行の中の料率の数字（書いてある順）。order は、直前の見出しの行の並び */
export function ratesInLine(raw: string, order: 'employeeFirst' | 'employerFirst' = 'employeeFirst'): RateCandidate[] {
  const line = toHalfWidth(raw).replace(/％/g, '%').trim();
  const kind = kindOf(line);
  const found: { rate: RateMicro; shown: string; field: RateField | null }[] = [];
  let last = 0;
  for (const m of line.matchAll(PATTERN)) {
    const permille = m[2] === '‰' || m[3] !== undefined;
    const text = m[1] ?? m[3];
    const rate = parseRate(text, permille ? 'permille' : 'percent');
    const before = line.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
    if (rate === null || rate > MAX_RATE) continue;
    found.push({ rate, shown: permille ? `${text}‰` : `${text}%`, field: fieldOf(before) });
  }
  // 言葉がない3つの数字で、1つが残り2つの和 → 和が全体、残りは書いてある順に本人・会社
  if (found.length === 3 && found.every((f) => f.field === null)) {
    const t = found.findIndex((f, i) => found.filter((_, j) => j !== i).reduce((s, x) => s + x.rate, 0) === f.rate);
    if (t >= 0) {
      const rest = found.filter((_, i) => i !== t);
      found[t].field = 'total';
      rest[0].field = order === 'employeeFirst' ? 'employee' : 'employer';
      rest[1].field = order === 'employeeFirst' ? 'employer' : 'employee';
    }
  }
  return found.map((f) => ({ rate: f.rate, shown: f.shown, line, kind, field: f.field ?? 'total' }));
}

/** PDF の全部の行から拾う（見出しの行を見つけたら、その並びを次の行から使う） */
export function findRates(lines: readonly string[]): RateCandidate[] {
  let order: 'employeeFirst' | 'employerFirst' = 'employeeFirst';
  return lines.flatMap((line) => {
    const h = headerOrder(toHalfWidth(line));
    if (h) {
      order = h;
      return [];
    }
    return ratesInLine(line, order);
  });
}

/** 推し：保険・欄ごとに最初に見つかった値（入れるのは空の欄だけ。画面の側で決める） */
export function guessFill(cands: readonly RateCandidate[]): Partial<Record<`${RateKind}.${RateField}`, RateMicro>> {
  const out: Partial<Record<`${RateKind}.${RateField}`, RateMicro>> = {};
  for (const c of cands) {
    const k = `${c.kind}.${c.field}` as const;
    if (out[k] === undefined) out[k] = c.rate;
  }
  return out;
}
