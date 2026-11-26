import { monthSpine, MonthSpineInput } from './month-spine';

const base: MonthSpineInput = {
  todo: 0,
  payrollMissing: 0,
  revision: { candidates: 0, waiting: 0 },
  premium: { closed: true, noticeSaved: true, reviewed: true, solo: false },
  premiumMonth: 10,
  payMonth: 11,
};
const states = (x: Partial<MonthSpineInput>) => monthSpine({ ...base, ...x }).map((s) => s.state);

describe('ホームの「今月の処理」（11/26）', () => {
  it('全部済めば済み', () => {
    expect(states({})).toEqual(['done', 'done', 'done', 'done']);
  });

  it('読み込み中は「確認中」', () => {
    const s = monthSpine({
      ...base,
      todo: null,
      payrollMissing: null,
      revision: null,
      premium: null,
    });
    expect(s.map((x) => x.noteKey)).toEqual(Array(4).fill('home.spine.note.loading'));
  });

  it('手続き・給与・改定は、数えた人数を出す', () => {
    const s = monthSpine({
      ...base,
      todo: 3,
      payrollMissing: 8,
      revision: { candidates: 2, waiting: 1 },
    });
    expect(s.map((x) => x.state)).toEqual(['attention', 'todo', 'attention', 'done']);
    expect(s[0].noteParams).toEqual({ count: 3 });
    expect(s[1].noteParams).toEqual({ count: 8, m: 11 });
    expect(s[2].noteParams).toEqual({ count: 2 });
  });

  it('改定：月を待っている人だけなら済み（人数は出す）。読めなければ「まだ」', () => {
    const w = monthSpine({ ...base, revision: { candidates: 0, waiting: 4 } })[2];
    expect(w.state).toBe('done');
    expect(w.noteKey).toBe('home.spine.note.revisionWaiting');
    expect(states({ revision: 'error' })[2]).toBe('todo');
  });

  it('保険料：確認済み → 告知額 → 別の人の確認 の順に進む', () => {
    const p = (premium: MonthSpineInput['premium']) => monthSpine({ ...base, premium })[3].noteKey;
    expect(p({ closed: false, noticeSaved: false, reviewed: false, solo: false })).toBe(
      'home.spine.note.premiumOpen',
    );
    expect(p({ closed: true, noticeSaved: false, reviewed: false, solo: false })).toBe(
      'home.spine.note.premiumNotice',
    );
    expect(p({ closed: true, noticeSaved: true, reviewed: false, solo: false })).toBe(
      'home.spine.note.premiumReview',
    );
    expect(p({ closed: true, noticeSaved: true, reviewed: false, solo: true })).toBe(
      'home.spine.note.premiumDone',
    );
  });
});
