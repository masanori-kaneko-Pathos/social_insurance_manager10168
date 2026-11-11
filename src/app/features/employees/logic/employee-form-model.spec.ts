import { EmployeeFull, employeeExtras } from '../../../core/models/employee';
import {
  emptyEmployeeForm,
  EmployeeFormValue,
  fromEmployeeForm,
  hoursToMinutes,
  PATTERNS,
  toEmployeeForm,
} from './employee-form-model';

function filledForm(): EmployeeFormValue {
  const v = emptyEmployeeForm();
  return {
    ...v,
    employeeNumber: '0012',
    lastName: ' テスト ',
    firstName: '一郎',
    lastNameKana: 'テスト',
    firstNameKana: 'イチロウ',
    birthDate: '1990-05-10',
    sex: 'male',
    hireDate: '2024-04-01',
    health: { enrolled: true, acquiredDate: '2024-04-01', lostDate: '', lossReason: '' },
    pension: { enrolled: true, acquiredDate: '2024-04-01', lostDate: '', lossReason: '' },
    basicPensionNumber: '１２３４-５６７８９０',
    contact: { ...v.contact, postalCode: '100-0001', address: '東京都千代田区', phone: '03-1234-5678', email: '' },
  };
}

describe('fromEmployeeForm', () => {
  it('電話：備考と、追加の電話（番号のない欄は捨てる）', () => {
    const v = filledForm();
    const r = fromEmployeeForm({
      ...v,
      contact: { ...v.contact, phoneNote: ' 本人携帯 ', phone2: '', phone2Note: '自宅', phone3: '090-1111-2222', phone3Note: '会社支給携帯' },
    });
    expect(r.contact.phoneNote).toBe('本人携帯');
    expect(r.contact.otherPhones).toEqual([{ number: '09011112222', note: '会社支給携帯' }]);
  });

  it('空欄は null、前後の空白は取る、番号はハイフン・全角を取って数字だけ', () => {
    const r = fromEmployeeForm(filledForm());
    expect(r.lastName).toBe('テスト');
    expect(r.retireDate).toBeNull();
    expect(r.basicPensionNumber).toBe('1234567890');
    expect(r.contact.postalCode).toBe('1000001');
    expect(r.contact.email).toBeNull();
    expect(r.sex).toBe('male');
    expect(r.collectionMethod).toBeNull(); // 事業所の設定のまま
    expect(r.foreign).toBeNull();
    expect(r.nameOrder).toBe('kana');
    expect(r.contact.phone).toBe('0312345678'); // 電話も数字だけ
  });

  it('退職日がなければ退職の理由は消す／喪失日がなければ喪失の原因は消す', () => {
    const v = filledForm();
    v.retireReason = 'resign';
    v.health.lossReason = 'retire';
    const r = fromEmployeeForm(v);
    expect(r.retireReason).toBeNull();
    expect(r.health.lossReason).toBeNull();
  });

  it('退職日・喪失日があれば理由も残す', () => {
    const v = filledForm();
    v.retireDate = '2026-08-20';
    v.retireReason = 'resign';
    v.health.lostDate = '2026-08-21';
    v.health.lossReason = 'retire';
    const r = fromEmployeeForm(v);
    expect(r.retireReason).toBe('resign');
    expect(r.health.lossReason).toBe('retire');
  });

  it('外国人の情報：大文字にそろえ、資格外活動の時間は分に、許可がなければ時間は null', () => {
    const v = filledForm();
    v.hasForeign = true;
    v.foreign = {
      ...v.foreign,
      romanLastName: 'nguyen',
      romanFirstName: ' van  a ',
      nationality: 'vn',
      residenceCardNumber: 'ab12345678cd',
      workPermit: true,
      workPermitHours: '28',
      hasCertificate: false,
    };
    const r = fromEmployeeForm(v);
    expect(r.foreign?.romanLastName).toBe('NGUYEN');
    expect(r.foreign?.romanFirstName).toBe('VAN A');
    // 届書に使う氏名はローマ字（初期値）を写す。並びは A〜Z
    expect(r.lastName).toBe('NGUYEN');
    expect(r.firstName).toBe('VAN A');
    expect(r.nameOrder).toBe('roman');
    expect(r.foreign?.nationality).toBe('VN');
    expect(r.foreign?.residenceCardNumber).toBe('AB12345678CD');
    expect(r.foreign?.workPermitWeeklyMinutes).toBe(1680);
    expect(r.foreign?.certificate).toBeNull();

    v.foreign.workPermit = false;
    expect(fromEmployeeForm(v).foreign?.workPermitWeeklyMinutes).toBeNull();
  });

  it('外国人のチェックを外すと、入れた情報は保存しない', () => {
    const v = filledForm();
    v.foreign.romanLastName = 'X';
    v.hasForeign = false;
    expect(fromEmployeeForm(v).foreign).toBeNull();
  });
});

