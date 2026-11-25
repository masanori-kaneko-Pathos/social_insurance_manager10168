// 取り込み：登録済みの同じ人（社員番号・氏名・生年月日が同じ）の「CSVによる変更点」（11/25）
// Angular・Firebase に依存しない純粋な関数
//
// - 違うところを1行ずつ出し、行ごとに「変更する／変更しない」を選んでもらう
//   初期値：登録が空の項目・部署・休業を足す → 変更する。入力済みの値と違う → 変更しない（打ち間違い・別の人のことがある）
// - 計算・届に効く項目（入社日・退職日・契約・加入・報酬月額・申出日・登録と違う性別・一部だけ入っている外国籍の情報）は選べない。
//   「いつから」がないと随時改定・取得日・喪失日が決まらないので、従業員のページへのリンクを出す
// - 変更すると届が要るかもしれない項目は、FOLLOW_UPS に書く（住所 → 住所変更届、カナ → 氏名変更届、休業 → 申出書）。
//   表の案内と、保存のあとの To-do は、この表から出す。項目が増えたらここに1行足す

import type { ContactDoc, EmployeeFormInput, EmployeeOrg, ForeignDoc, Leave, RegisterDoc } from '../../../core/models/employee';
import { EMPLOYEE_COLUMNS, EmployeeColumn } from './employee-csv';
import { leaveText } from './employee-export';

// ===== 変更すると届が要るかもしれない項目 =====

/** 関連する届出（住所変更届・氏名変更（訂正）届・産前産後休業取得者申出書・育児休業等取得者申出書） */
export type FollowUp = 'address' | 'name' | 'maternity' | 'childcare';

/** 列 → 関連する届出（入力済みの値を変えたときだけ。初めて入れるのは「変わった」ではない） */
export const FOLLOW_UPS: Partial<Record<EmployeeColumn, FollowUp>> = {
  postalCode: 'address',
  address: 'address',
  lastNameKana: 'name',
  firstNameKana: 'name',
};

/** 休業の種類 → 関連する届出（介護休業・休職は、社会保険の届はない） */
function leaveFollowUp(l: Pick<Leave, 'kind'>): FollowUp | null {
  if (l.kind === 'maternity') return 'maternity';
  if (l.kind === 'childcare' || l.kind === 'paternity') return 'childcare';
  return null;
}

// ===== 変更点の表 =====

/** 列、休業（1件ずつ）、外国籍の情報（まだ何もない人に、国籍とローマ字をまとめて入れる） */
export type ChangeItem = EmployeeColumn | 'leave' | 'foreign';

export interface PersonChange {
  /** 1人の中で行を見分ける（列の名前。休業は 'leave:0'） */
  key: string;
  item: ChangeItem;
  saved: string;
  file: string;
  /** 変更する／変更しない を選べる。選べない行は、従業員のページへのリンク */
  selectable: boolean;
  /** 選べる行の初期値 */
  apply: boolean;
  /** 変更したときに関連する届出 */
  followUp: FollowUp | null;
  /** 選べない理由が「事業所の設定にない部署」 */
  unknownDepartment?: boolean;
  /** 休業の行：ファイルの何件目か */
  leaveIndex?: number;
}

/** いつでも選べる列（計算に効かない。変えても「いつから」は要らない） */
const SELECTABLE = new Set<EmployeeColumn>([
  'lastNameKana', 'firstNameKana', 'postalCode', 'address', 'insuredNumber', 'basicPensionNumber', 'department', 'jobType', 'history',
]);
const FOREIGN_COLUMNS: readonly EmployeeColumn[] = ['nationality', 'romanLastName', 'romanFirstName', 'romanMiddleName'];

/**
 * 比べない列：同じ人を見分ける項目、マイナンバー（別の窓口）、標準報酬の開始月（報酬月額と一緒に見る）、
 * 契約のメモ（契約ごとの自由記入）、休業の列（休業は1件ずつ別に比べる）
 */
const NOT_COMPARED = new Set<EmployeeColumn>([
  'employeeNumber', 'lastName', 'firstName', 'birthDate', 'myNumber', 'remunerationFrom', 'note',
  'leave1Kind', 'leave1Start', 'leave1End', 'leave1Birth', 'leave1Filed',
  'leave2Kind', 'leave2Start', 'leave2End', 'leave2Birth', 'leave2Filed',
]);
export const COMPARED_COLUMNS: readonly EmployeeColumn[] = EMPLOYEE_COLUMNS.filter((c) => !NOT_COMPARED.has(c));

export interface ChangeSource {
  /** ファイルの行の値（空の列は「書いていない」として比べない） */
  values: Partial<Record<EmployeeColumn, string>>;
  /** 書き出しと同じ書き方の行（employeeExportRow）。ファイルの値と登録の値 */
  fileRow: readonly string[];
  savedRow: readonly string[];
  fileLeaves: readonly Leave[];
  savedLeaves: readonly Leave[];
  /** 登録済みの人が退職しているか（退職の理由・事由の内容は、退職している人だけ選べる） */
  savedRetired: boolean;
  departmentUnknown: boolean;
}

const blank = (v: string | null | undefined) => !(v ?? '').trim();

