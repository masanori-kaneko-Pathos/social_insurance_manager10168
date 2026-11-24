import type { EmployeeFull } from '../../../core/models/employee';
import type { GradeTableDoc } from '../../../core/models/rates';
import { HEALTH_ROWS, PENSION_ROWS } from '../../payrolls/logic/grades.fixture';
import type { MasterRateDoc } from '../../../core/models/rates';
import { pickRates } from '../../rates/logic/pick-rates';
import { calcMonthly } from '../../premiums/logic/calc-monthly';
import { bonusCarryOf, planTransfer, transferErrors, TransferSource } from './transfer';

const on = (acquiredDate: string) => ({ enrolled: true, acquiredDate, lostDate: null, lossReason: null });

const E = {
  id: 'e1',
  employeeNumber: 'E001',
  lastName: '山田',
  firstName: '太郎',
  birthDate: '1990-05-15',
  hireDate: '2020-04-01',
  retireDate: null,
  retireReason: null,
  health: on('2020-04-01'),
  pension: on('2020-04-01'),
  leaves: [
    { kind: 'childcare', start: '2026-08-01', plannedEnd: '2027-03-31', end: null },
    { kind: 'maternity', start: '2024-01-01', plannedEnd: '2024-04-01', end: null },
  ],
  careExemptions: [],
  overseas: [],
  userUid: 'u-1',
  priorBonusTotals: null,
  register: { history: [], retireDetail: null },
} as unknown as EmployeeFull;

const TABLES: GradeTableDoc[] = [
  { kind: 'health', from: '2024-03', grades: HEALTH_ROWS, source: 't' },
  { kind: 'pension', from: '2024-03', grades: PENSION_ROWS, source: 't' },
];

const SRC: TransferSource = {
  employee: E,
  contracts: [
    { from: '2020-04-01', weeklyMinutes: 2400 } as never,
    { from: '2025-04-01', weeklyMinutes: 2400 } as never,
  ],
  remunerations: [
    { from: '2025-09', reason: 'regular', monthlyAmount: 305000, health: { grade: 22, standard: 300000 }, pension: { grade: 19, standard: 300000 } } as never,
  ],
  dependents: [
    { lastName: '山田', firstName: '花子', from: '2021-01-01', to: null, startReason: 'marriage', startReasonText: null } as never,
    { lastName: '山田', firstName: '一郎', from: '2021-01-01', to: '2025-03-31' } as never,
  ],
  bonusPayments: [
    { paidDate: '2026-07-10', amounts: { e1: 1_000_500 } } as never,
    { paidDate: '2025-12-10', amounts: { e1: 900_000 } } as never, // 前の年度
    { paidDate: '2026-11-20', amounts: { e1: 500_000 } } as never, // 異動日より後
  ],
  fromInsurer: 'kyokai',
  toInsurer: 'kyokai',
  fromOfficeName: '本社',
  gradeTables: TABLES,
};

