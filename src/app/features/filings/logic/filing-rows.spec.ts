import { emptyPayrollInput, Payroll } from '../../../core/models/payroll';
import {
  acquireRow,
  bonusRow,
  FILING_COLUMNS,
  FilingEmployee,
  firstPaidInMonth,
  irregularRemarks,
  kindCode,
  lossesIn,
  lossRow,
  regularRemarks,
  revisionRow,
  toCells,
} from './filing-rows';

const emp = (p: Partial<FilingEmployee> = {}): FilingEmployee => ({
  id: 'e1',
  employeeNumber: 'A01',
  lastName: '年金',
  firstName: '一郎',
  lastNameKana: 'ネンキン',
  firstNameKana: 'イチロウ',
  birthDate: '1955-12-05',
  sex: 'male',
  retireDate: null,
  health: { enrolled: true, acquiredDate: '2026-10-01', lostDate: null, lossReason: null },
  pension: { enrolled: true, acquiredDate: '2026-10-01', lostDate: null, lossReason: null },
  acquisitionType: 'standard',
  multipleOffices: false,
  rehired: false,
  needsConfirmationCard: false,
  optInDate: null,
  insuredNumber: '12',
  basicPensionNumber: '1234567890',
  ...p,
});

function pay(month: string, cash: number, days = 30, retro = 0): [string, Payroll] {
  return [month, { ...emptyPayrollInput(), officeId: 'o', employeeId: 'e1', paidMonth: month, cash, fixed: cash, days, retro }];
}

describe('列：記入例の欄の順', () => {
  it('取得届は ①整理番号 ②氏名・フリガナ ③生年月日 ④種別 ⑤取得区分 … ⑨報酬月額 ⑩備考', () => {
    expect(FILING_COLUMNS.acquire.slice(0, 13)).toEqual([
      'insuredNumber', 'name', 'kana', 'birthDate', 'kind', 'acquisitionType', 'basicPensionNumber',
      'acquiredDate', 'dependents', 'cash', 'inKind', 'total', 'remarks',
    ]);
  });
  it('月変は ④改定年月 ⑤従前 ⑥従前改定月 ⑦昇降給 ⑧遡及 のあとに3か月分', () => {
    const c = FILING_COLUMNS.irregular;
    expect(c.slice(3, 9)).toEqual(['revisedMonth', 'prevHealth', 'prevPension', 'prevFrom', 'raise', 'retro']);
    expect(c.slice(9, 14)).toEqual(['m1Month', 'm1Days', 'm1Cash', 'm1InKind', 'm1Total']);
  });
});

describe('資格取得届', () => {
  it('種別・取得区分・被扶養者・報酬月額（和暦）', () => {
    const r = acquireRow({ employee: emp({ birthDate: '1990-05-25' }), pensionFund: false, expected: { cash: 198000, inKind: 0 }, hasDependents: false, shortTime: false })!;
    expect(r['kind']).toBe('1．男');
    expect(r['acquisitionType']).toBe('1．健保・厚年');
    expect(r['acquiredDate']).toBe('令和8年10月1日');
    expect(r['birthDate']).toBe('平成2年5月25日');
    expect(r['dependents']).toBe('0．無');
    expect(r['total']).toBe('198,000');
    expect(r['remarks']).toBe('');
  });
  it('備考：70歳以上・二以上・短時間・再雇用・特定減額特例', () => {
    const r = acquireRow({
      employee: emp({ multipleOffices: true, rehired: true, optInDate: '2026-09-20' }),
      pensionFund: true, expected: null, hasDependents: null, shortTime: true,
    })!;
    expect(r['kind']).toBe('5．男（基金）');
    expect(r['remarks']).toBe(
      '1．70歳以上被用者該当、2．二以上事業所勤務者の取得、3．短時間労働者の取得（特定適用事業所等）、4．退職後の継続再雇用者の取得、6．特定減額特例対象者の任意取得',
    );
    expect(r['cash']).toBe('');
  });
  it('種別：女・性別なし', () => {
    expect(kindCode('female', false)).toBe('2．女');
    expect(kindCode(null, false)).toBe('');
  });
});

