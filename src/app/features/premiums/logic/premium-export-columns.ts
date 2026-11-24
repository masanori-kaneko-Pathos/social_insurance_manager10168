// 保険料一覧の「項目を選んで出力」の目録（11/24）
// Angular・Firebase に依存しない純粋な関数。見出しの名前は翻訳済みの文字を t で受け取る
//
// 標準の形（PREMIUM_DEFAULT_KEYS）は、今までの CSV（premium-csv.ts）の人の行と同じ列・同じ書き方
// 計算できない人・免除の人は、金額の列を空にする（今までの CSV と同じ）

import type { ExportColumn } from '../../../shared/export/export-table';
import { employeeYenOfPart } from './premium-core';
import { milliText } from './premium-csv';
import type { PremiumRow } from './premium-rows';

export interface PremiumExportRow extends PremiumRow {
  employee: {
    employeeNumber?: string | null;
    lastName: string;
    firstName: string;
    lastNameKana?: string | null;
    firstNameKana?: string | null;
    org?: { departmentId: string | null } | null;
  };
}

export interface PremiumExportContext {
  /** 翻訳（exportCols.premium.○○・exportCols.group.○○） */
  t: (key: string) => string;
  /** 部署の ID → 名前（なければ空） */
  deptName: (id: string | null | undefined) => string;
  /** 備考（計算できない理由・免除など。画面と同じ文言） */
  note: (row: PremiumExportRow) => string;
  /** 何月分 */
  month: string;
  /** 控除する給与の月 */
  payMonth: string;
}

export const PREMIUM_DEFAULT_KEYS = [
  'employeeNumber', 'name', 'healthGrade', 'healthStandard', 'care', 'pensionGrade', 'pensionStandard',
  'healthEmployee', 'pensionEmployee', 'employeeTotal', 'employer', 'total', 'contribution', 'note',
] as const;

export function premiumExportColumns(ctx: PremiumExportContext): ExportColumn<PremiumExportRow>[] {
  const { t } = ctx;
  const ok = (r: PremiumExportRow) => r.state === 'ok';
  const money = (f: (r: PremiumExportRow) => string) => (r: PremiumExportRow) => (ok(r) ? f(r) : '');
  const part = (p: 'health' | 'care' | 'childSupport') =>
    money((r) => {
      const y = employeeYenOfPart(r.result, p);
      return y == null ? '' : String(y);
    });
  const col = (group: string, key: string, value: (r: PremiumExportRow) => string): ExportColumn<PremiumExportRow> => ({
    key,
    label: t(`exportCols.premium.${key}`),
    group: t(`exportCols.group.${group}`),
    value,
  });
  return [
    col('person', 'employeeNumber', (r) => r.employee.employeeNumber ?? ''),
    col('person', 'name', (r) => `${r.employee.lastName} ${r.employee.firstName}`),
    col('person', 'kana', (r) => [r.employee.lastNameKana, r.employee.firstNameKana].filter(Boolean).join(' ')),
    col('person', 'department', (r) => ctx.deptName(r.employee.org?.departmentId)),
    col('month', 'month', () => ctx.month),
    col('month', 'payMonth', () => ctx.payMonth),
    col('standard', 'healthGrade', (r) => (r.health ? String(r.health.grade) : '')),
    col('standard', 'healthStandard', (r) => (r.health ? String(r.health.standard) : '')),
    col('standard', 'care', (r) => (r.care ? '1' : '')),
    col('standard', 'pensionGrade', (r) => (r.pension ? String(r.pension.grade) : '')),
    col('standard', 'pensionStandard', (r) => (r.pension ? String(r.pension.standard) : '')),
    col('employee', 'healthEmployee', money((r) => String(r.healthEmployeeYen))),
    col('employee', 'healthPart', part('health')),
    col('employee', 'carePart', part('care')),
    col('employee', 'childSupportPart', part('childSupport')),
    col('employee', 'pensionEmployee', money((r) => (r.pension ? String(r.pensionEmployeeYen) : ''))),
    col('employee', 'employeeTotal', money((r) => String(r.result?.employeeYen ?? 0))),
    col('employer', 'employer', money((r) => milliText(r.premiumEmployerMilli))),
    col('employer', 'total', money((r) => milliText(r.premiumTotalMilli))),
    col('employer', 'contribution', money((r) => (r.contributionMilli ? milliText(r.contributionMilli) : ''))),
    col('other', 'note', (r) => ctx.note(r)),
  ];
}
