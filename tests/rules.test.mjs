// セキュリティルール（firestore.rules）の自動テスト（11/26）
//
// 使い方（どちらか）
//   npm run test:rules
//     ＝ firebase emulators:exec --project demo-shaho-rules --only firestore "node tests/rules.test.mjs"（本番に触らない demo のプロジェクトでエミュレーターを起動し、終わったら止める）
//   エミュレーターを起動したまま、別のターミナルで node tests/rules.test.mjs
// 必要なもの：Java（エミュレーターが使う）と、devDependencies の @firebase/rules-unit-testing
//
// 確かめること：誰が・どこを読めて書けるか（事業所の管理者・一般・従業員本人・ほかの従業員・部外者・ログインしていない人）
// 書き込みの形の検査は、代表として組合の料率と給与の項目だけ（ほかの形は spec とアプリの入力チェックで見ている）
// エミュレーターの中だけで動く。本番のデータには触らない（projectId は demo- で始まる）

import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-shaho-rules',
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8'),
    host: '127.0.0.1',
    port: 8080,
  },
});
await testEnv.clearFirestore();

const O = 'offices/o1';
const OTHER = 'offices/o2';

// ===== テスト用のデータ（ルールを通さずに入れる） =====
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const user = (role, extra = {}) => ({ email: 'x@example.com', displayName: 'テスト', role, currentOfficeId: null, lang: 'ja', employeeRef: null, ...extra });
  await setDoc(doc(db, 'users/admin1'), user('admin'));
  await setDoc(doc(db, 'users/general1'), user('admin'));
  await setDoc(doc(db, 'users/outsider'), user('admin'));
  await setDoc(doc(db, 'users/emp1'), user('employee', { employeeRef: { officeId: 'o1', employeeId: 'E1', inviteCode: 'c1' } }));
  await setDoc(doc(db, 'users/emp2'), user('employee', { employeeRef: { officeId: 'o1', employeeId: 'E2', inviteCode: 'c2' } }));

  await setDoc(doc(db, O), {
    name: 'テスト本社',
    memberUids: ['admin1', 'general1'],
    memberRoles: { admin1: 'admin', general1: 'general' },
    ownerUid: 'admin1',
    prefecture: '13',
    healthInsurer: { type: 'kumiai', kumiaiName: 'テスト健康保険組合' },
  });
  await setDoc(doc(db, OTHER), { name: 'ほかの会社', memberUids: ['outsider'], memberRoles: { outsider: 'admin' }, ownerUid: 'outsider' });

  for (const id of ['E1', 'E2']) {
    await setDoc(doc(db, `${O}/employees/${id}`), { lastName: '従業員', firstName: id, birthDate: '1990-01-01' });
    await setDoc(doc(db, `${O}/employees/${id}/details/private`), { contact: { address: '東京都' } });
    await setDoc(doc(db, `${O}/employees/${id}/dependents/d1`), { lastName: '家族', birthDate: '1985-03-15', from: '2020-04-01', to: null });
    await setDoc(doc(db, `${O}/employees/${id}/payrolls/2026-11`), { cash: 300000 });
    await setDoc(doc(db, `${O}/employees/${id}/remunerations/2026-04`), { from: '2026-04' });
  }
  await setDoc(doc(db, `${O}/history/h1`), { target: 'employee', changes: [] });
  await setDoc(doc(db, `${O}/myNumberVault/E1`), { cipher: 'xxx' });
  await setDoc(doc(db, `${O}/myNumberIndex/all`), { people: {} });
  await setDoc(doc(db, `${O}/myNumberLogs/l1`), { action: 'view' });
  await setDoc(doc(db, `${O}/shared/forEmployees`), { name: 'テスト本社' });
  await setDoc(doc(db, 'masterRates/care_2026-03'), { kind: 'care', from: '2026-03', rate: 16200 });
});

const as = (uid) => testEnv.authenticatedContext(uid, { email: 'x@example.com' }).firestore();
const admin = as('admin1');
const general = as('general1');
const outsider = as('outsider');
const emp1 = as('emp1');
const emp2 = as('emp2');
const guest = testEnv.unauthenticatedContext().firestore();

