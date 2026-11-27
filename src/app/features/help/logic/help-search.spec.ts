import { HELP_GROUPS, HELP_TOPICS, matchesHelp, normalizeForSearch } from './help-search';

describe('normalizeForSearch', () => {
  it('カタカナ → ひらがな、全角英数 → 半角、小文字', () => {
    expect(normalizeForSearch('ゲンブツ ＣＳＶ')).toBe('げんぶつ csv');
  });
});

describe('matchesHelp', () => {
  const text = '現物給与（社宅・食事）の入れ方。給与の実績の画面の「計算」から開きます。';
  it('空なら全部', () => {
    expect(matchesHelp(text, '  ')).toBeTrue();
  });
  it('「現物」で当たる', () => {
    expect(matchesHelp(text, '現物')).toBeTrue();
  });
  it('空白で区切ると「かつ」', () => {
    expect(matchesHelp(text, '現物 社宅')).toBeTrue();
    expect(matchesHelp(text, '現物 賞与')).toBeFalse();
  });
  it('カタカナで打っても、ひらがなの本文に当たる', () => {
    expect(matchesHelp('けいさん', 'ケイサン')).toBeTrue();
  });
});

describe('業務の内容の並び（11/27）', () => {
  it('業務の流れ以外の項目が、どこかのまとまりにちょうど1回ずつ入っている', () => {
    const inGroups = HELP_GROUPS.flatMap((g) => g.topics);
    const others = HELP_TOPICS.filter((t) => t !== 'flow');
    expect([...inGroups].sort()).toEqual([...others].sort());
    expect(new Set(inGroups).size).toBe(inGroups.length);
  });
});
