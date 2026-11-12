import { emptyPayrollInput } from '../../../core/models/payroll';
import { candidateDays, PayrollRowText, readRow, sameInput, textOf, totalOf } from './payroll-input';
import { formatHours, parseHours, parseNat } from '../../../shared/utils/number';

const blank = (): PayrollRowText => textOf(null);

describe('parseNat', () => {
  it('カンマ・全角を読む', () => {
    expect(parseNat('320,000')).toBe(320000);
    expect(parseNat('３２００００')).toBe(320000);
    expect(parseNat(' 31 ')).toBe(31);
  });
  it('空欄は null、読めないものは undefined', () => {
    expect(parseNat('')).toBeNull();
    expect(parseNat('1.5')).toBeUndefined();
    expect(parseNat('-1')).toBeUndefined();
    expect(parseNat('abc')).toBeUndefined();
  });
});

describe('parseHours / formatHours', () => {
  it('3つの書き方', () => {
    expect(parseHours('160')).toBe(9600);
    expect(parseHours('160:30')).toBe(9630);
    expect(parseHours('160.5')).toBe(9630);
    expect(parseHours('１６０：３０')).toBe(9630);
  });
  it('分は 0〜59 まで', () => {
    expect(parseHours('160:60')).toBeUndefined();
  });
  it('戻す', () => {
    expect(formatHours(9630)).toBe('160:30');
    expect(formatHours(60)).toBe('1:00');
  });
});

describe('readRow', () => {
  it('何も入れていない行は blank', () => {
    expect(readRow(blank(), 31)).toEqual({ kind: 'blank' });
  });
  it('3つの必須だけで保存できる（現物・遡及は 0、欠勤・時間は null）', () => {
    const r = readRow({ ...blank(), cash: '330,000', fixed: '300000', days: '31' }, 31);
    expect(r).toEqual({
      kind: 'ok',
      input: { ...emptyPayrollInput(), cash: 330000, fixed: 300000, days: 31 },
    });
  });
  it('必須が欠けている', () => {
    const r = readRow({ ...blank(), cash: '330000' }, 31);
    expect(r).toEqual({ kind: 'invalid', errors: ['fixedRequired', 'daysRequired'] });
  });
  it('チェックだけ入れても blank ではない', () => {
    const r = readRow({ ...blank(), prorated: true }, 31);
    expect(r.kind).toBe('invalid');
  });
  it('数値のチェック（固定 > 通貨）も通す', () => {
    const r = readRow({ ...blank(), cash: '100', fixed: '200', days: '31' }, 31);
    expect(r).toEqual({ kind: 'invalid', errors: ['fixedOverCash'] });
  });
  it('時間の読み違い', () => {
    const r = readRow({ ...blank(), cash: '100', fixed: '100', days: '20', hours: '8時間' }, 31);
    expect(r).toEqual({ kind: 'invalid', errors: ['unreadable'] });
  });
});

describe('textOf と readRow は行き来できる', () => {
  it('保存した値 → 文字 → 同じ値', () => {
    const p = {
      ...emptyPayrollInput(),
      cash: 250000,
      fixed: 200000,
      inKind: 12000,
      retro: 5000,
      days: 20,
      absentDays: 2,
      workMinutes: 9630,
      prorated: true,
    };
    const r = readRow(textOf(p), 31);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(sameInput(r.input, p)).toBeTrue();
  });
});

describe('candidateDays', () => {
  it('欠勤を引く', () => {
    expect(candidateDays(31, '2')).toBe(29);
  });
  it('欠勤が空欄・読めない・多すぎるときは引かない', () => {
    expect(candidateDays(31, '')).toBe(31);
    expect(candidateDays(31, 'x')).toBe(31);
    expect(candidateDays(20, '25')).toBe(20);
  });
});

describe('totalOf（合計の列）', () => {
  it('支払額＋現物', () => {
    expect(totalOf('250000', '12610')).toBe(262610);
  });
  it('現物が空なら支払額だけ', () => {
    expect(totalOf('250000', '')).toBe(250000);
  });
  it('支払額が空・読めないときは出さない', () => {
    expect(totalOf('', '12610')).toBeNull();
    expect(totalOf('abc', '')).toBeNull();
  });
  it('現物が読めないときも出さない', () => {
    expect(totalOf('250000', 'x')).toBeNull();
  });
});

describe('現物の「内訳なし」（画面の行）', () => {
  it('内訳なしの行は現物の文字を使わず null で保存し、合計は支払額のまま', () => {
    const r = readRow({ ...blank(), cash: '330000', fixed: '300000', days: '30', inKind: '999', inKindMerged: true }, 30);
    expect(r.kind === 'ok' && r.input.inKind).toBeNull();
    expect(totalOf('330000', '')).toBe(330000);
  });
  it('保存済みの null は「内訳なし」の行として出す', () => {
    const t = textOf({ ...emptyPayrollInput(), cash: 1, fixed: 1, days: 1, inKind: null });
    expect(t.inKindMerged).toBeTrue();
    expect(t.inKind).toBe('');
    expect(textOf({ ...emptyPayrollInput(), inKind: 0 }).inKindMerged).toBeFalse();
  });
  it('0 と null は別のものとして比べる', () => {
    expect(sameInput({ ...emptyPayrollInput(), inKind: 0 }, { ...emptyPayrollInput(), inKind: null })).toBeFalse();
  });
});
