// 契約書（労働条件通知書）の PDF の文字から、雇用契約の項目の「候補」を拾う
// Angular・Firebase に依存しない純粋な関数。PDF を行の文字にするのは shared/import/pdf.ts の readPdfLines
//
// 決めたこと（11/12 の赤ペン）
// - 入力欄には勝手に入れない。項目ごとに、候補と元の行を並べ、人が「反映」を押した項目だけ入れる
// - スキャンした（写真の）PDF は読まない（文字を読む仕組みは外のサービスで、有料のものが多い）
// - PDF はどこにも保存しない（ブラウザの中で読んで捨てる）
//
// 読み方は、厚生労働省のモデル労働条件通知書（一般労働者用・短時間労働者用）の言い方を基本にする
//   契約期間：「期間の定めなし」「期間の定めあり（ 年 月 日～ 年 月 日）」
//   更新：「自動的に更新する」「更新する場合があり得る」「契約の更新はしない」
//   時間：「始業（ 時 分）」「終業（ 時 分）」「休憩時間（ ）分」、休日：「週・月当たり 日」
//   賃金：「イ 月給（ 円）」「ロ 日給（ 円）」「ハ 時間給（ 円）」、諸手当「イ（ 手当 円）」
// ひな形は選択肢がすべて印字されている（○で囲む）。PDF の文字では○が分からないので、
// ■・☑ などの印がついた選択肢か、金額・日付が書き込まれた選択肢だけを候補にする。どれか決められなければ「決められない」

import type { EmploymentType, PayType, RenewalType } from '../../../core/models/contract';
import { formatHours } from '../../../shared/utils/number';

export type ContractPdfField =
  | 'from'
  | 'periodEnd'
  | 'renewal'
  | 'employmentType'
  | 'payType'
  | 'hourlyWage'
  | 'dailyWage'
  | 'scheduledWage'
  | 'hours'
  | 'monthlyDays';

export const CONTRACT_PDF_FIELDS: readonly ContractPdfField[] = [
  'from',
  'periodEnd',
  'renewal',
  'employmentType',
  'payType',
  'hourlyWage',
  'dailyWage',
  'scheduledWage',
  'hours',
  'monthlyDays',
];

/** 候補にそえる説明 */
export type CandidateNote =
  | 'noPeriod' // 期間の定めなし（終わりの日は空）
  | 'fromDailyTimes' // 始業・終業・休憩 × 週の日数から出した
  | 'fromWeekDays' // 週の日数 × 52 ÷ 12（切り捨て）から出した
  | 'allowances' // 基本給＋諸手当（入れない手当は除いた）
  | null;

export interface ContractCandidate {
  field: ContractPdfField;
  /** 入力欄に入れる値（フォームの形の文字） */
  value: string;
  /** 元の行（人が見比べるため） */
  source: string;
  note: CandidateNote;
  /** 文の差し込み（除いた手当など） */
  params?: Record<string, string>;
}

export interface ContractPdfRead {
  candidates: ContractCandidate[];
  /** 選択肢が全部書いてあって、どれか決められなかった */
  ambiguous: ContractPdfField[];
  /** 見つからなかった */
  missing: ContractPdfField[];
}

// ===== 文字をそろえる =====

/** 全角の数字・記号を半角に、空白を1つに（「（　２５０，０００円）」→「(250,000円)」） */
export function normalizeLine(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[〜~～]/g, '～')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 印のついた選択肢か（■ ☑ ✓ ● ◉ ◎ のあと。○ は空の選択肢にも使われるので数えない） */
const MARK = '[■☑✓✔●◉◎]';

// ===== 日付 =====

const ERA: Record<string, number> = { 令和: 2018, R: 2018, 平成: 1988, H: 1988 };
const DATE_SRC =
  '(?:(令和|平成|R|H)\\s*(\\d{1,2}|元)|(\\d{4}))\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日|(\\d{4})[/.\\-](\\d{1,2})[/.\\-](\\d{1,2})';

