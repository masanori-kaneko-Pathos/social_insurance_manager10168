// 賞与の「項目を選んで出力」の目録（11/24）
// Angular・Firebase に依存しない純粋な関数
//
// 標準の形（BONUS_DEFAULT_KEYS）は、今までの書き出し（bonusExportTable）と同じ列・同じ書き方
// 計算できない人・免除の人は、金額の列を空にする（今までと同じ）

import type { ExportColumn } from '../../../shared/export/export-table';
import type { BonusExportInput } from './bonus-export';
import type { BonusRow } from './bonus-rows';
import { employeeYenOfPart } from './premium-core';
import { milliText } from './premium-csv';

export interface BonusExportItem extends BonusExportInput {
  row: Pick<
    BonusRow,
    'state' | 'result' | 'healthEmployeeYen' | 'pensionEmployeeYen' | 'premiumEmployerMilli' | 'premiumTotalMilli' | 'contributionMilli'
  >;
  employee: {
    lastNameKana?: string | null;
    firstNameKana?: string | null;
    org?: { departmentId: string | null } | null;
  };
}

export interface BonusExportContext {
  /** 翻訳（exportCols.bonus.○○・exportCols.group.○○） */
  t: (key: string) => string;
  deptName: (id: string | null | undefined) => string;
  paidDate: string;
}

/** 今までの書き出しの列（bonus.export.col と同じ並び） */
export const BONUS_DEFAULT_KEYS = [
  'number', 'name', 'paidDate', 'amount', 'standard', 'health', 'pension', 'employee', 'employer', 'note',
] as const;

/** 書き出す人（額の入っている人だけ。今までと同じ） */
export function bonusExportItems<T extends BonusExportInput>(people: readonly T[]): T[] {
  return people.filter((p) => p.amountYen > 0);
}

export function bonusExportColumns(ctx: BonusExportContext): ExportColumn<BonusExportItem>[] {
  const { t } = ctx;
  const ok = (p: BonusExportItem) => p.row.state === 'ok' && !!p.row.result;
  const money = (f: (p: BonusExportItem) => string) => (p: BonusExportItem) => (ok(p) ? f(p) : '');
  const part = (k: 'health' | 'care' | 'childSupport') =>
    money((p) => {
      const y = employeeYenOfPart(p.row.result, k);
      return y == null ? '' : String(y);
    });
  const col = (group: string, key: string, value: (p: BonusExportItem) => string): ExportColumn<BonusExportItem> => ({
    key,
    label: t(`exportCols.bonus.${key}`),
    group: t(`exportCols.group.${group}`),
    value,
  });
  return [
    col('person', 'number', (p) => p.employeeNumber ?? ''),
    col('person', 'name', (p) => p.name),
    col('person', 'kana', (p) => [p.employee.lastNameKana, p.employee.firstNameKana].filter(Boolean).join(' ')),
    col('person', 'department', (p) => ctx.deptName(p.employee.org?.departmentId)),
    col('bonus', 'paidDate', () => ctx.paidDate),
    col('bonus', 'amount', (p) => String(p.amountYen)),
    col('bonus', 'standard', (p) => (p.row.result ? String(p.row.result.standardBonus) : '')),
    // 上限を当てた後の額（健保は年度の累計573万円、厚年は1か月150万円。賞与支払届と見比べる用）
    col('bonus', 'healthBase', (p) => (p.row.result && p.row.result.healthStatus !== 'none' ? String(p.row.result.healthBase) : '')),
    col('bonus', 'pensionBase', (p) => (p.row.result?.pensionStatus === 'charged' ? String(p.row.result.pensionBase) : '')),
    col('employee', 'health', money((p) => String(p.row.healthEmployeeYen))),
    col('employee', 'healthPart', part('health')),
    col('employee', 'carePart', part('care')),
    col('employee', 'childSupportPart', part('childSupport')),
    col('employee', 'pension', money((p) => (p.row.result!.pensionStatus === 'charged' ? String(p.row.pensionEmployeeYen) : ''))),
    col('employee', 'employee', money((p) => String(p.row.result!.employeeYen))),
    col('employer', 'employer', money((p) => milliText(p.row.premiumEmployerMilli))),
    col('employer', 'total', money((p) => milliText(p.row.premiumTotalMilli))),
    col('employer', 'contribution', money((p) => (p.row.contributionMilli ? milliText(p.row.contributionMilli) : ''))),
    col('other', 'note', (p) => (ok(p) ? '' : p.note)),
  ];
}