describe('事業所の間の異動（transfer）', () => {
  const input = { date: '2026-11-16', employeeNumber: 'F010', monthlyAmount: null };

  it('元の事業所：退職日 ＝ 異動日の前日、喪失日 ＝ 異動日（喪失の理由は退職等、退職の理由は異動）', () => {
    const p = planTransfer(SRC, input);
    expect(p.source.retireDate).toBe('2026-11-15');
    expect(p.source.retireReason).toBe('transfer');
    expect(p.source.health).toEqual({ enrolled: true, acquiredDate: '2020-04-01', lostDate: '2026-11-16', lossReason: 'retire' });
    expect(p.source.pension.lostDate).toBe('2026-11-16');
  });

  it('新しい事業所：入社日・取得日 ＝ 異動日、マイページの連携は写さない、履歴に元の事業所と入社日', () => {
    const p = planTransfer(SRC, input);
    expect(p.employee.employeeNumber).toBe('F010');
    expect(p.employee.hireDate).toBe('2026-11-16');
    expect(p.employee.health).toEqual({ enrolled: true, acquiredDate: '2026-11-16', lostDate: null, lossReason: null });
    expect('userUid' in p.employee).toBeFalse();
    expect(p.employee.register.history.at(-1)).toEqual({ month: '2026-11', text: '本社から異動（入社日 2020-04-01）' });
  });

  it('異動した月の保険料：元の事業所は10月分まで、新しい事業所は11月分から（1か月分を新しい事業所だけ）', () => {
    const p = planTransfer(SRC, input);
    const master: MasterRateDoc[] = [
      { kind: 'kyokaiHealth', from: '2026-03', byPrefecture: { '13': 98500 }, source: 't' },
      { kind: 'care', from: '2026-03', rate: 16200, source: 't' },
      { kind: 'childSupport', from: '2026-04', rate: 2300, source: 't' },
      { kind: 'pension', from: '2024-03', rate: 183000, source: 't' },
      { kind: 'childContribution', from: '2024-03', rate: 3600, source: 't' },
    ];
    const rates = pickRates({ prefecture: '13', healthInsurer: { type: 'kyokai' } }, { master, kumiai: [] }, '2026-10');
    const rems = [{ from: '2025-09', health: { grade: 22, standard: 300000 }, pension: { grade: 19, standard: 300000 } }];
    const oldEmp = { ...E, ...p.source };
    const newEmp = { ...E, ...p.employee, leaves: [] };
    const charged = (emp: typeof oldEmp, m: string) => {
      try {
        return calcMonthly({ month: m, employee: emp, remunerations: rems, rates: { ...rates, month: m } as never }).groups.length > 0;
      } catch {
        return null;
      }
    };
    expect(charged(oldEmp, '2026-10')).toBeTrue();
    expect(charged(oldEmp, '2026-11')).toBeFalse();
    expect(charged(newEmp, '2026-10')).toBeFalse();
    const newRems = [{ from: '2026-11', health: p.remuneration.health, pension: p.remuneration.pension }];
    expect(calcMonthly({ month: '2026-11', employee: newEmp, remunerations: newRems, rates: { ...rates, month: '2026-11' } as never }).groups.length).toBeGreaterThan(0);
  });

  it('雇用契約は異動日に効いている契約を異動日から写す。扶養家族は扶養中の人だけを異動日から', () => {
    const p = planTransfer(SRC, input);
    expect(p.contracts.map((c) => c.from)).toEqual(['2026-11-16']);
    expect(p.dependents.length).toBe(1);
    expect(p.dependents[0].from).toBe('2026-11-16');
    expect(p.dependents[0].startReason).toBeNull();
  });

  it('休業は続いているものだけ写す', () => {
    const p = planTransfer(SRC, input);
    expect(p.lists.leaves.map((l) => l.kind)).toEqual(['childcare']);
  });

  it('標準報酬：異動した月から資格取得時決定（報酬月額を入れなければ今の報酬月額）', () => {
    const p = planTransfer(SRC, input);
    expect(p.remuneration.from).toBe('2026-11');
    expect(p.remuneration.reason).toBe('acquisition');
    expect(p.remuneration.monthlyAmount).toBe(305000);
    expect(p.remuneration.health.standard).toBe(300000);
    const q = planTransfer(SRC, { ...input, monthlyAmount: 315000 });
    expect(q.remuneration.health.standard).toBe(320000);
  });

  it('賞与の年度累計：同じ保険者（協会けんぽ）なら今年度の分を引き継ぐ。保険者が違えば引き継がない', () => {
    expect(bonusCarryOf('e1', SRC.bonusPayments, '2026-11-16', null)).toEqual({ year: 2026, total: 1_000_000 });
    expect(planTransfer(SRC, input).priorBonusTotals).toEqual({ '2026': 1_000_000 });
    expect(planTransfer({ ...SRC, toInsurer: 'kumiai:2024-04' }, input).priorBonusTotals).toBeNull();
  });

  it('入力のチェック：入社日以前・退職済み・報酬月額が読めない', () => {
    expect(transferErrors(SRC, { ...input, date: '2020-04-01' })).toContain('beforeHire');
    expect(transferErrors({ ...SRC, employee: { ...E, retireDate: '2026-10-31' } }, input)).toContain('retired');
    expect(transferErrors(SRC, { ...input, monthlyAmount: 0 })).toContain('amount');
    expect(transferErrors({ ...SRC, remunerations: [] }, input)).toContain('noRemuneration');
    expect(transferErrors(SRC, input)).toEqual([]);
  });
});
