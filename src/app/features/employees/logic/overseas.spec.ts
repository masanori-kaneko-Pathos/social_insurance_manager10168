import type { Overseas } from '../../../core/models/employee';
import {
  certificateEndingSoon,
  currentOverseas,
  emptyOverseasForm,
  fromOverseasForm,
  overseasErrors,
  overseasOn,
  overseasOverlaps,
  overseasWarnings,
  OverseasPerson,
  payAbroadEnrolled,
  shiftDate,
} from './overseas';

const ov = (p: Partial<Overseas> = {}): Overseas => ({
  country: 'US',
  from: '2026-04-01',
  to: null,
  payer: 'japan',
  certificateFrom: null,
  certificateTo: null,
  note: null,
  ...p,
});

const AGREEMENTS = [
  { country: 'US', covers: 'pensionAndHealth' as const },
  { country: 'GB', covers: 'pension' as const },
];
// 1980-06-15 生まれ：40歳到達日 2020-06-14、65歳到達日 2045-06-14
const CARE_AGE = { from: '2020-06-14', to: '2045-06-14' };

const person = (p: Partial<OverseasPerson> = {}): OverseasPerson => ({
  id: 'e1',
  retireDate: null,
  overseas: [],
  health: { enrolled: true, lostDate: null },
  pension: { enrolled: true, lostDate: null },
  ...p,
});

describe('shiftDate：nか月後（前）の同じ日', () => {
  it('同じ日がなければ月末', () => {
    expect(shiftDate('2026-08-31', -6)).toBe('2026-02-28');
    expect(shiftDate('2031-03-31', -6)).toBe('2030-09-30');
    expect(shiftDate('2026-04-10', 6)).toBe('2026-10-10');
  });
});

describe('overseasOn・currentOverseas：今の海外勤務', () => {
  it('帰任の日は日本にいるとみなす', () => {
    const o = ov({ from: '2026-04-01', to: '2027-03-31' });
    expect(overseasOn(o, '2026-04-01')).toBeTrue();
    expect(overseasOn(o, '2027-03-30')).toBeTrue();
    expect(overseasOn(o, '2027-03-31')).toBeFalse();
  });

  it('今がなければ、次の赴任を返す', () => {
    const past = ov({ from: '2024-01-01', to: '2025-01-01' });
    const next = ov({ from: '2026-12-01' });
    expect(currentOverseas([past, next], '2026-11-12')).toBe(next);
    expect(currentOverseas([past], '2026-11-12')).toBeNull();
  });
});

describe('overseasOverlaps：期間の重なり', () => {
  it('帰任の日と次の赴任の日が同じなら重ならない', () => {
    const a = ov({ from: '2025-01-01', to: '2026-01-01' });
    expect(overseasOverlaps(ov({ from: '2026-01-01' }), [a])).toBeFalse();
    expect(overseasOverlaps(ov({ from: '2025-12-31' }), [a])).toBeTrue();
  });
});

describe('overseasWarnings：注意', () => {
  const base = { agreements: AGREEMENTS, careAge: CARE_AGE, careExemptions: [] };

  it('協定国で証明書がない → 二重加入', () => {
    expect(overseasWarnings({ ...base, item: ov() })).toContain('noCertificate');
    const withCert = ov({ certificateFrom: '2026-04-01', certificateTo: '2031-03-31' });
    expect(overseasWarnings({ ...base, item: withCert })).not.toContain('noCertificate');
  });

  it('協定が年金だけの国 → 医療保険の注意', () => {
    expect(overseasWarnings({ ...base, item: ov({ country: 'GB' }) })).toContain('pensionOnly');
  });

  it('協定のない国 → noAgreement', () => {
    expect(overseasWarnings({ ...base, item: ov({ country: 'TH' }) })).toContain('noAgreement');
  });

  it('海外の会社だけが払う → payAbroad（証明書・協定の注意は出さない）', () => {
    const w = overseasWarnings({ ...base, item: ov({ payer: 'abroad' }) });
    expect(w).toContain('payAbroad');
    expect(w).not.toContain('noCertificate');
  });

  it('証明書が5年を超える → overFiveYears（ちょうど5年はよい）', () => {
    const five = ov({ certificateFrom: '2026-04-01', certificateTo: '2031-03-31' });
    const over = ov({ certificateFrom: '2026-04-01', certificateTo: '2031-04-01' });
    expect(overseasWarnings({ ...base, item: five })).not.toContain('overFiveYears');
    expect(overseasWarnings({ ...base, item: over })).toContain('overFiveYears');
  });

  it('証明書が海外勤務の期間からはみ出す → certificateOutside', () => {
    const early = ov({ certificateFrom: '2026-03-01', certificateTo: '2027-03-31' });
    const late = ov({ to: '2027-01-01', certificateFrom: '2026-04-01', certificateTo: '2027-03-31' });
    expect(overseasWarnings({ ...base, item: early })).toContain('certificateOutside');
    expect(overseasWarnings({ ...base, item: late })).toContain('certificateOutside');
  });

  it('40〜64歳で介護の適用除外がない → careExemption。登録済みなら出さない', () => {
    expect(overseasWarnings({ ...base, item: ov() })).toContain('careExemption');
    const care = [{ from: '2026-04-01', to: null }];
    expect(overseasWarnings({ ...base, careExemptions: care, item: ov() })).not.toContain('careExemption');
    const young = { from: '2040-01-01', to: '2065-01-01' };
    expect(overseasWarnings({ ...base, careAge: young, item: ov({ to: '2027-03-31' }) })).not.toContain('careExemption');
  });
});

