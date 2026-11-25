import { emptyRegister } from '../../../core/models/employee';
import {
  countGaps,
  historyProblem,
  historyText,
  isWorker,
  onRegister,
  parseHistory,
  readHistoryLine,
  readRetireText,
  RegisterPerson,
  registerGaps,
  registerLarge,
  registerTable,
} from './labor-register';

const TODAY = '2026-11-24';

const person = (over: Partial<RegisterPerson> = {}): RegisterPerson => ({
  hireDate: '2020-04-01',
  retireDate: null,
  retireReason: null,
  sex: 'male',
  org: null,
  contact: { address: '東京都千代田区1-1' },
  foreign: null,
  register: { history: [{ month: '2020-04', text: '入社' }], retireDetail: null },
  ...over,
});

describe('労働者名簿：履歴の1行（先頭の年月）', () => {
  const cases: [string, ReturnType<typeof readHistoryLine>][] = [
    ['2024-04 営業部へ異動', { month: '2024-04', text: '営業部へ異動' }],
    ['2024/4 入社', { month: '2024-04', text: '入社' }],
    ['２０２４年４月　総務部へ異動', { month: '2024-04', text: '総務部へ異動' }],
    ['2024年4月1日 入社', { month: '2024-04', text: '入社' }],
    ['2024-04-01 入社', { month: '2024-04', text: '入社' }],
    ['2018.04：○○株式会社 入社', { month: '2018-04', text: '○○株式会社 入社' }],
    ['営業部長に昇進', { month: null, text: '営業部長に昇進' }],
    ['2024-13 月がおかしい', { month: null, text: '2024-13 月がおかしい' }],
    ['2024-04', { month: null, text: '2024-04' }],
    ['   ', null],
  ];
  for (const [raw, want] of cases) {
    it(JSON.stringify(raw), () => expect(readHistoryLine(raw)).toEqual(want));
  }

  it('改行で並べた履歴を読み、同じ書き方に戻せる（CSV のセル・画面の欄）', () => {
    const lines = parseHistory('2018-04 前職：○○商事\r\n\n2020/4 入社\n営業部長に昇進');
    expect(lines).toEqual([
      { month: '2018-04', text: '前職：○○商事' },
      { month: '2020-04', text: '入社' },
      { month: null, text: '営業部長に昇進' },
    ]);
    expect(historyText(lines)).toBe('2018-04 前職：○○商事\n2020-04 入社\n営業部長に昇進');
    expect(parseHistory(historyText(lines))).toEqual(lines);
  });

  it('行が多すぎる・1行が長すぎる', () => {
    expect(historyProblem(Array.from({ length: 31 }, () => ({ month: null, text: 'a' })))).toBe('tooMany');
    expect(historyProblem([{ month: null, text: 'あ'.repeat(101) }])).toBe('tooLong');
    expect(historyProblem([{ month: null, text: 'あ'.repeat(100) }])).toBeNull();
  });
});

describe('労働者名簿：退職の事由の文を読む', () => {
  it('選択肢の言葉そのままなら、詳しい内容はなし', () => {
    expect(readRetireText('解雇')).toEqual({ reason: 'dismissal', detail: null });
    expect(readRetireText('死亡')).toEqual({ reason: 'death', detail: null });
    expect(readRetireText('退職')).toEqual({ reason: 'resign', detail: null });
    expect(readRetireText('')).toBeNull();
  });
  it('文なら言葉から選び、文を詳しい内容に残す', () => {
    expect(readRetireText('懲戒解雇（無断欠勤が続いたため）')).toEqual({ reason: 'dismissal', detail: '懲戒解雇（無断欠勤が続いたため）' });
    expect(readRetireText('自己都合')).toEqual({ reason: 'resign', detail: '自己都合' });
    expect(readRetireText('定年退職')).toEqual({ reason: 'resign', detail: '定年退職' });
    expect(readRetireText('病死')).toEqual({ reason: 'death', detail: '病死' });
    expect(readRetireText('グループ会社へ転籍')).toEqual({ reason: 'transfer', detail: 'グループ会社へ転籍' });
    expect(readRetireText('家業を継ぐ')).toEqual({ reason: 'other', detail: '家業を継ぐ' });
  });
});

describe('労働者名簿：載る人', () => {
  const officer = (alsoEmployee?: boolean) => ({
    departmentId: null,
    position: null,
    officer: { type: 'fullTime' as const, checks: {} as never, ...(alsoEmployee === undefined ? {} : { alsoEmployee }) },
  });
  it('労働者でない役員は載せない。使用人を兼ねる役員は載せる', () => {
    expect(isWorker({ org: null })).toBeTrue();
    expect(isWorker({ org: officer() })).toBeFalse();
    expect(isWorker({ org: officer(true) })).toBeTrue();
  });
  it('入社前の人は載せない。退職した人は5年まで', () => {
    expect(onRegister(person({ hireDate: '2026-12-01' }), TODAY)).toBeFalse();
    expect(onRegister(person({ retireDate: '2021-11-24' }), TODAY)).toBeTrue();
    expect(onRegister(person({ retireDate: '2021-11-23' }), TODAY)).toBeFalse();
  });
  it('常時30人以上：今日在籍している、名簿に載る人で数える（役員・退職者・入社前は数えない）', () => {
    const many = Array.from({ length: 29 }, () => person());
    expect(registerLarge(many, TODAY)).toBeFalse();
    expect(registerLarge([...many, person({ org: officer() }), person({ retireDate: '2026-11-23' }), person({ hireDate: '2026-12-01' })], TODAY)).toBeFalse();
    expect(registerLarge([...many, person({ retireDate: TODAY })], TODAY)).toBeTrue();
  });
});

