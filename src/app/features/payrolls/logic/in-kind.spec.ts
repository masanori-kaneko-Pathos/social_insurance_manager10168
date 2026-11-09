import type { InKindPrefecture } from '../../../core/models/master';
import { emptyInKindForm, housingValue, inKindAmount, inKindTableAt, prorationOf, readInKindForm } from './in-kind';

// 東京（seed/master-in-kind.json と同じ値）
const TOKYO_TATAMI: InKindPrefecture = {
  name: '東京',
  meal: { month: 25500, day: 850, breakfast: 210, lunch: 300, dinner: 340 },
  housing: 2830,
};
const TOKYO_SQM: InKindPrefecture = { ...TOKYO_TATAMI, housing: 1330 };
const SAGA_SQM: InKindPrefecture = {
  name: '佐賀',
  meal: { month: 24300, day: 810, breakfast: 200, lunch: 280, dinner: 330 },
  housing: 510,
};

const meal = (p: Partial<{ fullMonth: boolean; breakfasts: number; lunches: number; dinners: number; employeePays: number }>) => ({
  fullMonth: false, breakfasts: 0, lunches: 0, dinners: 0, employeePays: 0, ...p,
});

describe('inKindTableAt：その月の表', () => {
  const tables = [{ from: '2026-04' }, { from: '2026-10' }];
  it('2026-09 は畳の表、2026-10 から㎡の表', () => {
    expect(inKindTableAt(tables, '2026-09')?.from).toBe('2026-04');
    expect(inKindTableAt(tables, '2026-10')?.from).toBe('2026-10');
    expect(inKindTableAt(tables, '2027-03')?.from).toBe('2026-10');
  });
  it('表より前の月は null', () => {
    expect(inKindTableAt(tables, '2026-03')).toBeNull();
  });
});

describe('食事', () => {
  it('3食とも毎日 → 月額', () => {
    expect(inKindAmount(TOKYO_SQM, { meal: meal({ fullMonth: true }), housing: null }).total).toBe(25500);
  });

  it('昼食だけ20回 → 300 × 20', () => {
    expect(inKindAmount(TOKYO_SQM, { meal: meal({ lunches: 20 }), housing: null }).total).toBe(6000);
  });

  it('本人負担が3分の2以上なら報酬に入れない（6000 の 2/3 ＝ 4000）', () => {
    const r = inKindAmount(TOKYO_SQM, { meal: meal({ lunches: 20, employeePays: 4000 }), housing: null });
    expect(r.meal?.twoThirds).toBeTrue();
    expect(r.total).toBe(0);
  });

  it('3分の2 未満なら 価額 − 本人負担', () => {
    const r = inKindAmount(TOKYO_SQM, { meal: meal({ lunches: 20, employeePays: 3999 }), housing: null });
    expect(r.meal?.twoThirds).toBeFalse();
    expect(r.total).toBe(2001);
  });
});

describe('住宅', () => {
  it('2026-09 まで：1畳 2,830円 × 12畳', () => {
    expect(inKindAmount(TOKYO_TATAMI, { meal: null, housing: { size: 12, proration: null, employeePays: 0 } }).total).toBe(33960);
  });

  it('2026-10 から：1㎡ 1,330円 × 25.5㎡（1円未満なし）、本人負担を引く', () => {
    const r = inKindAmount(TOKYO_SQM, { meal: null, housing: { size: 25.5, proration: null, employeePays: 10000 } });
    expect(r.housing?.value).toBe(33915);
    expect(r.total).toBe(23915);
  });

  it('1円未満は切り捨て（佐賀 510円 × 20.15㎡ ＝ 10276.5）', () => {
    expect(housingValue(SAGA_SQM, { size: 20.15, proration: null, employeePays: 0 })).toBe(10276);
  });

  it('本人負担が価額より多ければ 0（マイナスにしない）', () => {
    expect(inKindAmount(SAGA_SQM, { meal: null, housing: { size: 10, proration: null, employeePays: 9999 } }).total).toBe(0);
  });
});

describe('食事と住宅の合計', () => {
  it('佐賀：朝・夕を20回ずつ ＋ 30㎡', () => {
    const r = inKindAmount(SAGA_SQM, {
      meal: meal({ breakfasts: 20, dinners: 20 }),
      housing: { size: 30, proration: null, employeePays: 5000 },
    });
    expect(r.meal?.counted).toBe(10600); // (200 + 330) × 20
    expect(r.housing?.counted).toBe(10300); // 510 × 30 − 5000
    expect(r.total).toBe(20900);
  });
});

describe('readInKindForm', () => {
  it('何も選んでいない', () => {
    expect(readInKindForm(emptyInKindForm(), '2026-11')).toEqual({ errors: ['nothing'] });
  });

  it('広さの形', () => {
    const v = { ...emptyInKindForm(), useHousing: true, size: '25.555' };
    expect(readInKindForm(v, '2026-11')).toEqual({ errors: ['size'] });
  });

  it('読める（カンマ入りの円、空欄は 0）', () => {
    const v = { ...emptyInKindForm(), useMeal: true, lunches: '20', mealPays: '1,000', useHousing: true, size: '25.5' };
    expect(readInKindForm(v, '2026-11')).toEqual({
      input: {
        meal: { fullMonth: false, breakfasts: 0, lunches: 20, dinners: 0, employeePays: 1000 },
        housing: { size: 25.5, proration: null, employeePays: 0 },
      },
    });
  });
});

describe('年金機構 Q&A の例（2026.pdf）', () => {
  it('Q10 パターン①：東京 月25,500円、本人負担10,000円（2/3 ＝ 17,000円より少ない）→ 15,500円', () => {
    const r = inKindAmount(TOKYO_SQM, { meal: meal({ fullMonth: true, employeePays: 10000 }), housing: null });
    expect(r.total).toBe(15500);
  });

  it('Q10 パターン②：本人負担17,000円（2/3 と同じ額）→ 0円（食事の供与はないものとして扱う）', () => {
    const r = inKindAmount(TOKYO_SQM, { meal: meal({ fullMonth: true, employeePays: 17000 }), housing: null });
    expect(r.meal?.twoThirds).toBeTrue();
    expect(r.total).toBe(0);
  });

  it('Q7：4/11 に6畳の社宅へ入居（東京）→ 16,980円 × 20/30 ＝ 11,320円', () => {
    const proration = prorationOf('2026-04-11', '2026-04');
    expect(proration).toEqual({ days: 20, daysInMonth: 30 });
    expect(housingValue(TOKYO_TATAMI, { size: 6, proration, employeePays: 0 })).toBe(11320);
  });

  it('日割の1円未満は最後に1回だけ切り捨て（佐賀 510円 × 20.15㎡ × 10/31）', () => {
    // 10276.5 × 10 / 31 ＝ 3315.0…
    expect(housingValue(SAGA_SQM, { size: 20.15, proration: { days: 10, daysInMonth: 31 }, employeePays: 0 })).toBe(3315);
  });

  it('1日に入居したら1か月まるごと。その月でない日はエラー', () => {
    expect(prorationOf('2026-11-01', '2026-11')).toBeNull();
    const v = { ...emptyInKindForm(), useHousing: true, size: '6', movedIn: '2026-10-15' };
    expect(readInKindForm(v, '2026-11')).toEqual({ errors: ['movedIn'] });
  });
});
