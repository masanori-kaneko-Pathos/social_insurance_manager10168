// テスト用の等級表（令和6年3月分から。健保50等級・厚年は健保4〜35級と同じ32等級）。regular.spec.ts と同じ値
import type { GradeRow } from '../../../core/models/rates';
import type { GradeRows } from './regular';

const HEALTH_STD = [
  58, 68, 78, 88, 98, 104, 110, 118, 126, 134, 142, 150, 160, 170, 180, 190, 200, 220, 240, 260, 280,
  300, 320, 340, 360, 380, 410, 440, 470, 500, 530, 560, 590, 620, 650, 680, 710, 750, 790, 830, 880,
  930, 980, 1030, 1090, 1150, 1210, 1270, 1330, 1390,
].map((k) => k * 1000);
const HEALTH_MIN = [
  0, 63, 73, 83, 93, 101, 107, 114, 122, 130, 138, 146, 155, 165, 175, 185, 195, 210, 230, 250, 270,
  290, 310, 330, 350, 370, 395, 425, 455, 485, 515, 545, 575, 605, 635, 665, 695, 730, 770, 810, 855,
  905, 955, 1005, 1055, 1115, 1175, 1235, 1295, 1355,
].map((k) => k * 1000);

export const HEALTH_ROWS: GradeRow[] = HEALTH_STD.map((standard, i) => ({
  grade: i + 1,
  standard,
  min: HEALTH_MIN[i],
}));
export const PENSION_ROWS: GradeRow[] = HEALTH_ROWS.slice(3, 35).map((r, i) => ({
  grade: i + 1,
  standard: r.standard,
  min: i === 0 ? 0 : r.min,
}));
export const GRADES: GradeRows = { health: HEALTH_ROWS, pension: PENSION_ROWS };

/** 標準報酬（千円）→ 等級 */
export const healthGradeOf = (k: number) => HEALTH_STD.indexOf(k * 1000) + 1;
export const pensionGradeOf = (k: number) => PENSION_ROWS.findIndex((r) => r.standard === k * 1000) + 1;
