// マイナンバー（個人番号）の状態。番号そのものは画面に保存しない（暗号化して関数だけが扱う）
// Firestore：offices/{o}/myNumberIndex/all の people.{従業員ID}、offices/{o}/employees/{e}/details/myNumber
// 家族（11/12）：myNumberIndex/all の family.{従業員ID}.{家族ID}、offices/{o}/employees/{e}/details/myNumberFamily

/** requested 提供を依頼中／submitted 本人が提出（チェック待ち）／returned 差し戻し中／registered 登録済み／refused 提供を受けられない */
export type MyNumberStatus = 'requested' | 'submitted' | 'returned' | 'registered' | 'refused';
export const MY_NUMBER_STATUSES: readonly MyNumberStatus[] = ['requested', 'submitted', 'returned', 'registered', 'refused'];

/** 確かめた本人確認書類（番号の確認＋身元の確認） */
export type MyNumberDocType = 'card' | 'noticeCard' | 'residentRecord' | 'other';
export const MY_NUMBER_DOC_TYPES: readonly MyNumberDocType[] = ['card', 'noticeCard', 'residentRecord', 'other'];

/** 家族の番号：本人確認をした人（会社／従業員）。配偶者（第3号）は会社が確認するのが原則 */
export type MyNumberVerifiedBy = 'employer' | 'employee';
export const MY_NUMBER_VERIFIED_BY: readonly MyNumberVerifiedBy[] = ['employer', 'employee'];

export type MyNumberAction = 'set' | 'request' | 'cancel' | 'approve' | 'return' | 'refuse' | 'dispose';

export interface MyNumberEntry {
  status: MyNumberStatus;
  docType: MyNumberDocType | null;
  /** 差し戻し・提供を受けられない理由 */
  note: string | null;
  by: 'admin' | 'employee';
  /** ISO の日時（一覧）。本人の文書では Timestamp */
  updatedAt: string;
  /** 家族だけ：本人確認をした人 */
  verifiedBy?: MyNumberVerifiedBy | null;
}

export type MyNumberLogAction = MyNumberAction | 'submit' | 'view' | 'export' | 'import';

export interface MyNumberLog {
  id: string;
  action: MyNumberLogAction;
  employeeId: string | null;
  /** 家族の番号の操作（従業員本人の分は null） */
  dependentId: string | null;
  count: number;
  uid: string;
  /** 操作した人の表示名（ログインのトークンから。なければ空） */
  name: string;
  at: Date | null;
}
