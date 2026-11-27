// 給与の取り込みの確認の表を、1人1行にまとめる（11/28。200人×12か月 ＝ 2,400行を、200行にする）
// - 人の行には、月の数・最初と最後の支払月・総支給額の合計・エラーの行の数・上書きの月の数
// - エラーの行がある人を上に、そのあとは社員番号の順
// - エラーの行が1つでもある人は、その人の行を全部取り込まない（月が欠けると、定時決定・随時改定の平均が崩れるため）
// Angular・Firebase に依存しない純粋な関数

/** 表の1行（読めた行か、問題の行か、その両方）。ImportIssues の withIssues の形 */
export interface GroupSourceRow<T, I = unknown> {
  line: number;
  item: T | null;
  issue: I | null;
}

export interface GroupItem {
  line: number;
  employeeId: string;
  paidMonth: string;
  input: { cash: number };
}

/** 問題の行（読めた行がない行）の人：決まっていれば employeeId、決まらなければファイルの値で区別する */
export interface IssuePerson {
  employeeId: string | null;
  /** 人が決まらないときの見分け（ファイルの社員番号か氏名）。同じ値の行は1人にまとめる */
  fileKey: string;
  paidMonth: string | null;
}

export interface PersonGroup<T, I = unknown> {
  /** 'e:従業員ID' か 'f:ファイルの値' */
  key: string;
  employeeId: string | null;
  /** 人が決まらないときの、ファイルの値 */
  fileKey: string;
  /** 月の順（月が読めない行は最後に、行の番号の順） */
  rows: GroupSourceRow<T, I>[];
  lines: number[];
  firstMonth: string | null;
  lastMonth: string | null;
  /** 支払月の数（同じ月が2行あっても1） */
  monthCount: number;
  /** 読めた行の総支給額の合計（円） */
  cash: number;
  /** エラーの行の数 */
  errors: number;
  /** 保存済みを上書きする月の数 */
  updated: number;
}

export function groupByPerson<T extends GroupItem, I>(
  rows: readonly GroupSourceRow<T, I>[],
  personOf: (line: number) => IssuePerson,
  isUpdated: (item: T) => boolean,
  /** 並べるときの社員番号（人が決まらないときは fileKey を使う） */
  numberOf: (employeeId: string) => string,
): PersonGroup<T, I>[] {
  const groups = new Map<string, PersonGroup<T, I> & { months: Set<string>; monthOf: Map<number, string | null> }>();
  for (const r of rows) {
    let employeeId: string | null;
    let fileKey = '';
    let month: string | null;
    if (r.item) {
      employeeId = r.item.employeeId;
      month = r.item.paidMonth;
    } else {
      const p = personOf(r.line);
      employeeId = p.employeeId;
      fileKey = p.fileKey;
      month = p.paidMonth;
    }
    const key = employeeId ? `e:${employeeId}` : `f:${fileKey}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key, employeeId, fileKey, rows: [], lines: [], firstMonth: null, lastMonth: null, monthCount: 0,
        cash: 0, errors: 0, updated: 0, months: new Set(), monthOf: new Map(),
      };
      groups.set(key, g);
    }
    g.rows.push(r);
    g.lines.push(r.line);
    g.monthOf.set(r.line, month);
    if (month) {
      g.months.add(month);
      if (!g.firstMonth || month < g.firstMonth) g.firstMonth = month;
      if (!g.lastMonth || month > g.lastMonth) g.lastMonth = month;
    }
    if (r.issue) g.errors++;
    if (r.item) {
      g.cash += r.item.input.cash;
      if (isUpdated(r.item)) g.updated++;
    }
  }
  const out = [...groups.values()].map(({ months, monthOf, ...g }) => {
    g.monthCount = months.size;
    g.rows.sort((a, b) => {
      const ma = monthOf.get(a.line) ?? '￿';
      const mb = monthOf.get(b.line) ?? '￿';
      return ma === mb ? a.line - b.line : ma < mb ? -1 : 1;
    });
    g.lines = g.rows.map((r) => r.line);
    return g as PersonGroup<T, I>;
  });
  const sortNo = (g: PersonGroup<T, I>) => (g.employeeId ? numberOf(g.employeeId) : g.fileKey);
  return out.sort((a, b) => {
    if ((a.errors > 0) !== (b.errors > 0)) return a.errors > 0 ? -1 : 1;
    const c = sortNo(a).localeCompare(sortNo(b), 'ja', { numeric: true });
    return c !== 0 ? c : a.lines[0] - b.lines[0];
  });
}

/**
 * エラーの行がある人の、エラーでない行（取り込まない行として、チェックを外したのと同じに扱う）
 * 表の絞り込み（エラーの行だけ表示）に関係なく、読んだ全部の行から出す
 */
export function blockedLines(
  items: readonly Pick<GroupItem, 'line' | 'employeeId'>[],
  errorPeople: readonly (string | null | undefined)[],
): Set<number> {
  const bad = new Set(errorPeople.filter((x): x is string => !!x));
  return new Set(items.filter((it) => bad.has(it.employeeId)).map((it) => it.line));
}
