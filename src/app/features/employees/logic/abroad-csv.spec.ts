import { abroadCsvTemplate, AbroadTarget, planAbroadImport } from './abroad-csv';

const AG = [
  { country: 'DE', from: '2000-02', covers: 'pension' as const },
  { country: 'US', from: '2005-10', covers: 'pensionAndHealth' as const },
];
const T = (over: Partial<AbroadTarget> = {}): AbroadTarget => ({
  id: 'e1', employeeNumber: 'E001', lastName: '山田', firstName: '太郎', foreign: false, certificate: null, overseas: [],
  birthDate: '1990-01-01', careExemptions: [], ...over,
});
const ctx = { agreements: AG, today: '2026-11-17' };

describe('planAbroadImport：相手国の適用証明書（B9）', () => {
  const H = ['社員番号', '氏名', '証明書の国', '証明書の範囲', '証明書の期間（から）', '証明書の期間（まで）'];
  it('範囲が空なら協定の一覧から。外国籍の人だけ', () => {
    const r = planAbroadImport('certificate', [H, ['E001', '', 'de', '', '2026/4/1', '2031-03-31'], ['E002', '', 'US', '', '2026-04-01', '']], [
      T({ foreign: true }), T({ id: 'e2', employeeNumber: 'E002' }),
    ], ctx);
    expect(r.rows[0].certificate).toEqual({ country: 'DE', from: '2026-04-01', to: '2031-03-31', covers: 'pension' });
    expect(r.rows[1].errors).toEqual([{ column: 'employeeNumber', code: 'notForeign' }]);
  });
  it('協定のない国で範囲が空・読めない範囲・日付の順・登録済みと同じは飛ばす・差し替えは注意', () => {
    const cert = { country: 'DE', from: '2026-04-01', to: '2031-03-31', covers: 'pension' as const };
    const r = planAbroadImport('certificate', [
      H,
      ['E001', '', 'DE', '年金だけ', '2026-04-01', '2031-03-31'],
      ['E002', '', 'TH', '', '2026-04-01', ''],
      ['E003', '', 'DE', 'ぜんぶ', '2026-04-01', '2025-01-01'],
      ['E004', '', 'DE', '年金と医療', '2026-04-01', '2030-03-31'],
    ], [
      T({ foreign: true, certificate: cert }),
      T({ id: 'e2', employeeNumber: 'E002', foreign: true }),
      T({ id: 'e3', employeeNumber: 'E003', foreign: true }),
      T({ id: 'e4', employeeNumber: 'E004', foreign: true, certificate: cert }),
    ], ctx);
    expect(r.rows[0].skip).toBe('same');
    expect(r.rows[1].errors.map((e) => e.code)).toEqual(['coversUnknown']);
    expect(r.rows[2].errors.map((e) => e.code)).toEqual(['order', 'covers']);
    expect(r.rows[3].warnings).toEqual(['replace', 'coversWider']);
  });
  it('必須の列がなければ missing', () => {
    expect(planAbroadImport('certificate', [['社員番号', '国']], [], ctx).missing).toEqual(['from']);
  });
  it('存在しない日付（2/30・13月）は noSuchDate、形が読めない日付は date（11/28）', () => {
    const r = planAbroadImport('certificate', [H, ['E001', '', 'DE', '', '２０２６／２／３０', 'いつか']], [T({ foreign: true })], ctx);
    expect(r.rows[0].errors).toEqual([{ column: 'from', code: 'noSuchDate' }, { column: 'to', code: 'date' }]);
  });
});

describe('planAbroadImport：海外勤務（B9）', () => {
  const tpl = abroadCsvTemplate('overseas');
  const H = tpl[0];
  it('ひな形の行を読める。協定国（年金と医療）で日本の証明書あり → 注意なし（介護の年齢は除く）', () => {
    const r = planAbroadImport('overseas', [H, ['E001', '', 'US', '2026-10-01', '2029-09-30', '両方', '2026-10-01', '2029-09-29', '']], [T({ birthDate: '2000-01-01' })], ctx);
    expect(r.rows[0].errors).toEqual([]);
    expect(r.rows[0].overseas).toEqual({ country: 'US', from: '2026-10-01', to: '2029-09-30', payer: 'both', certificateFrom: '2026-10-01', certificateTo: '2029-09-29', note: null });
    expect(r.rows[0].warnings).toEqual([]);
  });
  it('給与を払う会社が空なら日本の会社だけ。海外の会社だけは資格喪失の注意', () => {
    const r = planAbroadImport('overseas', [H, ['E001', '', 'DE', '2026-10-01', '', '', '', '', ''], ['E002', '', 'DE', '2026-10-01', '', '海外だけ', '', '', '']], [
      T({ birthDate: '2000-01-01' }), T({ id: 'e2', employeeNumber: 'E002', birthDate: '2000-01-01' }),
    ], ctx);
    expect(r.rows[0].overseas?.payer).toBe('japan');
    expect(r.rows[0].warnings).toEqual(['noCertificate', 'pensionOnly', 'careExemption']); // 帰任が未定なので40歳にかかる
    expect(r.rows[1].warnings).toEqual(['payAbroad', 'careExemption']);
  });
  it('重なり・証明書の片方・日本・登録済みと同じ・ファイルの中で重なる', () => {
    const existing = { country: 'US', from: '2024-04-01', to: '2025-03-31', payer: 'japan' as const, certificateFrom: null, certificateTo: null, note: null };
    const r = planAbroadImport('overseas', [
      H,
      ['E001', '', 'US', '2024-04-01', '2025-03-31', '', '', '', ''],
      ['E001', '', 'DE', '2025-01-01', '', '', '', '', ''],
      ['E002', '', 'GB', '2026-01-01', '', '', '2026-01-01', '', ''],
      ['E003', '', 'US', '2026-01-01', '2026-12-31', '', '', '', ''],
      ['E003', '', 'CN', '2026-06-01', '', '', '', '', ''],
    ], [T({ overseas: [existing] }), T({ id: 'e2', employeeNumber: 'E002' }), T({ id: 'e3', employeeNumber: 'E003' })], ctx);
    expect(r.rows[0].skip).toBe('same');
    expect(r.rows[1].errors.map((e) => e.code)).toEqual(['overlap']);
    expect(r.rows[2].errors.map((e) => e.code)).toEqual(['pair']);
    expect(planAbroadImport('overseas', [H, ['E001', '', 'JP', '2026-01-01', '', '', '', '', '']], [T()], ctx).rows[0].errors.map((e) => e.code)).toEqual(['country']);
    expect(r.rows[3].errors).toEqual([]);
    expect(r.rows[4].errors.map((e) => e.code)).toEqual(['duplicate']);
  });
});
