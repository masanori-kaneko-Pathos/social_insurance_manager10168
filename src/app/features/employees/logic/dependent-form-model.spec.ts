import { Dependent } from '../../../core/models/dependent';
import {
  annualFromMonthly,
  contractWageCandidate,
  dependentErrors,
  DependentFormValue,
  emptyDependentForm,
  fromDependentForm,
  sortDependents,
  startReasonsOf,
  toDependentForm,
} from './dependent-form-model';

function spouse(): DependentFormValue {
  return {
    ...emptyDependentForm('2026-04-01'),
    lastName: '年金',
    firstName: '花子',
    lastNameKana: 'ネンキン',
    firstNameKana: 'ハナコ',
    birthDate: '1962-03-26',
    sex: 'female',
    basicPensionNumber: '1234-567890',
    postalCode: '１６８-８５００',
    address: '東京都杉並区高井戸1-1-1',
    phone: '090-1234-5678',
    phoneType: 'mobile',
    occupation: 'partTime',
    annualIncome: '0',
    startReason: 'marriage',
  };
}

function parentApart(): DependentFormValue {
  return {
    ...spouse(),
    lastName: '年金',
    firstName: 'イチ子',
    firstNameKana: 'イチコ',
    birthDate: '1939-07-07',
    relationship: 'parent',
    livingTogether: false,
    address: '大阪府大阪市北区梅田1-1-1',
    remittance: '150,000',
    remittanceTimes: '12',
    startReason: 'incomeDecrease',
  };
}

describe('dependentErrors', () => {
  it('ちゃんと入っていればエラーなし', () => {
    expect(dependentErrors(spouse())).toEqual({});
    expect(dependentErrors(parentApart())).toEqual({});
  });
  it('別居なら住所が必須（同居なら要らない）', () => {
    expect(dependentErrors({ ...parentApart(), address: ' ' }).address).toBe('required');
    expect(dependentErrors({ ...spouse(), address: '' }).address).toBeUndefined();
  });
  it('必須・カナ・番号の形', () => {
    const e = dependentErrors({ ...spouse(), lastName: '', lastNameKana: 'ねんきん', basicPensionNumber: '123', postalCode: '12' });
    expect(e.lastName).toBe('required');
    expect(e.lastNameKana).toBe('kana');
    expect(e.basicPensionNumber).toBe('basicPensionNumber');
    expect(e.postalCode).toBe('postalCode');
  });
  it('「その他」の続柄は中身が要る', () => {
    expect(dependentErrors({ ...parentApart(), relationship: 'other' }).relationshipNote).toBe('required');
  });
  it('扶養に入った理由は続柄に合うものだけ（配偶者に「出生」はない）', () => {
    expect(dependentErrors({ ...spouse(), startReason: 'birth' }).startReason).toBe('reasonMismatch');
    expect(startReasonsOf('child')).toContain('birth');
  });
  it('外れた日：入った日より後で、理由が要る。離婚は配偶者だけ', () => {
    expect(dependentErrors({ ...spouse(), to: '2026-04-01' }).to).toBe('toBeforeFrom');
    expect(dependentErrors({ ...spouse(), to: '2026-09-01' }).endReason).toBe('required');
    expect(dependentErrors({ ...parentApart(), to: '2026-09-01', endReason: 'divorce' }).endReason).toBe('reasonMismatch');
  });
  it('入った日は生年月日より後', () => {
    expect(dependentErrors({ ...spouse(), from: '1960-01-01' }).from).toBe('fromBeforeBirth');
  });
  it('労働契約の方式なら契約の年収が要る', () => {
    expect(dependentErrors({ ...spouse(), incomeBasis: 'contract' }).contractAnnualWage).toBe('yen');
  });
});

describe('fromDependentForm', () => {
  it('配偶者：番号は数字だけ、電話は数字だけ', () => {
    const r = fromDependentForm(spouse())!;
    expect(r.basicPensionNumber).toBe('1234567890');
    expect(r.postalCode).toBe('1688500');
    expect(r.phone).toBe('09012345678');
    expect(r.remittance).toBeNull(); // 同居
  });
  it('配偶者以外：配偶者だけの欄は消す。別居なら仕送りを残す', () => {
    const r = fromDependentForm({ ...parentApart(), commonLaw: true, alias: 'x' })!;
    expect(r.commonLaw).toBeFalse();
    expect(r.alias).toBeNull();
    expect(r.basicPensionNumber).toBeNull();
    expect(r.phone).toBeNull();
    expect(r.remittance).toBe(150000);
    expect(r.remittanceTimes).toBe(12);
  });
  it('外れていなければ外れた理由は消す／学生でなければ学年は消す', () => {
    const r = fromDependentForm({ ...spouse(), endReason: 'death', schoolYear: '2' })!;
    expect(r.to).toBeNull();
    expect(r.endReason).toBeNull();
    expect(r.schoolYear).toBeNull();
  });
  it('海外特例要件・労働契約', () => {
    const r = fromDependentForm({
      ...spouse(),
      hasOverseas: true,
      overseasReason: 'accompany',
      overseasFrom: '2026-05-01',
      incomeBasis: 'contract',
      contractAnnualWage: '1,250,000',
      contractHoursClear: false,
    })!;
    expect(r.overseas).toEqual({ reason: 'accompany', reasonText: null, from: '2026-05-01', to: null, endReason: null, endReasonText: null });
    expect(r.contractIncome).toEqual({ annualWage: 1250000, periodEnd: null, hoursClear: false, allowancesClear: true });
  });
  it('チェックを通らなければ null', () => {
    expect(fromDependentForm({ ...spouse(), birthDate: '' })).toBeNull();
  });
  it('保存した形 → 画面 → 保存した形 で戻る', () => {
    for (const v of [spouse(), parentApart(), { ...spouse(), to: '2026-10-01', endReason: 'other' as const, endReasonText: '転居' }]) {
      const input = fromDependentForm(v)!;
      expect(fromDependentForm(toDependentForm(input))).toEqual(input);
    }
  });
});

describe('候補', () => {
  it('月額 × 12', () => {
    expect(annualFromMonthly('108,333')).toBe(1299996);
    expect(annualFromMonthly('')).toBeNull();
  });
  it('契約の年収：時給 × 週の時間 × 52 ＋ 手当 × 12 ＋ 賞与', () => {
    const v = { ...spouse(), contractHourly: '1,100', contractWeeklyHours: '20', contractAllowances: '5,000', contractBonus: '50000' };
    // 1,100 × 20 × 52 = 1,144,000 ＋ 60,000 ＋ 50,000
    expect(contractWageCandidate(v)).toBe(1254000);
    expect(contractWageCandidate({ ...v, contractHourly: '' })).toBeNull();
  });
});

describe('sortDependents', () => {
  it('扶養中が上（配偶者 → 年上から）、外れた人が下', () => {
    const rows = [
      { id: 'c2', relationship: 'child', birthDate: '2015-01-01', to: null },
      { id: 'ex', relationship: 'parent', birthDate: '1940-01-01', to: '2026-01-01' },
      { id: 'c1', relationship: 'child', birthDate: '2012-01-01', to: null },
      { id: 'sp', relationship: 'spouse', birthDate: '1990-01-01', to: null },
    ] as Dependent[];
    expect(sortDependents(rows, '2026-11-06').map((r) => r.id)).toEqual(['sp', 'c1', 'c2', 'ex']);
  });
});
