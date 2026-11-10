// 変更履歴（カタログ【3】「変更前後の値と変更日を保持」）
// Angular・Firebase に依存しない純粋な関数
// - 変更前と変更後の文書を比べて、変わった項目ごとに1件の記録にする
// - まとまり（contact など）は中まで比べる。配列（休業など）は丸ごと1つの値として比べる
// - 作成は field '*' で変更後だけ、削除は field '*' で変更前だけ
// - 値は JSON の文字で持つ（ルールの上限 5000 文字に収める）

export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

/** 比べない項目（いつ書いたかは記録そのものの changedAt で分かる） */
const IGNORED = new Set(['createdAt', 'updatedAt']);
export const MAX_VALUE_LENGTH = 5000;

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** JSON の文字に（長すぎれば切って … を付ける。undefined は null） */
export function toValue(v: unknown): string | null {
  if (v === undefined) return null;
  const s = JSON.stringify(v);
  return s.length > MAX_VALUE_LENGTH ? `${s.slice(0, MAX_VALUE_LENGTH - 1)}…` : s;
}

/** まとまりを平らにする：{ contact: { address: 'x' } } → { 'contact.address': 'x' } */
export function flatten(obj: Plain, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    if (!prefix && IGNORED.has(k)) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && Object.keys(v).length > 0) {
      for (const [p, x] of flatten(v, path)) out.set(p, x);
    } else {
      out.set(path, v);
    }
  }
  return out;
}

function withoutIgnored(obj: Plain): Plain {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !IGNORED.has(k)));
}

/** 変更前・変更後（null ＝ なし）→ 変わった項目の一覧（項目の名前の順） */
export function changesOf(before: Plain | null, after: Plain | null): FieldChange[] {
  if (!before && !after) return [];
  if (!before) return [{ field: '*', before: null, after: toValue(withoutIgnored(after!)) }];
  if (!after) return [{ field: '*', before: toValue(withoutIgnored(before)), after: null }];

  const a = flatten(before);
  const b = flatten(after);
  const fields = [...new Set([...a.keys(), ...b.keys()])].sort();
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const x = toValue(a.get(field) ?? null);
    const y = toValue(b.get(field) ?? null);
    if (x !== y) changes.push({ field, before: x, after: y });
  }
  return changes;
}

/** 画面に出す値（JSON の文字 → 読める文字） */
export function displayValue(v: string | null, yes = 'はい', no = 'いいえ'): string {
  if (v === null) return '—';
  let x: unknown;
  try {
    x = JSON.parse(v);
  } catch {
    return v;
  }
  if (x === null || x === '') return '—';
  if (typeof x === 'boolean') return x ? yes : no;
  if (typeof x === 'number') return x.toLocaleString('ja-JP');
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return `${x.length}件`;
  return v;
}

/**
 * まとめて1件の記録にする（給与の実績・賞与のように、たくさんの人をまとめて書くもの）
 * - 変わった項目が1つなら、その項目の記録
 * - 2つ以上なら、field は「cash,days」のように並べ、変更前・変更後はその項目だけの組
 * - 何も変わっていなければ null
 */
export function summarize(before: Plain | null, after: Plain | null): FieldChange | null {
  const cs = changesOf(before, after);
  if (cs.length === 0) return null;
  if (cs.length === 1) return cs[0];
  const side = (k: 'before' | 'after') =>
    Object.fromEntries(cs.map((c) => [c.field, c[k] === null ? null : (JSON.parse(c[k]!) as unknown)]));
  const field = cs.map((c) => c.field).join(',');
  return {
    field: field.length > 100 ? `${field.slice(0, 99)}…` : field,
    before: toValue(side('before')),
    after: toValue(side('after')),
  };
}

/** 賞与の1回の支給で、1人の額（通貨・現物）がどう変わったか（変わった人だけ） */
export function bonusChanges(
  before: { amounts?: Record<string, number>; inKindAmounts?: Record<string, number> } | null,
  after: { amounts?: Record<string, number>; inKindAmounts?: Record<string, number> } | null,
): Map<string, FieldChange> {
  const ids = new Set([
    ...Object.keys(before?.amounts ?? {}),
    ...Object.keys(before?.inKindAmounts ?? {}),
    ...Object.keys(after?.amounts ?? {}),
    ...Object.keys(after?.inKindAmounts ?? {}),
  ]);
  const out = new Map<string, FieldChange>();
  const one = (x: typeof before, id: string) =>
    x && (x.amounts?.[id] !== undefined || x.inKindAmounts?.[id] !== undefined)
      ? { amount: x.amounts?.[id] ?? 0, inKind: x.inKindAmounts?.[id] ?? 0 }
      : null;
  for (const id of [...ids].sort()) {
    const c = summarize(one(before, id), one(after, id));
    if (c) out.set(id, c);
  }
  return out;
}

/**
 * 登録・削除の行に出す短い要約（中身の JSON をそのまま出さない）
 * 種類ごとに、人が見て「どれのことか」わかる項目だけを拾う。選択肢の値は label で言葉に直す
 * 拾えないとき（知らない種類・形が違う）は null → 画面は「—」
 */
export function recordSummary(
  kind: string,
  json: string | null,
  label: (key: string) => string,
): string | null {
  if (json === null) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
  const n = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('ja-JP') : '');
  const grade = (v: unknown) =>
    v && typeof v === 'object' && 'grade' in v ? String((v as { grade: unknown }).grade) : '';
  switch (kind) {
    case 'employee':
      return `${s('lastName')} ${s('firstName')}`.trim() || null;
    case 'details':
      return label('history.summary.private');
    case 'contracts':
      return [s('from') && `${s('from')}〜`, s('employmentType') && label(`contract.employmentType.${s('employmentType')}`)]
        .filter((x) => !!x)
        .join(' ') || null;
    case 'remunerations':
      return label('history.summary.remuneration')
        .replace('{health}', grade(o['health']))
        .replace('{pension}', grade(o['pension']))
        .replace('{amount}', n(o['monthlyAmount']));
    case 'dependents': {
      const name = `${s('lastName')} ${s('firstName')}`.trim();
      const rel = s('relationship') && label(`dependent.relationship.${s('relationship')}`);
      return [name, rel && `（${rel}）`].join('') || null;
    }
    case 'payrolls':
      return o['cash'] !== undefined ? label('history.summary.payroll').replace('{cash}', n(o['cash'])) : null;
    default:
      return null;
  }
}
