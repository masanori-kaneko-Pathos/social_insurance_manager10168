// マイナンバーの関数（画面からは Firestore の番号に一切触らせない。読み書きはここだけ）
//
// 置き場所（ルールで画面からの読み書きを止めてある。関数は管理者の権限で読み書きする）
// - offices/{o}/myNumberVault/{employeeId}          暗号化した番号（ルールに match がない ＝ 誰も読めない）
// - offices/{o}/myNumberIndex/all                   状態の一覧 people.{employeeId}（管理者が読む。1回の読み取りで全員分）
// - offices/{o}/employees/{e}/details/myNumber      本人の状態（管理者と本人が読む。番号は入れない）
// - offices/{o}/myNumberLogs/{auto}                 アクセス記録（管理者が読む。書くのは関数だけ）
// 家族（被扶養者）の番号（11/12）：data に dependentId があれば家族の分として扱う
// - offices/{o}/myNumberVault/{employeeId}_{dependentId}   暗号化した番号
// - offices/{o}/myNumberIndex/all                          family.{employeeId}.{dependentId}
// - offices/{o}/employees/{e}/details/myNumberFamily       {dependentId}: 状態（管理者と本人が読む）
// 決まりは mynumber-rules.ts、暗号化は mynumber-crypto.ts（どちらも spec あり）

import { FieldValue, getFirestore, Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { keyFrom, open, seal, Sealed } from './mynumber-crypto.js';
import {
  ADMIN_ACTIONS,
  AdminAction,
  canSubmit,
  DOC_TYPES,
  isRecentAuth,
  isValidMyNumber,
  keepsVault,
  MyNumberDocType,
  MyNumberStatus,
  nextStatus,
  normalizeMyNumber,
  VERIFIED_BY,
  VerifiedBy,
} from './mynumber-rules.js';

const REGION = 'asia-northeast1';
/** index.ts の initializeApp() のあとで呼ぶ（読み込んだ時点ではまだ初期化されていない） */
const db = () => getFirestore('socialinsurance-db');
const key = () => keyFrom(process.env.MYNUMBER_KEY);
const MAX_IMPORT = 500;

interface Entry {
  status: MyNumberStatus;
  docType: MyNumberDocType | null;
  note: string | null;
  by: 'admin' | 'employee';
  updatedAt: string;
  /** 家族だけ：本人確認をした人（会社／従業員） */
  verifiedBy?: VerifiedBy | null;
}

type LogAction = AdminAction | 'submit' | 'view' | 'export' | 'import';

function fail(code: 'failed-precondition' | 'permission-denied' | 'invalid-argument' | 'not-found', reason: string): never {
  throw new HttpsError(code, reason, { reason });
}

function needUid(auth: { uid: string } | undefined): string {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'signIn', { reason: 'signIn' });
  return auth.uid;
}

function idArg(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) fail('invalid-argument', 'badArgument');
  return v;
}

function numberArg(v: unknown): string {
  const n = typeof v === 'string' ? normalizeMyNumber(v) : '';
  if (!isValidMyNumber(n)) fail('invalid-argument', 'badNumber');
  return n;
}

function docTypeArg(v: unknown, optional = false): MyNumberDocType | null {
  if ((v == null || v === '') && optional) return null;
  if (!DOC_TYPES.includes(v as MyNumberDocType)) fail('invalid-argument', 'badDocType');
  return v as MyNumberDocType;
}

/** 家族のID（任意。なければ従業員本人の番号） */
function dependentArg(v: unknown): string | null {
  return v == null || v === '' ? null : idArg(v);
}

function verifiedByArg(v: unknown): VerifiedBy {
  if (!VERIFIED_BY.includes(v as VerifiedBy)) fail('invalid-argument', 'badArgument');
  return v as VerifiedBy;
}

function noteArg(v: unknown, required: boolean): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  if (t.length > 200 || (required && !t)) fail('invalid-argument', 'badNote');
  return t || null;
}

/** 全桁を見る・書き出す：5分以内にパスワードでログインし直していること */
function needRecentAuth(token: { auth_time?: number } | undefined): void {
  if (!isRecentAuth(token?.auth_time, Math.floor(Date.now() / 1000))) fail('permission-denied', 'reauth');
}

