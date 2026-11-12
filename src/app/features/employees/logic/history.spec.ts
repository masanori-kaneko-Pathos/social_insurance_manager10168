import {
  valuesAt,
  bonusChanges,
  changesOf,
  displayValue,
  flatten,
  MAX_VALUE_LENGTH,
  recordSummary,
  summarize,
  toValue,
} from './history';

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

describe('recordSummary：登録・削除の行の要約', () => {
  const ja: Record<string, string> = {
    'contract.employmentType.part': 'パート',
    'dependent.relationship.spouse': '配偶者（夫・妻）',
    'history.summary.private': '住所・連絡先・通勤・口座',
    'history.summary.remuneration': '健保 {health}級・厚年 {pension}級（報酬月額 {amount}円）',
    'history.summary.payroll': '支払額 {cash}円',
  };
  const label = (k: string) => ja[k] ?? k;
  it('従業員は氏名', () => {
    expect(recordSummary('employee', JSON.stringify({ lastName: '田中', firstName: '花子', source: 'csv' }), label)).toBe('田中 花子');
  });
  it('契約は始まる日と雇用の形（選択肢は言葉に直す）', () => {
    expect(recordSummary('contracts', JSON.stringify({ from: '2026-04-01', employmentType: 'part' }), label)).toBe('2026-04-01〜 パート');
  });
  it('標準報酬は等級と報酬月額', () => {
    const r = { health: { grade: 6, standard: 104000 }, pension: { grade: 3, standard: 104000 }, monthlyAmount: 104000 };
    expect(recordSummary('remunerations', JSON.stringify(r), label)).toBe('健保 6級・厚年 3級（報酬月額 104,000円）');
  });
  it('扶養家族は氏名と続柄', () => {
    expect(recordSummary('dependents', JSON.stringify({ lastName: '田中', firstName: '一郎', relationship: 'spouse' }), label)).toBe('田中 一郎（配偶者（夫・妻））');
  });
  it('鍵付きの文書は中身を出さない', () => {
    expect(recordSummary('details', JSON.stringify({ contact: { address: '東京都' } }), label)).toBe('住所・連絡先・通勤・口座');
  });
  it('知らない種類・壊れた中身は null', () => {
    expect(recordSummary('xyz', '{}', label)).toBeNull();
    expect(recordSummary('employee', 'not json', label)).toBeNull();
    expect(recordSummary('employee', null, label)).toBeNull();
  });
});

describe('valuesAt：その日の時点の値', () => {
  const h = (field: string, before: string | null, after: string | null, at: number, target = 'employee') => ({
    target,
    field,
    before,
    after,
    at,
  });
  it('その日より後の変更だけを巻き戻す（いちばん古い変更前 → いちばん新しい変更後）', () => {
    const list = [h('lastName', '"佐藤"', '"山田"', 10), h('contact.address', '"A"', '"B"', 30), h('contact.address', '"B"', '"C"', 40)];
    expect(valuesAt(list, 20)).toEqual([{ target: 'employee', field: 'contact.address', then: '"A"', now: '"C"' }]);
    expect(valuesAt(list, 5).map((v) => v.field)).toEqual(['lastName', 'contact.address']);
  });
  it('変えて戻した項目は出さない', () => {
    expect(valuesAt([h('lastName', '"A"', '"B"', 10), h('lastName', '"B"', '"A"', 20)], 5)).toEqual([]);
  });
});
