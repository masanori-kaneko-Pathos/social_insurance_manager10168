// マイナンバー（個人番号）の状態。番号そのものは画面に保存しない（暗号化して関数だけが扱う）
// Firestore：offices/{o}/myNumberIndex/all の people.{従業員ID}、offices/{o}/employees/{e}/details/myNumber

/** requested 提供を依頼中／submitted 本人が提出（チェック待ち）／returned 差し戻し中／registered 登録済み／refused 提供を受けられない */
export type MyNumberStatus = 'requested' | 'submitted' | 'returned' | 'registered' | 'refused';
export const MY_NUMBER_STATUSES: readonly MyNumberStatus[] = ['requested', 'submitted', 'returned', 'registered', 'refused'];

/** 確かめた本人確認書類（番号の確認＋身元の確認） */
export type MyNumberDocType = 'card' | 'noticeCard' | 'residentRecord' | 'other';
export const MY_NUMBER_DOC_TYPES: readonly MyNumberDocType[] = ['card', 'noticeCard', 'residentRecord', 'other'];

export type MyNumberAction = 'set' | 'request' | 'cancel' | 'approve' | 'return' | 'refuse' | 'dispose';

export interface MyNumberEntry {
  status: MyNumberStatus;
  docType: MyNumberDocType | null;
  /** 差し戻し・提供を受けられない理由 */
  note: string | null;
  by: 'admin' | 'employee';
  /** ISO の日時（一覧）。本人の文書では Timestamp */
  updatedAt: string;
}

export type MyNumberLogAction = MyNumberAction | 'submit' | 'view' | 'export' | 'import';

export interface MyNumberLog {
  id: string;
  action: MyNumberLogAction;
  employeeId: string | null;
  count: number;
  uid: string;
  /** 操作した人の表示名（ログインのトークンから。なければ空） */
  name: string;
  at: Date | null;
}
