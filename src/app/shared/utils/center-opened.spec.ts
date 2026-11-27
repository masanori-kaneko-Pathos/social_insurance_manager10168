import { centerScrollY } from './center-opened';

describe('開いた行を真ん中へ（11/27）', () => {
  const base = { viewTop: 40, viewBottom: 840, scrollY: 1000 };

  it('収まるときは、上下の余白が同じ位置へ', () => {
    // 使える範囲 800、高さ 200 → 行の頭は 40 + 300 = 340 に来る。いま 700 なので 360 下へ
    expect(centerScrollY({ ...base, top: 700, bottom: 900 })).toBe(1360);
  });

  it('収まらないときは、行の頭を見出しのすぐ下へ', () => {
    expect(centerScrollY({ ...base, top: 600, bottom: 1600 })).toBe(1000 + 600 - 48);
  });

  it('上にはみ出している行は、上へ戻す', () => {
    expect(centerScrollY({ ...base, top: -100, bottom: 100 })).toBe(1000 - 100 - 340);
  });

  it('もう真ん中近くなら動かさない', () => {
    expect(centerScrollY({ ...base, top: 350, bottom: 550 })).toBeNull();
  });

  it('ページの上より上には動かさない', () => {
    expect(centerScrollY({ ...base, scrollY: 0, top: 0, bottom: 100 })).toBe(0);
  });
});