let failed = 0;
let passed = 0;
async function check(label, promise) {
  try {
    await promise;
    passed++;
    console.log(`OK  ${label}`);
  } catch (err) {
    failed++;
    console.log(`NG  ${label}\n    ${err?.message ?? err}`);
  }
}
const ok = (label, p) => check(label, assertSucceeds(p));
const ng = (label, p) => check(label, assertFails(p));
const read = (db, path) => getDoc(doc(db, path));

// ===== マスタ（料率・等級表など）：ログインしていれば読める。誰も書けない =====
await ok('マスタ：ログインしている人は読める', read(general, 'masterRates/care_2026-03'));
await ng('マスタ：ログインしていない人は読めない', read(guest, 'masterRates/care_2026-03'));
await ng('マスタ：管理者でも書けない', setDoc(doc(admin, 'masterRates/care_2027-03'), { kind: 'care', from: '2027-03', rate: 1 }));

// ===== 利用者 =====
await ok('利用者：自分の文書は読める', read(general, 'users/general1'));
await ng('利用者：ほかの人の文書は読めない', read(general, 'users/admin1'));
await ok('利用者：自分の言語は変えられる', updateDoc(doc(admin, 'users/admin1'), { lang: 'en', updatedAt: serverTimestamp() }));
await ng('利用者：自分の権限（role）は変えられない', updateDoc(doc(emp1, 'users/emp1'), { role: 'admin', updatedAt: serverTimestamp() }));
await ng('利用者：メンバーでない事業所には切り替えられない', updateDoc(doc(admin, 'users/admin1'), { currentOfficeId: 'o2', updatedAt: serverTimestamp() }));

// ===== 事業所 =====
await ok('事業所：メンバー（一般）は読める', read(general, O));
await ng('事業所：部外者は読めない', read(outsider, O));
await ng('事業所：従業員のアカウントは読めない（要るものは写しで見る）', read(emp1, O));
await ng('事業所：一般は書き換えられない', updateDoc(doc(general, O), { name: '書き換え', updatedAt: serverTimestamp() }));
await ng('事業所：管理者でもメンバーの名簿は書き換えられない', updateDoc(doc(admin, O), { memberUids: ['admin1', 'general1', 'outsider'], updatedAt: serverTimestamp() }));
await ng('事業所：消せない', deleteDoc(doc(admin, O)));
await ok('従業員向けの写し：従業員本人は読める', read(emp1, `${O}/shared/forEmployees`));
await ng('従業員向けの写し：部外者は読めない', read(outsider, `${O}/shared/forEmployees`));

// ===== 従業員 =====
await ok('従業員：メンバー（一般）は読める', read(general, `${O}/employees/E2`));
await ng('従業員：部外者は読めない', read(outsider, `${O}/employees/E1`));
await ok('従業員：本人は自分の文書を読める', read(emp1, `${O}/employees/E1`));
await ng('従業員：ほかの従業員の文書は読めない', read(emp1, `${O}/employees/E2`));
await ng('従業員：一般は作れない', setDoc(doc(general, `${O}/employees/E9`), { lastName: 'x' }));
await ng('従業員：管理者でも消せない（退職は退職日で表す）', deleteDoc(doc(admin, `${O}/employees/E2`)));

// ===== 住所・口座など（details/private）：管理者と本人だけ =====
await ok('住所・口座：管理者は読める', read(admin, `${O}/employees/E1/details/private`));
await ng('住所・口座：一般は読めない', read(general, `${O}/employees/E1/details/private`));
await ok('住所・口座：本人は読める', read(emp1, `${O}/employees/E1/details/private`));
await ng('住所・口座：ほかの従業員は読めない', read(emp2, `${O}/employees/E1/details/private`));