/** 違うところを、表の並び（列の順 → 外国籍 → 休業）で */
export function samePersonChanges(x: ChangeSource): PersonChange[] {
  const at = (row: readonly string[], c: EmployeeColumn) => (row[EMPLOYEE_COLUMNS.indexOf(c)] ?? '').trim();
  // 外国籍の情報がまだ何もない人：国籍とローマ字は1行にまとめて選べる
  const foreignNew = !at(x.savedRow, 'nationality') && !!at(x.fileRow, 'nationality');
  const out: PersonChange[] = [];
  for (const c of COMPARED_COLUMNS) {
    if (blank(x.values[c])) continue;
    if (foreignNew && FOREIGN_COLUMNS.includes(c)) continue;
    const saved = at(x.savedRow, c);
    if (c === 'department' && x.departmentUnknown) {
      out.push({ key: c, item: c, saved, file: (x.values[c] ?? '').trim(), selectable: false, apply: false, followUp: null, unknownDepartment: true });
      continue;
    }
    const file = at(x.fileRow, c);
    if (saved === file) continue;
    const selectable =
      SELECTABLE.has(c) ||
      (c === 'sex' && !saved) ||
      ((c === 'retireReason' || c === 'retireDetail') && x.savedRetired);
    out.push({
      key: c,
      item: c,
      saved,
      file,
      selectable,
      apply: selectable && (!saved || c === 'department'),
      followUp: saved ? (FOLLOW_UPS[c] ?? null) : null,
    });
  }
  if (foreignNew) {
    const file = FOREIGN_COLUMNS.map((c) => at(x.fileRow, c)).filter((v) => v).join(' ');
    out.push({ key: 'foreign', item: 'foreign', saved: '', file, selectable: true, apply: true, followUp: null });
  }
  x.fileLeaves.forEach((l, i) => {
    if (x.savedLeaves.some((s) => s.kind === l.kind && s.start === l.start)) return;
    out.push({ key: `leave:${i}`, item: 'leave', saved: '', file: leaveText(l), selectable: true, apply: true, followUp: leaveFollowUp(l), leaveIndex: i });
  });
  return out;
}

// ===== 選んだ行から、保存するもの =====

export interface SamePersonSaved {
  sex: EmployeeFormInput['sex'];
  org?: EmployeeOrg | null;
  contact: ContactDoc;
  register: RegisterDoc;
  leaves: readonly Leave[];
}

export interface SamePersonFile {
  employee: EmployeeFormInput;
  leaves: readonly Leave[];
}

export interface SamePersonUpdate {
  /** 従業員の文書・鍵付きの文書に重ねる項目（まとまりは丸ごと。中は今の値に、選んだところだけ足したもの） */
  patch: Partial<
    Pick<
      EmployeeFormInput,
      'lastNameKana' | 'firstNameKana' | 'sex' | 'retireReason' | 'org' | 'contact' | 'register' | 'insuredNumber' | 'basicPensionNumber' | 'foreign'
    >
  >;
  /** 休業を足したときの、休業の全件（足さなければ null） */
  leaves: Leave[] | null;
  /** 変更した行の数 */
  count: number;
  /** 関連する届出（休業の申出書は To-do に計算で出る。住所・氏名は保存のときに宿題を残す） */
  followUps: FollowUp[];
}

/** 「変更する」を選んだ行（chosen）だけから、保存するものを作る。何もなければ null */
export function samePersonUpdate(saved: SamePersonSaved, file: SamePersonFile, chosen: readonly PersonChange[]): SamePersonUpdate | null {
  const rows = chosen.filter((c) => c.selectable);
  if (rows.length === 0) return null;
  const f = file.employee;
  const patch: SamePersonUpdate['patch'] = {};
  let contact: ContactDoc | null = null;
  let register: RegisterDoc | null = null;
  let org: EmployeeOrg | null = null;
  const orgNow = (): EmployeeOrg => org ?? saved.org ?? { departmentId: null, position: null, officer: null };
  const added: Leave[] = [];
  for (const c of rows) {
    switch (c.item) {
      case 'lastNameKana':
      case 'firstNameKana':
      case 'insuredNumber':
      case 'basicPensionNumber':
      case 'sex':
      case 'retireReason':
        (patch as Record<string, unknown>)[c.item] = f[c.item];
        break;
      case 'postalCode':
      case 'address':
        contact = { ...(contact ?? saved.contact), [c.item]: f.contact[c.item] };
        break;
      case 'history':
      case 'retireDetail':
        register = { ...(register ?? saved.register), [c.item]: f.register[c.item] };
        break;
      case 'department':
        org = { ...orgNow(), departmentId: f.org?.departmentId ?? null };
        break;
      case 'jobType':
        org = { ...orgNow(), jobType: f.org?.jobType ?? null };
        break;
      case 'foreign':
        patch.foreign = f.foreign as ForeignDoc | null;
        break;
      case 'leave':
        if (c.leaveIndex !== undefined && file.leaves[c.leaveIndex]) added.push(file.leaves[c.leaveIndex]);
        break;
    }
  }
  if (contact) patch.contact = contact;
  if (register) patch.register = register;
  if (org) patch.org = org;
  return {
    patch,
    leaves: added.length > 0 ? [...saved.leaves, ...added] : null,
    count: rows.length,
    followUps: rows.map((c) => c.followUp).filter((x): x is FollowUp => !!x),
  };
}

/** 選べない行を変更する場所（従業員のページのタブ。null ＝ 編集画面） */
export function changeTab(item: ChangeItem): 'employment' | 'insurance' | 'pay' | null {
  if (item === 'leave') return 'employment';
  if (['healthEnrolled', 'pensionEnrolled', 'optInDate', 'optOutDate'].includes(item)) return 'insurance';
  if (item === 'monthlyAmount') return 'pay';
  if (CONTRACT_COLUMNS.includes(item)) return 'employment';
  return null;
}

const CONTRACT_COLUMNS: readonly ChangeItem[] = [
  'employmentType', 'payType', 'weeklyHours', 'monthlyDays', 'hourlyWage', 'dailyWage', 'scheduledWage', 'expectedCash',
  'expectedInKind', 'periodEnd', 'renewal', 'student', 'minimumWageReduction', 'specialEmployment', 'renewalPrecedent', 'noExtensionAgreed',
];
