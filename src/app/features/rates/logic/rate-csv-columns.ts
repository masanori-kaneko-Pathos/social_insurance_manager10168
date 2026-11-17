// 組合の料率の CSV の列（rate-csv と rate-table の両方で使う。11/17）

type Kind = 'health' | 'care' | 'childSupport';
type Part = 'total' | 'employee' | 'employer';

export type RateCsvColumn = 'from' | 'unit' | `${Kind}_${Part}`;

export const RATE_CSV_HEADERS: Record<RateCsvColumn, string> = {
  from: '何月分から',
  unit: '単位',
  health_total: '健康保険_全体',
  health_employee: '健康保険_本人',
  health_employer: '健康保険_会社',
  care_total: '介護保険_全体',
  care_employee: '介護保険_本人',
  care_employer: '介護保険_会社',
  childSupport_total: '支援金_全体',
  childSupport_employee: '支援金_本人',
  childSupport_employer: '支援金_会社',
};
export const RATE_CSV_COLUMNS = Object.keys(RATE_CSV_HEADERS) as RateCsvColumn[];
