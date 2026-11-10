// To-do をその場で片づける窓（資格取得届・資格喪失届・区分変更届）の中身
// Angular・Firebase に依存しない純粋な関数：どの窓を、どの初期値で開くか／入力のチェック／保存する形
//
// 窓は届書1枚に合わせる
//   acquire ：資格取得届（取得日・健保と厚年・報酬月額と等級 → 資格取得時決定の標準報酬）
//   loss    ：資格喪失届（喪失日・健保と厚年・喪失の原因）
//   category：被保険者区分変更届（提出日だけ。届出の記録と確認済みを残す）

import type { EnrollmentDoc, LossReason } from '../../../core/models/employee';
import type { FilingType } from '../../../core/models/office-records';
import type { GradeTableDoc } from '../../../core/models/rates';
import type { RemunerationInput } from '../../../core/models/remuneration';
import { addDays, DATE_RE, DateStr, toYearMonth } from '../../../shared/utils/date';
import { CertificateLike, exemptOn } from '../../employees/logic/agreement';
import { contractAt } from '../../employees/logic/contract-form-model';
import { ageReachDate, birthdayAt } from '../../employees/logic/coverage';
import { decideStandard, parseYen, pickGradeTable } from '../../rates/logic/grade';
import { BoardItem } from './todo-board';

export type ActionMode = 'acquire' | 'loss' | 'category';

/** 窓で使う従業員の項目 */
export interface ActionPerson {
  id: string;
  birthDate: DateStr;
  hireDate: DateStr;
  retireDate: DateStr | null;
  health: EnrollmentDoc;
  pension: EnrollmentDoc;
  certificate: CertificateLike | null;
}

/** 見込みの報酬月額を出すための契約の項目 */
export interface ActionContract {
  from: DateStr;
  expectedCash: number;
  expectedInKind: number;
}

export interface Plans {
  health: boolean;
  pension: boolean;
}

/** どの窓を、何の初期値で開くか */
export interface ActionRequest {
  mode: ActionMode;
  employeeId: string;
  /** 取得日・喪失日・区分が変わる日 */
  date: DateStr;
  /** 選べる保険（acquire：まだ入っていない保険／loss：入っている保険） */
  plans: Plans;
  reason: LossReason | null;
  /** 見込みの報酬月額（契約から。契約がなければ null） */
  expected: number | null;
  /** 保存と一緒に確認済みにする鍵（年齢到達・区分変更届） */
  dismissKey: string | null;
}

// ===== 1. どの窓を開くか =====

function enrolledOn(e: EnrollmentDoc, date: DateStr): boolean {
  return e.enrolled && !!e.acquiredDate && e.acquiredDate <= date && (!e.lostDate || e.lostDate > date);
}

/** その日に取得できる保険（協定で免除されず、年齢で外れておらず、まだ入っていない） */
function acquirable(p: ActionPerson, date: DateStr): Plans {
  const ex = exemptOn(p.certificate, date);
  return {
    health: !ex.health && date < birthdayAt(p.birthDate, 75) && !enrolledOn(p.health, date),
    pension: !ex.pension && date < ageReachDate(p.birthDate, 70) && !enrolledOn(p.pension, date),
  };
}

/** その日の前日まで入っている保険（その日に喪失させられる保険） */
function losable(p: ActionPerson, date: DateStr): Plans {
  const prev = addDays(date, -1);
  return { health: enrolledOn(p.health, prev), pension: enrolledOn(p.pension, prev) };
}

function expectedAt(contracts: readonly ActionContract[], date: DateStr): number | null {
  const c = contractAt([...contracts], date);
  return c ? c.expectedCash + c.expectedInKind : null;
}