async function needAdmin(uid: string, officeId: string): Promise<void> {
  const o = await db().doc(`offices/${officeId}`).get();
  if (!o.exists) fail('not-found', 'notFound');
  if ((o.data()?.memberRoles ?? {})[uid] !== 'admin') fail('permission-denied', 'notAdmin');
}

/** 番号の持ち主：従業員本人（dependentId なし）か、その家族 */
interface Subject {
  officeId: string;
  employeeId: string;
  dependentId: string | null;
}

const refs = (officeId: string, employeeId: string) => ({
  vault: db().doc(`offices/${officeId}/myNumberVault/${employeeId}`),
  index: db().doc(`offices/${officeId}/myNumberIndex/all`),
  self: db().doc(`offices/${officeId}/employees/${employeeId}/details/myNumber`),
  employee: db().doc(`offices/${officeId}/employees/${employeeId}`),
});

/** 金庫の文書（家族は {従業員ID}_{家族ID}） */
const vaultOf = (s: Subject) =>
  db().doc(`offices/${s.officeId}/myNumberVault/${s.dependentId ? `${s.employeeId}_${s.dependentId}` : s.employeeId}`);
/** 暗号化に添える文字（取り違え防止。従業員本人は今までどおり） */
const aadOf = (s: Subject) =>
  s.dependentId ? `${s.officeId}/${s.employeeId}/${s.dependentId}` : `${s.officeId}/${s.employeeId}`;
const familyRef = (s: Subject) => db().doc(`offices/${s.officeId}/employees/${s.employeeId}/details/myNumberFamily`);
const dependentRef = (s: Subject) =>
  db().doc(`offices/${s.officeId}/employees/${s.employeeId}/dependents/${s.dependentId}`);

function writeLog(
  tx: Transaction | null,
  officeId: string,
  uid: string,
  action: LogAction,
  employeeId: string | null,
  count: number,
  name: unknown,
  dependentId: string | null = null,
): Promise<unknown> | void {
  const ref = db().collection(`offices/${officeId}/myNumberLogs`).doc();
  // 名前はログインのトークンから（表示名。なければ空）。記録を読むときに名簿を引かなくて済む
  const data = {
    action, employeeId, dependentId, count, uid,
    name: typeof name === 'string' ? name.slice(0, 50) : '',
    at: FieldValue.serverTimestamp(),
  };
  if (tx) tx.set(ref, data);
  else return ref.set(data);
}

/** 状態を一覧と本人の文書の両方に書く（null ＝ 未登録に戻す）。家族は family の欄と details/myNumberFamily */
function writeStatus(tx: Transaction, subject: Subject, entry: Entry | null): void {
  const { officeId, employeeId, dependentId } = subject;
  const r = refs(officeId, employeeId);
  if (dependentId) {
    const value = entry ?? FieldValue.delete();
    tx.set(r.index, { family: { [employeeId]: { [dependentId]: value } } }, { merge: true });
    tx.set(familyRef(subject), { [dependentId]: value }, { merge: true });
    return;
  }
  if (entry) {
    tx.set(r.index, { people: { [employeeId]: entry } }, { merge: true });
    tx.set(r.self, { ...entry, updatedAt: FieldValue.serverTimestamp() });
  } else {
    tx.set(r.index, { people: { [employeeId]: FieldValue.delete() } }, { merge: true });
    tx.delete(r.self);
  }
}

async function currentOf(tx: Transaction, subject: Subject): Promise<Entry | null> {
  if (subject.dependentId) {
    const snap = await tx.get(familyRef(subject));
    return (snap.data()?.[subject.dependentId] as Entry | undefined) ?? null;
  }
  const snap = await tx.get(refs(subject.officeId, subject.employeeId).self);
  return snap.exists ? (snap.data() as Entry) : null;
}

/**
 * 管理者の操作：登録（set）・提供の依頼・取り消し・承認・差し戻し・提供を受けられない・廃棄
 * data: { officeId, employeeId, dependentId?, action, number?, docType?, verifiedBy?, note? }
 * 家族（dependentId あり）の登録では、本人確認をした人（verifiedBy：会社／従業員）を必ず受け取る
 */
