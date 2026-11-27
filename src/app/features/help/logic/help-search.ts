/**
 * ヘルプの絞り込み（Angular・Firebase に依存しない純粋な関数）
 * 見出しと本文のどちらかに、打った言葉が全部入っている項目を出す（空白で区切ると「かつ」）
 * ひらがな・カタカナ、全角・半角、大文字・小文字の違いは気にしない
 */

export const HELP_TOPICS = [
  'flow', // 業務の流れ（場面ごとにすること。表で出す。11/24）
  'todo',
  'acquire',
  'loss',
  'payroll',
  'inKind',
  'regular',
  'irregular',
  'leave',
  'childcareSpecial',
  'care',
  'agreement',
  'csv',
  'myPage',
  'roles',
  'annual',
  'filings',
  'premiumList',
  'payrollSoft',
  'myNumber',
  'display',
] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

/**
 * 「業務の内容」の並び（11/27）：まとまりごとに、閉じた項目を並べる。名前は help.group.<key>
 * 業務の流れ（flow）は別の箱でいつも開いているので、ここには入れない
 */
export const HELP_GROUPS: readonly { key: string; topics: readonly HelpTopic[] }[] = [
  { key: 'monthly', topics: ['todo', 'payroll', 'inKind', 'premiumList', 'payrollSoft'] },
  { key: 'joinLeave', topics: ['acquire', 'loss', 'myPage', 'myNumber'] },
  { key: 'standard', topics: ['regular', 'irregular', 'annual'] },
  { key: 'leave', topics: ['leave', 'childcareSpecial', 'care', 'agreement'] },
  { key: 'app', topics: ['filings', 'csv', 'roles', 'display'] },
];

/**
 * 長い項目の小見出し（11/27）：本文を help.topic.<topic>.sections.<key>.title・body に分けて持つ
 * 小見出しのない項目は help.topic.<topic>.body の1段落
 */
export const HELP_SECTIONS: Partial<Record<HelpTopic, readonly string[]>> = {
  payroll: ['intro', 'fixed', 'commute', 'retro', 'prorated', 'days', 'state', 'hours', 'decrease', 'bonus', 'blank'],
};

/** 比べやすい形にそろえる（カタカナ → ひらがな、全角英数 → 半角、小文字） */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function matchesHelp(text: string, query: string): boolean {
  const words = normalizeForSearch(query).split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return true;
  const t = normalizeForSearch(text);
  return words.every((w) => t.includes(w));
}

/**
 * 業務の流れ（11/24）：場面 → すること → 使う画面。画面は事業所の中の道（/o/:officeId/ のあと）
 * 文は翻訳ファイル help.flow.<key>.scene・todo、画面の名前は help.flow.link.<label>
 */
export interface FlowStep {
  key: string;
  links: { label: string; path: readonly string[] }[];
}

export function flowSteps(thisYear: number): FlowStep[] {
  return [
    { key: 'setup', links: [{ label: 'settings', path: ['settings'] }, { label: 'import', path: ['import'] }, { label: 'payrollItems', path: ['payrolls', 'items'] }] },
    { key: 'join', links: [{ label: 'employeeNew', path: ['employees', 'new'] }, { label: 'filings', path: ['filings'] }] },
    { key: 'monthly', links: [{ label: 'payrolls', path: ['payrolls'] }, { label: 'premiums', path: ['premiums'] }] },
    { key: 'change', links: [{ label: 'revisions', path: ['revisions'] }] },
    { key: 'july', links: [{ label: 'regular', path: ['regular', String(thisYear)] }] },
    { key: 'bonus', links: [{ label: 'bonusNew', path: ['bonuses', 'new'] }, { label: 'bonuses', path: ['bonuses'] }] },
    { key: 'leave', links: [{ label: 'employees', path: ['employees'] }, { label: 'revisions', path: ['revisions'] }] },
    { key: 'retire', links: [{ label: 'employees', path: ['employees'] }, { label: 'filings', path: ['filings'] }] },
    { key: 'yearEnd', links: [{ label: 'premiumPeriod', path: ['premiums', 'period'] }] },
  ];
}
