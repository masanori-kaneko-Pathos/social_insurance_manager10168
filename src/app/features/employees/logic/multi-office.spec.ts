import { multiOfficeForm, readMultiOffice } from './multi-office';

describe('readMultiOffice（二以上事業所勤務の按分。11/28）', () => {
  const F = (o: any) => ({ own: '', total: '', insurer: 'office', prefecture: '13', ...o });
  it('両方空なら按分しない', () => {
    expect(readMultiOffice(F({}))).toEqual({ multi: null, errors: [] });
  });
  it('この事業所の報酬と合計。協会けんぽは都道府県を持つ', () => {
    expect(readMultiOffice(F({ own: '200,000', total: '300000' })).multi).toEqual({ own: 200000, total: 300000, insurer: 'office', prefecture: null });
    expect(readMultiOffice(F({ own: '200000', total: '300000', insurer: 'kyokai', prefecture: '27' })).multi).toEqual({ own: 200000, total: 300000, insurer: 'kyokai', prefecture: '27' });
  });
  it('片方だけ・合計が少ない・都道府県なしは誤り', () => {
    expect(readMultiOffice(F({ own: '200000' })).errors).toEqual(['total']);
    expect(readMultiOffice(F({ own: '400000', total: '300000' })).errors).toEqual(['totalLess']);
    expect(readMultiOffice(F({ own: '1', total: '2', insurer: 'kyokai', prefecture: '' })).errors).toEqual(['prefecture']);
  });
  it('保存済みから入力に戻す', () => {
    expect(multiOfficeForm({ own: 200000, total: 300000, insurer: 'other', prefecture: null }, '13')).toEqual({ own: '200,000', total: '300,000', insurer: 'other', prefecture: '13' });
  });
});