describe('労働者名簿：記入漏れ', () => {
  it('そろっていれば空', () => {
    expect(registerGaps(person({ org: { departmentId: null, position: null, officer: null, jobType: '営業' } }), TODAY, true)).toEqual([]);
  });
  it('性別・住所・履歴が空。業務の種類は30人以上のときだけ', () => {
    const p = person({ sex: null, contact: { address: '' }, register: emptyRegister() });
    expect(registerGaps(p, TODAY, false)).toEqual(['sex', 'address', 'history']);
    expect(registerGaps(p, TODAY, true)).toEqual(['sex', 'address', 'history', 'jobType']);
  });
  it('海外に住んでいる・住所を書けない理由がある人は、住所の漏れにしない', () => {
    expect(registerGaps(person({ contact: { address: null, overseasCountry: 'GB' } }), TODAY, false)).toEqual([]);
    expect(registerGaps(person({ contact: { address: null }, foreign: { noAddressReason: 'shortStay' } }), TODAY, false)).toEqual([]);
  });
  it('退職：事由が空。解雇・死亡は詳しい内容（理由・原因）も要る', () => {
    expect(registerGaps(person({ retireDate: '2026-10-31' }), TODAY, false)).toEqual(['retireReason']);
    expect(registerGaps(person({ retireDate: '2026-10-31', retireReason: 'resign' }), TODAY, false)).toEqual([]);
    expect(registerGaps(person({ retireDate: '2026-10-31', retireReason: 'dismissal' }), TODAY, false)).toEqual(['retireDetail']);
    expect(
      registerGaps(person({ retireDate: '2026-10-31', retireReason: 'death', register: { history: [{ month: null, text: '入社' }], retireDetail: '病死' } }), TODAY, false),
    ).toEqual([]);
  });
  it('名簿に載らない人（役員・保存の期間を過ぎた人）は数えない', () => {
    const officerOnly = { departmentId: null, position: null, officer: { type: 'representative' as const, checks: {} as never } };
    expect(registerGaps(person({ sex: null, org: officerOnly }), TODAY, true)).toEqual([]);
    expect(registerGaps(person({ sex: null, retireDate: '2020-01-31', retireReason: 'resign' }), TODAY, true)).toEqual([]);
  });
  it('何の漏れが何人か', () => {
    expect(countGaps([['history', 'jobType'], [], ['history']])).toEqual({ people: 2, by: { history: 2, jobType: 1 } });
  });
});

describe('労働者名簿：出力の表', () => {
  const text = {
    header: (k: string) => k,
    sex: (s: string) => (s === 'male' ? '男' : '女'),
    reason: (r: string) => ({ resign: '退職', dismissal: '解雇', death: '死亡', transfer: '転勤', other: 'その他' })[r] ?? r,
    officerWorker: '使用人兼務の役員',
    overseas: (c: string, city: string | null) => `${c} ${city ?? ''}`.trim(),
  };
  const row = (over: Record<string, unknown> = {}) => ({
    ...person(),
    employeeNumber: 'E1', lastName: '山田', firstName: '太郎', lastNameKana: 'ヤマダ', firstNameKana: 'タロウ', birthDate: '1990-05-15',
    contact: { postalCode: '1000001', address: '東京都千代田区1-1' },
    ...over,
  }) as never;

  it('様式の順で、名簿に載る人だけ。事由は選択肢＋詳しい内容、履歴はセルの中で改行', () => {
    const t = registerTable(
      [
        row({ register: { history: [{ month: '2020-04', text: '入社' }, { month: null, text: '営業部長に昇進' }], retireDetail: '整理解雇' }, retireDate: '2026-09-30', retireReason: 'dismissal', org: { departmentId: null, position: null, officer: null, jobType: '営業' } }),
        row({ lastName: '役員', org: { departmentId: null, position: null, officer: { type: 'fullTime', checks: {} as never } } }),
        row({ lastName: '兼務', org: { departmentId: null, position: null, officer: { type: 'fullTime', checks: {} as never, alsoEmployee: true } } }),
      ],
      TODAY,
      text as never,
    );
    expect(t[0]).toEqual(['kana', 'name', 'sex', 'birthDate', 'postalCode', 'address', 'hireDate', 'jobType', 'history', 'leaveDate', 'reason', 'note']);
    expect(t.length).toBe(3); // 労働者でない役員は載せない
    expect(t[1]).toEqual(['ヤマダ タロウ', '山田 太郎', '男', '1990-05-15', '100-0001', '東京都千代田区1-1', '2020-04-01', '営業', '2020-04 入社\n営業部長に昇進', '2026-09-30', '解雇（整理解雇）', '']);
    expect(t[2][1]).toBe('兼務 太郎');
    expect(t[2][11]).toBe('使用人兼務の役員');
  });

  it('海外に住んでいる人は国と都市を住所の欄に', () => {
    const t = registerTable([row({ contact: { postalCode: null, address: null, overseasCountry: 'GB', overseasCity: 'London' } })], TODAY, text as never);
    expect(t[1][4]).toBe('');
    expect(t[1][5]).toBe('GB London');
  });
});

