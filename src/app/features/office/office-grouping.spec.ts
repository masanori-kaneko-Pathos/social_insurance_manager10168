import { Office } from '../../core/models/office';
import { groupOfficesByCorporation } from './office-grouping';

const office = (id: string, p: Partial<Office>): Office =>
  ({ id, name: id, corporateName: null, corporateNumber: null, groupName: null, ...p }) as Office;

describe('groupOfficesByCorporation：切り替えのメニューのまとまり', () => {
  it('法人番号ごとにまとめ、法人番号のないものは最後に「その他」', () => {
    const g = groupOfficesByCorporation([
      office('B支店', { corporateNumber: '1111111111111', corporateName: '甲社' }),
      office('A本社', { corporateNumber: '1111111111111', corporateName: '甲社' }),
      office('個人', {}),
    ]);
    expect(g.map((x) => x.label)).toEqual(['甲社', null]);
    expect(g[0].offices.map((o) => o.id)).toEqual(['A本社', 'B支店']);
  });

  it('グループの名前があれば、法人番号が違ってもまとめる', () => {
    const g = groupOfficesByCorporation([
      office('親', { corporateNumber: '1111111111111', corporateName: '親会社', groupName: 'テストHD' }),
      office('子', { corporateNumber: '2222222222222', corporateName: '子会社', groupName: 'テストHD ' }),
      office('別', { corporateNumber: '3333333333333', corporateName: '別会社' }),
    ]);
    expect(g.map((x) => x.label)).toEqual(['テストHD', '別会社']);
    expect(g[0].offices.map((o) => o.id)).toEqual(['子', '親']);
  });
});
