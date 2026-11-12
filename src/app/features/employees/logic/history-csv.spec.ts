import type { GradeTableDoc } from '../../../core/models/rates';
import { convertRow, guessMapping, isOurFormat } from '../../../shared/import/column-map';
import {
  CONTRACT_HISTORY_FIELDS,
  CONTRACT_HISTORY_SPEC,
  employeeIdsIn,
  historyCsvTemplate,
  HistoryPerson,
  planHistoryImport,
  readHistoryCsv,
  REMUNERATION_HISTORY_FIELDS,
} from './history-csv';

// 等級表（小さい例）：健保・厚年とも 1級 〜 3級
const table = (kind: 'health' | 'pension', from: string): GradeTableDoc => ({
  kind,
  from,
  source: 'test',
  grades: [
    { grade: 1, standard: 200000, min: 0 },
    { grade: 2, standard: 300000, min: 250000 },
    { grade: 3, standard: 400000, min: 350000 },
  ],
});
const TABLES = [table('health', '2025-03'), table('pension', '2025-03')];

const PEOPLE: HistoryPerson[] = [
  { id: 'a', employeeNumber: 'E001', lastName: '山田', firstName: '太郎', hireDate: '2026-04-01', retireDate: null },
  { id: 'b', employeeNumber: 'E002', lastName: '佐藤', firstName: '花子', hireDate: '2026-10-01', retireDate: '2029-03-31' },
];

describe('readHistoryCsv：契約の履歴', () => {
  it('ひな形をそのまま読める（契約は画面と同じ形になる）', () => {
    const read = readHistoryCsv('contract', historyCsvTemplate('contract'));
    expect(read.missingColumns).toEqual([]);
    expect(read.rows.every((r) => r.errors.length === 0)).toBeTrue();
    const p = read.rows[0].parsed!;
    expect(p.kind).toBe('contract');
    if (p.kind === 'contract') {
      expect(p.contract.from).toBe('2027-04-01');
      expect(p.contract.weeklyMinutes).toBe(24 * 60);
      expect(p.contract.expectedCash).toBe(130000); // 空なら所定内賃金を写す
    }
  });

  it('必須の列がなければ読まない', () => {
    const read = readHistoryCsv('contract', [['社員番号', '雇用形態'], ['E001', '正社員']]);
    expect(read.missingColumns).toContain('from');
    expect(read.rows).toEqual([]);
  });

  it('値のエラーは行・列で返す', () => {
    const [header] = historyCsvTemplate('contract');
    const row = header.map(() => '');
    const set = (h: string, v: string) => (row[header.indexOf(h)] = v);
    set('社員番号', 'E001');
    set('契約の開始日', '2027/2/30');
    set('雇用形態', '正社員');
    set('給与の形', '月給');
    set('週の所定労働時間', '40:00');
    set('月の所定労働日数', '21');
    set('所定内賃金', 'たくさん');
    const r = readHistoryCsv('contract', [header, row]).rows[0];
    expect(r.parsed).toBeNull();
    expect(r.errors.map((e) => e.column)).toContain('from');
  });
});

describe('readHistoryCsv：標準報酬の履歴', () => {
  it('決定の理由はいろいろな言い方で読める', () => {
    const t = [
      ['社員番号', '標準報酬の開始月', '決定の理由', '報酬月額'],
      ['E001', '2026/9', '算定', '305,000'],
      ['E001', '2027-02', '月変', '342000'],
      ['E001', '2027-10', '育児休業等終了時改定', '280000'],
      ['E001', '2028-01', 'ふしぎ', '280000'],
    ];
    const rows = readHistoryCsv('remuneration', t).rows;
    const reasons = rows.map((r) => (r.parsed?.kind === 'remuneration' ? r.parsed.reason : null));
    expect(reasons).toEqual(['regular', 'irregular', 'leaveEnd', null]);
    expect(rows[0].parsed?.kind === 'remuneration' && rows[0].parsed.monthlyAmount).toBe(305000);
    expect(rows[3].errors[0].column).toBe('reason');
  });
});

