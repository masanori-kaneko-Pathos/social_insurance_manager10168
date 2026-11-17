// 保険料額表（等級ごとの保険料の表）から料率を読む（11/17）
// 協会けんぽの「保険料額表」や、組合が出す同じ形の表（CSV・Excel）を、料率の CSV と同じ1行1か月の形に直す
// - 料率は、表の%の欄ではなく金額から逆算する（保険料 ÷ 標準報酬）。%の書き方は表ごとにばらばらなため
//   いちばん大きい標準報酬の行で率を出し、ほかの行でも同じ率になるか確かめる（0.5円まで）
// - 見出しは結合セルが多いので、空の欄に左の文字を写してから読む
// - 何月分からは「健康保険料率：令和8年3月分～適用」のような文から読む
// Angular・Firebase に依存しない純粋な関数

import type { RateMicro } from '../../../core/models/rates';
import { toHalfWidth } from '../../../shared/utils/text';
import { formatRateInput } from './rate-format';
import { RATE_CSV_COLUMNS, RATE_CSV_HEADERS, RateCsvColumn } from './rate-csv-columns';

type Kind = 'health' | 'healthCare' | 'care' | 'childSupport';
type Part = 'total' | 'half' | 'employee' | 'employer';

interface AmountColumn {
  index: number;
  kind: Kind;
  part: Part;
  rate: RateMicro;
}

export interface RateTableRead {
  /** 料率の CSV と同じ見出しの表（見出し ＋ 1〜2行）。読めなければ null */
  table: string[][] | null;
  /** 読み取った何月分から（見つからなければ空） */
  from: { health: string; care: string; childSupport: string };
  /** 表として読めなかった理由（見出しが見つからないなど） */
  problem: 'noGrade' | 'noHealth' | null;
}

const GRADE = /^\d{1,2}(?:\s*[(（]\s*\d{1,2}\s*[)）])?$/;

