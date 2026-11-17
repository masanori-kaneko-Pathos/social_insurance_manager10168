// 従業員の「登録の取り消し」（11/17）。間違えて登録した人（二重登録など）を消す
// ルールでは従業員を誰も消せない（退職は退職日で表す）。消すのはこの関数だけ（事業所の削除と同じ考え方）
// 決まりは employee-delete-rules.ts（spec あり）。ここは「読む → 判断 → 消す」をつなぐだけ

import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { employeeDeleteProblem, filingAfterRemove, myNumberRecorded, withoutEmployee } from './employee-delete-rules.js';

const REGION = 'asia-northeast1';
const db = () => getFirestore('socialinsurance-db');

function fail(code: 'failed-precondition' | 'permission-denied' | 'invalid-argument' | 'not-found', reason: string): never {
  throw new HttpsError(code, reason, { reason });
}

function idArg(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) fail('invalid-argument', 'badArgument');
  return v;
}

/**
 * data: { officeId, employeeId, confirm }（confirm ＝ 画面で打ち込んだ社員番号。番号がない人は姓）
 * 消すもの：従業員の文書と下のもの全部（契約・標準報酬・給与・扶養・変更履歴・鍵付きの文書など）、
 *   賞与の支給の中のその人の額、給与の月の索引のその人、まだ出していない届出の記録のその人、
 *   届出の宿題・依頼・受信箱・未使用の招待
 */
export const siDeleteEmployee = onCall({ region: REGION, timeoutSeconds: 120 }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'signIn', { reason: 'signIn' });
  const officeId = idArg(req.data?.officeId);
  const employeeId = idArg(req.data?.employeeId);
  const confirm = typeof req.data?.confirm === 'string' ? req.data.confirm : '';

  const officeRef = db().doc(`offices/${officeId}`);
  const empRef = officeRef.collection('employees').doc(employeeId);
  const [office, emp, index, filings, account] = await Promise.all([
    officeRef.get(),
    empRef.get(),
    officeRef.collection('myNumberIndex').doc('all').get(),
    officeRef.collection('filings').where('employeeIds', 'array-contains', employeeId).get(),
    db().collection('users').where('employeeRef.officeId', '==', officeId).where('employeeRef.employeeId', '==', employeeId).limit(1).get(),
  ]);
  if (!office.exists) fail('not-found', 'notFound');
  const e = emp.data() ?? {};
  const number = typeof e.employeeNumber === 'string' ? e.employeeNumber : '';
  const problem = employeeDeleteProblem({
    isAdmin: (office.data()?.memberRoles ?? {})[uid] === 'admin',
    exists: emp.exists,
    employeeNumber: number,
    confirm,
    expected: number || (typeof e.lastName === 'string' ? e.lastName : ''),
    filingCount: filings.docs.filter((f) => filingAfterRemove(f.data(), employeeId).submitted).length,
    hasMyNumber: myNumberRecorded(index.data(), employeeId),
    hasAccount: !account.empty || (typeof e.userUid === 'string' && e.userUid !== ''),
  });
  if (problem === 'notAdmin') fail('permission-denied', problem);
  if (problem === 'notFound') fail('not-found', problem);
  if (problem) fail('failed-precondition', problem);

  // その人に結びついた、事業所の下のもの
  const [bonuses, months, tasks, requests, notices, invites] = await Promise.all([
    officeRef.collection('bonusPayments').get(),
    officeRef.collection('payrollMonths').where('ids', 'array-contains', employeeId).get(),
    officeRef.collection('filingTasks').where('employeeId', '==', employeeId).get(),
    officeRef.collection('requests').where('employeeId', '==', employeeId).get(),
    officeRef.collection('notifications').where('employeeId', '==', employeeId).get(),
    officeRef.collection('invites').where('employeeId', '==', employeeId).get(),
  ]);

  const writer = db().bulkWriter();
  const now = FieldValue.serverTimestamp();
  for (const b of bonuses.docs) {
    const amounts = withoutEmployee(b.get('amounts'), employeeId);
    const inKind = withoutEmployee(b.get('inKindAmounts'), employeeId);
    if (amounts || inKind) {
      writer.update(b.ref, {
        ...(amounts ? { amounts } : {}),
        ...(inKind ? { inKindAmounts: inKind } : {}),
        updatedAt: now,
      });
    }
  }
  // まだ出していない届出の記録：その人を外す（ほかに誰もいなければ記録ごと消す）
  for (const f of filings.docs) {
    const { rest } = filingAfterRemove(f.data(), employeeId);
    if (rest.length === 0) writer.delete(f.ref);
    else writer.update(f.ref, { employeeIds: rest, updatedAt: now });
  }
  for (const m of months.docs) writer.update(m.ref, { ids: FieldValue.arrayRemove(employeeId), updatedAt: now });
  for (const d of [...tasks.docs, ...requests.docs, ...notices.docs, ...invites.docs]) writer.delete(d.ref);
  await writer.close();

  // 従業員の文書と下のもの全部（最後に消す。途中で失敗しても、もう一度押せば続きから消える）
  await db().recursiveDelete(empRef);
  return { ok: true };
});
