/**
 * ある月に使う保険料率を選ぶ
 * Angular・Firebase に依存しない純粋な関数だけで書く（料率の一覧は引数で受け取る）。
 */
import {
  KumiaiRateInput,
  MasterRateDoc,
  NationalRateKind,
  PickedRate,
  RateMicro,
  RateSplit,
  RatesForMonth,
} from '../../../core/models/rates';

/** 料率を選ぶのに使う事業所の情報（Office をそのまま渡せる） */
export interface OfficeForRates {
  prefecture: string; // '01'〜'47'
  healthInsurer: { type: 'kyokai' | 'kumiai' };
}

export interface RateTables {
  master: MasterRateDoc[];
  kumiai: KumiaiRateInput[]; // 協会けんぽの事業所なら空
}

/** from がその月以前のもののうち、一番新しいもの（なければ null） */
export function latest<T extends { from: string }>(list: T[], month: string): T | null {
  let found: T | null = null;
  for (const item of list) {
    if (item.from <= month && (!found || item.from > found.from)) found = item;
  }
  return found;
}

/** 協会けんぽ・全国一律の料率は労使折半 */
function half(total: RateMicro): RateSplit {
  if (!Number.isSafeInteger(total) || total % 2 !== 0) {
    throw new Error(`料率を折半できません（データを確認してください）: ${total}`);
  }
  return { employee: total / 2, employer: total / 2 };
}

function national(master: MasterRateDoc[], kind: NationalRateKind, month: string) {
  const list = master.filter(
    (d): d is Extract<MasterRateDoc, { kind: NationalRateKind }> => d.kind === kind,
  );
  return latest(list, month);
}

function nationalHalf(
  master: MasterRateDoc[],
  kind: NationalRateKind,
  month: string,
): PickedRate | null {
  const d = national(master, kind, month);
  return d ? { ...half(d.rate), from: d.from, source: 'national' } : null;
}

function kyokaiHealth(
  master: MasterRateDoc[],
  prefecture: string,
  month: string,
): PickedRate | null {
  const list = master.filter(
    (d): d is Extract<MasterRateDoc, { kind: 'kyokaiHealth' }> => d.kind === 'kyokaiHealth',
  );
  const d = latest(list, month);
  const total = d?.byPrefecture[prefecture];
  return d && total !== undefined ? { ...half(total), from: d.from, source: 'kyokai' } : null;
}

/** 料率を選べない月（保険者・都道府県の履歴より前など）。全部「未登録」になる */
export function noRates(month: string): RatesForMonth {
  return {
    month,
    health: null,
    care: null,
    childSupport: null,
    pension: null,
    childContribution: null,
  };
}

export function pickRates(
  office: OfficeForRates,
  tables: RateTables,
  month: string,
): RatesForMonth {
  const { master } = tables;

  // 厚生年金と拠出金は、加入している健保に関係なく全国一律
  const pension = nationalHalf(master, 'pension', month);
  const contribution = national(master, 'childContribution', month);
  const childContribution: PickedRate | null = contribution
    ? { employee: 0, employer: contribution.rate, from: contribution.from, source: 'national' }
    : null;

  if (office.healthInsurer.type === 'kumiai') {
    // 組合健保：健保・介護・支援金は組合の料率（本人分・会社分をそのまま使う）
    const k = latest(tables.kumiai, month);
    const pick = (s: RateSplit | undefined): PickedRate | null =>
      k && s
        ? { employee: s.employee, employer: s.employer, from: k.from, source: 'kumiai' }
        : null;
    return {
      month,
      health: pick(k?.health),
      care: pick(k?.care),
      childSupport: pick(k?.childSupport),
      pension,
      childContribution,
    };
  }

  // 協会けんぽ：健保は都道府県別、介護・支援金は全国一律
  return {
    month,
    health: kyokaiHealth(master, office.prefecture, month),
    care: nationalHalf(master, 'care', month),
    childSupport: nationalHalf(master, 'childSupport', month),
    pension,
    childContribution,
  };
}
