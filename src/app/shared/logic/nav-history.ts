// アプリの中で見た画面の順（「‹ 前の画面」のリンクのため。11/25）
// Angular に依存しない純粋な関数
//
// - 同じ画面（パスが同じ）にもう一度来たら、そこから後ろを捨てて、URL だけ新しくする
//   （タブ・絞り込みの切り替えは上書き。A → B → A と戻ったら A の前は A の前のまま。行ったり来たりで輪にならない）
// - 編集・新規登録の画面は積まない（保存して詳細に移ったあとの「戻る」が、編集画面に戻らないように）

export interface NavEntry {
  /** パス（? より前）。同じ画面かどうかを見分ける */
  path: string;
  /** 戻るときに開く URL（タブ・絞り込みの ? も含む） */
  url: string;
  /** 画面の名前（i18n のキーと、差し込む値） */
  name: { key: string; params?: Record<string, string> };
  /** 画面が後から決めた名前（従業員のページの氏名など）。あればキーより先に使う */
  text?: string;
}

export const NAV_HISTORY_MAX = 30;

/** 画面を開いたとき */
export function pushEntry(stack: readonly NavEntry[], entry: NavEntry): NavEntry[] {
  const i = stack.findIndex((e) => e.path === entry.path);
  if (i >= 0) {
    // 同じ画面：そこまで戻して URL を新しく（後から決めた名前は残す）
    return [...stack.slice(0, i), { ...stack[i], url: entry.url, name: entry.name }];
  }
  return [...stack, entry].slice(-NAV_HISTORY_MAX);
}

/** 今の画面の前の画面（なければ null。今の画面が積まれていない編集画面でも、いちばん上を返す） */
export function previousOf(stack: readonly NavEntry[], currentPath: string): NavEntry | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].path !== currentPath) return stack[i];
  }
  return null;
}

/** 画面が後から名前を決めたとき（同じパスの記録に付ける） */
export function nameEntry(stack: readonly NavEntry[], path: string, text: string): NavEntry[] {
  return stack.map((e) => (e.path === path ? { ...e, text } : e));
}
