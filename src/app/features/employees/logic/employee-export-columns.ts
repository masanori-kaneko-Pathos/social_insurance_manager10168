// 従業員一覧の「項目を選んで出力」の目録（11/24）
// Angular・Firebase に依存しない純粋な関数
//
// - 値の書き方は、今までの書き出し（employee-export.ts。取り込みと同じ形）をそのまま使う。標準の形はその列の順（マイナンバーは除く）
// - 見出しの名前は取り込みの見出しと同じ（日本語）。出したファイルをそのまま取り込みにも使えるように
// - 足した項目：基準日の年齢、基準日の健保・厚年の標準報酬月額

import type { ExportColumn } from '../../../shared/export/export-table';
import { ageAt } from '../../../shared/utils/date';
import { EMPLOYEE_COLUMNS, EMPLOYEE_CSV_HEADERS, EmployeeColumn } from './employee-csv';
import { EmployeeExportItem, employeeExportRow } from './employee-export';

/** 目録の1行：書き出しの材料と、基準日 */
export interface EmployeeExportCtx {
  t: (key: string) => string;
  deptName: (id: string) => string | null;
  /** 基準日（一覧の「基準日」） */
  asOf: string;
}

/** 列 → まとまり */
function groupOf(k: EmployeeColumn): string {
  if (k.startsWith('leave')) return 'leave';
  if (['nationality', 'romanLastName', 'romanFirstName', 'romanMiddleName'].includes(k)) return 'foreign';
  if (['department', 'note'].includes(k)) return 'other';
  const i = EMPLOYEE_COLUMNS.indexOf(k);
  if (i < EMPLOYEE_COLUMNS.indexOf('hireDate')) return 'person';
  if (i < EMPLOYEE_COLUMNS.indexOf('employmentType')) return 'enrollment';
  return 'contract';
}

/** 標準の形：今までの書き出しの列（マイナンバーは出さない） */
export const EMPLOYEE_DEFAULT_KEYS: readonly string[] = EMPLOYEE_COLUMNS.filter((k) => k !== 'myNumber');

export function employeeExportColumns(ctx: EmployeeExportCtx): ExportColumn<EmployeeExportItem>[] {
  // 1人の行は一度だけ作って、列ごとに取り出す
  const cache = new WeakMap<EmployeeExportItem, string[]>();
  const rowOf = (x: EmployeeExportItem) => {
    let r = cache.get(x);
    if (!r) {
      r = employeeExportRow(x, ctx.deptName);
      cache.set(x, r);
    }
    return r;
  };
  const month = ctx.asOf.slice(0, 7);
  type WithStd = { from: string; health?: { standard: number }; pension?: { standard: number } };
  /** 基準日の月に効いている標準報酬月額（標準報酬の履歴の、その月以前でいちばん新しい行） */
  const std = (x: EmployeeExportItem, part: 'health' | 'pension') => {
    let hit: WithStd | null = null;
    for (const r of x.remunerations as readonly WithStd[]) if (r.from <= month && (!hit || r.from > hit.from)) hit = r;
    const v = hit?.[part]?.standard;
    return v == null ? '' : String(v);
  };
  const g = (name: string) => ctx.t(`exportCols.group.${name}`);
  const base: ExportColumn<EmployeeExportItem>[] = EMPLOYEE_DEFAULT_KEYS.map((k) => {
    const i = EMPLOYEE_COLUMNS.indexOf(k as EmployeeColumn);
    return { key: k, label: EMPLOYEE_CSV_HEADERS[k as EmployeeColumn], group: g(groupOf(k as EmployeeColumn)), value: (x) => rowOf(x)[i] };
  });
  const extra: ExportColumn<EmployeeExportItem>[] = [
    { key: 'age', label: ctx.t('exportCols.employee.age'), group: g('person'), value: (x) => String(ageAt(x.employee.birthDate, ctx.asOf)) },
    { key: 'healthStandardNow', label: ctx.t('exportCols.employee.healthStandardNow'), group: g('enrollment'), value: (x) => std(x, 'health') },
    { key: 'pensionStandardNow', label: ctx.t('exportCols.employee.pensionStandardNow'), group: g('enrollment'), value: (x) => std(x, 'pension') },
  ];
  // 足した項目は、それぞれのまとまりの最後に置く
  const out: ExportColumn<EmployeeExportItem>[] = [];
  for (const c of base) out.push(c);
  for (const e of extra) {
    const last = out.map((c) => c.group).lastIndexOf(e.group);
    out.splice(last + 1, 0, e);
  }
  return out;
}
