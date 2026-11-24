import { PayrollLine } from '../../../core/models/payroll';
import { categoryOf, copyNames, itemNames, readAmount, readLines, startDrafts, totalsOf } from './payroll-lines';

const L = (name: string, category: PayrollLine['category'], amount: number): PayrollLine => ({ name, category, amount });

// 画面のイメージの例（月給）：基本給 250,000・職務手当 30,000・固定残業手当 40,000・通勤手当 15,000・時間外手当 12,480・欠勤控除 11,290
const SLIP = [
  L('基本給', 'base', 250000),
  L('職務手当', 'fixedAllowance', 30000),
  L('固定残業手当', 'fixedAllowance', 40000),
  L('通勤手当', 'commute', 15000),
  L('時間外手当', 'variable', 12480),
  L('欠勤控除', 'deduction', 11290),
];

describe('totalsOf：内訳から総支給額・毎月決まった額を出す', () => {
  it('月給：総支給額は控除を引く。毎月決まった額は引く前（変動を見る）と払った分', () => {
    const t = totalsOf(SLIP, 'monthly');
    expect(t.cash).toBe(336190);
    expect(t.fixedFull).toBe(335000);
    expect(t.fixed).toBe(323710);
    expect(t.retro).toBe(0);
    expect(t.nonFixed).toBe(12480);
    // 今までの計算が読む値どうしの決まり（ルールと同じ）
    expect(t.fixed <= t.cash).toBeTrue();
  });

  it('時給：基本給（時給×時間）も固定的賃金（法律どおり）。変動を見つける額からは除く', () => {
    const t = totalsOf([L('基本給', 'base', 150000), L('通勤手当', 'commute', 6000), L('時間外手当', 'variable', 3000), L('遅刻早退控除', 'deduction', 1200)], 'hourly');
    expect(t.cash).toBe(157800);
    expect(t.fixed).toBe(154800);
    expect(t.nonFixed).toBe(3000);
    expect(t.fixedFull).toBe(6000);
  });

  it('報酬にならない行は入れない。昇給差額は総支給額に入り、昇給差額として別に返す', () => {
    const t = totalsOf([L('基本給', 'base', 200000), L('出張旅費', 'excluded', 30000), L('昇給差額', 'retro', 10000)], 'monthly');
    expect(t.cash).toBe(210000);
    expect(t.retro).toBe(10000);
    expect(t.fixedFull).toBe(200000);
    expect(t.fixed).toBe(200000);
  });

  it('払った分の毎月決まった額は、総支給額から昇給差額を除いた額を超えない', () => {
    const t = totalsOf([L('通勤手当', 'commute', 20000), L('基本給', 'base', 10000), L('昇給差額', 'retro', 5000), L('欠勤控除', 'deduction', 26000)], 'monthly');
    expect(t.cash).toBe(9000);
    expect(t.fixed).toBe(4000);
    expect(t.nonFixed).toBe(0);
  });
});

describe('readLines：入力中の行を読む', () => {
  it('空の行は飛ばし、金額のカンマ・円・全角を読む。控除の「−」はあってもなくてもよい', () => {
    const r = readLines([
      { name: '基本給', category: 'base', amount: '２５０，０００円' },
      { name: '', category: null, amount: '' },
      { name: '住宅手当', category: 'fixedAllowance', amount: '' }, // 金額が空の行は保存しない（ひな形の行）
      { name: '欠勤控除', category: 'deduction', amount: '−11,290' },
    ]);
    expect(r.lines).toEqual([L('基本給', 'base', 250000), L('欠勤控除', 'deduction', 11290)]);
    expect(readAmount('-100', 'variable')).toBeNull(); // 控除でない行のマイナスは読まない
  });

  it('分類が決まっていない行があれば保存しない（行ごとに誤りを返す）', () => {
    const r = readLines([
      { name: '基本給', category: 'base', amount: '250000' },
      { name: 'リーダー手当', category: null, amount: '5000' },
    ]);
    expect(r.lines).toBeNull();
    expect(r.lineErrors.get(1)).toEqual(['category']);
  });

  it('行がない・控除が多すぎて総支給額がマイナスなら保存しない', () => {
    expect(readLines([]).errors).toEqual(['empty']);
    const r = readLines([
      { name: '基本給', category: 'base', amount: '1000' },
      { name: '欠勤控除', category: 'deduction', amount: '2000' },
    ]);
    expect(r.errors).toEqual(['negative']);
  });
});

describe('項目名と分類', () => {
  it('事業所の項目（名前・CSVの見出し）→ よくある名前 の順。どちらにもなければ null', () => {
    const items = [{ name: 'リーダー手当', labels: ['ﾘｰﾀﾞｰ手当'], category: 'fixedAllowance' as const }];
    expect(categoryOf('リーダー手当', items)).toBe('fixedAllowance');
    expect(categoryOf(' ﾘｰﾀﾞｰ 手当', items)).toBe('fixedAllowance');
    expect(categoryOf('固定残業代', [])).toBe('fixedAllowance'); // 固定残業代は固定的賃金
    expect(categoryOf('非課税通勤手当', [])).toBe('commute');
    expect(categoryOf('勤怠控除', [])).toBe('deduction');
    expect(categoryOf('サンキュー手当', [])).toBeNull();
    // 事業所で分類を決め直した名前は、そちらが勝つ
    expect(categoryOf('皆勤手当', [{ name: '皆勤手当', labels: [], category: 'fixedAllowance' }])).toBe('fixedAllowance');
  });

  it('候補の名前は事業所の項目が先、同じ名前は1つ', () => {
    const names = itemNames([{ name: '基本給', labels: [], category: 'base' }, { name: 'リーダー手当', labels: [], category: 'fixedAllowance' }]);
    expect(names.slice(0, 2)).toEqual(['基本給', 'リーダー手当']);
    expect(names.filter((n) => n === '基本給').length).toBe(1);
  });

  it('前の月からは項目名と分類だけ写し、金額は写さない', () => {
    expect(copyNames(SLIP.slice(0, 2))).toEqual([
      { name: '基本給', category: 'base', amount: '' },
      { name: '職務手当', category: 'fixedAllowance', amount: '' },
    ]);
  });
});

describe('startDrafts：内訳を入れ始めるときの行', () => {
  it('前の月の項目名 → 事業所のひな形 → アプリの例 の順。分類は項目名から付ける', () => {
    expect(startDrafts(SLIP.slice(0, 1), ['住宅手当'], []).map((d) => d.name)).toEqual(['基本給']);
    const t = startDrafts(null, ['基本給', 'リーダー手当'], []);
    expect(t).toEqual([
      { name: '基本給', category: 'base', amount: '' },
      { name: 'リーダー手当', category: null, amount: '' },
    ]);
    expect(startDrafts([], null, []).map((d) => d.name)).toEqual(['基本給', '固定残業手当', '通勤手当']);
  });
});
