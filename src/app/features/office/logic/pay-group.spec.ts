import type { PayGroup } from '../../../core/models/office';
import {
  deductionHistoryAt,
  missingGroup,
  newPayGroupId,
  payGroupErrors,
  payGroupIdAt,
  payrollAt,
  withAssignment,
} from './pay-group';

const PART: PayGroup = { id: 'g1', name: 'パート', payroll: { closingDay: 15, payDay: 25, payMonth: 'current', deduction: 'next' } };
const OFFICE = {
  payroll: { closingDay: 31, payDay: 25, payMonth: 'next' as const, deduction: 'next' as const },
  payGroups: [PART],
  deductionHistory: [{ from: '0000-01', deduction: 'next' as const }],
};

describe('給与の支払区分（pay-group）', () => {
  const e = { payGroups: [{ from: '0000-01', groupId: null }, { from: '2026-04', groupId: 'g1' }] };

  it('その支払月の区分：割り当ての履歴から（なし ＝ 既定）', () => {
    expect(payGroupIdAt(e, '2026-03')).toBeNull();
    expect(payGroupIdAt(e, '2026-04')).toBe('g1');
    expect(payGroupIdAt(null, '2026-04')).toBeNull();
  });

  it('給与の決まり：区分の人は区分の締め日、既定の人は事業所の設定', () => {
    expect(payrollAt(OFFICE, e, '2026-05').closingDay).toBe(15);
    expect(payrollAt(OFFICE, e, '2026-03').closingDay).toBe(31);
    expect(payrollAt(OFFICE, {}, '2026-05').payMonth).toBe('next');
  });

  it('控除の時期の履歴は既定の区分の人だけ', () => {
    expect(deductionHistoryAt(OFFICE, e, '2026-03')).toEqual(OFFICE.deductionHistory);
    expect(deductionHistoryAt(OFFICE, e, '2026-05')).toBeNull();
  });

  it('消した区分を指していたら既定で計算し、知らせる', () => {
    const gone = { payGroups: [{ from: '0000-01', groupId: 'g9' }] };
    expect(payrollAt(OFFICE, gone, '2026-05').closingDay).toBe(31);
    expect(missingGroup(OFFICE, gone, '2026-05')).toBeTrue();
    expect(missingGroup(OFFICE, e, '2026-05')).toBeFalse();
  });

  it('区分の一覧のチェックと、新しい ID', () => {
    const bad: PayGroup[] = [
      { id: 'g1', name: '', payroll: { ...PART.payroll, closingDay: 0 } },
      { id: 'g2', name: '月給者', payroll: PART.payroll },
      { id: 'g3', name: 'パート', payroll: PART.payroll },
      { id: 'g4', name: 'パート', payroll: { ...PART.payroll, payDay: 32 } },
    ];
    const errs = payGroupErrors(bad, '月給者');
    expect(errs.get(0)).toEqual(['name', 'closingDay']);
    expect(errs.get(1)).toEqual(['duplicate']);
    expect(errs.get(2)).toBeUndefined();
    expect(errs.get(3)).toEqual(['duplicate', 'payDay']);
    expect(newPayGroupId([PART])).toBe('g2');
  });

  it('割り当てを変える：同じ月は置き換え、前と同じ区分なら足さない', () => {
    expect(withAssignment(null, '2026-04', 'g1')).toEqual([{ from: '2026-04', groupId: 'g1' }]);
    expect(withAssignment(e.payGroups, '2026-04', 'g2')).toEqual([{ from: '0000-01', groupId: null }, { from: '2026-04', groupId: 'g2' }]);
    expect(withAssignment(e.payGroups, '2026-06', 'g1')).toEqual(e.payGroups);
    expect(withAssignment(e.payGroups, '2026-10', null)).toEqual([...e.payGroups, { from: '2026-10', groupId: null }]);
  });
});