describe('資格喪失届', () => {
  const retired = emp({
    birthDate: '1998-08-06',
    retireDate: '2026-09-30',
    health: { enrolled: true, acquiredDate: '2020-04-01', lostDate: '2026-10-01', lossReason: 'retire' },
    pension: { enrolled: true, acquiredDate: '2020-04-01', lostDate: '2026-10-01', lossReason: 'retire' },
  });
  it('期間に入る喪失（健保と厚年が同じ日なら1つ）と、原因の退職日', () => {
    const ls = lossesIn(retired, '2026-10-01', '2026-10-31');
    expect(ls.length).toBe(1);
    const r = lossRow(retired, ls[0]);
    expect(r['lostDate']).toBe('令和8年10月1日');
    expect(r['lossReason']).toBe('4．退職等（令和8年9月30日退職等）');
    expect(r['over70NotApplicable']).toBe('');
  });
  it('75歳到達は健保だけ。期間の外は出さない', () => {
    const e = emp({ health: { enrolled: true, acquiredDate: '2000-04-01', lostDate: '2026-11-04', lossReason: 'age75' } });
    expect(lossesIn(e, '2026-11-01', '2026-11-30').map((l) => l.reason)).toEqual(['age75']);
    expect(lossesIn(e, '2026-12-01', '2026-12-31')).toEqual([]);
    expect(lossRow(e, { date: '2026-11-04', reason: 'age75' })['lossReason']).toBe('7．75歳到達（健康保険のみ喪失）');
  });
  it('70歳以上で退職：不該当年月日 ＝ 退職日', () => {
    const e = emp({ retireDate: '2026-09-30' });
    expect(lossRow(e, { date: '2026-10-01', reason: 'retire' })['over70NotApplicable']).toBe('令和8年9月30日');
  });
});

describe('月額変更届・算定基礎届', () => {
  const payrolls = new Map([pay('2025-10', 214000), pay('2025-11', 222000, 31), pay('2025-12', 215000, 30, 18000)]);
  it('記入例のとおり：3か月・総計・平均・従前（千円）・遡及', () => {
    const r = revisionRow('irregular', {
      employee: emp({ birthDate: '1985-05-01' }),
      month: '2026-01',
      firstMonth: '2025-10',
      payrolls,
      previous: { health: 190000, pension: 190000, from: '2025-09' },
      raise: { month: '2025-10', direction: 'up' },
      total: 651000,
      average: 217000,
      corrected: null,
      remarks: [],
    });
    expect(r['revisedMonth']).toBe('令和8年1月');
    expect(r['prevHealth']).toBe('190');
    expect(r['prevFrom']).toBe('令和7年9月');
    expect(r['raise']).toBe('10月 1．昇給');
    expect(r['retro']).toBe('12月 18,000円');
    expect(r['m2Days']).toBe('31日');
    expect(r['m3Total']).toBe('215,000');
    expect(r['sum']).toBe('651,000');
    expect(r['basicPensionNumber70']).toBe('');
    expect(toCells('irregular', r).length).toBe(FILING_COLUMNS.irregular.length);
  });
  it('備考：算定は途中入社・休職・年間平均、月変は理由・年間平均', () => {
    const p = new Map([pay('2026-04', 100), pay('2026-05', 100)]);
    p.set('2026-06', { ...p.get('2026-05')!, paidMonth: '2026-06', state: 'suspended' });
    const e = emp({ birthDate: '1990-01-01', health: { enrolled: true, acquiredDate: '2026-04-15', lostDate: null, lossReason: null } });
    expect(regularRemarks({ employee: e, year: 2026, annual: true, payrolls: p })).toEqual([
      '4．途中入社',
      '5．病休・育休・休職等',
      '8．年間平均',
    ]);
    expect(irregularRemarks({ employee: e, revisedFrom: '2026-07', annual: true, reasonNote: '基本額の変更' })).toEqual([
      '4．昇給・降給の理由（基本額の変更）',
      '6．その他（年間平均）',
    ]);
  });
});

describe('賞与支払届', () => {
  it('合計は千円未満切り捨て。70歳以上は基礎年金番号と備考', () => {
    const r = bonusRow({ employee: emp(), paidDate: '2025-12-22', cash: 104000, inKind: 5000, firstPaidInMonth: null });
    expect(r['total1000']).toBe('109,000');
    expect(r['paidDate']).toBe('令和7年12月22日');
    expect(r['basicPensionNumber70']).toBe('1234567890');
    expect(r['remarks']).toBe('1．70歳以上被用者');
  });
  it('同じ月に先に払った賞与があれば、合算（初回支払日）', () => {
    const pays = [
      { paidDate: '2025-12-05', amounts: { e1: 10000 } },
      { paidDate: '2025-12-22', amounts: { e1: 20000 } },
    ];
    expect(firstPaidInMonth('e1', '2025-12-22', pays)).toBe('2025-12-05');
    expect(firstPaidInMonth('e1', '2025-12-05', pays)).toBeNull();
    const r = bonusRow({ employee: emp({ birthDate: '1990-01-01' }), paidDate: '2025-12-22', cash: 20000, inKind: 0, firstPaidInMonth: '2025-12-05' });
    expect(r['remarks']).toBe('3．同一月内の賞与合算（初回支払日：5日）');
  });
});