describe('planHistoryImport：取り込みの計画', () => {
  const contracts = readHistoryCsv('contract', historyCsvTemplate('contract')).rows;

  it('社員番号で人を見分け、登録済みの日は飛ばす（上書きしない）', () => {
    const plan = planHistoryImport(contracts, {
      employees: PEOPLE,
      existing: new Map([['b', new Set(['2027-04-01'])]]),
      gradeTables: TABLES,
    });
    expect(plan.skipped.map((s) => s.id)).toEqual(['2027-04-01']);
    expect(plan.items.map((i) => [i.employeeId, i.id])).toEqual([['b', '2028-04-01']]);
    expect(plan.items[0].name).toBe('佐藤 花子');
  });

  it('登録されていない社員番号・ファイルの中の重複・入社前・退職後はエラー', () => {
    const t = [
      ['社員番号', '標準報酬の開始月', '決定の理由', '報酬月額'],
      ['E999', '2027-09', '定時', '300000'],
      ['E001', '2027-09', '定時', '300000'],
      ['E001', '2027-09', '定時', '310000'],
      ['E001', '2026-03', '定時', '300000'],
      ['E002', '2029-04', '定時', '300000'],
    ];
    const plan = planHistoryImport(readHistoryCsv('remuneration', t).rows, {
      employees: PEOPLE,
      existing: new Map(),
      gradeTables: TABLES,
    });
    expect(plan.errors.map((e) => e.code)).toEqual(['unknownEmployee', 'duplicateInFile', 'beforeHire', 'afterRetire']);
    expect(plan.items.length).toBe(1);
  });

  it('等級が空なら報酬月額から出す。書いてあればそれを使い、違えば注意', () => {
    const t = [
      ['社員番号', '標準報酬の開始月', '決定の理由', '報酬月額', '健保の等級', '厚年の等級'],
      ['E001', '2026-09', '定時', '305000', '', ''],
      ['E001', '2027-02', '随時', '305000', '3', '2'],
      ['E001', '2027-09', '定時', '305000', '9', ''],
    ];
    const plan = planHistoryImport(readHistoryCsv('remuneration', t).rows, {
      employees: PEOPLE,
      existing: new Map(),
      gradeTables: TABLES,
    });
    const [auto, given] = plan.items;
    expect(auto.remuneration!.health).toEqual({ grade: 2, standard: 300000 });
    expect(auto.warnings).toEqual([]);
    expect(given.remuneration!.health).toEqual({ grade: 3, standard: 400000 });
    expect(given.remuneration!.pension.grade).toBe(2);
    expect(given.warnings).toContain('gradeDiffers');
    expect(plan.errors.map((e) => e.code)).toEqual(['badGrade']); // 等級表にない 9級
  });

  it('等級表がない月はいちばん古い表で出して注意', () => {
    const t = [['社員番号', '標準報酬の開始月', '決定の理由', '報酬月額'], ['E001', '2024-09', '定時', '305000']];
    const old = { ...PEOPLE[0], hireDate: '2020-04-01' };
    const plan = planHistoryImport(readHistoryCsv('remuneration', t).rows, {
      employees: [old],
      existing: new Map(),
      gradeTables: TABLES,
    });
    expect(plan.items[0].warnings).toContain('oldTable');
  });
});

describe('employeeIdsIn：登録済みの記録を読む人', () => {
  it('ファイルに出てくる人だけ', () => {
    const rows = readHistoryCsv('contract', historyCsvTemplate('contract')).rows;
    expect(employeeIdsIn(rows, PEOPLE)).toEqual(['b']);
  });
});

describe('列を合わせる', () => {
  it('ひな形の見出しはうちの形とみなす', () => {
    expect(isOurFormat(historyCsvTemplate('contract')[0], CONTRACT_HISTORY_FIELDS)).toBeTrue();
    expect(isOurFormat(historyCsvTemplate('remuneration')[0], REMUNERATION_HISTORY_FIELDS)).toBeTrue();
  });

  it('よその見出しを当てて、1日の分 × 週の日数から週の時間を出す', () => {
    const headers = ['社員コード', '契約開始日', '雇用区分', '給与形態', '日の契約労働時間', '週の契約労働日数', '所定内賃金'];
    const m = guessMapping(headers, CONTRACT_HISTORY_FIELDS);
    expect(m.from).toEqual({ col: 1 });
    const v = convertRow(['E001', '2027/4/1', 'パート', '時給', '360', '4', '100000'], m, CONTRACT_HISTORY_SPEC);
    expect(v.from).toBe('2027-04-01');
    expect(v.weeklyHours).toBe('24:00');
  });
});
