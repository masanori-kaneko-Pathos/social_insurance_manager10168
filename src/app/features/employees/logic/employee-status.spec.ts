import type { Leave } from '../../../core/models/employee';
import { statusChips } from './employee-status';

const leave = (kind: Leave['kind'], start: string, plannedEnd: string | null, end: string | null = null): Leave =>
  ({ kind, start, plannedEnd, end } as Leave);

describe('statusChips（概要の状況の札。11/28）', () => {
  const today = '2026-11-28';
  it('何もなければ札なし', () => {
    expect(statusChips({ leaves: [] }, today)).toEqual([]);
  });
  it('休業：今日が入っている休業を出す。なければ、これからの休業。終わった休業は出さない', () => {
    expect(statusChips({ leaves: [leave('childcare', '2026-10-01', '2027-03-31')] }, today)).toEqual([
      { kind: 'leaveNow', leave: 'childcare', until: '2027-03-31', tab: 'employment' },
    ]);
    expect(statusChips({ leaves: [leave('maternity', '2027-02-01', null), leave('childcare', '2027-05-01', null)] }, today)).toEqual([
      { kind: 'leaveSoon', leave: 'maternity', from: '2027-02-01', tab: 'employment' },
    ]);
    expect(statusChips({ leaves: [leave('suspension', '2026-01-01', '2026-12-31', '2026-03-31')] }, today)).toEqual([]);
  });
  it('海外勤務・協定の適用証明書・役員・介護の適用除外', () => {
    const chips = statusChips(
      {
        leaves: [],
        overseas: [{ country: 'SG', from: '2025-10-01', to: null, payer: 'both', certificateFrom: null, certificateTo: null, note: null }],
        certificate: { country: 'US', to: '2029-03-31' },
        officer: { alsoEmployee: false },
        careExemptions: [{ reason: 'overseas', from: '2025-10-01', to: null, filedOn: null, endFiledOn: null, note: null }] as never,
      },
      today,
    );
    expect(chips.map((c) => c.kind)).toEqual(['overseasNow', 'certificate', 'officer', 'careExempt']);
    expect(chips[0]).toEqual({ kind: 'overseasNow', country: 'SG', payer: 'both', tab: 'employment' });
  });
});
