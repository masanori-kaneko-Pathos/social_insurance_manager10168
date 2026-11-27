// アプリの中で見た画面の順（「‹ 前の画面」のリンクのため。11/25）
// Angular に依存しない純粋な関数
//
// - 11/27：前の画面は「すぐ前に見た画面」。どう来たかで3通りに積む（PushMode）
//   push：ふつうのリンク。同じ画面がもう積まれていれば、そこから抜いていちばん上へ（すぐ前の画面がいつも出る）
//   back：「‹ 前の画面」で戻った。そこから後ろを捨てる（戻った先で、また今の画面に戻るリンクが出て輪にならない）
//   root：サイドバー・ホームから来た。積んだものを全部捨てて、この画面から始める（「‹ 前の画面」は出ない）
// - タブ・絞り込みの切り替え（同じパス）は上書き
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

/** どう来たか（11/27） */
export type PushMode = 'push' | 'back' | 'root';

/** 画面を開いたとき */
export function pushEntry(stack: readonly NavEntry[], entry: NavEntry, mode: PushMode = 'push'): NavEntry[] {
  const i = stack.findIndex((e) => e.path === entry.path);
  // 後から決めた名前（氏名など）は、同じ画面なら残す
  const next = i >= 0 ? { ...stack[i], url: entry.url, name: entry.name } : entry;
  if (mode === 'root') return [next];
  if (i < 0) return [...stack, entry].slice(-NAV_HISTORY_MAX);
  // 戻った：そこから後ろを捨てる
  if (mode === 'back') return [...stack.slice(0, i), next];
  // ふつうのリンク：同じ画面を抜いて、いちばん上へ（すぐ前の画面がいつも前に出る）
  return [...stack.slice(0, i), ...stack.slice(i + 1), next];
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
