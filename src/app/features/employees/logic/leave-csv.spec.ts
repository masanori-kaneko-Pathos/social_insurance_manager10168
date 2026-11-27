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

  it('存在しない日付（2/30）は noSuchDate、形が読めない日付は date（11/28）', () => {
    const t = [['社員番号', '休業1_種類', '休業1_開始日', '休業1_終了日'], ['E003', '育休', '2026-02-30', 'あとで']];
    const codes = planLeaveImport(t, [T('E003')]).rows[0].errors.map((e) => e.code);
    expect(codes).toContain('employeeCsv.rowError.noSuchDate');
    expect(codes).toContain('employeeCsv.rowError.date');
  });

  it('社員番号の先頭の0が消えた行も結ぶ。2人に当たるときはエラー（11/28）', () => {
    const t = [['社員番号', '休業1_種類', '休業1_開始日'], ['3', '育休', '2026-06-01'], ['12', '育休', '2026-06-01']];
    const p = planLeaveImport(t, [T('0003'), T('0012'), T('00012')]);
    expect(p.rows[0].errors).toEqual([]);
    expect(p.rows[0].zeroPadded).toBeTrue();
    expect(p.rows[1].errors.map((e) => e.code)).toEqual(['leaveCsv.error.ambiguousEmployee']);
  });

  it('出産予定日の列（任意）を産休の予定日に入れる（11/28）', () => {
    const t = [['社員番号', '休業の種類', '開始日', '終了日', '出産日・子の生年月日', '申出日', '出産予定日'], ['E003', '産休', '2026-07-10', '2026-10-20', '2026-08-25', '2026-07-01', '2026-08-20']];
    const r = planLeaveImport(t, [T('E003')]).rows[0];
    expect(r.errors).toEqual([]);
    expect(r.leave?.birthDate).toBe('2026-08-25');
    expect(r.leave?.expectedBirthDate).toBe('2026-08-20');
  });

  it('従業員のファイルの見出し（休業1_種類など）でも読める', () => {
    const t = [['社員番号', '休業1_種類', '休業1_開始日'], ['E003', '育休', '2026-06-01']];
    expect(planLeaveImport(t, [T('E003')]).rows[0].errors).toEqual([]);
  });
});
