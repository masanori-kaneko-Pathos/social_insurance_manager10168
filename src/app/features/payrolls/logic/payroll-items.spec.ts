import { PayrollItem } from '../../../core/models/payroll-item';
import { itemRows, parseItemLabels, validatePayrollItem } from './payroll-items';

const item = (id: string, name: string, category: PayrollItem['category'], labels: string[] = []) =>
  ({ id, name, labels, category }) as PayrollItem;

describe('給与の項目の設定', () => {
  it('一覧は事業所の項目 → 初期値。事業所で決め直した名前の初期値は出さない', () => {
    const rows = itemRows([item('a', 'リーダー手当', 'fixedAllowance'), item('b', '皆勤手当', 'fixedAllowance')]);
    expect(rows.slice(0, 2).map((r) => r.item?.id).sort()).toEqual(['a', 'b']);
    expect(rows.filter((r) => r.value.name === '皆勤手当').length).toBe(1);
    expect(rows.find((r) => r.value.name === '基本給')?.item).toBeNull();
  });

  it('CSVの見出しの区切り・重なり・名前と同じものを落とす', () => {
    expect(parseItemLabels('ﾘｰﾀﾞｰ手当、リーダー手当, ﾘｰﾀﾞｰ手当,班長手当', 'リーダー手当')).toEqual(['班長手当']);
  });

  it('名前は必須。ほかの事業所の項目と名前・言い方が重なればエラー（初期値と重なるのはよい）', () => {
    const others = [item('a', 'リーダー手当', 'fixedAllowance', ['班長手当'])];
    expect(validatePayrollItem({ name: '', labels: [], category: 'variable' }, others)).toEqual(['nameRequired']);
    expect(validatePayrollItem({ name: '班長手当', labels: [], category: 'variable' }, others)).toEqual(['duplicate']);
    expect(validatePayrollItem({ name: '皆勤手当', labels: [], category: 'fixedAllowance' }, others)).toEqual([]);
  });
});
