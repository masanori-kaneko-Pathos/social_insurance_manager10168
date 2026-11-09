import { bonusChanges, changesOf, displayValue, flatten, MAX_VALUE_LENGTH, summarize, toValue } from './history';

describe('flatten', () => {
  it('まとまりは中まで、配列は丸ごと。作成・更新の日時は比べない', () => {
    const m = flatten({ name: 'A', contact: { address: 'x', phone: null }, leaves: [{ kind: 'maternity' }], updatedAt: 1 });
    expect([...m.keys()]).toEqual(['name', 'contact.address', 'contact.phone', 'leaves']);
  });
});

describe('changesOf', () => {
  it('変わった項目だけ。変更前・変更後は JSON の文字', () => {
    const c = changesOf(
      { lastName: '山田', contact: { address: '東京都', phone: null }, updatedAt: 1 },
      { lastName: '山田', contact: { address: '大阪府', phone: '0612345678' }, updatedAt: 2 },
    );
    expect(c).toEqual([
      { field: 'contact.address', before: '"東京都"', after: '"大阪府"' },
      { field: 'contact.phone', before: 'null', after: '"0612345678"' },
    ]);
  });
  it('項目が増えた・減った（古いデータに項目がない）も記録する', () => {
    expect(changesOf({ a: 1 }, { a: 1, optOutDate: '2027-01-01' })).toEqual([
      { field: 'optOutDate', before: 'null', after: '"2027-01-01"' },
    ]);
  });
  it('作成は「*」で変更後だけ、削除は「*」で変更前だけ', () => {
    expect(changesOf(null, { from: '2026-09', monthlyAmount: 300000, createdAt: 1 })).toEqual([
      { field: '*', before: null, after: '{"from":"2026-09","monthlyAmount":300000}' },
    ]);
    expect(changesOf({ from: '2026-09' }, null)[0].after).toBeNull();
  });
  it('何も変わっていなければ空', () => {
    expect(changesOf({ a: [1, 2], b: { c: 1 } }, { a: [1, 2], b: { c: 1 } })).toEqual([]);
  });
  it('配列の中が変われば、配列ごと1件', () => {
    const c = changesOf({ leaves: [{ end: null }] }, { leaves: [{ end: '2026-07-31' }] });
    expect(c.map((x) => x.field)).toEqual(['leaves']);
  });
});

describe('toValue / displayValue', () => {
  it('長すぎる値は切る（ルールの上限に収める）', () => {
    expect(toValue('x'.repeat(10000))!.length).toBe(MAX_VALUE_LENGTH);
  });
  it('読める形に', () => {
    expect(displayValue('"東京都"')).toBe('東京都');
    expect(displayValue('300000')).toBe('300,000');
    expect(displayValue('true')).toBe('はい');
    expect(displayValue('null')).toBe('—');
    expect(displayValue(null)).toBe('—');
    expect(displayValue('[1,2,3]')).toBe('3件');
  });
});

describe('summarize：まとめて1件に', () => {
  it('2つ以上変わったら、項目を並べて、その項目だけの組', () => {
    expect(summarize({ cash: 300000, days: 31, fixed: 280000 }, { cash: 310000, days: 30, fixed: 280000 })).toEqual({
      field: 'cash,days',
      before: '{"cash":300000,"days":31}',
      after: '{"cash":310000,"days":30}',
    });
  });
  it('1つだけならその項目の記録。変わらなければ null', () => {
    expect(summarize({ cash: 1 }, { cash: 2 })?.field).toBe('cash');
    expect(summarize({ cash: 1 }, { cash: 1 })).toBeNull();
  });
});

describe('bonusChanges：賞与の額が変わった人ごと', () => {
  it('足した人・消した人・額を変えた人。変わらない人は出さない', () => {
    const m = bonusChanges(
      { amounts: { A: 500000, B: 300000, C: 100000 } },
      { amounts: { A: 500000, B: 320000, D: 50000 } },
    );
    expect([...m.keys()]).toEqual(['B', 'C', 'D']);
    expect(m.get('B')).toEqual({ field: 'amount', before: '300000', after: '320000' });
    expect(m.get('C')?.after).toBeNull();
    expect(m.get('D')?.before).toBeNull();
  });
});