/** To-do の1件から、開く窓を決める（窓がない種類は null） */
export function actionFor(
  item: BoardItem,
  p: ActionPerson,
  contracts: readonly ActionContract[],
  today: DateStr,
): ActionRequest | null {
  const base = { employeeId: p.id, reason: null, expected: null, dismissKey: null };
  const acquire = (date: DateStr): ActionRequest => ({
    ...base,
    mode: 'acquire',
    date,
    plans: acquirable(p, date),
    expected: expectedAt(contracts, date),
  });
  const loss = (date: DateStr, reason: LossReason, plans = losable(p, date)): ActionRequest => ({
    ...base,
    mode: 'loss',
    date,
    plans,
    reason,
  });

  const t = item.todo;
  switch (item.kind) {
    case 'acquire':
    case 'certificateEnd':
      return acquire(t?.date ?? today);
    case 'upcoming': {
      const date = t?.date ?? today;
      const toInsured = !!t?.next && t.next.category !== 'excluded' && t.next.category !== 'unknown';
      return toInsured ? acquire(date) : loss(date, 'retire');
    }
    case 'lose':
      return loss(p.retireDate ? addDays(p.retireDate, 1) : today, 'retire');
    case 'agreement': {
      // 協定で免除される保険だけ。喪失日は証明書の始まる日
      // 証明書が取得日より前から効いていれば、取得日（＝資格を取らなかった扱い。取得の取消）
      const cert = p.certificate?.from ?? today;
      const acquired = [p.health, p.pension]
        .filter((en) => en.enrolled && en.acquiredDate)
        .map((en) => en.acquiredDate!)
        .sort()[0];
      const date = acquired && acquired > cert ? acquired : cert;
      const ex = exemptOn(p.certificate, date);
      const on = { health: enrolledOn(p.health, date), pension: enrolledOn(p.pension, date) };
      return loss(date, 'agreement', { health: ex.health && on.health, pension: ex.pension && on.pension });
    }
    case 'categoryChange':
      return { ...base, mode: 'category', date: t?.date ?? today, plans: { health: false, pension: false }, dismissKey: item.key };
    case 'age':
      if (item.age?.age !== 75) return null; // 40・60・65・70歳は「確認した」だけ
      return {
        ...loss(item.age.birthday, 'age75', { health: losable(p, item.age.birthday).health, pension: false }),
        dismissKey: item.key,
      };
    default:
      return null;
  }
}

// ===== 2. 窓の入力 =====

export interface ActionFormValue {
  date: string;
  health: boolean;
  pension: boolean;
  reason: LossReason;
  amount: string; // 報酬月額（acquire）
  healthGrade: string;
  pensionGrade: string;
  submittedOn: string; // 提出した日（空ならまだ）
}

export function actionForm(r: ActionRequest, today: DateStr): ActionFormValue {
  return {
    date: r.date,
    health: r.plans.health,
    pension: r.plans.pension,
    reason: r.reason ?? 'retire',
    amount: r.expected !== null ? String(r.expected) : '',
    healthGrade: '',
    pensionGrade: '',
    submittedOn: today,
  };
}

/** 報酬月額から、その月の等級の候補（等級表や金額がなければ空） */
export function autoGrades(
  tables: readonly GradeTableDoc[],
  date: string,
  amount: string,
): { health: string; pension: string } {
  const yen = parseYen(amount);
  if (yen === null || !DATE_RE.test(date)) return { health: '', pension: '' };
  const d = decideStandard([...tables], toYearMonth(date), yen);
  return { health: d.health ? String(d.health.grade) : '', pension: d.pension ? String(d.pension.grade) : '' };
}

export type ActionError =
  | 'date' // 日付の形
  | 'beforeHire' // 取得日が入社日より前
  | 'beforeAcquired' // 喪失日が取得日以前
  | 'noPlan' // 健保・厚年のどちらも選んでいない
  | 'amount' // 報酬月額が読めない
  | 'grade' // 等級を選んでいない（等級表にない）
  | 'submittedOn'; // 提出日の形

