// 届書作成プログラム（日本年金機構が無料で配っているソフト）に取り込む CSV
// 「登録被保険者情報に取り込む CSV ファイルの収録項目」（操作説明書 別添3（3）の57項目）の順に並べる
// - 取り込みの鍵は 事業所整理記号＋被保険者整理番号。新しい人は 氏名（ｶﾅ）と生年月日も要る
// - 文字コードは Shift_JIS（shared/csv/sjis.ts）。使えない文字がある項目は、仕様のとおり省いて知らせる
// - 個人番号（54）は空にする（マイナンバーは、パスワードの確かめ直しと記録つきの「書き出し」からしか出さない）
// - アプリにデータがない項目（基金・雇用保険・住所のカナなど）も空
// Angular・Firebase に依存しない純粋な関数

import { normalizeForSjis, toHalfKana, unsupportedChars } from '../../../shared/csv/sjis';

/** 1行目の見出し（取り込みの画面で「1行目を項目名とする」にチェックを入れる） */
export const NENKIN_HEADERS: readonly string[] = [
  '都道府県コード', '郡市区符号', '事業所記号', '被保険者整理番号', '被保険者氏名(ｶﾅ)', '被保険者氏名（漢字）',
  '生年月日（元号）', '生年月日（年月日）', '種別（性別）', '基礎年金番号（課所符号）', '基礎年金番号（一連番号）',
  '郵便番号（親番号）', '郵便番号（子番号）', '被保険者住所(ｶﾅ)', '被保険者住所（漢字）',
  '資格取得年月日（元号）', '資格取得年月日（年月日）', '従前の標準報酬月額（健保）', '従前の標準報酬月額（厚年）',
  '従前の改定月（元号）', '従前の改定月（年）', '従前の改定月（月）',
  '被保険者等番号', '加入員番号', '加算適用の有無', '加算給与月額', '標準給与月額', '第２加算給与月額', '第２加算標準給与月額',
  '算定・支払基礎日数（４月）', '算定・通貨によるものの額（４月）', '算定・現物によるものの額（４月）',
  '算定・支払基礎日数（５月）', '算定・通貨によるものの額（５月）', '算定・現物によるものの額（５月）',
  '算定・支払基礎日数（６月）', '算定・通貨によるものの額（６月）', '算定・現物によるものの額（６月）',
  '算定・修正平均額', '算定・遡及支払額', '算定・昇(降)給区分', '算定・昇(降)給差の月額',
  '算定・昇(降)給月（年）', '算定・昇(降)給月（月）', '算定・備考欄',
  '賞与・通貨によるものの額', '賞与・現物によるものの額',
  '雇用保険被保険者番号４桁', '雇用保険被保険者番号６桁', '雇用保険被保険者番号１桁',
  '性別', '１週間の所定労働時間（時間）', '１週間の所定労働時間（分）', '個人番号',
  '70歳以上被用者', '二以上被保険者', '短時間労働者',
];

export interface NenkinOffice {
  prefecture: string; // '01'〜'47'
  officeSymbol: string | null; // 「01-イロハ」など
  pensionFund: boolean; // 厚生年金基金の加入員 → 種別 5・6
}

export interface NenkinMonth {
  days: number;
  cash: number;
  /** null ＝ 内訳なし（支払額に含まれている）→ 現物は 0 で出す */
  inKind: number | null;
}

export interface NenkinPerson {
  employee: {
    lastName: string;
    firstName: string;
    lastNameKana: string;
    firstNameKana: string;
    birthDate: string;
    sex: 'male' | 'female' | null;
    insuredNumber: string | null;
    basicPensionNumber: string | null;
    health: { enrolled: boolean; acquiredDate: string | null };
    pension: { enrolled: boolean; acquiredDate: string | null };
    multipleOffices: boolean;
  };
  /** 住民票の住所（鍵付きの文書から。読めなければ null） */
  contact: { postalCode: string | null; address: string | null; overseasCountry?: string | null } | null;
  /** 今の標準報酬月額（円）と、いつから（定時決定・月額変更の届のとき） */
  previous: { health: number; pension: number; from: string } | null;
  /** 算定基礎届：4・5・6月（ないところは null） */
  regular: { months: (NenkinMonth | null)[]; retro: number } | null;
  /** 賞与支払届 */
  bonus: { cash: number; inKind: number } | null;
  over70: boolean;
}

export type NenkinIssueKind = 'nameChars' | 'nameLong' | 'addressChars' | 'addressLong' | 'kanaChars' | 'noInsuredNumber';

export interface NenkinIssue {
  name: string;
  kind: NenkinIssueKind;
  chars: string[];
}

// ===== 小さな道具 =====

const ERAS = [
  { code: '9', start: '2019-05-01' }, // 令和
  { code: '7', start: '1989-01-08' }, // 平成
  { code: '5', start: '1926-12-25' }, // 昭和
  { code: '3', start: '1912-07-30' }, // 大正
  { code: '1', start: '1868-10-23' }, // 明治
] as const;

/** 'YYYY-MM-DD' → 元号の数字と和暦の年（2桁）。読めなければ null */
export function eraOf(date: string): { code: string; yy: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  for (const e of ERAS) {
    if (date >= e.start) {
      const y = Number(date.slice(0, 4)) - Number(e.start.slice(0, 4)) + 1;
      return { code: e.code, yy: String(y).padStart(2, '0') };
    }
  }
  return null;
}

