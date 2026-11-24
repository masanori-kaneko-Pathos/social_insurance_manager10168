// 出力の窓口（11/24）：一覧ごとの「出せる項目の目録」から、人が選んだ列で表を作る
// Angular・Firebase に依存しない純粋な関数
//
// - 目録（ExportColumn）は一覧ごとに作る（保険料一覧・従業員一覧など）。値はいつも文字（CSV にそのまま書く）
// - 選んだ列（ExportPick）は、目録の鍵と、書き換えた見出し（なければ目録の名前）
// - テンプレートは、選んだ列に名前を付けて事業所ごとに保存したもの（export-template.service）

export interface ExportColumn<R> {
  key: string;
  /** 目録の名前（翻訳済み） */
  label: string;
  /** まとまりの名前（翻訳済み。窓の左で見出しにする） */
  group: string;
  value: (row: R) => string;
}

export interface ExportPick {
  key: string;
  /** 書き換えた見出し（空・null なら目録の名前） */
  header: string | null;
}

/** 選んだ列で表を作る（1行目は見出し）。目録にない鍵（項目がなくなった古いテンプレートなど）は飛ばす */
export function exportTable<R>(rows: readonly R[], catalog: readonly ExportColumn<R>[], picks: readonly ExportPick[]): string[][] {
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const cols = picks.flatMap((p) => {
    const c = byKey.get(p.key);
    return c ? [{ c, header: p.header?.trim() || c.label }] : [];
  });
  return [cols.map((x) => x.header), ...rows.map((r) => cols.map((x) => x.c.value(r)))];
}

/** 鍵の並びから、見出しを書き換えていない選び方を作る（標準の形） */
export function picksOf(keys: readonly string[]): ExportPick[] {
  return keys.map((key) => ({ key, header: null }));
}

/** i 番目を1つ上（-1）か下（+1）へ。端なら動かさない */
export function movePick(picks: readonly ExportPick[], i: number, dir: -1 | 1): ExportPick[] {
  const j = i + dir;
  if (i < 0 || i >= picks.length || j < 0 || j >= picks.length) return [...picks];
  const out = [...picks];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** 目録にない鍵を落とす（項目が減ったあとの古いテンプレート） */
export function knownPicks(picks: readonly ExportPick[], catalog: readonly { key: string }[]): ExportPick[] {
  const keys = new Set(catalog.map((c) => c.key));
  return picks.filter((p) => keys.has(p.key));
}

/** 窓の左に出す：まとまりごとの項目（目録の順） */
export function groupsOf<R>(catalog: readonly ExportColumn<R>[]): { group: string; columns: ExportColumn<R>[] }[] {
  const out: { group: string; columns: ExportColumn<R>[] }[] = [];
  for (const c of catalog) {
    const g = out.find((x) => x.group === c.group);
    if (g) g.columns.push(c);
    else out.push({ group: c.group, columns: [c] });
  }
  return out;
}
