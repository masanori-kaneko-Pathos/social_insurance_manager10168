import {
  buildPeople,
  closeBlockers,
  closeCheck,
  CloseCheckInput,
  CloseSource,
  diffsOf,
  monthDiffSummary,
  openTotals,
  peopleTotals,
  settlementOf,
} from './month-close';

const row = (id: string, state: CloseSource['state'], e = 0, t = 0, c = 0): CloseSource => ({
  id,
  state,
  employeeYen: e,
  premiumTotalMilli: t,
  contributionMilli: c,
});

describe('month-close', () => {
  describe('buildPeople', () => {
    it('計算できた人はその額、免除の人は 0、加入していない人は入れない', () => {
      const p = buildPeople([row('a', 'ok', 45408, 90816000, 1152000), row('b', 'exempt'), row('c', 'none')]);
      expect(p).toEqual({ a: { e: 45408, t: 90816000, c: 1152000 }, b: { e: 0, t: 0, c: 0 } });
    });

    it('計算できない人がいれば確定させない', () => {
      const rows = [row('a', 'ok', 1, 2000, 0), row('b', 'missing'), row('c', 'error')];
      expect(closeBlockers(rows)).toBe(2);
      expect(() => buildPeople(rows)).toThrow();
    });

    it('合計（人数・本人負担・全額・拠出金）', () => {
      const p = buildPeople([row('a', 'ok', 100, 200000, 3000), row('b', 'ok', 50, 100000, 1000), row('c', 'exempt')]);
      expect(peopleTotals(p)).toEqual({ count: 3, employeeYen: 150, premiumTotalMilli: 300000, contributionMilli: 4000 });
    });
  });

  describe('diffsOf', () => {
    const opt = { month: '2026-10', today: '2026-11-24' };

    it('変わっていない人は出さない', () => {
      const closed = { a: { e: 100, t: 200000, c: 0 } };
      expect(diffsOf(closed, { a: { e: 100, t: 200000, c: 0 } }, {}, opt)).toEqual([]);
    });

    it('標準報酬を遡って上げた人：本人・会社・全額の差額', () => {
      // 30万 → 32万（例）：本人 +1,500、全額 +3,000.000
      const d = diffsOf({ a: { e: 15000, t: 30000000, c: 1080000 } }, { a: { e: 16500, t: 33000000, c: 1152000 } }, {}, opt);
      expect(d.length).toBe(1);
      expect(d[0].diffEmployeeYen).toBe(1500);
      expect(d[0].diffTotalMilli).toBe(3000000);
      expect(d[0].diffEmployerMilli).toBe(1500000);
      expect(d[0].diffContributionMilli).toBe(72000);
      expect(d[0].status).toBe('open');
      expect(d[0].expired).toBe(false);
    });

    it('遡って下げた人はマイナス（返す額）', () => {
      const d = diffsOf({ a: { e: 16500, t: 33000000, c: 0 } }, { a: { e: 15000, t: 30000000, c: 0 } }, {}, opt);
      expect(d[0].diffEmployeeYen).toBe(-1500);
      expect(d[0].diffEmployerMilli).toBe(-1500000);
    });

    it('資格を遡って取り消した人（今は加入していない）：確定時の額がまるごとマイナス', () => {
      const d = diffsOf({ a: { e: 15000, t: 30000000, c: 1080000 } }, {}, {}, opt);
      expect(d[0].now).toEqual({ e: 0, t: 0, c: 0 });
      expect(d[0].diffEmployeeYen).toBe(-15000);
    });

    it('遡って加入した人（確定時にいなかった）：今の額がまるごとプラス', () => {
      const d = diffsOf({}, { b: { e: 9000, t: 18000000, c: 0 } }, {}, opt);
      expect(d[0].closed).toEqual({ e: 0, t: 0, c: 0 });
      expect(d[0].diffEmployeeYen).toBe(9000);
    });

    it('料率をあとから入れた月も差額に出る（確定は計算できる人だけなので、料率の差し替えで変わった分）', () => {
      const d = diffsOf({ a: { e: 15000, t: 30000000, c: 0 } }, { a: { e: 15030, t: 30060000, c: 0 } }, {}, opt);
      expect(d[0].diffEmployeeYen).toBe(30);
    });

    it('精算した額と同じなら精算済み。さらに変わったら「精算後に変更あり」', () => {
      const closed = { a: { e: 15000, t: 30000000, c: 0 } };
      const now = { a: { e: 16500, t: 33000000, c: 0 } };
      const first = diffsOf(closed, now, {}, opt)[0];
      const s = { a: settlementOf(first, '2026-12') };
      expect(diffsOf(closed, now, s, opt)[0].status).toBe('settled');
      const later = diffsOf(closed, { a: { e: 18000, t: 36000000, c: 0 } }, s, opt)[0];
      expect(later.status).toBe('changedAfterSettle');
    });

    it('精算した後に元へ戻った人も出す（返す分がある）', () => {
      const closed = { a: { e: 15000, t: 30000000, c: 0 } };
      const s = { a: { employeeId: 'a', payMonth: '2026-12', diffEmployeeYen: 1500, diffTotalMilli: 3000000, diffContributionMilli: 0 } };
      const d = diffsOf(closed, closed, s, opt);
      expect(d.length).toBe(1);
      expect(d[0].status).toBe('changedAfterSettle');
      expect(openTotals(d).employeeYen).toBe(-1500);
    });

    it('時効（納期限から2年）を過ぎた月と、退職済みの人の印', () => {
      // 2024-09分の納期限は 2024-10-31。2年後の 2026-10-31 を過ぎると時効
      const d = diffsOf({ a: { e: 1, t: 2000, c: 0 } }, { a: { e: 2, t: 4000, c: 0 } }, {}, {
        month: '2024-09',
        today: '2026-11-24',
        retiredIds: new Set(['a']),
      });
      expect(d[0].expired).toBe(true);
      expect(d[0].retired).toBe(true);
      expect(openTotals(d).count).toBe(0);
    });
  });

  describe('openTotals', () => {
    it('精算済み・時効を除き、精算後に変わった人は残りだけを足す', () => {
      const opt = { month: '2026-10', today: '2026-11-24' };
      const closed = { a: { e: 100, t: 200000, c: 0 }, b: { e: 100, t: 200000, c: 0 }, c: { e: 100, t: 200000, c: 0 } };
      const now = { a: { e: 150, t: 300000, c: 0 }, b: { e: 130, t: 260000, c: 0 }, c: { e: 200, t: 400000, c: 1000 } };
      const s = {
        a: { employeeId: 'a', payMonth: '2026-12', diffEmployeeYen: 50, diffTotalMilli: 100000, diffContributionMilli: 0 }, // 精算済み
        c: { employeeId: 'c', payMonth: '2026-12', diffEmployeeYen: 60, diffTotalMilli: 120000, diffContributionMilli: 0 }, // その後に変わった
      };
      const t = openTotals(diffsOf(closed, now, s, opt));
      expect(t.count).toBe(2);
      expect(t.employeeYen).toBe(30 + 40);
      expect(t.totalMilli).toBe(60000 + 80000);
      expect(t.employerMilli).toBe(140000 - 70000);
      expect(t.contributionMilli).toBe(1000);
    });
  });

  describe('monthDiffSummary', () => {
    it('月ごとの全額の差（精算の記録に関係なく）', () => {
      const s = monthDiffSummary(
        '2026-09',
        { a: { e: 100, t: 200000, c: 1000 }, b: { e: 100, t: 200000, c: 1000 } },
        { a: { e: 150, t: 300000, c: 1500 }, b: { e: 100, t: 200000, c: 1000 } },
        '2026-11-24',
      );
      expect(s).toEqual({ month: '2026-09', count: 1, totalMilli: 100000, contributionMilli: 500, expired: false });
    });
  });

  describe('closeCheck（確認済みにできるか。11/27）', () => {
    const ok: CloseCheckInput = { future: false, blockers: 0, bonusProblems: 0, rowCount: 10, regularPending: 0, soft: { matched: 10, diff: 0 } };

    it('全員が照合で一致していれば、止めず知らせることもない', () => {
      expect(closeCheck(ok)).toEqual({ block: null, notes: [] });
    });
    it('照合していない・差がある・定時決定の未反映は、止めずに知らせる', () => {
      expect(closeCheck({ ...ok, soft: null })).toEqual({ block: null, notes: ['softMissing'] });
      expect(closeCheck({ ...ok, soft: { matched: 8, diff: 2 } })).toEqual({ block: null, notes: ['softDiff'] });
      expect(closeCheck({ ...ok, soft: null, regularPending: 3 })).toEqual({ block: null, notes: ['softMissing', 'regularPending'] });
    });
    it('賞与に計算できない人がいれば止める（納付額が欠けたまま進まない）', () => {
      expect(closeCheck({ ...ok, bonusProblems: 1 }).block).toBe('bonusProblems');
    });
    it('止める理由は、まだ来ていない月 → 月額 → 賞与 → 人がいない の順', () => {
      expect(closeCheck({ ...ok, future: true, blockers: 1, bonusProblems: 1, rowCount: 0 }).block).toBe('future');
      expect(closeCheck({ ...ok, blockers: 1, bonusProblems: 1 }).block).toBe('problems');
      expect(closeCheck({ ...ok, rowCount: 0 }).block).toBe('empty');
    });
    it('止めるときも、知らせることは一緒に返す（照合なし・差あり・未反映の組み合わせ）', () => {
      expect(closeCheck({ ...ok, bonusProblems: 2, soft: { matched: 0, diff: 10 }, regularPending: 1 })).toEqual({
        block: 'bonusProblems',
        notes: ['softDiff', 'regularPending'],
      });
    });
  });
});