function dateOf(m: RegExpExecArray | RegExpMatchArray): string | null {
  let y: number;
  let mo: number;
  let d: number;
  if (m[6]) {
    y = Number(m[6]);
    mo = Number(m[7]);
    d = Number(m[8]);
  } else {
    y = m[3] ? Number(m[3]) : ERA[m[1]] + (m[2] === '元' ? 1 : Number(m[2]));
    mo = Number(m[4]);
    d = Number(m[5]);
  }
  const s = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === s ? s : null;
}

function datesIn(line: string): string[] {
  const re = new RegExp(DATE_SRC, 'g');
  const out: string[] = [];
  for (const m of line.matchAll(re)) {
    const d = dateOf(m);
    if (d) out.push(d);
  }
  return out;
}

const yen = (s: string) => Number(s.replace(/,/g, ''));

// ===== 項目ごと =====

/** 契約期間：「期間の定めあり（日付～日付）」か「期間の定めなし」 */
function readPeriod(lines: string[], out: ContractCandidate[], amb: Set<ContractPdfField>): void {
  const i = lines.findIndex((l) => /契約期間|雇用期間|期間の定め/.test(l));
  if (i < 0) return;
  // 日付は同じ行か次の行に書かれていることが多い
  const near = [lines[i], lines[i + 1] ?? ''].join(' ');
  const dates = datesIn(near);
  const hasRange = dates.length >= 2 && /～|から|より|-|－/.test(near);
  if (hasRange) {
    const [from, to] = dates;
    out.push({ field: 'from', value: from, source: near.trim(), note: null });
    out.push({ field: 'periodEnd', value: to, source: near.trim(), note: null });
    return;
  }
  const none = new RegExp(`${MARK}\\s*期間の定めなし`).test(near) || (/期間の定めなし/.test(near) && !/期間の定めあり/.test(near));
  if (none) out.push({ field: 'periodEnd', value: '', source: near.trim(), note: 'noPeriod' });
  else if (/期間の定めなし/.test(near) && /期間の定めあり/.test(near)) amb.add('periodEnd');
}

/** 選択肢から1つ選ぶ：印のついたもの → 1つだけ書かれているもの → 決められない */
function pickOption<T extends string>(
  text: string,
  options: readonly { value: T; re: RegExp }[],
): { value: T; match: string } | 'ambiguous' | null {
  const marked = options.filter((o) => new RegExp(`${MARK}\\s*(?:${o.re.source})`).test(text));
  if (marked.length === 1) return { value: marked[0].value, match: text.match(marked[0].re)![0] };
  const found = options.filter((o) => o.re.test(text));
  if (found.length === 1) return { value: found[0].value, match: text.match(found[0].re)![0] };
  return found.length > 1 ? 'ambiguous' : null;
}

const lineOf = (lines: string[], piece: string) => lines.find((l) => l.includes(piece)) ?? piece;

const RENEWAL_OPTIONS: readonly { value: RenewalType; re: RegExp }[] = [
  { value: 'expected', re: /自動的に更新する|更新する(?![場の])/ },
  { value: 'possible', re: /更新する場合があり得る|更新する場合がある|更新の可能性あり/ },
  { value: 'none', re: /契約の更新はしない|更新しない|更新なし/ },
];

/** 更新の有無（期間の定めがない契約には出さない） */
function readRenewal(lines: string[], out: ContractCandidate[], amb: Set<ContractPdfField>): void {
  const idx = lines.findIndex((l) => /更新/.test(l));
  if (idx < 0) return;
  // 見出しの行から数行に選択肢が並ぶ
  const block = lines.slice(idx, idx + 4).join(' ');
  const r = pickOption(block, RENEWAL_OPTIONS);
  if (r === 'ambiguous') amb.add('renewal');
  else if (r) out.push({ field: 'renewal', value: r.value, source: lineOf(lines, r.match), note: null });
}

