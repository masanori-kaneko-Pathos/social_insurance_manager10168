import { InsurerPeriod } from '../../core/models/office';
import { sameInsurer, withInsurerDetails } from './office-settings';

const k = (kumiaiName: string, insurerNumber?: string | null) => ({
  type: 'kumiai' as const,
  kumiaiName,
  ...(insurerNumber !== undefined ? { insurerNumber } : {}),
});
const kyokai = { type: 'kyokai' as const, kumiaiName: null };

describe('保険者番号と保険者の履歴（11/26）', () => {
  it('番号を後から入れても、同じ保険者（履歴に行を足さない）', () => {
    expect(
      sameInsurer(k('テスト電機健康保険組合'), k('テスト電機健康保険組合', '06130488')),
    ).toBeTrue();
    expect(
      sameInsurer(k('テスト電機健康保険組合', '06130488'), k('テスト電機健保', '06130488')),
    ).toBeTrue();
    expect(
      sameInsurer(k('テスト電機健康保険組合', '06130488'), k('テスト電機健康保険組合', '06130090')),
    ).toBeFalse();
    expect(sameInsurer(kyokai, k('テスト電機健康保険組合'))).toBeFalse();
  });

  it('今の保険者が続いている行だけ、名前・番号を入れ直す（前の保険者の行はそのまま）', () => {
    const history: InsurerPeriod[] = [
      { from: '0000-01', prefecture: '13', healthInsurer: kyokai },
      { from: '2024-04', prefecture: '13', healthInsurer: k('テスト電機健康保険組合') },
      { from: '2025-04', prefecture: '27', healthInsurer: k('テスト電機健康保険組合') },
    ];
    const next = k('テスト電機健康保険組合', '06130488');
    expect(withInsurerDetails(history, next)).toEqual([
      history[0],
      { from: '2024-04', prefecture: '13', healthInsurer: next },
      { from: '2025-04', prefecture: '27', healthInsurer: next },
    ]);
  });
});
