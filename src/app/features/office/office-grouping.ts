import { Office } from '../../core/models/office';

export interface OfficeGroup {
  key: string;
  label: string | null; // null は「その他」（法人番号なし）
  offices: Office[];
}

const byName = (a: Office, b: Office) => a.name.localeCompare(b.name, 'ja');

/**
 * まとめて並べる
 * - グループの名前があれば、その名前ごと（親会社と子会社のように、法人番号が違ってもまとめる）
 * - なければ法人番号ごと。どちらもないものは最後に「その他」
 */
export function groupOfficesByCorporation(offices: Office[]): OfficeGroup[] {
  const groups = new Map<string, OfficeGroup>();
  const others: Office[] = [];

  for (const o of offices) {
    const groupName = o.groupName?.trim() || null;
    const key = groupName ? `group:${groupName}` : o.corporateNumber;
    if (!key) {
      others.push(o);
      continue;
    }
    const g = groups.get(key);
    if (g) {
      g.offices.push(o);
    } else {
      groups.set(key, {
        key,
        label: groupName ?? o.corporateName ?? o.corporateNumber,
        offices: [o],
      });
    }
  }

  const list = [...groups.values()]
    .map((g) => ({ ...g, offices: [...g.offices].sort(byName) }))
    .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '', 'ja'));

  if (others.length > 0) {
    list.push({ key: 'others', label: null, offices: others.sort(byName) });
  }
  return list;
}