const EMPLOYMENT_OPTIONS: readonly { value: EmploymentType; re: RegExp }[] = [
  { value: 'regular', re: /正社員|正規社員|正規雇用/ },
  { value: 'contract', re: /契約社員/ },
  { value: 'part', re: /パートタイマー|パートタイム|パート(?!ナー)/ },
  { value: 'arbeit', re: /アルバイト/ },
  { value: 'shokutaku', re: /嘱託/ },
];

/** 雇用形態：「雇用形態」「雇用区分」「社員区分」の行で、1つに決まるときだけ */
function readEmployment(lines: string[], out: ContractCandidate[], amb: Set<ContractPdfField>): void {
  const line = lines.find((l) => /雇用形態|雇用区分|社員区分|従業員区分/.test(l));
  if (!line) return;
  const r = pickOption(line, EMPLOYMENT_OPTIONS);
  if (r === 'ambiguous') amb.add('employmentType');
  else if (r) out.push({ field: 'employmentType', value: r.value, source: line, note: null });
}

/** 入れない手当（所定内賃金に入れないもの。画面のヒントと同じ） */
const EXCLUDED_ALLOWANCE = /通勤|交通|家族|扶養|精勤|皆勤|時間外|残業|深夜|休日|賞与|結婚|臨時/;

/** 賃金：金額が書き込まれた形（月給・日給月給・日給・時間給）が1つに決まるとき。月給は基本給＋諸手当 */
function readWage(lines: string[], out: ContractCandidate[], amb: Set<ContractPdfField>): void {
  const forms: { pay: PayType; re: RegExp }[] = [
    { pay: 'dailyMonthly', re: /日給月給\s*[（(]?\s*([\d,]+)\s*円/ },
    { pay: 'monthly', re: /(?<!日給)月給\s*[（(]?\s*([\d,]+)\s*円|基本給\s*[（(]?\s*(?:月額)?\s*([\d,]+)\s*円/ },
    { pay: 'daily', re: /日給(?!月給)\s*[（(]?\s*([\d,]+)\s*円/ },
    { pay: 'hourly', re: /時間給\s*[（(]?\s*([\d,]+)\s*円|時給\s*[（(]?\s*([\d,]+)\s*円/ },
  ];
  const hits: { pay: PayType; amount: number; line: string }[] = [];
  for (const f of forms) {
    for (const l of lines) {
      const m = l.match(f.re);
      if (m) {
        const amount = yen(m[1] ?? m[2]);
        if (amount > 0 && !hits.some((h) => h.pay === f.pay)) hits.push({ pay: f.pay, amount, line: l });
      }
    }
  }
  if (hits.length === 0) return;
  if (hits.length > 1) {
    amb.add('payType');
    return;
  }
  const [h] = hits;
  out.push({ field: 'payType', value: h.pay, source: h.line, note: null });
  if (h.pay === 'hourly') out.push({ field: 'hourlyWage', value: String(h.amount), source: h.line, note: null });
  if (h.pay === 'daily') out.push({ field: 'dailyWage', value: String(h.amount), source: h.line, note: null });
  if (h.pay === 'monthly' || h.pay === 'dailyMonthly') {
    // 諸手当：「〇〇手当 10,000円」。入れない手当は除いて、除いたものを知らせる
    let total = h.amount;
    const excluded: string[] = [];
    for (const l of lines) {
      for (const m of l.matchAll(/([^\s（(、,，:：]{1,12}手当)\s*[（(:：]?\s*([\d,]+)\s*円/g)) {
        if (EXCLUDED_ALLOWANCE.test(m[1])) excluded.push(m[1]);
        else total += yen(m[2]);
      }
    }
    out.push({
      field: 'scheduledWage',
      value: String(total),
      source: h.line,
      note: 'allowances',
      params: { excluded: excluded.join('・') || '—' },
    });
  }
}

/** 時間：「週の所定労働時間 30時間」があればそれ。なければ（終業 − 始業 − 休憩）× 週の日数 */
function readHours(lines: string[], out: ContractCandidate[]): number | null {
  const text = lines.join(' ');
  const weekly = text.match(/(?:週|1週間)[^\d]{0,10}?所定労働時間[^\d]{0,6}(\d{1,2})\s*(?:時間|:|：)\s*(?:(\d{1,2})\s*分?)?/);
  const weekDaysMatch = text.match(/週\s*(?:当たり|あたり)?\s*(\d)\s*日/);
  const weekDays = weekDaysMatch && !/週・月当たり/.test(weekDaysMatch[0]) ? Number(weekDaysMatch[1]) : null;
  if (weekly) {
    const m = Number(weekly[1]) * 60 + Number(weekly[2] ?? 0);
    out.push({ field: 'hours', value: formatHours(m), source: lineOf(lines, weekly[0].slice(0, 8)), note: null });
    return weekDays;
  }
  const start = text.match(/始業\s*[（(]?\s*(\d{1,2})\s*(?:時|:|：)\s*(\d{1,2})?\s*分?/);
  const end = text.match(/終業\s*[（(]?\s*(\d{1,2})\s*(?:時|:|：)\s*(\d{1,2})?\s*分?/);
  const rest = text.match(/休憩(?:時間)?\s*[（(]?\s*(\d{1,3})\s*[）)]?\s*分/);
  if (start && end && weekDays) {
    const daily =
      Number(end[1]) * 60 + Number(end[2] ?? 0) - (Number(start[1]) * 60 + Number(start[2] ?? 0)) - Number(rest?.[1] ?? 0);
    if (daily > 0 && daily <= 24 * 60) {
      out.push({
        field: 'hours',
        value: formatHours(daily * weekDays),
        source: lineOf(lines, start[0].slice(0, 4)),
        note: 'fromDailyTimes',
        params: { daily: formatHours(daily), days: String(weekDays) },
      });
    }
  }
  return weekDays;
}

/** 月の所定労働日数：「所定労働日数 21日」。なければ週の日数 × 52 ÷ 12（切り捨て） */
function readMonthlyDays(lines: string[], out: ContractCandidate[], weekDays: number | null): void {
  const line = lines.find((l) => /(?:月の|1か月の|1ヶ月の|月平均|月間)\s*(?:平均)?\s*所定労働日数/.test(l));
  const m = line?.match(/所定労働日数[^\d]{0,6}(\d{1,2}(?:\.\d+)?)\s*日/);
  if (line && m) {
    out.push({ field: 'monthlyDays', value: String(Math.floor(Number(m[1]))), source: line, note: null });
    return;
  }
  if (weekDays) {
    out.push({
      field: 'monthlyDays',
      value: String(Math.floor((weekDays * 52) / 12)),
      source: lines.find((l) => /週\s*(?:当たり|あたり)?\s*\d\s*日/.test(l)) ?? '',
      note: 'fromWeekDays',
      params: { days: String(weekDays) },
    });
  }
}

/** PDF の行 → 契約の項目の候補 */
export function readContractText(rawLines: readonly string[]): ContractPdfRead {
  const lines = rawLines.map(normalizeLine).filter(Boolean);
  const candidates: ContractCandidate[] = [];
  const ambiguous = new Set<ContractPdfField>();
  readPeriod(lines, candidates, ambiguous);
  readRenewal(lines, candidates, ambiguous);
  readEmployment(lines, candidates, ambiguous);
  readWage(lines, candidates, ambiguous);
  const weekDays = readHours(lines, candidates);
  readMonthlyDays(lines, candidates, weekDays);
  const got = new Set(candidates.map((c) => c.field));
  // 時給・日給・所定内賃金は給与の形しだいで要らない。始まる日は入力欄にもう入っている → 「見つからない」に入れない
  const optional = new Set<ContractPdfField>(['from', 'hourlyWage', 'dailyWage', 'scheduledWage']);
  const missing = CONTRACT_PDF_FIELDS.filter((f) => !got.has(f) && !ambiguous.has(f) && !optional.has(f));
  return { candidates, ambiguous: [...ambiguous], missing };
}
