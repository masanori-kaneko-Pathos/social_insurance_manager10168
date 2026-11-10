/**
 * 従業員の連絡先・通勤・口座を、鍵付きの文書（employees/{id}/details/private）へ移す（11/10）
 *
 * 使い方（プロジェクトのフォルダで）:
 *   node scripts/migrate-private.mjs --dry-run   … 移す人数と、最初の数人の中身を見るだけ（書き込まない）
 *   node scripts/migrate-private.mjs             … 移す（鍵付きの文書を作り、従業員の文書から古い項目を消す）
 *
 * 書き込みには、事前に `gcloud auth application-default login` が必要（seed-criteria.mjs と同じ）。
 * - 鍵付きの文書がもうある人は、上書きしない（アプリで直した新しい値を守る）。古い項目を消すだけ
 * - 何回流しても同じ結果になる（2回目は「移す人 0人」）
 * - 変更履歴は残さない（中身は変わらず、置き場所が変わるだけのため）
 */
const PROJECT_ID = 'kensyu10168';
const DATABASE_ID = 'socialinsurance-db';
const KEYS = ['contact', 'commute', 'bankAccount'];
const PER_BATCH = 200; // 1人 ＝ 2件（鍵付きの文書を作る・古い項目を消す）。batch の上限は500件

const EMPTY = {
  contact: { postalCode: null, address: null, phone: null, email: null },
  commute: { method: null, route: null },
  bankAccount: { bankName: null, branchName: null, accountType: null, accountNumber: null, holderKana: null },
};

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore(app, DATABASE_ID);
const dryRun = process.argv.includes('--dry-run');

// 古い項目が残っている従業員を探す（事業所ごと）
const plans = [];
for (const office of (await db.collection('offices').get()).docs) {
  const employees = await office.ref.collection('employees').get();
  for (const e of employees.docs) {
    const d = e.data();
    if (!KEYS.some((k) => k in d)) continue;
    const privRef = e.ref.collection('details').doc('private');
    const exists = (await privRef.get()).exists;
    plans.push({
      office: office.data().name,
      name: `${d.lastName ?? ''} ${d.firstName ?? ''}`.trim(),
      ref: e.ref,
      privRef,
      exists,
      priv: Object.fromEntries(KEYS.map((k) => [k, d[k] ?? EMPTY[k]])),
    });
  }
}

console.log(`移す人：${plans.length}人（うち、鍵付きの文書がもうある人 ${plans.filter((p) => p.exists).length}人 → 古い項目を消すだけ）`);
for (const p of plans.slice(0, 3)) {
  console.log(`- ${p.office}｜${p.name}｜〒${p.priv.contact.postalCode ?? '—'} ${p.priv.contact.address ?? ''}｜口座 ${p.priv.bankAccount.bankName ?? '—'}`);
}

if (dryRun) {
  console.log('\n--dry-run なので書き込みはしていません');
} else {
  for (let i = 0; i < plans.length; i += PER_BATCH) {
    const batch = db.batch();
    for (const p of plans.slice(i, i + PER_BATCH)) {
      if (!p.exists) batch.set(p.privRef, { ...p.priv, updatedAt: FieldValue.serverTimestamp() });
      batch.update(p.ref, Object.fromEntries(KEYS.map((k) => [k, FieldValue.delete()])));
    }
    await batch.commit();
  }
  console.log(`\n${DATABASE_ID} に書き込みました：${plans.length}人`);
}
