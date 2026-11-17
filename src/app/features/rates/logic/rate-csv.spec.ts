import { readRateCsv, readRateMonth, rateCsvTable, rateEditsOf, rateErrorColumns, rateFixTable, recheckRateCsv, RATE_CSV_COLUMNS, RATE_CSV_HEADERS } from './rate-csv';
import type { KumiaiRateInput } from '../../../core/models/rates';

const H = RATE_CSV_COLUMNS.map((c) => RATE_CSV_HEADERS[c]);
const range = { from: '2025-04', to: null };
const r = (from: string, health: [number, number], care: [number, number] = [9000, 9000], cs: [number, number] = [1150, 1150]): KumiaiRateInput => ({
  from,
  health: { employee: health[0], employer: health[1] },
  care: { employee: care[0], employer: care[1] },
  childSupport: { employee: cs[0], employer: cs[1] },
});

describe('readRateMonth', () => {
  it('いろいろな月の書き方を読む', () => {
    expect(readRateMonth('2026-04')).toBe('2026-04');
    expect(readRateMonth('2026/4')).toBe('2026-04');
    expect(readRateMonth('2026/4/1')).toBe('2026-04');
    expect(readRateMonth('2026年4月分')).toBe('2026-04');
    expect(readRateMonth('２０２６－０３')).toBe('2026-03');
    expect(readRateMonth('2026-13')).toBeNull();
    expect(readRateMonth('4月')).toBeNull();
  });
});

describe('readRateCsv：組合の料率の CSV（11/17）', () => {
  it('新規・上書き・変わらないを分ける。全体が空なら本人＋会社', () => {
    const existing = [r('2025-04', [45000, 50000]), r('2026-04', [45000, 50000])];
    const { rows, missing } = readRateCsv(
      [
        H,
        ['2026-04', '%', '9.5', '4.5', '5.0', '1.8', '0.9', '0.9', '0.23', '0.115', '0.115'],
        ['2025-04', '', '', '4.5', '5', '1.8', '0.9', '0.9', '', '', ''],
        ['2027-03', '%', '9.6', '4.6', '5', '1.8', '0.9', '0.9', '0.23', '0.115', '0.115'],
      ],
      { range, existing },
    );
    expect(missing).toEqual([]);
    expect(rows.map((x) => [x.from, x.status])).toEqual([
      ['2025-04', 'update'], // 支援金が空 → 0（2026年4月分より前）なので、保存済み（0.23%）と違う
      ['2026-04', 'same'],
      ['2027-03', 'new'],
    ]);
    expect(rows[0].input!.childSupport).toEqual({ employee: 0, employer: 0 });
    expect(rows[2].input!.health).toEqual({ employee: 46000, employer: 50000 });
  });

  it('‰ で読む', () => {
    const { rows } = readRateCsv(
      [H, ['2026-04', '‰', '95', '45', '50', '18', '9', '9', '2.3', '1.15', '1.15']],
      { range, existing: [] },
    );
    expect(rows[0].input).toEqual(r('2026-04', [45000, 50000]));
  });

  it('エラー：合わない・30%超・読めない・期間の外・重なり・介護の空・2026年4月分からの支援金の空', () => {
    const { rows } = readRateCsv(
      [
        H,
        ['2026-04', '%', '9.0', '4.5', '5.0', '1.8', '0.9', '0.9', '0.23', '0.115', '0.115'],
        ['2026-05', '%', '', '20', '15', '1.8', '0.9', '0.9', '0.23', '0.115', '0.115'],
        ['2026-06', '%', '', '4.5', 'abc', '1.8', '0.9', '0.9', '0.23', '0.115', '0.115'],
        ['2024-04', '%', '', '4.5', '5', '1.8', '0.9', '0.9', '', '', ''],
        ['2026-07', '%', '', '4.5', '5', '1.8', '0.9', '0.9', '0.23', '0.115', '0.115'],
        ['2026/7', '%', '', '4.5', '5', '1.8', '0.9', '0.9', '0.23', '0.115', '0.115'],
        ['2026-08', '%', '', '4.5', '5', '', '', '', '', '', ''],
        ['2026-09', 'x', '', '4.5', '5', '1.8', '0.9', '0.9', '0.23', '0.115', '0.115'],
      ],
      { range, existing: [] },
    );
    const byLine = new Map(rows.map((x) => [x.line, x]));
    expect(byLine.get(2)!.errors).toEqual(['health.mismatch']);
    expect(byLine.get(3)!.errors).toEqual(['health.tooHigh']);
    expect(byLine.get(4)!.errors).toEqual(['health.format']);
    expect(byLine.get(5)!.errors).toEqual(['outOfRange']);
    expect(byLine.get(6)!.status).toBe('new');
    expect(byLine.get(7)!.errors).toEqual(['duplicate']);
    expect(byLine.get(8)!.errors).toEqual(['care.required', 'childSupport.required']);
    expect(byLine.get(9)!.errors).toEqual(['unit']);
  });

  it('見出しの言い換え・BOM・列の並び替えを読む。必須の列がなければ missing', () => {
    const { rows } = readRateCsv(
      [
        ['﻿適用開始月', '健保_会社', '健保_本人', '介護_本人', '介護_会社', '支援金_本人', '支援金_会社'],
        ['2026年4月分', '5', '4.5', '0.9', '0.9', '0.115', '0.115'],
      ],
      { range, existing: [] },
    );
    expect(rows[0].input).toEqual(r('2026-04', [45000, 50000]));
    expect(readRateCsv([['何月分から', '健康保険_本人'], ['2026-04', '4.5']], { range, existing: [] }).missing).toEqual([
      'health_employer',
    ]);
  });

  it('期間の終わりの月（to）は入れられない', () => {
    const { rows } = readRateCsv([H, ['2026-10', '%', '', '4.5', '5', '1.8', '0.9', '0.9', '0.23', '0.115', '0.115']], {
      range: { from: '2025-04', to: '2026-10' },
      existing: [],
    });
    expect(rows[0].errors).toEqual(['outOfRange']);
  });
});

