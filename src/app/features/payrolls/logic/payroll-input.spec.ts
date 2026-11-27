import { emptyPayrollInput, fixedForChange } from '../../../core/models/payroll';
import { autoDaysText, candidateDays, PayrollRowText, readEntry, readRow, sameInput, sumPayrolls, textOf, totalOf } from './payroll-input';
import { formatHours, parseHours, parseNat } from '../../../shared/utils/number';

const blank = (): PayrollRowText => textOf(null);

describe('sumPayrolls（給与の一覧の合計。11/20）', () => {
  it('入っている欄だけ足す。支払額が入っている人を数える', () => {
    const s = sumPayrolls([
      { cash: '270,000', fixed: '270000', inKind: '' },
      { cash: '320000', fixed: '300000', inKind: '20000' },
      { cash: '', fixed: '', inKind: '' },
      { cash: 'abc', fixed: '', inKind: '' },
    ]);
    expect(s).toEqual({ count: 2, cash: 590000, fixed: 570000, inKind: 20000, total: 610000 });
  });
});

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
      input: { ...emptyPayrollInput(), cash: 330000, fixed: 300000, fixedFull: 300000, days: 31 },
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
  it('固定的賃金は欠勤控除前：総支給額を超えても保存でき、計算に使う額は総支給額 − 遡及支払額まで（A2）', () => {
    const r = readRow({ ...blank(), cash: '100', fixed: '200', days: '31' }, 31);
    expect(r).toEqual({ kind: 'ok', input: { ...emptyPayrollInput(), cash: 100, fixed: 100, fixedFull: 200, days: 31 } });
    const withRetro = readRow({ ...blank(), cash: '280000', fixed: '300000', retro: '10000', days: '31' }, 31);
    expect(withRetro.kind === 'ok' && [withRetro.input.fixed, withRetro.input.fixedFull]).toEqual([270000, 300000]);
  });
  it('欠勤の月（控除前の固定的賃金が同じ）は、変動を見る額が前の月と同じ（A2）', () => {
    const full = readRow({ ...blank(), cash: '330000', fixed: '300000', days: '31' }, 31);
    const absent = readRow({ ...blank(), cash: '290000', fixed: '300000', days: '31', absentDays: '2' }, 31);
    expect(full.kind === 'ok' && absent.kind === 'ok' && fixedForChange(full.input) === fixedForChange(absent.input)).toBeTrue();
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

describe('candidateDays（算定基礎届の記入・提出ガイドブック (4) 支払基礎日数とは。11/25）', () => {
  it('月給：出勤日数に関係なく暦日数（欠勤を入れても引かない）', () => {
    expect(candidateDays(31, '2', 'monthly')).toBe(31);
  });
  it('日給月給：欠勤がある月は、事業所が定めた日数（所定労働日数）から欠勤日数を引く', () => {
    expect(candidateDays(31, '6', 'dailyMonthly', 22)).toBe(16); // 17日未満なので平均から除かれる
    expect(candidateDays(31, '2', 'dailyMonthly', 22)).toBe(20);
  });
  it('日給月給：欠勤がない月は暦日数', () => {
    expect(candidateDays(31, '', 'dailyMonthly', 22)).toBe(31);
    expect(candidateDays(31, '0', 'dailyMonthly', 22)).toBe(31);
  });
  it('欠勤が読めない・多すぎるときは引かない', () => {
    expect(candidateDays(31, 'x', 'dailyMonthly', 22)).toBe(31);
    expect(candidateDays(31, '25', 'dailyMonthly', 22)).toBe(22);
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

describe('readEntry：内訳つきの1人分（11/24）', () => {
  const empty = textOf(null);
  it('内訳があれば、総支給額・毎月決まった額・昇給差額は内訳から出し、行と引く前の額も持つ', () => {
    const r = readEntry(
      { ...empty, days: '30' },
      [
        { name: '基本給', category: 'base', amount: '250,000' },
        { name: '欠勤控除', category: 'deduction', amount: '10000' },
        { name: '昇給差額', category: 'retro', amount: '5000' },
      ],
      'monthly',
      30,
    );
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.input.cash).toBe(245000);
    expect(r.input.fixed).toBe(240000);
    expect(r.input.fixedFull).toBe(250000);
    expect(r.input.retro).toBe(5000);
    expect(r.input.lines?.length).toBe(3);
  });
  it('分類が決まっていない行があれば lines の誤り。行がなければ今までどおり（内訳なし）', () => {
    const bad = readEntry({ ...empty, days: '30' }, [{ name: 'サンキュー手当', category: null, amount: '1000' }], 'monthly', 30);
    expect(bad).toEqual({ kind: 'invalid', errors: ['lines'] });
    const plain = readEntry({ ...empty, cash: '200000', fixed: '200000', days: '30' }, [{ name: '', category: null, amount: '' }], null, 30);
    expect(plain.kind === 'ok' && plain.input.lines).toBeNull();
    // ひな形の行を並べただけ（金額なし）も内訳なし：総支給額の欄から読む
    const names = readEntry({ ...empty, cash: '200000', fixed: '200000', days: '30' }, [{ name: '基本給', category: 'base', amount: '' }], null, 30);
    expect(names.kind === 'ok' && names.input.cash).toBe(200000);
  });
});

describe('自動の日数（11/26）', () => {
  const t = (x: Partial<PayrollRowText> = {}): PayrollRowText => ({ ...textOf(null), cash: '300000', fixed: '300000', ...x });

  it('日数が空なら、自動の日数で保存する', () => {
    const r = readRow(t(), 31, 31);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.input.days).toBe(31);
  });

  it('日数を入れたら、その数で保存する', () => {
    const r = readRow(t({ days: '28' }), 31, 31);
    if (r.kind === 'ok') expect(r.input.days).toBe(28);
    else fail('ok のはず');
  });

  it('自動にならない人（時給・日給・契約なし）は、日数が空なら入れてもらう', () => {
    const r = readRow(t(), 31, null);
    expect(r.kind === 'invalid' && r.errors).toEqual(['daysRequired']);
  });

  it('何も入れていない行は、自動の日数があっても保存しない', () => {
    expect(readRow(textOf(null), 31, 31).kind).toBe('blank');
  });

  it('保存済みの日数が自動の日数と同じなら空欄で見せ、違えばそのまま', () => {
    expect(autoDaysText(t({ days: '31' }), 31).days).toBe('');
    expect(autoDaysText(t({ days: '28' }), 31).days).toBe('28');
    expect(autoDaysText(t({ days: '31' }), null).days).toBe('31');
  });
});
