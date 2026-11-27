import { Timestamp } from 'firebase/firestore';

/**
 * 給与の項目：offices/{officeId}/payrollItems/{自動ID}（11/24）
 *
 * 給与明細の項目名（会社ごとに違う）と、アプリの分類（社会保険での扱い）を結ぶ。
 * 給与の実績には、明細の行（項目名・分類・金額）をそのまま写して持つので、
 * あとで項目の分類を変えても、保存済みの月の計算は変わらない（payroll.ts の PayrollLine）。
 *
 * - 事業所で登録していない名前は、アプリが持っているよくある名前（DEFAULT_PAYROLL_ITEMS）で分類する
 * - どちらにもない名前は「分類が決まっていない」。決めるまで保存できない
 */

/**
 * 分類
 * - base：基本給（月給・日給月給の人は毎月決まった額。時給・日給の人は月ごとに変わる額）
 * - fixedAllowance：固定的な手当（役付・住宅・家族・固定残業手当など）
 * - commute：通勤手当（定期代・月決めの額。固定的賃金として、運賃の改定・引っ越しによる額の変化を見つける）
 *   1日いくら×出勤日数の交通費は variable（出勤日数の増減は起算月にしない。単価の変更は人が足す。調査指摘事例集 事例4。11/25）
 * - variable：非固定的な手当（残業・休日・深夜・皆勤・歩合・固定残業の超過分など）
 * - deduction：欠勤・遅刻早退の控除（総支給額から引く。毎月決まった額は引く前で見る）
 * - retro：遡及支払額（前の月までの分。定時決定・随時改定の平均から除く）
 * - excluded：報酬にならないもの（出張旅費の精算・慶弔見舞金など。総支給額に入れない）
 */
export type PayrollItemCategory = 'base' | 'fixedAllowance' | 'commute' | 'variable' | 'deduction' | 'retro' | 'excluded';

export const PAYROLL_ITEM_CATEGORIES: readonly PayrollItemCategory[] = [
  'base',
  'fixedAllowance',
  'commute',
  'variable',
  'deduction',
  'retro',
  'excluded',
];

/** 毎月決まった額に数える分類（基本給は給与の形しだいなので入れない） */
export const FIXED_CATEGORIES: readonly PayrollItemCategory[] = ['fixedAllowance', 'commute'];

export interface PayrollItemDoc {
  name: string;
  /** CSVの見出し（給与ソフトの CSV の見出しなど。名前を変えたら古い名前もここに入る） */
  labels: string[];
  category: PayrollItemCategory;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PayrollItem extends PayrollItemDoc {
  id: string;
}

export type PayrollItemInput = Pick<PayrollItemDoc, 'name' | 'labels' | 'category'>;

/**
 * 給与の内訳のひな形：offices/{officeId}/payrollTemplates/default（11/24）
 * 内訳を入れ始めるときに並べる項目名の順。その人の前の月の内訳があれば、そちらを使う
 */
export interface PayrollTemplateDoc {
  names: string[];
  updatedAt: Timestamp;
}

/** 事業所のひな形がまだないときに並べる例 */
export const DEFAULT_TEMPLATE_NAMES: readonly string[] = ['基本給', '固定残業手当', '通勤手当'];

/**
 * よくある給与明細の項目名（事業所で登録していなくても、この名前なら分類が決まる）
 * 固定残業手当は固定的な手当（固定的賃金。超過分は別の項目で非固定的な手当）
 */
export const DEFAULT_PAYROLL_ITEMS: readonly PayrollItemInput[] = [
  { name: '基本給', labels: ['月給', '基本賃金', '本給', '時給', '日給', '役員報酬'], category: 'base' },
  { name: '役職手当', labels: ['役付手当', '管理職手当'], category: 'fixedAllowance' },
  { name: '職務手当', labels: ['職能手当', '職務給'], category: 'fixedAllowance' },
  { name: '資格手当', labels: [], category: 'fixedAllowance' },
  { name: '住宅手当', labels: [], category: 'fixedAllowance' },
  { name: '家族手当', labels: ['扶養手当'], category: 'fixedAllowance' },
  { name: '地域手当', labels: ['勤務地手当'], category: 'fixedAllowance' },
  { name: '固定残業手当', labels: ['固定残業代', '固定割増手当', 'みなし残業手当'], category: 'fixedAllowance' },
  // 明細で別の行に分かれることが多いものは、それぞれ独立した項目にする（分けたまま入れられるように。11/24）
  // 課税・非課税は社会保険の扱いに関係しない（どちらも報酬）
  { name: '通勤手当', labels: ['通勤費', '交通費'], category: 'commute' },
  { name: '非課税通勤手当', labels: ['通勤手当（非課税）'], category: 'commute' },
  { name: '課税通勤手当', labels: ['通勤手当（課税）'], category: 'commute' },
  { name: '時間外手当', labels: ['残業手当', '時間外勤務手当', '時間外労働手当'], category: 'variable' },
  { name: '法定内残業手当', labels: [], category: 'variable' },
  { name: '時間外手当（60時間超）', labels: ['時間外労働手当（60時間超過・追加割増分）', '60時間超残業手当'], category: 'variable' },
  { name: '休日出勤手当', labels: ['休日手当', '法定休日労働手当', '所定休日労働手当'], category: 'variable' },
  { name: '深夜手当', labels: ['深夜労働手当', '深夜勤務手当'], category: 'variable' },
  { name: '固定残業手当の超過分', labels: ['固定割増手当超過額', '固定残業代超過分'], category: 'variable' },
  { name: '皆勤手当', labels: ['精皆勤手当', '精勤手当'], category: 'variable' },
  { name: '歩合給', labels: ['インセンティブ', '能率給', '出来高給'], category: 'variable' },
  { name: '欠勤控除', labels: ['勤怠控除'], category: 'deduction' },
  { name: '遅刻早退控除', labels: [], category: 'deduction' },
  { name: '遡及支払額', labels: ['昇給差額', '差額支給'], category: 'retro' },
  { name: '出張旅費', labels: ['旅費', '出張手当（実費）'], category: 'excluded' },
  { name: '慶弔見舞金', labels: ['見舞金', '慶弔金'], category: 'excluded' },
];
