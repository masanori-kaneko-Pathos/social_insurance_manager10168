import { Timestamp } from 'firebase/firestore';

// 届出の宿題：offices/{officeId}/filingTasks/{自動ID}
//
// 今の To-do は「今ある事実」から毎回計算している（入社日・契約・年齢など）。
// ところが「事業所の名前を変えた」「住所が変わった」は変わった瞬間の出来事で、保存されるのは変わったあとの値だけ。
// あとから計算しても「変わった」ことはわからないので、出来事のときにメモを1枚残す（11/12）。
// 消さずに done で残すので、「いつ何の届を出したか」の記録にもなる。

/**
 * - officeNameAddress：適用事業所名称／所在地変更（訂正）届（事実発生から5日以内）
 * - officeRelation：事業所関係変更（訂正）届（同じく5日以内）
 * - address：被保険者住所変更届（マイナンバーと基礎年金番号の紐づけがない人・海外居住者など。速やかに）
 * - addressKumiai：組合健保の事業所で住所が変わった（組合の決まりを確かめる）
 * - name：被保険者氏名変更（訂正）届（マイナンバーと基礎年金番号が結びついていない人・協会けんぽの健保だけの人など。速やかに）
 * - dependentChange：家族が増えた・減った（マイページの申請）→ 被扶養者（異動）届を確かめる（事実発生から5日以内）
 */
export type FilingTaskKind = 'officeNameAddress' | 'officeRelation' | 'address' | 'addressKumiai' | 'name' | 'dependentChange';
export const FILING_TASK_KINDS: readonly FilingTaskKind[] = [
  'officeNameAddress',
  'officeRelation',
  'address',
  'addressKumiai',
  'name',
  'dependentChange',
];

export type FilingTaskStatus = 'open' | 'done';

export interface FilingTaskInput {
  kind: FilingTaskKind;
  /** 人に関係するものだけ（事業所のものは null） */
  employeeId: string | null;
  /** 変わった日（'YYYY-MM-DD'）。期限はこの日を1日目に数える */
  factDate: string;
  /** 変わった項目の名前（文に出す。値そのものは入れない） */
  fields: string[];
}

export interface FilingTaskDoc extends FilingTaskInput {
  status: FilingTaskStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** 「届を出した」「確認した」を押した日時 */
  doneAt: Timestamp | null;
}

export interface FilingTask extends FilingTaskDoc {
  id: string;
}
