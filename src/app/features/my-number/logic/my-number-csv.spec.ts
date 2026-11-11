import { myNumberCsv, readMyNumberTable } from './my-number-csv';

describe('マイナンバーの書き出し', () => {
  it('社員番号の順・従業員がいない番号は出さない', () => {
    const t = myNumberCsv(
      [
        { employeeId: 'b', number: '111111111118' },
        { employeeId: 'a', number: '222222222225' },
        { employeeId: 'x', number: '333333333332' },
      ],
      [
        { id: 'a', employeeNumber: 'E10', lastName: '伊藤', firstName: '一郎' },
        { id: 'b', employeeNumber: 'E2', lastName: '佐藤', firstName: '花子' },
      ],
    );
    expect(t[0]).toEqual(['社員番号', '姓', '名', 'マイナンバー']);
    expect(t.slice(1).map((r) => r[0])).toEqual(['E2', 'E10']);
  });
});

describe('マイナンバーの取り込み（登録済みの従業員へ）', () => {
  const people = [
    { id: 'a', employeeNumber: '0012', lastName: '伊藤', firstName: '一郎' },
    { id: 'b', employeeNumber: 'E2', lastName: '佐藤', firstName: '花子' },
  ];
  it('社員番号で探す・先頭の0は無視・誤りは行ごとに', () => {
    const r = readMyNumberTable(
      [
        ['従業員番号', '氏名', '個人番号'],
        ['12', '伊藤', '1111-1111-1118'],
        ['E2', '佐藤', '111111111119'],
        ['E9', '?', '111111111118'],
        ['E2', '佐藤', ''],
      ],
      people,
    );
    expect(r.items).toEqual([{ line: 2, employeeId: 'a', number: '111111111118' }]);
    expect(r.errors.map((e) => e.code)).toEqual(['invalid', 'notFound']);
  });
  it('列がなければ知らせる', () => {
    expect(readMyNumberTable([['氏名']], people).missing).toEqual(['employeeNumber', 'myNumber']);
  });
});
