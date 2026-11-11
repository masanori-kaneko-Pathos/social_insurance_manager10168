import { excelCellText, looksTabbed, tidy } from './parse';

// SheetJS の SSF.is_date の代わり（日付・時刻の書式の文字があるか）
const isDate = (fmt: string) => /[ymdhs]/i.test(fmt.replace(/"[^"]*"/g, '').replace(/\[\$[^\]]*\]/g, ''));

describe('parse：Excel のセル', () => {
  it('日付の書式の数は YYYY-MM-DD', () => {
    expect(excelCellText({ t: 'n', v: 46113, z: 'yyyy/m/d' }, isDate)).toBe('2026-04-01');
    expect(excelCellText({ t: 'n', v: 46113, z: '[$-411]ggge"年"m"月"d"日"' }, isDate)).toBe('2026-04-01');
  });

  it('時刻・経過時間の書式の数は H:MM（40:00 は Excel では 1.666… 日）', () => {
    expect(excelCellText({ t: 'n', v: 40 / 24, z: '[h]:mm' }, isDate)).toBe('40:00');
    expect(excelCellText({ t: 'n', v: 20.5 / 24, z: '[h]:mm' }, isDate)).toBe('20:30');
    expect(excelCellText({ t: 'n', v: 8 / 24, z: 'h:mm' }, isDate)).toBe('8:00');
  });

  it('ふつうの数は表示の形ではなく数そのもの', () => {
    expect(excelCellText({ t: 'n', v: 300000, z: '#,##0' }, isDate)).toBe('300000');
    expect(excelCellText({ t: 'n', v: 21 }, isDate)).toBe('21');
  });

  it('文字・真偽・エラー・空', () => {
    expect(excelCellText({ t: 's', v: '山田' }, isDate)).toBe('山田');
    expect(excelCellText({ t: 'b', v: true }, isDate)).toBe('TRUE');
    expect(excelCellText({ t: 'e', v: 7 }, isDate)).toBe('');
    expect(excelCellText(undefined, isDate)).toBe('');
  });
});

describe('parse：表の形をそろえる', () => {
  it('空の行を除き、列の数をそろえる', () => {
    expect(tidy([['a', 'b'], ['', ' '], ['c']])).toEqual([['a', 'b'], ['c', '']]);
  });

  it('タブ区切りの見分け', () => {
    expect(looksTabbed('社員番号\t氏名\n1\t山田')).toBeTrue();
    expect(looksTabbed('社員番号,氏名\t\n')).toBeFalse();
  });
});
