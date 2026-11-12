import { normalizeLine, readContractText } from './contract-pdf';

// モデル労働条件通知書（短時間労働者用）を書き込んだ形をまねた行（作り物）
const PART = [
  '労働条件通知書',
  '契約期間 期間の定めあり（令和８年４月１日～令和９年３月３１日）',
  '１ 契約の更新の有無',
  '[■更新する場合があり得る □自動的に更新する □契約の更新はしない □その他（ ）]',
  '雇用形態 パートタイマー',
  '始業・終業の時刻等 始業（ ９時００分） 終業（ １５時００分）',
  '休憩時間（ ６０ ）分',
  '休日 定例日；毎週 土・日曜日 週 ５日勤務',
  '賃金 １ 基本賃金 ハ 時間給（ １，２００円）',
];

// 正社員（期間の定めなし・月給・手当あり）
const REGULAR = [
  '雇用契約書',
  '契約期間 期間の定めなし',
  '雇用区分 正社員',
  '1週間の所定労働時間 40時間00分',
  '月平均所定労働日数 21.5日',
  '基本給 月額 250,000円',
  '役職手当 20,000円 通勤手当 15,000円 家族手当 10,000円',
];

const find = (r: ReturnType<typeof readContractText>, f: string) => r.candidates.find((c) => c.field === f);

describe('normalizeLine', () => {
  it('全角の数字・記号を半角に、空白を1つに', () => {
    expect(normalizeLine('時間給（　１，２００円）')).toBe('時間給( 1,200円)');
  });
});

describe('readContractText：短時間労働者（有期・時給）', () => {
  const r = readContractText(PART);

  it('契約期間（和暦）', () => {
    expect(find(r, 'from')?.value).toBe('2026-04-01');
    expect(find(r, 'periodEnd')?.value).toBe('2027-03-31');
  });

  it('印のついた更新の選択肢', () => {
    expect(find(r, 'renewal')?.value).toBe('possible');
  });

  it('雇用形態・時給', () => {
    expect(find(r, 'employmentType')?.value).toBe('part');
    expect(find(r, 'payType')?.value).toBe('hourly');
    expect(find(r, 'hourlyWage')?.value).toBe('1200');
  });

  it('（終業 − 始業 − 休憩）× 週の日数 → 週の時間、週の日数 → 月の日数', () => {
    const h = find(r, 'hours')!;
    expect(h.value).toBe('25:00'); // 5時間 × 5日
    expect(h.note).toBe('fromDailyTimes');
    expect(find(r, 'monthlyDays')).toEqual(jasmine.objectContaining({ value: '21', note: 'fromWeekDays' }));
  });

  it('元の行を一緒に返す', () => {
    expect(find(r, 'hourlyWage')!.source).toContain('時間給');
    expect(r.missing).toEqual([]);
  });
});

describe('readContractText：正社員（期間の定めなし・月給）', () => {
  const r = readContractText(REGULAR);

  it('期間の定めなし → 終わりの日は空', () => {
    expect(find(r, 'periodEnd')).toEqual(jasmine.objectContaining({ value: '', note: 'noPeriod' }));
  });

  it('週の所定労働時間・月の日数（小数は切り捨て）', () => {
    expect(find(r, 'hours')?.value).toBe('40:00');
    expect(find(r, 'monthlyDays')?.value).toBe('21');
  });

  it('所定内賃金 ＝ 基本給 ＋ 入れる手当（通勤・家族は除く）', () => {
    const w = find(r, 'scheduledWage')!;
    expect(w.value).toBe('270000');
    expect(w.params?.['excluded']).toBe('通勤手当・家族手当');
    expect(find(r, 'payType')?.value).toBe('monthly');
    expect(find(r, 'employmentType')?.value).toBe('regular');
  });

  it('更新の行がなければ「見つからない」', () => {
    expect(r.missing).toEqual(['renewal']);
  });
});

describe('readContractText：ひな形のまま（選択肢が全部印字）', () => {
  it('印のない選択肢が並んでいるだけなら、決められない', () => {
    const r = readContractText([
      '契約期間 期間の定めなし、期間の定めあり（ 年 月 日～ 年 月 日）',
      '契約の更新の有無 [自動的に更新する・更新する場合があり得る・契約の更新はしない・その他（ ）]',
      '基本賃金 イ 月給（ 円） ロ 日給（ 円） ハ 時間給（ 円）',
    ]);
    expect(r.ambiguous).toContain('periodEnd');
    expect(r.ambiguous).toContain('renewal');
    expect(find(r, 'payType')).toBeUndefined(); // 金額のない形は候補にしない
  });

  it('金額が2つの形に書かれていたら決められない', () => {
    const r = readContractText(['イ 月給（ 200,000円） ハ 時間給（ 1,200円）']);
    expect(r.ambiguous).toContain('payType');
  });
});
