/**
 * 金額の計算と端数処理（整数だけで計算する）
 * 金額は 1/1000円 を 1 とする整数（Milli）、料率は 0.0001% を 1 とする整数（RateMicro）。
 */
import { CollectionMethod, Milli } from '../../../core/models/premium';
import { RateMicro } from '../../../core/models/rates';

const MILLI_PER_YEN = 1000;
const HALF_YEN: Milli = 500; // 50銭

function assertSafe(n: number, label: string): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(
      `${label}が正しくありません（0以上の整数で、正確に扱える範囲であること）: ${n}`,
    );
  }
}

/**
 * 金額（円）× 料率 → Milli
 * 金額は1,000円単位であること（標準報酬月額・標準賞与額）。割り算をしないので誤差が出ない。
 */
export function milliOf(baseYen: number, rate: RateMicro): Milli {
  assertSafe(baseYen, '金額');
  assertSafe(rate, '料率');
  if (baseYen % 1000 !== 0) throw new Error(`金額は1,000円単位であること: ${baseYen}`);
  const result = (baseYen / 1000) * rate;
  assertSafe(result, '計算結果');
  return result;
}

/** 円 → Milli */
export function yenToMilli(yen: number): Milli {
  assertSafe(yen, '金額');
  return yen * MILLI_PER_YEN;
}

/**
 * 本人負担の端数処理（Milli → 円）
 * - payroll（給与・賞与から控除）：50銭以下は切り捨て、50銭を超えたら切り上げ
 * - cash（本人が現金で払う）　　　：50銭未満は切り捨て、50銭以上は切り上げ
 * 割り算は「割り切れる形」にしてから行う（商と余りに分ける）。
 */
export function roundEmployee(milli: Milli, method: CollectionMethod): number {
  assertSafe(milli, '本人負担');
  const rest = milli % MILLI_PER_YEN; // 1円未満の部分
  const yen = (milli - rest) / MILLI_PER_YEN; // 割り切れる割り算なので正確
  const roundUp = method === 'payroll' ? rest > HALF_YEN : rest >= HALF_YEN;
  return roundUp ? yen + 1 : yen;
}

/** 事業所の納付額：合計の1円未満を切り捨て（Milli → 円） */
export function floorYen(milli: Milli): number {
  assertSafe(milli, '合計');
  return (milli - (milli % MILLI_PER_YEN)) / MILLI_PER_YEN;
}

/** Milli を表示用の文字列に（29550400 → '29,550.4'、29550000 → '29,550'） */
export function formatMilli(milli: Milli): string {
  const sign = milli < 0 ? '-' : '';
  const abs = Math.abs(milli);
  const rest = abs % MILLI_PER_YEN;
  const yen = (abs - rest) / MILLI_PER_YEN;
  const frac = String(rest).padStart(3, '0').replace(/0+$/, '');
  return `${sign}${yen.toLocaleString('ja-JP')}${frac ? '.' + frac : ''}`;
}
