import { leaveCsvTemplate, LeaveTarget, planLeaveImport } from './leave-csv';

const T = (no: string, leaves: LeaveTarget['leaves'] = []): LeaveTarget => ({
  id: no.toLowerCase(), employeeNumber: no, lastName: '山田', firstName: '太郎', hireDate: '2015-04-01', retireDate: null, leaves,
});

describe('休業の履歴の取り込み（11/27）', () => {
  it('ひな形をそのまま読める（同じ人に3件以上でもよい）', () => {
    const p = planLeaveImport(leaveCsvTemplate(), [T('E007'), T('E003')]);
    expect(p.missing).toEqual([]);
    expect(p.rows.every((r) => r.errors.length === 0)).toBe(true);
    expect(p.rows.filter((r) => r.employee?.employeeNumber === 'E007').length).toBe(3);
  });

  it('登録済みと同じ休業（種類・開始日）は飛ばす。いない人・ファイルの中の重複はエラー', () => {
    const t = [leaveCsvTemplate()[0], ['E007', '産休', '2026-06-01', '', '', ''], ['E999', '育休', '2026-06-01', '', '', ''], ['E003', '休職', '2027-01-10', '', '', ''], ['E003', '休職', '2027-01-10', '', '', '']];
    const existing = [{ kind: 'maternity', start: '2026-06-01' } as LeaveTarget['leaves'][number]];
    const p = planLeaveImport(t, [T('E007', existing), T('E003')]);
    expect(p.rows[0].skip).toBe(true);
    expect(p.rows[1].errors.map((e) => e.code)).toContain('leaveCsv.error.unknownEmployee');
    expect(p.rows[3].errors.map((e) => e.code)).toContain('leaveCsv.error.duplicateInFile');
  });

  it('従業員のファイルの見出し（休業1_種類など）でも読める', () => {
    const t = [['社員番号', '休業1_種類', '休業1_開始日'], ['E003', '育休', '2026-06-01']];
    expect(planLeaveImport(t, [T('E003')]).rows[0].errors).toEqual([]);
  });
});