export const siMyNumberAdmin = onCall({ region: REGION }, async (req) => {
  const uid = needUid(req.auth);
  const officeId = idArg(req.data?.officeId);
  const employeeId = idArg(req.data?.employeeId);
  const dependentId = dependentArg(req.data?.dependentId);
  const subject: Subject = { officeId, employeeId, dependentId };
  const action = req.data?.action as AdminAction;
  if (!ADMIN_ACTIONS.includes(action)) fail('invalid-argument', 'badArgument');
  await needAdmin(uid, officeId);
  const number = action === 'set' ? numberArg(req.data?.number) : null;
  const docType = action === 'set' ? docTypeArg(req.data?.docType, true) : null;
  const verifiedBy = action === 'set' && dependentId ? verifiedByArg(req.data?.verifiedBy) : null;
  const note = action === 'return' || action === 'refuse' ? noteArg(req.data?.note, true) : null;
  const r = refs(officeId, employeeId);
  const vault = vaultOf(subject);

  await db().runTransaction(async (tx) => {
    const [emp, dep, cur] = await Promise.all([
      tx.get(r.employee),
      dependentId ? tx.get(dependentRef(subject)) : Promise.resolve(null),
      currentOf(tx, subject),
    ]);
    if (!emp.exists || (dep && !dep.exists)) fail('not-found', 'notFound');
    const step = nextStatus(cur?.status ?? null, action);
    if (!step.ok) fail('failed-precondition', 'badStatus');
    const next = step.next;
    if (number) tx.set(vault, { ...seal(key(), number, aadOf(subject)), updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
    else if (!keepsVault(next)) tx.delete(vault);
    const entry: Entry | null = next
      ? {
          status: next,
          // 承認のときは、本人が選んだ確認書類をそのまま残す
          docType: action === 'set' ? docType : (cur?.docType ?? null),
          note,
          by: 'admin',
          updatedAt: new Date().toISOString(),
          ...(dependentId ? { verifiedBy: action === 'set' ? verifiedBy : (cur?.verifiedBy ?? null) } : {}),
        }
      : null;
    writeStatus(tx, subject, entry);
    writeLog(tx, officeId, uid, action, employeeId, 1, req.auth?.token?.name, dependentId);
    // 依頼・差し戻し：本人のマイページの受信箱に知らせる（文は日本語。理由はそのまま。家族の名前は書かない）
    if (action === 'request' || action === 'return') {
      const family = dependentId ? 'ご家族の' : '';
      tx.set(db().collection(`offices/${officeId}/notifications`).doc(), {
        employeeId,
        kind: 'notice',
        title: action === 'request' ? `${family}マイナンバーの提出のお願い` : `${family}マイナンバーの提出（修正のお願い）`,
        body:
          action === 'request'
            ? `社会保険の届出のため、マイページの「マイナンバー」から${family}番号を提出してください。`
            : `提出いただいた${family}マイナンバーを確認できませんでした。理由：${note ?? ''}　マイページから提出し直してください。`,
        link: null,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return { ok: true };
});

/**
 * 本人の提出（マイページ）。依頼中・差し戻し中のときだけ。data: { number, docType, dependentId? }
 * 家族の分は、従業員が本人確認をしたもの（verifiedBy: employee）として受け取る
 */
export const siMyNumberSubmit = onCall({ region: REGION }, async (req) => {
  const uid = needUid(req.auth);
  const number = numberArg(req.data?.number);
  const docType = docTypeArg(req.data?.docType);
  const dependentId = dependentArg(req.data?.dependentId);
  const user = await db().doc(`users/${uid}`).get();
  const ref = user.data()?.employeeRef as { officeId?: string; employeeId?: string } | undefined;
  if (user.data()?.role !== 'employee' || !ref?.officeId || !ref.employeeId) fail('permission-denied', 'notEmployee');
  const officeId = idArg(ref.officeId);
  const employeeId = idArg(ref.employeeId);
  const subject: Subject = { officeId, employeeId, dependentId };

  await db().runTransaction(async (tx) => {
    const [dep, cur] = await Promise.all([
      dependentId ? tx.get(dependentRef(subject)) : Promise.resolve(null),
      currentOf(tx, subject),
    ]);
    if (dep && !dep.exists) fail('not-found', 'notFound');
    if (!canSubmit(cur?.status ?? null)) fail('failed-precondition', 'badStatus');
    tx.set(vaultOf(subject), { ...seal(key(), number, aadOf(subject)), updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
    writeStatus(tx, subject, {
      status: 'submitted',
      docType,
      note: null,
      by: 'employee',
      updatedAt: new Date().toISOString(),
      ...(dependentId ? { verifiedBy: 'employee' as const } : {}),
    });
    writeLog(tx, officeId, uid, 'submit', employeeId, 1, req.auth?.token?.name, dependentId);
  });
  return { ok: true };
});

/** 全桁を見る（登録済み・チェック待ち）。5分以内にログインし直していること。data: { officeId, employeeId, dependentId? } */
export const siMyNumberView = onCall({ region: REGION }, async (req) => {
  const uid = needUid(req.auth);
  const officeId = idArg(req.data?.officeId);
  const employeeId = idArg(req.data?.employeeId);
  const dependentId = dependentArg(req.data?.dependentId);
  const subject: Subject = { officeId, employeeId, dependentId };
  await needAdmin(uid, officeId);
  needRecentAuth(req.auth?.token);
  const snap = await vaultOf(subject).get();
  if (!snap.exists) fail('not-found', 'notFound');
  const number = open(key(), snap.data() as Sealed, aadOf(subject));
  await writeLog(null, officeId, uid, 'view', employeeId, 1, req.auth?.token?.name, dependentId);
  return { number };
});

/** 書き出し：登録済みの人の番号をまとめて返す（CSV は画面で作る）。5分以内にログインし直していること */
export const siMyNumberExport = onCall({ region: REGION }, async (req) => {
  const uid = needUid(req.auth);
  const officeId = idArg(req.data?.officeId);
  await needAdmin(uid, officeId);
  needRecentAuth(req.auth?.token);
  const index = await db().doc(`offices/${officeId}/myNumberIndex/all`).get();
  const people = (index.data()?.people ?? {}) as Record<string, Entry>;
  const ids = Object.keys(people).filter((id) => people[id].status === 'registered');
  const snaps = ids.length ? await db().getAll(...ids.map((id) => refs(officeId, id).vault)) : [];
  const k = key();
  const rows = snaps
    .filter((s) => s.exists)
    .map((s) => ({ employeeId: s.id, number: open(k, s.data() as Sealed, `${officeId}/${s.id}`) }));
  await writeLog(null, officeId, uid, 'export', null, rows.length, req.auth?.token?.name);
  return { rows };
});

/** 取り込み：従業員ごとの番号をまとめて登録する。data: { officeId, items: [{ employeeId, number }] } */
export const siMyNumberImport = onCall({ region: REGION }, async (req) => {
  const uid = needUid(req.auth);
  const officeId = idArg(req.data?.officeId);
  const raw = req.data?.items;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_IMPORT) fail('invalid-argument', 'badArgument');
  await needAdmin(uid, officeId);
  const items = raw.map((x: { employeeId?: unknown; number?: unknown }) => ({
    employeeId: idArg(x?.employeeId),
    number: numberArg(x?.number),
  }));
  if (new Set(items.map((x) => x.employeeId)).size !== items.length) fail('invalid-argument', 'badArgument');
  const emps = await db().getAll(...items.map((x) => refs(officeId, x.employeeId).employee));
  if (emps.some((e) => !e.exists)) fail('not-found', 'notFound');

  const k = key();
  const now = new Date().toISOString();
  // 1回の書き込みは500件まで → 1人4件（金庫・一覧・本人・記録はまとめて1件）なので 100人ずつ
  for (let i = 0; i < items.length; i += 100) {
    const batch = db().batch();
    const people: Record<string, Entry> = {};
    for (const x of items.slice(i, i + 100)) {
      const r = refs(officeId, x.employeeId);
      const entry: Entry = { status: 'registered', docType: null, note: null, by: 'admin', updatedAt: now };
      people[x.employeeId] = entry;
      batch.set(r.vault, { ...seal(k, x.number, `${officeId}/${x.employeeId}`), updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
      batch.set(r.self, { ...entry, updatedAt: FieldValue.serverTimestamp() });
    }
    batch.set(db().doc(`offices/${officeId}/myNumberIndex/all`), { people }, { merge: true });
    await batch.commit();
  }
  await writeLog(null, officeId, uid, 'import', null, items.length, req.auth?.token?.name);
  return { count: items.length };
});