describe('外国籍の氏名', () => {
  function foreignForm(): EmployeeFormValue {
    const v = filledForm();
    v.hasForeign = true;
    v.lastName = '';
    v.firstName = '';
    v.lastNameKana = 'ホン';
    v.firstNameKana = 'キルトン';
    v.foreign = {
      ...v.foreign,
      romanLastName: 'hong',
      romanFirstName: 'kildong',
      kanjiName: { last: '洪', first: '吉童', lastKana: 'コウ', firstKana: 'キツドウ' },
      alias: { last: '住基', first: '太郎', lastKana: 'ジュウキ', firstKana: 'タロウ' },
      nationality: 'KR',
    };
    return v;
  }

  it('取得届に使う氏名で lastName・firstName が決まる（フリガナは届書のもの）', () => {
    const v = foreignForm();
    expect(fromEmployeeForm(v).lastName).toBe('HONG');
    v.foreign.filingName = 'kanji';
    expect(fromEmployeeForm(v).lastName).toBe('洪');
    v.foreign.filingName = 'alias';
    const r = fromEmployeeForm(v);
    expect(r.lastName).toBe('住基');
    expect(r.firstName).toBe('太郎');
    expect(r.lastNameKana).toBe('ホン');
  });

  it('ミドルネームは名に続ける', () => {
    const v = foreignForm();
    v.foreign.romanMiddleName = 'ivanovich';
    expect(fromEmployeeForm(v).firstName).toBe('KILDONG IVANOVICH');
  });

  it('漢字氏名・通称が4つとも空なら null', () => {
    const v = foreignForm();
    v.foreign.alias = { last: '', first: ' ', lastKana: '', firstKana: '' };
    expect(fromEmployeeForm(v).foreign?.alias).toBeNull();
  });

  it('ローマ字があれば「ない理由」は消す。なければ理由を残し、届書の氏名はカナ', () => {
    const v = foreignForm();
    v.foreign.noRomanReason = 'other';
    v.foreign.noRomanReasonText = 'x';
    expect(fromEmployeeForm(v).foreign?.noRomanReason).toBeNull();
    v.foreign.romanLastName = '';
    v.foreign.romanFirstName = '';
    const r = fromEmployeeForm(v);
    expect(r.foreign?.noRomanReason).toBe('other');
    expect(r.foreign?.noRomanReasonText).toBe('x');
    expect(r.lastName).toBe('ホン');
  });

  it('「カナの読みで並べる」なら nameOrder は kana', () => {
    const v = foreignForm();
    v.sortByKana = true;
    expect(fromEmployeeForm(v).nameOrder).toBe('kana');
  });
});

describe('toEmployeeForm と fromEmployeeForm は行き来できる', () => {
  it('保存した形 → 画面 → 保存した形', () => {
    const input = fromEmployeeForm({
      ...filledForm(),
      hasForeign: true,
      foreign: {
        ...emptyEmployeeForm().foreign,
        romanLastName: 'TRAN',
        romanFirstName: 'THI B',
        kanjiName: { last: '陳', first: '氏', lastKana: 'チン', firstKana: 'シ' },
        filingName: 'kanji',
        nationality: 'VN',
        workPermit: true,
        workPermitHours: '27.5',
        hasCertificate: true,
        certCountry: 'DE',
        certFrom: '2026-04-01',
        certTo: '2029-03-31',
        certCovers: 'pensionAndHealth',
      },
    });
    const e = { id: 'A', ...input, ...employeeExtras() } as unknown as EmployeeFull;
    expect(fromEmployeeForm(toEmployeeForm(e))).toEqual(input);
    // カナで並べる外国籍の人も戻る
    const kanaInput = { ...input, nameOrder: 'kana' as const };
    const e2 = { id: 'B', ...kanaInput, ...employeeExtras() } as unknown as EmployeeFull;
    expect(fromEmployeeForm(toEmployeeForm(e2))).toEqual(kanaInput);
  });
});

describe('小さな道具', () => {
  it('hoursToMinutes', () => {
    expect(hoursToMinutes('28')).toBe(1680);
    expect(hoursToMinutes('２８')).toBe(1680);
    expect(hoursToMinutes('27.5')).toBe(1650);
    expect(hoursToMinutes('abc')).toBeNull();
  });
  it('PATTERNS', () => {
    expect(PATTERNS.postalCode.test('1000001')).toBeTrue();
    expect(PATTERNS.postalCode.test('100-0001')).toBeTrue();
    expect(PATTERNS.basicPensionNumber.test('1234-567890')).toBeTrue();
    expect(PATTERNS.basicPensionNumber.test('123456789')).toBeFalse();
    expect(PATTERNS.residenceCard.test('AB12345678CD')).toBeTrue();
    expect(PATTERNS.phone.test('03-1234-5678')).toBeTrue();
    expect(PATTERNS.phone.test('+81 90 1234 5678')).toBeTrue();
    expect(PATTERNS.phone.test('abc')).toBeFalse();
    expect(PATTERNS.roman.test("O'BRIEN")).toBeTrue();
    expect(PATTERNS.roman.test('グエン')).toBeFalse();
  });
});
