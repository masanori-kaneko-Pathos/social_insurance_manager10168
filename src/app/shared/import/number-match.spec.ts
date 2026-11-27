import { makeNumberMatcher, numberKey } from './number-match';
import { isAfterNextMonth } from '../utils/date';

describe('makeNumberMatcher（社員番号の照合。11/28）', () => {
  const people = [
    { id: 'a', no: '0019' },
    { id: 'b', no: 'E001' },
    { id: 'c', no: '12' },
    { id: 'd', no: '012' },
    { id: 'e', no: null },
  ];
  const m = makeNumberMatcher(people, (p) => p.no);

  it('そのままの番号で当たる（全角・空白・大文字小文字は無視）', () => {
    expect(m('0019')).toEqual({ kind: 'ok', item: people[0], zeroPadded: false });
    expect(m('ｅ００１')).toEqual({ kind: 'ok', item: people[1], zeroPadded: false });
    expect(m(' E001 ')).toEqual({ kind: 'ok', item: people[1], zeroPadded: false });
  });
  it('Excel で先頭の0が消えた番号（19）は、0を補って当てる', () => {
    expect(m('19')).toEqual({ kind: 'ok', item: people[0], zeroPadded: true });
    expect(m('00019')).toEqual({ kind: 'ok', item: people[0], zeroPadded: true });
  });
  it('そのままで当たる人がいれば、0を補った照合より先に使う（012 と 12 がいても、12 は 12 の人）', () => {
    expect(m('12')).toEqual({ kind: 'ok', item: people[2], zeroPadded: false });
    expect(m('012')).toEqual({ kind: 'ok', item: people[3], zeroPadded: false });
  });
  it('0を補うと2人に当たるときは、黙って結ばない', () => {
    expect(m('0012')).toEqual({ kind: 'ambiguous' });
  });
  it('英字の入った番号は0を補わない。空は none', () => {
    expect(m('E1')).toEqual({ kind: 'none' });
    expect(m('')).toEqual({ kind: 'none' });
    expect(m('99')).toEqual({ kind: 'none' });
  });
  it('numberKey：長音やハイフンのような文字をそろえる', () => {
    expect(numberKey('Ａ－１２')).toBe('A-12');
    expect(numberKey('a‐12')).toBe('A-12');
  });
});

describe('isAfterNextMonth（来月より先の支払月。11/28）', () => {
  it('来月までは false、再来月から true（年をまたぐ）', () => {
    expect(isAfterNextMonth('2026-12', '2026-11-28')).toBeFalse();
    expect(isAfterNextMonth('2027-01', '2026-11-28')).toBeTrue();
    expect(isAfterNextMonth('2027-01', '2026-12-01')).toBeFalse();
    expect(isAfterNextMonth('2025-10', '2026-11-28')).toBeFalse();
  });
});
