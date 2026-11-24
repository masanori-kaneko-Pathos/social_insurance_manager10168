// 給与の「項目を選んで出力」の目録（11/24）
// Angular・Firebase に依存しない純粋な関数
//
// 標準の形（PAYROLL_COLUMNS）は、今までの CSV（buildPayrollCsv）と同じ列・同じ書き方
// 見出しの名前も取り込みと同じなので、出したファイルをそのまま取り込みに使える

import { payTotal } from '../../../core/models/payroll';
import type { ExportColumn } from '../../../shared/export/export-table';
import { CsvEmployee, CsvLang, PAYROLL_HEADERS, PayrollColumn, payrollCells, PayrollExportRow } from './payroll-csv';

export interface PayrollExportEmployee extends CsvEmployee {
  lastNameKana?: string | null;
  firstNameKana?: string | null;
  org?: { departmentId: string | null } | null;
}

export type PayrollExportItem = PayrollExportRow<PayrollExportEmployee>;

export interface PayrollExportContext {
  lang: CsvLang;
  /** 翻訳（exportCols.payroll.○○・exportCols.group.○○） */
  t: (key: string) => string;
  /** 部署の ID → 名前（なければ空） */
  deptName: (id: string | null | undefined) => string;
}

export function payrollExportColumns(ctx: PayrollExportContext): ExportColumn<PayrollExportItem>[] {
  const { t, lang } = ctx;
  // 1行の文字は列ごとに何度も使うので、行ごとに1回だけ作る
  const cache = new WeakMap<PayrollExportItem, Record<PayrollColumn, string>>();
  const cells = (r: PayrollExportItem) => {
    let v = cache.get(r);
    if (!v) cache.set(r, (v = payrollCells(r, lang)));
    return v;
  };
  const ours = (group: string, key: PayrollColumn): ExportColumn<PayrollExportItem> => ({
    key,
    label: PAYROLL_HEADERS[lang][key],
    group: t(`exportCols.group.${group}`),
    value: (r) => cells(r)[key],
  });
  const extra = (group: string, key: string, value: (r: PayrollExportItem) => string): ExportColumn<PayrollExportItem> => ({
    key,
    label: t(`exportCols.payroll.${key}`),
    group: t(`exportCols.group.${group}`),
    value,
  });
  return [
    ours('person', 'employeeNumber'),
    ours('person', 'name'),
    extra('person', 'kana', (r) => [r.employee.lastNameKana, r.employee.firstNameKana].filter(Boolean).join(' ')),
    extra('person', 'department', (r) => ctx.deptName(r.employee.org?.departmentId)),
    ours('month', 'paidMonth'),
    ours('pay', 'cash'),
    ours('pay', 'fixed'),
    ours('pay', 'inKind'),
    // 報酬月額の材料（支払額＋現物。内訳なしの現物は支払額に入っている）
    extra('pay', 'payTotal', (r) => (r.saved ? String(payTotal(r.saved)) : '')),
    ours('pay', 'retro'),
    ours('pay', 'days'),
    ours('pay', 'absentDays'),
    ours('pay', 'hours'),
    ours('pay', 'prorated'),
    ours('pay', 'state'),
  ];
}
