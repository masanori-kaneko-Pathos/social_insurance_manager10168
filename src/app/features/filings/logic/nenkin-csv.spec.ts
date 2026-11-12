import { eraOf, NENKIN_HEADERS, NenkinPerson, nenkinRows, splitOfficeSymbol } from './nenkin-csv';

const person = (p: Partial<NenkinPerson> = {}, e: Partial<NenkinPerson['employee']> = {}): NenkinPerson => ({
  employee: {
    lastName: '厚年',
    firstName: '太郎',
    lastNameKana: 'コウネン',
    firstNameKana: 'タロウ',
    birthDate: '1957-02-07',
    sex: 'male',
    insuredNumber: '12',
    basicPensionNumber: '1234567890',
    health: { enrolled: true, acquiredDate: '2003-04-01' },
    pension: { enrolled: true, acquiredDate: '2003-04-01' },
    multipleOffices: false,
    ...e,
  },
  contact: { postalCode: '1688599', address: '東京都杉並区高井戸１－２－３' },
  previous: null,
  regular: null,
  bonus: null,
  over70: false,
  ...p,
});
const OFFICE = { prefecture: '13', officeSymbol: '01-イロハ', pensionFund: false };
const col = (row: string[], item: number) => row[item - 1];

describe('届書作成プログラム向け CSV', () => {
  it('57項目で、1行目は見出し', () => {
    expect(NENKIN_HEADERS.length).toBe(57);
    const { rows } = nenkinRows(OFFICE, [person()]);
    expect(rows[0].length).toBe(57);
    expect(rows[1].length).toBe(57);
  });

  it('事業所整理記号・氏名・生年月日・基礎年金番号・郵便番号・住所（仕様の例のとおり）', () => {
    const r = nenkinRows(OFFICE, [person()]).rows[1];
    expect([col(r, 1), col(r, 2), col(r, 3), col(r, 4)]).toEqual(['13', '01', 'ｲﾛﾊ', '12']);
    expect(col(r, 5)).toBe('ｺｳﾈﾝ ﾀﾛｳ');
    expect(col(r, 6)).toBe('厚年　太郎');
    expect([col(r, 7), col(r, 8)]).toEqual(['5', '320207']); // 昭和32年2月7日
    expect([col(r, 9), col(r, 10), col(r, 11)]).toEqual(['1', '1234', '567890']);
    expect([col(r, 12), col(r, 13), col(r, 15)]).toEqual(['168', '8599', '東京都杉並区高井戸１－２－３']);
    expect([col(r, 16), col(r, 17)]).toEqual(['7', '150401']); // 平成15年4月1日
    expect(col(r, 51)).toBe('1');
    expect(col(r, 54)).toBe(''); // 個人番号は出さない
  });

  it('算定（4〜6月）・遡及・従前の標準報酬', () => {
    const r = nenkinRows(OFFICE, [
      person({
        previous: { health: 300000, pension: 300000, from: '2025-09' },
        regular: {
          months: [
            { days: 30, cash: 310000, inKind: 0 },
            { days: 8, cash: 80000, inKind: null },
            null,
          ],
          retro: 20000,
        },
      }),
    ]).rows[1];
    expect([col(r, 18), col(r, 19), col(r, 20), col(r, 21), col(r, 22)]).toEqual(['0300', '0300', '9', '07', '09']);
    expect([col(r, 30), col(r, 31), col(r, 32)]).toEqual(['30', '310000', '0']);
    expect([col(r, 33), col(r, 34), col(r, 35)]).toEqual(['08', '80000', '0']);
    expect([col(r, 36), col(r, 37)]).toEqual(['', '']);
    expect(col(r, 40)).toBe('20000');
  });

  it('海外に住む人は郵便番号 999-9999、漢字の住所は省く', () => {
    const r = nenkinRows(OFFICE, [person({ contact: { postalCode: null, address: null, overseasCountry: 'GB' } })]).rows[1];
    expect([col(r, 12), col(r, 13), col(r, 15)]).toEqual(['999', '9999', '']);
  });

  it('使えない文字・12文字を超える氏名・整理番号なしは、省いて知らせる', () => {
    const { rows, issues } = nenkinRows(OFFICE, [
      person({}, { lastName: '髙橋', insuredNumber: null }),
    ]);
    expect(col(rows[1], 6)).toBe('');
    expect(issues.map((i) => i.kind)).toEqual(['noInsuredNumber', 'nameChars']);
    expect(issues[1].chars).toEqual(['髙']);
  });

  it('基金の加入員は種別 5・6、70歳以上・二以上の印', () => {
    const r = nenkinRows({ ...OFFICE, pensionFund: true }, [person({ over70: true }, { sex: 'female', multipleOffices: true })]).rows[1];
    expect([col(r, 9), col(r, 51), col(r, 55), col(r, 56)]).toEqual(['6', '2', '1', '1']);
  });
});

describe('小さな道具', () => {
  it('元号の数字と年（改元の日も）', () => {
    expect(eraOf('2019-04-30')).toEqual({ code: '7', yy: '31' });
    expect(eraOf('2019-05-01')).toEqual({ code: '9', yy: '01' });
  });
  it('事業所整理記号を分ける（ハイフンなし・全角も）', () => {
    expect(splitOfficeSymbol('01-イロハ')).toEqual(['01', 'ｲﾛﾊ']);
    expect(splitOfficeSymbol('０１ケマ')).toEqual(['01', 'ｹﾏ']);
    expect(splitOfficeSymbol(null)).toEqual(['', '']);
  });
});
