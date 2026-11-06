// 保険料一覧の CSV（書き出しだけ）
// 1人1行（画面と同じ列）＋ 空行 ＋ 事業所の合計（納入告知書と見比べる用）

import { CsvLang } from '../../payrolls/logic/payroll-csv';

/** 画面の1行から、CSV に要るところだけ */
export interface PremiumCsvRow {
  employeeNumber: string | null;
  name: string;
  state: 'ok' | 'exempt' | 'missing' | 'error';
  health: { grade: number; standard: number } | null;
  pension: { grade: number; standard: number } | null;
  care: boolean;
  healthEmployeeYen: number;
  pensionEmployeeYen: number;
  employeeYen: number;
  employerMilli: number;
  totalMilli: number;
  contributionMilli: number;
  /** 計算できない理由・免除などの文言（画面と同じもの） */
  note: string;
}

export interface PremiumCsvTotal {
  label: string; // 健康保険料（介護・支援金を含む）など
  totalYen: number;
  employeeYen: number;
  employerYen: number;
}

const HEAD: Record<CsvLang, string[]> = {
  ja: [
    '社員番号', '氏名', '健保 等級', '健保 標準報酬月額', '介護', '厚年 等級', '厚年 標準報酬月額',
    '本人負担 健保等', '本人負担 厚年', '本人負担 合計', '会社負担（目安）', '全額', '拠出金（会社）', '備考',
  ],
  en: [
    'Employee number', 'Name', 'Health grade', 'Health standard', 'Care', 'Pension grade', 'Pension standard',
    'Employee health etc.', 'Employee pension', 'Employee total', 'Employer (est.)', 'Total', 'Contribution (employer)', 'Note',
  ],
};

const TOTAL_HEAD: Record<CsvLang, string[]> = {
  ja: ['事業所の合計', '', '納付額', '本人負担の合計', '会社負担'],
  en: ['Office totals', '', 'Payment', 'Employee total', 'Employer'],
};

const GRAND: Record<CsvLang, string> = { ja: '納付額の合計', en: 'Total payment' };

/** 0.001円単位 → '16745.5'（小数は必要な分だけ。カンマなし） */
export function milliText(m: number): string {
  const yen = Math.trunc(m / 1000);
  const rest = Math.abs(m % 1000);
  if (rest === 0) return String(yen);
  const sign = m < 0 && yen === 0 ? '-' : '';
  return `${sign}${yen}.${String(rest).padStart(3, '0').replace(/0+$/, '')}`;
}

export function buildPremiumCsv(
  rows: readonly PremiumCsvRow[],
  totals: readonly PremiumCsvTotal[],
  lang: CsvLang,
): string[][] {
  const out: string[][] = [HEAD[lang]];
  for (const r of rows) {
    const std = [
      r.health ? String(r.health.grade) : '',
      r.health ? String(r.health.standard) : '',
      r.care ? '1' : '',
      r.pension ? String(r.pension.grade) : '',
      r.pension ? String(r.pension.standard) : '',
    ];
    const money =
      r.state === 'ok'
        ? [
            String(r.healthEmployeeYen),
            r.pension ? String(r.pensionEmployeeYen) : '',
            String(r.employeeYen),
            milliText(r.employerMilli),
            milliText(r.totalMilli),
            r.contributionMilli ? milliText(r.contributionMilli) : '',
          ]
        : ['', '', '', '', '', ''];
    out.push([r.employeeNumber ?? '', r.name, ...std, ...money, r.note]);
  }
  out.push([]);
  out.push(TOTAL_HEAD[lang]);
  for (const t of totals) {
    out.push([t.label, '', String(t.totalYen), String(t.employeeYen), String(t.employerYen)]);
  }
  out.push([GRAND[lang], '', String(totals.reduce((s, t) => s + t.totalYen, 0)), '', '']);
  return out;
}

/** 保険料一覧_伊藤テスト中商事_2026-11分_20261106.csv */
export function premiumFileName(officeName: string, month: string, today: string, lang: CsvLang): string {
  return lang === 'ja'
    ? `保険料一覧_${officeName}_${month}分_${today.replace(/-/g, '')}.csv`
    : `premiums_${officeName}_${month}_${today.replace(/-/g, '')}.csv`;
}