describe('overseasErrors・fromOverseasForm：入力', () => {
  it('国と赴任した日は必須。日本は選べない', () => {
    const e = overseasErrors(emptyOverseasForm());
    expect(e.country).toBe('required');
    expect(e.from).toBe('required');
    expect(overseasErrors({ ...emptyOverseasForm(), country: 'JP', from: '2026-04-01' }).country).toBe('country');
  });

  it('証明書の期間は両方そろえる・順番', () => {
    const v = { ...emptyOverseasForm(), country: 'US', from: '2026-04-01' };
    expect(overseasErrors({ ...v, certificateFrom: '2026-04-01' }).certificateTo).toBe('pair');
    expect(overseasErrors({ ...v, certificateTo: '2027-04-01' }).certificateFrom).toBe('pair');
    expect(overseasErrors({ ...v, certificateFrom: '2026-04-01', certificateTo: '2026-04-01' }).certificateTo).toBe('order');
  });

  it('空欄は null にして保存する', () => {
    const o = fromOverseasForm({ ...emptyOverseasForm(), country: 'US', from: '2026-04-01', note: '  ' });
    expect(o).toEqual(ov());
  });
});

describe('certificateEndingSoon：証明書の期限が近い', () => {
  const o = ov({ certificateFrom: '2026-04-01', certificateTo: '2031-03-31' });

  it('期限の6か月前から出る', () => {
    expect(certificateEndingSoon(person({ overseas: [o] }), '2030-09-29')).toBeNull();
    expect(certificateEndingSoon(person({ overseas: [o] }), '2030-09-30')).toBe(o);
  });

  it('期限を過ぎて60日までは出る', () => {
    expect(certificateEndingSoon(person({ overseas: [o] }), '2031-05-30')).toBe(o);
    expect(certificateEndingSoon(person({ overseas: [o] }), '2031-05-31')).toBeNull();
  });

  it('期限までに帰任するなら出ない', () => {
    const back = { ...o, to: '2031-04-01' };
    expect(certificateEndingSoon(person({ overseas: [back] }), '2031-01-01')).toBeNull();
    const stay = { ...o, to: '2031-06-30' };
    expect(certificateEndingSoon(person({ overseas: [stay] }), '2031-01-01')).toBe(stay);
  });

  it('退職した人は出ない', () => {
    expect(certificateEndingSoon(person({ overseas: [o], retireDate: '2030-12-31' }), '2031-01-01')).toBeNull();
  });
});

describe('payAbroadEnrolled：海外の会社だけが払うのに加入している', () => {
  const o = ov({ payer: 'abroad', from: '2027-01-01', to: '2028-01-01' });

  it('赴任の60日前から、帰任の前日まで', () => {
    expect(payAbroadEnrolled(person({ overseas: [o] }), '2026-11-01')).toBeNull();
    expect(payAbroadEnrolled(person({ overseas: [o] }), '2026-11-02')).toBe(o);
    expect(payAbroadEnrolled(person({ overseas: [o] }), '2027-12-31')).toBe(o);
    expect(payAbroadEnrolled(person({ overseas: [o] }), '2028-01-01')).toBeNull();
  });

  it('もう喪失している・日本の会社も払うなら出ない', () => {
    const lost = { enrolled: true, lostDate: '2027-01-01' };
    expect(payAbroadEnrolled(person({ overseas: [o], health: lost, pension: lost }), '2027-02-01')).toBeNull();
    expect(payAbroadEnrolled(person({ overseas: [{ ...o, payer: 'both' }] }), '2027-02-01')).toBeNull();
  });
});
