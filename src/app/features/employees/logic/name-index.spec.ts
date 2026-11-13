import { ForeignDoc } from '../../../core/models/employee';
import { groupByName, kanaRow, matchesName, NamedEmployee, sortKeyOf, deptSortKey } from './name-index';

function jp(last: string, first: string, lastKana: string, firstKana: string): NamedEmployee {
  return { employeeNumber: null, lastName: last, firstName: first, lastNameKana: lastKana, firstNameKana: firstKana, nameOrder: 'kana', foreign: null };
}

function foreign(
  romanLast: string | null,
  romanFirst: string | null,
  lastKana: string,
  firstKana: string,
  extra: Partial<ForeignDoc> = {},
  nameOrder: 'kana' | 'roman' = 'roman',
): NamedEmployee {
  return {
    employeeNumber: null,
    lastName: romanLast ?? lastKana,
    firstName: romanFirst ?? firstKana,
    lastNameKana: lastKana,
    firstNameKana: firstKana,
    nameOrder,
    foreign: {
      romanLastName: romanLast,
      romanFirstName: romanFirst,
      romanMiddleName: null,
      noRomanReason: romanLast ? null : 'notOnCard',
      noRomanReasonText: null,
      kanjiName: null,
      alias: null,
      filingName: 'roman',
      residentRegistered: true,
      needsRomanNameFiling: false,
      nationality: 'US',
      residenceCardNumber: null,
      residenceStatus: null,
      residenceExpiry: null,
      workPermit: false,
      workPermitWeeklyMinutes: null,
      certificate: null,
      noAddressReason: null,
      ...extra,
    },
  };
}

describe('name-index', () => {
  it('kanaRow：濁点・半濁点・小さい字・ヴ・ひらがなも行にまとめる', () => {
    expect(kanaRow('ガ')).toBe('か');
    expect(kanaRow('パ')).toBe('は');
    expect(kanaRow('ャ')).toBe('や');
    expect(kanaRow('ヴ')).toBe('あ');
    expect(kanaRow('ん')).toBe('わ');
    expect(kanaRow('A')).toBeNull();
  });

  it('日本国籍はカナの姓で、外国籍はローマ字の姓で見出しが決まる', () => {
    expect(sortKeyOf(jp('大野', '太郎', 'オオノ', 'タロウ')).label).toBe('あ');
    const kendrick = foreign('LAMAR', 'KENDRICK', 'ラマー', 'ケンドリック');
    expect(sortKeyOf(kendrick).label).toBe('L');
    expect(sortKeyOf(kendrick, 'first').label).toBe('K');
  });

  it('外国籍でも「カナの読みで並べる」ならあ〜わの列', () => {
    const e = foreign('SMITH', 'HANAKO', 'スミス', 'ハナコ', {}, 'kana');
    expect(sortKeyOf(e).label).toBe('さ');
  });

  it('ローマ字氏名がない人はカナの列に戻す', () => {
    expect(sortKeyOf(foreign(null, null, 'グエン', 'アン')).label).toBe('か');
  });

  it('groupByName：あ〜わ → A〜Z の順で、見出しの中はカナ・ABC 順', () => {
    const list = [
      foreign('LEE', 'SOHEE', 'イ', 'ソヒ'),
      jp('佐藤', '花子', 'サトウ', 'ハナコ'),
      foreign('LAMAR', 'KENDRICK', 'ラマー', 'ケンドリック'),
      jp('伊藤', '一郎', 'イトウ', 'イチロウ'),
      jp('後藤', '次郎', 'ゴトウ', 'ジロウ'),
    ];
    const sections = groupByName(list);
    expect(sections.map((s) => s.label)).toEqual(['あ', 'か', 'さ', 'L']);
    expect(sections[3].items.map((e) => e.foreign?.romanLastName)).toEqual(['LAMAR', 'LEE']);
  });

  it('matchesName：漢字・カナ（ひらがなでも）・ローマ字（どちらの順でも）・通称で見つかる', () => {
    const e = foreign('NGUYEN', 'VAN A', 'グエン', 'バンア', {
      alias: { last: '山田', first: '太郎', lastKana: 'ヤマダ', firstKana: 'タロウ' },
    });
    expect(matchesName(e, 'ぐえん')).toBeTrue();
    expect(matchesName(e, 'nguyen van')).toBeTrue();
    expect(matchesName(e, 'van a nguyen')).toBeTrue();
    expect(matchesName(e, '山田')).toBeTrue();
    expect(matchesName(e, 'たろう')).toBeTrue();
    expect(matchesName(e, '佐藤')).toBeFalse();
    expect(matchesName(e, '  ')).toBeTrue();
  });
});

describe('deptSortKey（部署の並べ方。11/13）', () => {
  it('読み → あいうえお順、英字 → A〜Z、読みのない漢字 → 最後', () => {
    const list = [
      { name: '総務部', kana: 'そうむぶ' },
      { name: 'IT推進部', kana: null },
      { name: '営業部', kana: 'エイギョウブ' },
      { name: '品質管理部', kana: null },
      { name: 'カスタマー部', kana: null },
    ];
    const sorted = [...list].sort((a, b) => deptSortKey(a.name, a.kana).localeCompare(deptSortKey(b.name, b.kana), 'ja'));
    expect(sorted.map((d) => d.name)).toEqual(['営業部', 'カスタマー部', '総務部', 'IT推進部', '品質管理部']);
  });
});