describe('rateCsvTable：出力', () => {
  it('保存済みを古い順に、取り込みと同じ形で出す（出して読み直すと同じ）', () => {
    const rates = [r('2026-04', [45000, 50000]), r('2025-04', [44000, 50000], [9000, 9000], [0, 0])];
    const table = rateCsvTable(rates);
    expect(table[1].slice(0, 5)).toEqual(['2025-04', '%', '9.4', '4.4', '5']);
    const back = readRateCsv(table, { range, existing: rates });
    expect(back.rows.map((x) => x.status)).toEqual(['same', 'same']);
  });
  it('保存済みがなければ例の1行', () => {
    expect(rateCsvTable([]).length).toBe(2);
  });
});

describe('共通の窓で直す（11/17）', () => {
  const H = RATE_CSV_COLUMNS.map((c) => RATE_CSV_HEADERS[c]);
  const ctx = { range: { from: '2020-01', to: null }, existing: [] };
  const table = [
    H,
    ['2024-04', '%', '9.2', '4.6', '4.6', '1.8', '0.9', '0.9', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', ''],
    ['2025-03', '%', '9.9', '4.6', '4.6', '1.8', '0.9', '0.9', '', '', ''],
  ];

  it('エラー → 直す列', () => {
    expect(rateErrorColumns(['month', 'health.mismatch'])).toEqual(['from', 'health_total', 'health_employee', 'health_employer']);
    expect(rateErrorColumns(['unit'])).toEqual(['unit']);
  });

  it('表の行の番号の位置に置き、直した値で確かめ直すとエラーが消える', () => {
    const { rows } = readRateCsv(table, ctx);
    const bad = rows.find((r) => r.status === 'error')!;
    expect(bad.line).toBe(4);
    const fix = rateFixTable(rows);
    expect(fix[3][0]).toBe('2025-03');
    expect(fix[2].every((v) => v === '')).toBe(true);
    const edits = rateEditsOf({ [RATE_CSV_HEADERS.health_total]: '9.2', 知らない列: 'x' });
    expect(edits).toEqual({ health_total: '9.2' });
    const again = recheckRateCsv(rows, new Map([[bad.line, edits]]), ctx);
    expect(again.rows.every((r) => r.status === 'new')).toBe(true);
    expect(again.rows.map((r) => r.line)).toEqual([2, 4]);
  });
});