// ===== 扶養家族・標準報酬・給与 =====
await ok('扶養家族：本人は読める（特定被保険者の判定にも使う）', read(emp1, `${O}/employees/E1/dependents/d1`));
await ng('扶養家族：ほかの従業員は読めない', read(emp2, `${O}/employees/E1/dependents/d1`));
await ng('扶養家族：部外者は読めない', read(outsider, `${O}/employees/E1/dependents/d1`));
await ok('標準報酬：本人は読める', read(emp1, `${O}/employees/E1/remunerations/2026-04`));
await ok('給与：メンバーは読める', read(general, `${O}/employees/E1/payrolls/2026-11`));
await ng('給与：従業員のアカウントは読めない', read(emp1, `${O}/employees/E1/payrolls/2026-11`));
await ng('給与：一般は書けない', setDoc(doc(general, `${O}/employees/E1/payrolls/2026-12`), { cash: 1 }));

// ===== 変更履歴：管理者だけが読める。書き換え・削除はできない =====
await ok('変更履歴：管理者は読める', read(admin, `${O}/history/h1`));
await ng('変更履歴：一般は読めない', read(general, `${O}/history/h1`));
await ng('変更履歴：管理者でも消せない', deleteDoc(doc(admin, `${O}/history/h1`)));

// ===== マイナンバー：暗号化した番号は誰も読めない。状態と記録は管理者だけが読める。書くのは関数だけ =====
await ng('マイナンバー（暗号化した番号）：管理者でも読めない', read(admin, `${O}/myNumberVault/E1`));
await ng('マイナンバー（暗号化した番号）：本人も読めない', read(emp1, `${O}/myNumberVault/E1`));
await ok('マイナンバーの状態：管理者は読める', read(admin, `${O}/myNumberIndex/all`));
await ng('マイナンバーの状態：一般は読めない', read(general, `${O}/myNumberIndex/all`));
await ng('マイナンバーの状態：管理者でも書けない', setDoc(doc(admin, `${O}/myNumberIndex/all`), { people: {} }));
await ng('マイナンバーのアクセス記録：管理者でも書き換えられない', setDoc(doc(admin, `${O}/myNumberLogs/l1`), { action: 'none' }));

// ===== 組合の料率：管理者だけが書ける。形がちがえば書けない =====
const split = (employee, employer) => ({ employee, employer });
const rate = (from) => ({
  from,
  health: split(45000, 45000),
  care: split(8000, 8000),
  childSupport: split(1150, 1150),
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});
await ok('組合の料率：管理者は正しい形で作れる', setDoc(doc(admin, `${O}/kumiaiRates/2026-03`), rate('2026-03')));
await ng('組合の料率：一般は作れない', setDoc(doc(general, `${O}/kumiaiRates/2026-04`), rate('2026-04')));
await ng('組合の料率：文書の ID と適用開始月がちがえば作れない', setDoc(doc(admin, `${O}/kumiaiRates/2026-05`), rate('2026-06')));
await ng('組合の料率：余計な項目があれば作れない', setDoc(doc(admin, `${O}/kumiaiRates/2026-07`), { ...rate('2026-07'), extra: 1 }));
await ng('組合の料率：料率が範囲の外なら作れない', setDoc(doc(admin, `${O}/kumiaiRates/2026-08`), { ...rate('2026-08'), health: split(-1, 45000) }));
await ok('組合の料率：従業員本人は読める（マイページの保険料）', read(emp1, `${O}/kumiaiRates/2026-03`));
await ng('組合の料率：部外者は読めない', read(outsider, `${O}/kumiaiRates/2026-03`));

// ===== 給与の項目：分類の形 =====
const item = (category) => ({ name: '基本給', labels: [], category, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
await ok('給与の項目：管理者は作れる', setDoc(doc(admin, `${O}/payrollItems/i1`), item('base')));
await ng('給与の項目：知らない分類では作れない', setDoc(doc(admin, `${O}/payrollItems/i2`), item('bonus')));
await ng('給与の項目：一般は作れない', setDoc(doc(general, `${O}/payrollItems/i3`), item('base')));

// ===== ほかの事業所 =====
await ng('ほかの事業所：管理者でも、自分がメンバーでない事業所の従業員は読めない', read(admin, `${OTHER}/employees/X1`));

console.log(`\n${passed} OK / ${failed} NG`);
await testEnv.cleanup();
process.exit(failed > 0 ? 1 : 0);
