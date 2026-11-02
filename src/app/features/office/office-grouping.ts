import { Office } from '../../core/models/office';

export interface OfficeGroup {
  key: string;
  label: string | null; // null は「その他」（法人番号なし）
  offices: Office[];
}

const byName = (a: Office, b: Office) => a.name.localeCompare(b.name, 'ja');

/** 法人番号ごとにまとめる。法人番号なしは最後に1グループ */
export function groupOfficesByCorporation(offices: Office[]): OfficeGroup[] {
  const corps = new Map<string, OfficeGroup>();
  const others: Office[] = [];

  for (const o of offices) {
    if (!o.corporateNumber) {
      others.push(o);
      continue;
    }
    const g = corps.get(o.corporateNumber);
    if (g) {
      g.offices.push(o);
    } else {
      corps.set(o.corporateNumber, {
        key: o.corporateNumber,
        label: o.corporateName ?? o.corporateNumber,
        offices: [o],
      });
    }
  }

  const groups = [...corps.values()]
    .map((g) => ({ ...g, offices: [...g.offices].sort(byName) }))
    .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '', 'ja'));

  if (others.length > 0) {
    groups.push({ key: 'others', label: null, offices: others.sort(byName) });
  }
  return groups;
}