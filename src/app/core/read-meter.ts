// 読み込みの回数を数える（開発・確認のときだけ。11/12）
//
// Firestore の料金は「読んだ文書の数」で決まる（問い合わせの結果が0件でも1回）。
// 1万人のデータを入れる前に、1000人で画面ごとの回数を測って、計算で見積もるために使う。
// 使い方：ブラウザの開発者ツールのコンソールで
//   localStorage.setItem('shaho.readMeter', '1')  → 再読み込み（やめるときは removeItem）
// 画面の右下に「この画面での読み込み」が出る（画面を移ると0に戻る）。
// ※ リアルタイム更新（onSnapshot：ベル・受信箱）は数えていない

import { signal } from '@angular/core';
import {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  getDoc,
  getDocs,
  Query,
  QuerySnapshot,
} from 'firebase/firestore';

const KEY = 'shaho.readMeter';

/** 数えるか（localStorage に印があるときだけ。ふだんは何もしない） */
export const readMeterOn: boolean = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();

/** この画面での読み込み：合計と、コレクションごとの内訳 */
export const readTotal = signal(0);
export const readByCollection = signal<ReadonlyMap<string, number>>(new Map());

export function resetReads(): void {
  readTotal.set(0);
  readByCollection.set(new Map());
}

function add(n: number, label: string): void {
  readTotal.update((t) => t + n);
  readByCollection.update((m) => new Map(m).set(label, (m.get(label) ?? 0) + n));
}

/** パスからコレクションの名前（offices/x/employees/y/contracts → contracts） */
function collectionOf(path: string, isDoc: boolean): string {
  const parts = path.split('/').filter((p) => p);
  return (isDoc ? parts[parts.length - 2] : parts[parts.length - 1]) ?? '?';
}

/** 問い合わせの対象のコレクションの名前（where で絞った問い合わせは、SDK の内部の情報から。読めなければ 'query'） */
function queryLabel(q: unknown): string {
  try {
    const path = (q as { path?: string }).path;
    if (typeof path === 'string') return collectionOf(path, false);
    const inner = (q as { _query?: { collectionGroup?: string | null; path?: { lastSegment?: () => string } } })._query;
    if (inner?.collectionGroup) return inner.collectionGroup;
    const last = inner?.path?.lastSegment?.();
    if (last) return last;
  } catch {
    // 内部の形が変わっていても、数えることは続ける
  }
  return 'query';
}

/** getDocs と同じ。数えるときは、返ってきた件数（0件なら1回）を足す */
export async function countedGetDocs<A, D extends DocumentData>(q: Query<A, D>): Promise<QuerySnapshot<A, D>> {
  const snap = await getDocs(q);
  if (readMeterOn) add(Math.max(1, snap.size), queryLabel(q));
  return snap;
}

/** getDoc と同じ。数えるときは1回を足す */
export async function countedGetDoc<A, D extends DocumentData>(ref: DocumentReference<A, D>): Promise<DocumentSnapshot<A, D>> {
  const snap = await getDoc(ref);
  if (readMeterOn) add(1, collectionOf(ref.path, true));
  return snap;
}
