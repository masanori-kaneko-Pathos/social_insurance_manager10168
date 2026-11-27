// 従業員の「登録の取り消し」（11/17）。間違えて登録した人（二重登録など）を消す
// ルールでは従業員を誰も消せない（退職は退職日で表す）。消すのはこの関数だけ（事業所の削除と同じ考え方）
// 決まりは employee-delete-rules.ts（spec あり）。ここは「読む → 判断 → 消す」をつなぐだけ

import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  dismissalOf,
  employeeDeleteProblem,
  filingAfterRemove,
  myNumberRecorded,
  retentionDeletableOn,
  retentionDeleteProblem,
  withoutEmployee,
} from './employee-delete-rules.js';

const REGION = 'asia-northeast1';
const db = () => getFirestore('socialinsurance-db');

function fail(code: 'failed-precondition' | 'permission-denied' | 'invalid-argument' | 'not-found', reason: string): never {
  throw new HttpsError(code, reason, { reason });
}

function idArg(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) fail('invalid-argument', 'badArgument');
  return v;
}

/** 日本時間の今日（YYYY-MM-DD） */
function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * data: { officeId, employeeId, confirm, mode? }（confirm ＝ 画面で打ち込んだ社員番号。番号がない人は姓）
 * mode: 'retention'（11/27）＝ 保存期間（5年）を過ぎた退職者の削除。取り消しと違い、届出の記録・アカウントでは止めず、
 *   出した届出の記録・確認済みの月・精算・To-do の「確認した」からもその人を外し、マイページのアカウントも消す。
 *   マイナンバーが残っていれば止める（廃棄の手順を先に通す）。消せる日はここで数え直す
 * 取り消し（mode なし）：
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
  const retention = req.data?.mode === 'retention';

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
  const isAdmin = (office.data()?.memberRoles ?? {})[uid] === 'admin';
  const expected = number || (typeof e.lastName === 'string' ? e.lastName : '');
  const hasMyNumber = myNumberRecorded(index.data(), employeeId);
  let problem: string | null;
  if (retention) {
    // 消せる日を数え直す：最後の給与の支払月・最後の賞与の支払日（11/27）
    const retireDate = typeof e.retireDate === 'string' && e.retireDate ? e.retireDate : null;
    const [lastPay, allBonuses] = emp.exists
      ? await Promise.all([empRef.collection('payrolls').orderBy('paidMonth', 'desc').limit(1).get(), officeRef.collection('bonusPayments').get()])
      : [null, null];
    const lastPaidMonth = (lastPay?.docs[0]?.get('paidMonth') as string | undefined) ?? null;
    const bonusDates = (allBonuses?.docs ?? [])
      .filter((b) => employeeId in (b.get('amounts') ?? {}) || employeeId in (b.get('inKindAmounts') ?? {}))
      .map((b) => b.get('paidDate') as string)
      .filter((d) => typeof d === 'string')
      .sort();
    problem = retentionDeleteProblem({
      isAdmin,
      exists: emp.exists,
      confirm,
      expected,
      retireDate,
      deletableOn: retentionDeletableOn(retireDate, lastPaidMonth, bonusDates[bonusDates.length - 1] ?? null),
      today: todayJst(),
      hasMyNumber,
    });
  } else {
    problem = employeeDeleteProblem({
      isAdmin,
      exists: emp.exists,
      employeeNumber: number,
      confirm,
      expected,
      filingCount: filings.docs.filter((f) => filingAfterRemove(f.data(), employeeId).submitted).length,
      hasMyNumber,
      hasAccount: !account.empty || (typeof e.userUid === 'string' && e.userUid !== ''),
    });
  }
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
  // 届出の記録：その人を外す（ほかに誰もいなければ記録ごと消す）。取り消しではまだ出していない記録だけがここに来る
  // 保存期間を過ぎた削除では、出した記録からも外す（記録そのものは残る。11/27）
  for (const f of filings.docs) {
    const { rest } = filingAfterRemove(f.data(), employeeId);
    if (rest.length === 0) writer.delete(f.ref);
    else writer.update(f.ref, { employeeIds: rest, updatedAt: now });
  }
  for (const m of months.docs) writer.update(m.ref, { ids: FieldValue.arrayRemove(employeeId), updatedAt: now });
  for (const d of [...tasks.docs, ...requests.docs, ...notices.docs, ...invites.docs]) writer.delete(d.ref);

  // 保存期間を過ぎた削除だけ（11/27）：確認済みの月・精算・To-do の「確認した」・マイページのアカウント
  // 確認済みの月は、記録そのもの（合計・人数）は記録した時点のまま残し、その人の行だけを外す
  const accountUids: string[] = [];
  if (retention) {
    const [closes, dismissals] = await Promise.all([officeRef.collection('monthCloses').get(), officeRef.collection('todoDismissals').get()]);
    for (const c of closes.docs) {
      const people = c.get('people') as Record<string, unknown> | undefined;
      const diffIds = c.get('softCheck.diffIds') as string[] | undefined;
      // 同じ文書への書き込みは1回にまとめる
      const change: Record<string, unknown> = {};
      if (people && employeeId in people) change[`people.${employeeId}`] = FieldValue.delete();
      if (diffIds?.includes(employeeId)) change['softCheck.diffIds'] = FieldValue.arrayRemove(employeeId);
      if (Object.keys(change).length > 0) writer.update(c.ref, change);
      writer.delete(c.ref.collection('settlements').doc(employeeId));
    }
    for (const d of dismissals.docs) if (dismissalOf(d.id, employeeId)) writer.delete(d.ref);
    for (const a of account.docs) {
      accountUids.push(a.id);
      writer.delete(a.ref);
    }
    if (typeof e.userUid === 'string' && e.userUid !== '' && !accountUids.includes(e.userUid)) accountUids.push(e.userUid);
  }
  await writer.close();
  for (const u of accountUids) {
    // アカウントがもうなくても続ける
    await getAuth().deleteUser(u).catch(() => undefined);
  }

  // 従業員の文書と下のもの全部（最後に消す。途中で失敗しても、もう一度押せば続きから消える）
  await db().recursiveDelete(empRef);
  return { ok: true };
});
