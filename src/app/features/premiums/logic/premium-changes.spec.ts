import { PremiumGroup, PremiumLine, PremiumPart, PremiumResult } from '../../../core/models/premium';
import { premiumChanges } from './premium-changes';

const rate = (total: number) => ({ employee: total / 2, employer: total / 2, from: '2026-03', source: 'kyokai' as const });

function line(part: PremiumPart, base: number, grade: number, total: number): PremiumLine {
  return { part, base, grade, rate: rate(total), totalMilli: 0, employeeMilli: 0 };
}

/** 月額の結果を手で組む（本人負担の額は employeeYen に入れた数字をそのまま使う） */
function result(month: string, employeeYen: number, lines: PremiumLine[], extra: Partial<PremiumResult> = {}): PremiumResult {
  const group: PremiumGroup = { parts: lines.map((l) => l.part), lines, totalMilli: 0, employeeYen, employerMilli: 0 };
  return {
    kind: 'monthly',
    month,
    groups: lines.length > 0 ? [group] : [],
    missing: [],
    totalMilli: 0,
    employeeYen,
    employerMilli: 0,
    ...extra,
  };
}

const health = (base: number, grade: number) => line('health', base, grade, 98500);
const care = (base: number, grade: number) => line('care', base, grade, 16200);
const pension = (base: number, grade: number) => line('pension', base, grade, 183000);

describe('premiumChanges（本人負担が変わった月と理由）', () => {
  it('額が同じ月は出さない', () => {
    const rows = ['2026-09', '2026-10', '2026-11'].map((month) => ({
      month,
      result: result(month, 43000, [health(300000, 22), pension(300000, 19)]),
    }));
    expect(premiumChanges(rows)).toEqual([]);
  });

  it('40歳：介護保険が付いた月を出す', () => {
    const changes = premiumChanges([
      { month: '2026-10', result: result('2026-10', 42570, [health(300000, 22), pension(300000, 19)]) },
      { month: '2026-11', result: result('2026-11', 45000, [health(300000, 22), care(300000, 22), pension(300000, 19)]) },
    ]);
    expect(changes.length).toBe(1);
    expect(changes[0].month).toBe('2026-11');
    expect(changes[0].before).toBe(42570);
    expect(changes[0].after).toBe(45000);
    expect(changes[0].reasons).toEqual([{ kind: 'partStart', part: 'care' }]);
  });

  it('標準報酬月額の改定：健保と厚年が同じ額どうしなら1行にまとめる', () => {
    const changes = premiumChanges([
      { month: '2026-10', result: result('2026-10', 42570, [health(300000, 22), pension(300000, 19)]) },
      { month: '2026-11', result: result('2026-11', 53922, [health(380000, 26), pension(380000, 23)]) },
    ]);
    expect(changes[0].reasons).toEqual([
      { kind: 'base', part: 'health', from: 300000, to: 380000, fromGrade: 22, toGrade: 26 },
    ]);
  });

  it('標準報酬月額：健保と厚年で額が違えば両方出す（上限の違い）', () => {
    const changes = premiumChanges([
      { month: '2026-08', result: result('2026-08', 90000, [health(620000, 35), pension(620000, 31)]) },
      { month: '2026-09', result: result('2026-09', 99000, [health(710000, 37), pension(650000, 32)]) },
    ]);
    expect(changes[0].reasons.map((r) => (r.kind === 'base' ? r.part : r.kind))).toEqual(['health', 'pension']);
  });

  it('70歳：厚生年金が外れた月を出す', () => {
    const changes = premiumChanges([
      { month: '2026-11', result: result('2026-11', 36894, [health(260000, 20), pension(260000, 17)]) },
      { month: '2026-12', result: result('2026-12', 13104, [health(260000, 20)]) },
    ]);
    expect(changes[0].reasons).toEqual([{ kind: 'partEnd', part: 'pension' }]);
  });

  it('免除の始まりと終わり：前後の額は 0 として出す', () => {
    const lines = [health(340000, 24), pension(340000, 21)];
    const changes = premiumChanges([
      { month: '2026-09', result: result('2026-09', 48246, lines) },
      { month: '2026-10', result: result('2026-10', 0, lines, { exempt: true }) },
      { month: '2026-11', result: result('2026-11', 48246, lines) },
    ]);
    expect(changes.map((c) => [c.month, c.before, c.after, c.reasons[0].kind])).toEqual([
      ['2026-10', 48246, 0, 'exemptStart'],
      ['2026-11', 0, 48246, 'exemptEnd'],
    ]);
  });

  it('資格の取得と喪失', () => {
    const lines = [health(260000, 20), pension(260000, 17)];
    const changes = premiumChanges([
      { month: '2026-08', result: result('2026-08', 0, []) },
      { month: '2026-09', result: result('2026-09', 36894, lines) },
      { month: '2026-10', result: result('2026-10', 0, []) },
    ]);
    expect(changes.map((c) => c.reasons[0].kind)).toEqual(['start', 'end']);
  });

  it('料率の改定', () => {
    const before = [line('health', 300000, 22, 99100), pension(300000, 19)];
    const after = [line('health', 300000, 22, 98500), pension(300000, 19)];
    const changes = premiumChanges([
      { month: '2026-02', result: result('2026-02', 42315, before) },
      { month: '2026-03', result: result('2026-03', 42225, after) },
    ]);
    expect(changes[0].reasons).toEqual([{ kind: 'rate', part: 'health', from: 99100, to: 98500 }]);
  });

  it('計算できなかった月をはさんだら、その前後は比べない', () => {
    const lines = [health(300000, 22), pension(300000, 19)];
    const changes = premiumChanges([
      { month: '2026-09', result: result('2026-09', 42570, lines) },
      { month: '2026-10', result: null },
      { month: '2026-11', result: result('2026-11', 50000, lines) },
      { month: '2026-12', result: result('2026-12', 0, lines, { missing: [{ part: 'health', reason: 'noRate' }] }) },
    ]);
    expect(changes).toEqual([]);
  });

  it('月の順でなくても、古い順に並べて比べる', () => {
    const changes = premiumChanges([
      { month: '2026-11', result: result('2026-11', 45000, [health(300000, 22), care(300000, 22), pension(300000, 19)]) },
      { month: '2026-10', result: result('2026-10', 42570, [health(300000, 22), pension(300000, 19)]) },
    ]);
    expect(changes[0].month).toBe('2026-11');
  });
});