/** 元号の数字と「YYMMDD」 */
function eraDate(date: string | null): [string, string] {
  const e = date ? eraOf(date) : null;
  return e && date ? [e.code, `${e.yy}${date.slice(5, 7)}${date.slice(8, 10)}`] : ['', ''];
}

const yen = (n: number) => String(Math.min(Math.max(0, Math.floor(n)), 9_999_999));
const thousand4 = (n: number) => String(Math.min(Math.floor(n / 1000), 9999)).padStart(4, '0');

/** 事業所整理記号「01-イロハ」→ 郡市区符号「01」と事業所記号「ｲﾛﾊ」 */
export function splitOfficeSymbol(symbol: string | null): [string, string] {
  const s = toHalfKana(symbol ?? '').replace(/[-‐ー－\s]/g, (c) => (c === 'ー' ? c : ''));
  const m = /^(\d{2})(.+)$/.exec(s);
  return m ? [m[1], m[2]] : ['', s];
}

// ===== 1行 =====

export function nenkinRows(
  office: NenkinOffice,
  persons: readonly NenkinPerson[],
): { rows: string[][]; issues: NenkinIssue[] } {
  const issues: NenkinIssue[] = [];
  const [gun, kigo] = splitOfficeSymbol(office.officeSymbol);
  const rows: string[][] = [[...NENKIN_HEADERS]];

  for (const p of persons) {
    const e = p.employee;
    const label = `${e.lastName} ${e.firstName}`.trim();
    const row: string[] = new Array(NENKIN_HEADERS.length).fill('');
    const set = (item: number, v: string) => (row[item - 1] = v); // 項番（1〜57）で入れる

    if (!e.insuredNumber) issues.push({ name: label, kind: 'noInsuredNumber', chars: [] });

    set(1, office.prefecture);
    set(2, gun);
    set(3, kigo);
    set(4, (e.insuredNumber ?? '').replace(/\D/g, ''));

    // 氏名（ｶﾅ）：半角カナ、姓と名の間は半角スペース
    const kana = toHalfKana(`${e.lastNameKana} ${e.firstNameKana}`.trim());
    const badKana = unsupportedChars(kana).concat([...kana].filter((c) => /[^\x20-\x7e｡-ﾟ]/.test(c)));
    if (badKana.length > 0) issues.push({ name: label, kind: 'kanaChars', chars: [...new Set(badKana)] });
    else set(5, kana.slice(0, 25));

    // 氏名（漢字）：全角スペースで区切る。使えない文字・12文字超は省く
    const kanji = normalizeForSjis(`${e.lastName}　${e.firstName}`.trim());
    const badName = unsupportedChars(kanji);
    if (badName.length > 0) issues.push({ name: label, kind: 'nameChars', chars: badName });
    else if ([...kanji].length > 12) issues.push({ name: label, kind: 'nameLong', chars: [] });
    else set(6, kanji);

    [row[6], row[7]] = eraDate(e.birthDate);
    // 種別（性別）：男 1・女 2、厚生年金基金の加入員は 5・6
    if (e.sex) set(9, e.sex === 'male' ? (office.pensionFund ? '5' : '1') : office.pensionFund ? '6' : '2');
    const bpn = (e.basicPensionNumber ?? '').replace(/\D/g, '');
    if (bpn.length === 10) {
      set(10, bpn.slice(0, 4));
      set(11, bpn.slice(4));
    }

    // 住所：海外は郵便番号 999-9999 で、漢字の住所は省く
    const c = p.contact;
    if (c?.overseasCountry) {
      set(12, '999');
      set(13, '9999');
    } else if (c) {
      const zip = (c.postalCode ?? '').replace(/\D/g, '');
      if (zip.length === 7) {
        set(12, zip.slice(0, 3));
        set(13, zip.slice(3));
      }
      const addr = normalizeForSjis(c.address ?? '');
      const badAddr = unsupportedChars(addr);
      if (badAddr.length > 0) issues.push({ name: label, kind: 'addressChars', chars: badAddr });
      else if ([...addr].length > 37) issues.push({ name: label, kind: 'addressLong', chars: [] });
      else set(15, addr);
    }

    const acquired = e.pension.acquiredDate ?? e.health.acquiredDate;
    [row[15], row[16]] = eraDate(acquired);

    if (p.previous) {
      set(18, thousand4(p.previous.health));
      set(19, thousand4(p.previous.pension));
      const [code, ymd] = eraDate(`${p.previous.from}-01`);
      set(20, code);
      set(21, ymd.slice(0, 2));
      set(22, ymd.slice(2, 4));
    }

    if (p.regular) {
      p.regular.months.slice(0, 3).forEach((m, i) => {
        if (!m) return;
        const base = 30 + i * 3;
        set(base, String(Math.min(m.days, 99)).padStart(2, '0'));
        set(base + 1, m.days === 0 ? '00' : yen(m.cash));
        set(base + 2, yen(m.inKind ?? 0));
      });
      if (p.regular.retro > 0) set(40, yen(p.regular.retro));
    }

    if (p.bonus) {
      set(46, yen(p.bonus.cash));
      set(47, yen(p.bonus.inKind));
    }

    if (e.sex) set(51, e.sex === 'male' ? '1' : '2');
    if (p.over70) set(55, '1');
    if (e.multipleOffices) set(56, '1');
    rows.push(row);
  }
  return { rows, issues };
}
