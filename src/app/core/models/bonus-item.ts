import { Timestamp } from 'firebase/firestore';

/**
 * 賞与の項目：offices/{officeId}/bonusItems/{自動ID}（11/19）
 *
 * 年4回以上かを数える「まとまり」と、社会保険の扱いを事業所で決めておく。
 * 支給（bonusPayments）は今までどおり nature に名前（取り込みの名前・項目の名前）を持ち、
 * 計算の前に、その名前が当たる項目に寄せる（premiums/logic/bonus-items.ts）。
 *
 * - 名前を変えたら、古い名前は labels に移す（過去の支給が当たり続けるように）
 * - 社会保険の扱いは、定時決定の年（Y）ごとの履歴で持つ。途中で変えると、もう出した届と合わなくなるので、
 *   変えたら「次の定時決定の年」から効く
 */

/** count：回数で判定（年3回以下は賞与、4回以上は報酬）／remuneration：年4回以上の賞与（報酬）／none：社会保険の対象外 */
export type BonusTreatment = 'count' | 'remuneration' | 'none';
export const BONUS_TREATMENTS: readonly BonusTreatment[] = ['count', 'remuneration', 'none'];

export interface BonusTreatmentPeriod {
  /** この定時決定の年から（最初の1つは 0 ＝ 最初から） */
  fromYear: number;
  treatment: BonusTreatment;
}

export interface BonusItemDoc {
  name: string;
  /** 取り込みの名前（給与ソフトの CSV に出てくる名前。名前を変えたら古い名前もここに入る） */
  labels: string[];
  /** 規程上の年間の回数（空でもよい。年4回以上の賞与の、最初の年の見込みに使う） */
  plannedCount: number | null;
  treatments: BonusTreatmentPeriod[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BonusItem extends BonusItemDoc {
  id: string;
}

export type BonusItemInput = Pick<BonusItemDoc, 'name' | 'labels' | 'plannedCount' | 'treatments'>;