/** '1,390,000' ' 58,000 ' '5,962.4' → 数（読めなければ null） */
export function amountOf(s: string): number | null {
  const t = toHalfWidth(s).replace(/[,\s円]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** 「令和8年3月分」「平成29年9月分」「2026年3月分」→ '2026-03' */
export function eraMonth(text: string): string | null {
  const t = toHalfWidth(text);
  const m = /(令和|平成)?\s*(\d{1,4}|元)\s*年\s*(\d{1,2})\s*月/.exec(t);
  if (!m) return null;
  const n = m[2] === '元' ? 1 : Number(m[2]);
  const year = m[1] === '令和' ? 2018 + n : m[1] === '平成' ? 1988 + n : n;
  const month = Number(m[3]);
  if (year < 1900 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** 文の中から、その料率の「何月分から」を探す（例：「介護保険料率：令和8年3月分～適用」） */
function fromOf(texts: readonly string[], words: readonly string[]): string {
  for (const t of texts) {
    const h = toHalfWidth(t).replace(/\s/g, '');
    for (const w of words) {
      const i = h.indexOf(w);
      if (i < 0) continue;
      const m = eraMonth(h.slice(i + w.length, i + w.length + 30));
      if (m) return m;
    }
  }
  return '';
}

/** 見出しの欄の文字から、どの保険料のどの分かを決める */
function classify(label: string): { kind: Kind | null; part: Part | null } {
  const l = toHalfWidth(label).replace(/\s/g, '');
  let kind: Kind | null = null;
  if (/厚生年金|拠出金/.test(l)) kind = null;
  else if (/支援金/.test(l)) kind = 'childSupport';
  else if (/該当しない|介護なし|40歳未満|65歳以上/.test(l)) kind = 'health';
  else if (/該当する|介護あり|40歳以上/.test(l)) kind = 'healthCare';
  else if (/介護/.test(l) && !/健康保険/.test(l)) kind = 'care';
  else if (/健康保険|健保/.test(l)) kind = 'health';
  let part: Part | null = null;
  if (/折半/.test(l)) part = 'half';
  else if (/被保険者負担|被保険者分|本人|個人|従業員/.test(l)) part = 'employee';
  else if (/事業主|会社/.test(l)) part = 'employer';
  else if (/全額|合計|保険料額|計/.test(l)) part = 'total';
  return { kind, part };
}

/** 表の上の案内（「健康保険料率：令和8年3月分～適用」「（北海道支部）」「（単位：円）」など）。見出しには使わない */
const NOTICE = /(料率|拠出金率|支援金率)\s*[：:]|～\s*適用|保険料額表|単位\s*[：:]|支部[）)]?$/;

/** 列ごとの見出し（上の行から順につなげる。結合セルの空欄は左の文字を写す） */
function labelsOf(head: readonly (readonly string[])[], width: number): string[] {
  const labels = Array.from({ length: width }, () => '');
  for (const row of head) {
    let carry = '';
    for (let c = 0; c < width; c++) {
      const raw = (row[c] ?? '').trim();
      const v = NOTICE.test(toHalfWidth(raw)) ? '' : raw;
      if (v) carry = v;
      else if (c === 0) carry = '';
      labels[c] += ' ' + (v || carry);
    }
  }
  return labels;
}

/**
 * 保険料額表から料率を読む
 * 等級の列（'1'・'4(1)' など）が左端にある行をデータの行とみなし、その右の最初の数を標準報酬にする
 */
export function readRateTable(rows: readonly (readonly string[])[]): RateTableRead {
  const texts = rows.flat().filter((s) => /[年月]/.test(s));
  const from = {
    health: fromOf(texts, ['健康保険料率', '健康保険の保険料率', '一般保険料率']),
    care: fromOf(texts, ['介護保険料率']),
    childSupport: fromOf(texts, ['支援金率', '子ども・子育て支援金']),
  };
  // 題の「令和8年3月分（4月納付分）からの」も使う
  const titleFrom = rows.slice(0, 3).flat().map(eraMonth).find((m): m is string => !!m) ?? '';
  if (!from.health) from.health = titleFrom;
  if (!from.care) from.care = from.health;

  // データの行：左端が等級、その右に標準報酬
  const data: { std: number; cells: readonly string[] }[] = [];
  let firstData = -1;
  rows.forEach((r, i) => {
    const g = (r[0] ?? '').trim();
    if (!GRADE.test(toHalfWidth(g))) return;
    const std = amountOf(r[1] ?? '');
    if (std === null || std < 10_000) return;
    if (firstData < 0) firstData = i;
    data.push({ std, cells: r });
  });
  if (data.length < 5) return { table: null, from, problem: 'noGrade' };

  const width = Math.max(...rows.map((r) => r.length));
  const labels = labelsOf(rows.slice(0, firstData), width);

  // 金額の列：どの行でも「標準報酬 × 率」になる列だけ
  const columns: AmountColumn[] = [];
  for (let c = 2; c < width; c++) {
    const pairs = data
      .map((d) => ({ std: d.std, amount: amountOf(d.cells[c] ?? '') }))
      .filter((p): p is { std: number; amount: number } => p.amount !== null && p.amount > 0);
    if (pairs.length < 3) continue;
    const top = pairs.reduce((a, b) => (b.std > a.std ? b : a));
    const rate = Math.round((top.amount / top.std) * 1_000_000);
    if (rate <= 0 || rate > 300_000) continue;
    const ok = pairs.filter((p) => Math.abs((p.std * rate) / 1_000_000 - p.amount) <= 0.5).length;
    if (ok < pairs.length * 0.9) continue; // 報酬月額の「以上・未満」などは、率が合わない
    const { kind, part } = classify(labels[c]);
    if (kind && part) columns.push({ index: c, kind, part, rate });
  }

  const pick = (kind: Kind) => {
    const of = (part: Part) => columns.find((x) => x.kind === kind && x.part === part)?.rate;
    const total = of('total');
    const half = of('half');
    let employee = of('employee');
    let employer = of('employer');
    if (employee === undefined && half !== undefined) employee = half;
    if (employer === undefined && half !== undefined) employer = total !== undefined ? total - half : half;
    if (employee !== undefined && employer === undefined && total !== undefined) employer = total - employee;
    if (employer !== undefined && employee === undefined && total !== undefined) employee = total - employer;
    if (employee === undefined || employer === undefined) return null;
    return { employee, employer };
  };

  const health = pick('health');
  if (!health) return { table: null, from, problem: 'noHealth' };
  const withCare = pick('healthCare');
  const careOnly = pick('care');
  const care = careOnly ?? (withCare ? { employee: withCare.employee - health.employee, employer: withCare.employer - health.employer } : null);
  const childSupport = pick('childSupport');

  const fmt = (n: number | undefined) => (n === undefined ? '' : formatRateInput(n, 'percent'));
  const line = (month: string, cs: { employee: number; employer: number } | null): string[] => {
    const v: Record<RateCsvColumn, string> = Object.fromEntries(RATE_CSV_COLUMNS.map((c) => [c, ''])) as Record<RateCsvColumn, string>;
    v.from = month;
    v.unit = '%';
    v.health_total = fmt(health.employee + health.employer);
    v.health_employee = fmt(health.employee);
    v.health_employer = fmt(health.employer);
    if (care) {
      v.care_total = fmt(care.employee + care.employer);
      v.care_employee = fmt(care.employee);
      v.care_employer = fmt(care.employer);
    }
    if (cs) {
      v.childSupport_total = fmt(cs.employee + cs.employer);
      v.childSupport_employee = fmt(cs.employee);
      v.childSupport_employer = fmt(cs.employer);
    }
    return RATE_CSV_COLUMNS.map((c) => v[c]);
  };

  const header = RATE_CSV_COLUMNS.map((c) => RATE_CSV_HEADERS[c]);
  const start = [from.health, from.care].filter(Boolean).sort()[0] ?? '';
  // 支援金が健保より後の月から始まる表（令和8年3月分の表で、支援金は4月分から）は2行にする
  if (childSupport && from.childSupport && start && from.childSupport > start) {
    return { table: [header, line(start, null), line(from.childSupport, childSupport)], from, problem: null };
  }
  return { table: [header, line(start, childSupport)], from, problem: null };
}
