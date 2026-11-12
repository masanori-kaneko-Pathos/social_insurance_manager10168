import { addDepartment, departmentError, nextDepartmentId, removeDepartment, renameDepartment } from './departments';

describe('部署の一覧', () => {
  it('id は名前を変えても変わらず、消した番号は使い直さない', () => {
    let list = addDepartment([], '総務部');
    list = addDepartment(list, '営業部');
    expect(list.map((d) => d.id)).toEqual(['d1', 'd2']);
    list = renameDepartment(list, 'd1', '総務人事部');
    expect(list[0]).toEqual({ id: 'd1', name: '総務人事部' });
    list = removeDepartment(list, 'd2');
    expect(nextDepartmentId(list)).toBe('d2');
    expect(nextDepartmentId([{ id: 'd5', name: 'x' }])).toBe('d6');
  });
  it('空・長すぎ・同じ名前はだめ（自分の名前を変えるときは自分を除く）', () => {
    const list = [{ id: 'd1', name: '総務部' }];
    expect(departmentError(list, ' ')).toBe('empty');
    expect(departmentError(list, 'あ'.repeat(41))).toBe('tooLong');
    expect(departmentError(list, '総務部')).toBe('duplicate');
    expect(departmentError(list, '総務部', 'd1')).toBeNull();
  });
});
