// 読んだデータを、ログインしている間だけ覚えておく（11/12。読み込みを減らすため）
// 覚え場所の仕組み（純粋。Firebase に依存しない）。ログアウトで忘れるつなぎは data-cache.ts
//
// 1000人の事業所で測ると、ほとんどの画面が開くたびに全員分の従業員（約1,000回）を読み直していた。
// 従業員の一覧・契約・標準報酬は、画面をまたいで同じものを使うので、1回読んだら覚えておく。
//
// 古くならないように
// - アプリから書いたら、その分を忘れる（書き込みはすべて HistoryService を通るので、そこで忘れる）
// - 覚えておくのは5分まで（ほかの担当者の変更・従業員の招待の受け入れなど、この画面の外での変更のため）
// - ログインしている人が変わったら、全部忘れる
// - ページを読み込み直せば、全部忘れる（覚え場所はメモリだけ。ブラウザには保存しない）

/** 覚えておく時間 */
export const CACHE_MS = 5 * 60 * 1000;

interface Entry {
  at: number;
  value: Promise<unknown>;
}

const store = new Map<string, Entry>();

/** 覚えていればそれを、なければ読んで覚える（読んでいる途中のものも使い回す。失敗したら覚えない） */
export function cached<T>(key: string, load: () => Promise<T>, ms = CACHE_MS, now = Date.now()): Promise<T> {
  const hit = store.get(key);
  if (hit && now - hit.at < ms) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { at: now, value });
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  return value;
}

/** 覚えていれば返す（読みには行かない）。なければ null */
export function peek<T>(key: string, ms = CACHE_MS, now = Date.now()): Promise<T> | null {
  const hit = store.get(key);
  return hit && now - hit.at < ms ? (hit.value as Promise<T>) : null;
}

/** その鍵と、その下の鍵（'contracts/o1' なら 'contracts/o1/e1' も）を忘れる */
export function forget(prefix: string): void {
  for (const k of [...store.keys()]) if (k === prefix || k.startsWith(`${prefix}/`)) store.delete(k);
}

export function forgetAll(): void {
  store.clear();
}

// ===== 鍵 =====

export const cacheKey = {
  employees: (officeId: string) => `employees/${officeId}`,
  contracts: (officeId: string, employeeId: string) => `contracts/${officeId}/${employeeId}`,
  remunerations: (officeId: string, employeeId: string) => `remunerations/${officeId}/${employeeId}`,
};

/**
 * 変更履歴の target（'employee'・'contracts/2026-04-01' など）から、忘れるものを決める
 * 連絡先など鍵付きの文書（details/*）・扶養家族などは一覧に入っていないので、忘れなくてよい
 */
export function forgetForWrite(officeId: string, employeeId: string, target: string): void {
  if (target === 'employee') forget(cacheKey.employees(officeId));
  else if (target.startsWith('contracts/')) forget(cacheKey.contracts(officeId, employeeId));
  else if (target.startsWith('remunerations/')) forget(cacheKey.remunerations(officeId, employeeId));
}