export function actionErrors(
  v: ActionFormValue,
  r: ActionRequest,
  p: ActionPerson,
  tables: readonly GradeTableDoc[],
): Partial<Record<keyof ActionFormValue, ActionError>> {
  const e: Partial<Record<keyof ActionFormValue, ActionError>> = {};
  if (v.submittedOn !== '' && !DATE_RE.test(v.submittedOn)) e.submittedOn = 'submittedOn';
  if (r.mode === 'category') return e;

  if (!DATE_RE.test(v.date)) e.date = 'date';
  if (!v.health && !v.pension) e.health = 'noPlan';
  if (e.date) return e;

  if (r.mode === 'acquire') {
    if (v.date < p.hireDate) e.date = 'beforeHire';
    if (parseYen(v.amount) === null) e.amount = 'amount';
    const month = toYearMonth(v.date);
    const has = (kind: 'health' | 'pension', g: string) =>
      !!pickGradeTable([...tables], kind, month)?.grades.some((row) => String(row.grade) === g);
    if (!has('health', v.healthGrade) || !has('pension', v.pensionGrade)) e.healthGrade = 'grade';
  } else {
    // 協定は取得日と同じ日も受け付ける（資格を取らなかった扱い）。ほかは取得日より後
    const before = (en: EnrollmentDoc) =>
      !!en.acquiredDate &&
      (v.reason === 'agreement' ? v.date < en.acquiredDate : v.date <= en.acquiredDate);
    if ((v.health && before(p.health)) || (v.pension && before(p.pension))) e.date = 'beforeAcquired';
  }
  return e;
}

// ===== 3. 保存する形 =====

export interface ActionSave {
  /** 書き換えた加入（区分変更届は null ＝ 従業員の文書は書かない） */
  enrollment: { health: EnrollmentDoc; pension: EnrollmentDoc } | null;
  /** 資格取得時決定の標準報酬（その月の標準報酬がもうあれば null ＝ 上書きしない） */
  remuneration: RemunerationInput | null;
  filing: { type: FilingType; subject: string; submittedOn: string | null };
}

const FILING_OF: Record<ActionMode, FilingType> = { acquire: 'acquisition', loss: 'loss', category: 'category' };

/** 入力から保存する形を作る（チェックを通ったあとに呼ぶ。等級が等級表にないときは null） */
export function buildSave(
  v: ActionFormValue,
  r: ActionRequest,
  p: ActionPerson,
  tables: readonly GradeTableDoc[],
  savedMonths: readonly string[],
): ActionSave | null {
  const filing = { type: FILING_OF[r.mode], subject: v.date, submittedOn: v.submittedOn || null };
  if (r.mode === 'category') return { enrollment: null, remuneration: null, filing };

  const plain = (en: EnrollmentDoc): EnrollmentDoc => ({
    enrolled: en.enrolled,
    acquiredDate: en.acquiredDate,
    lostDate: en.lostDate,
    lossReason: en.lossReason ?? null,
  });

  if (r.mode === 'loss') {
    const lose = (en: EnrollmentDoc, on: boolean): EnrollmentDoc =>
      on ? { ...plain(en), lostDate: v.date, lossReason: v.reason } : plain(en);
    return {
      enrollment: { health: lose(p.health, v.health), pension: lose(p.pension, v.pension) },
      remuneration: null,
      filing,
    };
  }

  // acquire：先に入っていた喪失日は、取得日より後のときだけ残す
  const gain = (en: EnrollmentDoc, on: boolean): EnrollmentDoc => {
    if (!on) return plain(en);
    const keep = !!en.lostDate && en.lostDate > v.date;
    return {
      enrolled: true,
      acquiredDate: v.date,
      lostDate: keep ? en.lostDate : null,
      lossReason: keep ? (en.lossReason ?? null) : null,
    };
  };
  const month = toYearMonth(v.date);
  let remuneration: RemunerationInput | null = null;
  if (!savedMonths.includes(month)) {
    const row = (kind: 'health' | 'pension', g: string) =>
      pickGradeTable([...tables], kind, month)?.grades.find((x) => String(x.grade) === g) ?? null;
    const h = row('health', v.healthGrade);
    const pe = row('pension', v.pensionGrade);
    const amount = parseYen(v.amount);
    if (!h || !pe || amount === null) return null;
    remuneration = {
      from: month,
      reason: 'acquisition',
      monthlyAmount: amount,
      health: { grade: h.grade, standard: h.standard },
      pension: { grade: pe.grade, standard: pe.standard },
    };
  }
  return {
    enrollment: { health: gain(p.health, v.health), pension: gain(p.pension, v.pension) },
    remuneration,
    filing,
  };
}
