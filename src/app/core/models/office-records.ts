import { Timestamp } from 'firebase/firestore';
import { OfficeRole } from './office';

/**
 * 事業所の下の、そのほかの入れ物
 * - 招待（従業員のマイページ・一般ユーザー）
 * - 依頼と申請（カタログ【4】【1】）
 * - 受信箱（従業員のマイページ）
 * - 届出の記録
 * - 「やること」の確認済み
 */

// ===== 招待 offices/{o}/invites/{コード} =====

export type InviteKind = 'employee' | 'member';
export const INVITE_KINDS: readonly InviteKind[] = ['employee', 'member'];

export interface InviteDoc {
  code: string; // ＝ ドキュメントID（推測されにくい長い文字）
  kind: InviteKind;
  employeeId: string | null; // 従業員の招待のとき
  role: OfficeRole | null; // 一般ユーザーの招待のとき
  email: string | null;
  expiresAt: Timestamp;
  usedBy: string | null; // 使った人の uid
  usedAt: Timestamp | null;
  createdBy: string;
  createdAt: Timestamp;
}

export type Invite = InviteDoc;

// ===== 依頼と申請 offices/{o}/requests/{自動ID} =====

export type RequestType = 'onboarding' | 'change' | 'custom'; // 入社前の手続き・身上の変更・自由
export const REQUEST_TYPES: readonly RequestType[] = ['onboarding', 'change', 'custom'];

export type RequestDirection = 'toEmployee' | 'fromEmployee'; // 管理者からの依頼／従業員からの申請
export const REQUEST_DIRECTIONS: readonly RequestDirection[] = ['toEmployee', 'fromEmployee'];

export type RequestStatus = 'open' | 'submitted' | 'approved' | 'rejected';
export const REQUEST_STATUSES: readonly RequestStatus[] = ['open', 'submitted', 'approved', 'rejected'];

export type QuestionType = 'text' | 'date' | 'number' | 'choice' | 'yesno';
export const QUESTION_TYPES: readonly QuestionType[] = ['text', 'date', 'number', 'choice', 'yesno'];

export interface RequestQuestion {
  id: string;
  label: string;
  type: QuestionType;
  choices: string[] | null;
  required: boolean;
  /** 承認したら、どの項目に書くか（'contact.address' など。null ＝ 書かない） */
  field: string | null;
}

export interface RequestDoc {
  type: RequestType;
  direction: RequestDirection;
  employeeId: string;
  title: string;
  questions: RequestQuestion[];
  answers: Record<string, string>; // 質問のID → 答え
  status: RequestStatus;
  comment: string | null; // 差し戻し・却下の理由
  dueDate: string | null;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface EmployeeRequest extends RequestDoc {
  id: string;
}

// ===== 受信箱 offices/{o}/notifications/{自動ID} =====

export type NotificationKind = 'request' | 'notice';
export const NOTIFICATION_KINDS: readonly NotificationKind[] = ['request', 'notice'];

export interface NotificationDoc {
  employeeId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null; // 開く画面（依頼のIDなど）
  readAt: Timestamp | null;
  createdAt: Timestamp;
}

export interface InboxNotification extends NotificationDoc {
  id: string;
}

// ===== 届出の記録 offices/{o}/filings/{自動ID} =====

export type FilingType =
  | 'acquisition' // 資格取得届
  | 'loss' // 資格喪失届
  | 'regular' // 算定基礎届
  | 'irregular' // 月額変更届
  | 'bonus' // 賞与支払届
  | 'dependent' // 被扶養者（異動）届
  | 'leave' // 産休・育休の申出書
  | 'category'; // 被保険者区分変更届
export const FILING_TYPES: readonly FilingType[] = [
  'acquisition',
  'loss',
  'regular',
  'irregular',
  'bonus',
  'dependent',
  'leave',
  'category',
];

export interface FilingDoc {
  type: FilingType;
  employeeIds: string[];
  /** 何の届けか（算定基礎届なら '2026'、月額変更届なら改定月 など） */
  subject: string | null;
  submittedOn: string | null; // 提出した日（作っただけなら null）
  note: string | null;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Filing extends FilingDoc {
  id: string;
}

// ===== 「やること」の確認済み offices/{o}/todoDismissals/{カードの鍵} =====

export interface TodoDismissalDoc {
  key: string; // 'age:{employeeId}:70' など（＝ ドキュメントID）
  until: string | null; // この日まで出さない（null ＝ ずっと）
  dismissedBy: string;
  createdAt: Timestamp;
}

export type TodoDismissal = TodoDismissalDoc;
