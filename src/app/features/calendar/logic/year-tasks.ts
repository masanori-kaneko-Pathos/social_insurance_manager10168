// 1年の業務の暦：社会保険の担当者が、月ごとにやること（と、このアプリの対象外の隣の業務）
// Angular・Firebase に依存しない純粋な関数。事業所の設定（賞与の月・保険者・控除の時期）で中身が変わる
//
// 根拠（11/11 に調べた一次情報など）
// - 料率：協会けんぽは毎年3月分から改定（翌月徴収なら4月の給与から、当月徴収なら3月の給与から）
// - 算定基礎届：7月1日〜7月10日。9月分から新しい標準報酬（翌月徴収なら10月の給与から）
// - 賞与支払届：賞与を払ってから5日以内
// - 納付：前月分を月末まで（告知書は20日ごろ届く）
// - 被扶養者の再確認：協会けんぽは10月下旬〜11月中旬にリストが届き、12月上旬が期限（令和8年度は12/11）
//   健保組合は組合ごとに時期が違う
// - 年末調整・住民税・労働保険の年度更新・源泉徴収票は、このアプリの対象外（暦の上では並べて、抜けて見えないようにする）

import { shiftMonth, YearMonth } from '../../../shared/utils/date';

/** 押すと移る画面（アプリの外の業務は null） */
export type TaskLink =
  | 'rates'
  | 'payrolls'
  | 'premiums'
  | 'revisions'
  | 'regular'
  | 'bonuses'
  | 'filings'
  | 'employees'
  | 'home'
  | null;

export interface YearTask {
  /** 翻訳の鍵（calendar.task.〇〇） */
  key: string;
  link: TaskLink;
  /** このアプリの対象外（ほかの仕組みでやる） */
  outside: boolean;
  /** 文に差し込む値（月など） */
  params?: Record<string, string | number>;
}

export interface MonthTasks {
  month: number; // 1〜12
  tasks: YearTask[];
}

export interface CalendarOffice {
  bonusMonths: number[];
  insurer: 'kyokai' | 'kumiai';
  deduction: 'current' | 'next';
}

const t = (key: string, link: TaskLink, params?: YearTask['params']): YearTask => ({ key, link, outside: false, params });
const out = (key: string): YearTask => ({ key, link: null, outside: true });

/** 毎月の業務（どの月にも出す） */
export function monthlyTasks(): YearTask[] {
  return [t('payroll', 'payrolls'), t('payment', 'premiums'), t('joinLeave', 'home'), t('watchRevision', 'revisions')];
}

/** 月ごとの業務（1月〜12月） */
export function yearTasks(o: CalendarOffice): MonthTasks[] {
  const next = o.deduction === 'next';
  const months: MonthTasks[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, tasks: [] }));
  const add = (m: number, task: YearTask) => months[m - 1].tasks.push(task);

  add(1, out('withholdingSlip'));
  add(1, out('salaryReport'));
  if (o.insurer === 'kyokai') add(3, t('ratesKyokai', 'rates', { payMonth: next ? 4 : 3 }));
  else add(3, t('ratesKumiai', 'rates'));
  add(4, t('raise', 'revisions'));
  add(4, out('employmentRate'));
  add(5, out('residentTax'));
  add(6, out('laborInsurance'));
  add(7, t('regular', 'regular'));
  add(9, t('regularApply', 'premiums', { payMonth: next ? 10 : 9 }));
  if (o.insurer === 'kyokai') {
    add(10, t('dependentList', 'employees'));
    add(12, t('dependentDue', 'employees'));
  } else {
    add(10, t('dependentKumiai', 'employees'));
  }
  add(10, out('yearEndForms'));
  add(12, out('yearEnd'));
  for (const m of [...new Set(o.bonusMonths)].filter((x) => x >= 1 && x <= 12).sort((a, b) => a - b)) {
    add(m, t('bonus', 'bonuses'));
  }
  return months;
}

/** 今月から12か月（今月が先頭。暦は「これから」を見るものなので） */
export function upcomingMonths(thisMonth: YearMonth): YearMonth[] {
  return Array.from({ length: 12 }, (_, i) => shiftMonth(thisMonth, i));
}
