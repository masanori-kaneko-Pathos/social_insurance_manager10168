import { BonusRow } from './bonus-rows';
import { milliText } from './premium-csv';

/** 書き出す1人分（画面の行から作る） */
export interface BonusExportInput {
  employeeNumber: string | null;
  name: string;
  amountYen: number;
  row: Pick<BonusRow, 'state' | 'result' | 'healthEmployeeYen' | 'pensionEmployeeYen' | 'premiumEmployerMilli'>;
  /** 計算できなかった・免除などの理由（画面の言葉） */
  note: string;
}

/**
 * 賞与の書き出し（11/18）：給与ソフトに渡す「社会保険の本人負担」まで
 * 差引支給額は出さない（雇用保険・所得税はこのアプリの外。天引きの計算は給与ソフト）
 * - 列：社員番号・氏名・支払日・賞与額・標準賞与額・健康保険等（本人）・厚生年金保険（本人）・本人負担の合計・会社負担（目安）・備考
 * - 額の入っている人だけ。数字はカンマなし（Excel でそのまま計算できる）。会社負担は1人ごとの目安なので銭まで
 * - 厚年がかからない人（70歳以上など）は厚年の欄を空にする
 */
export function bonusExportTable(
  headers: readonly string[],
  paidDate: string,
  people: readonly BonusExportInput[],
): string[][] {
  const out: string[][] = [[...headers]];
  for (const p of people) {
    if (p.amountYen <= 0) continue;
    const r = p.row;
    const ok = r.state === 'ok' && !!r.result;
    const standard = r.result ? String(r.result.standardBonus) : '';
    out.push([
      p.employeeNumber ?? '',
      p.name,
      paidDate,
      String(p.amountYen),
      standard,
      ok ? String(r.healthEmployeeYen) : '',
      ok && r.result!.pensionStatus === 'charged' ? String(r.pensionEmployeeYen) : '',
      ok ? String(r.result!.employeeYen) : '',
      ok ? milliText(r.premiumEmployerMilli) : '',
      ok ? '' : p.note,
    ]);
  }
  return out;
}
