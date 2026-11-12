/**
 * 外国籍の従業員の入力欄の選択肢（国籍・在留資格）。Angular・Firebase に依存しない
 *
 * 国籍：ISO 3166-1 の2文字のコード（日本を除く）を A〜Z で並べる。国の名前は書き写さず、
 *   ブラウザの国名辞書（Intl.DisplayNames）から、その画面の言語で出す（書き写しの間違いを入れないため）
 * 在留資格：出入国在留管理庁の「在留資格一覧表」の名前（在留カードに書いてある名前）をそのまま保存する。
 *   よく使う就労資格を上に、身分・地位による資格、就労できない資格と続け、外交・公用はいちばん下
 */

/** ISO 3166-1 alpha-2（今ある国・地域。日本と、なくなった国のコードは除く） */
export const COUNTRY_CODES: readonly string[] = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI',
  'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML',
  'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NC',
  'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH',
  'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA',
  'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST',
  'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR',
  'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN',
  'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];

export interface CountryOption {
  code: string;
  name: string;
}

/** 国籍の選択肢（コードの A〜Z 順。名前はその言語の国名。辞書にない国はコードのまま） */
export function countryOptions(lang: string): CountryOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([lang], { type: 'region' });
  } catch {
    names = null;
  }
  return COUNTRY_CODES.map((code) => ({ code, name: names?.of(code) ?? code }));
}

/** 1つの国コードの名前（その言語。辞書にない国はコードのまま） */
export function countryName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export type ResidenceGroup = 'work' | 'status' | 'nonWork' | 'diplomatic';

export interface ResidenceStatus {
  /** 保存する値（在留カードの表記） */
  ja: string;
  en: string;
  group: ResidenceGroup;
}

/** 在留資格（選択肢の並び順） */
export const RESIDENCE_STATUSES: readonly ResidenceStatus[] = [
  // 就労できる資格（よく使うものを上に）
  { ja: '技術・人文知識・国際業務', en: 'Engineer/Specialist in Humanities/International Services', group: 'work' },
  { ja: '特定技能1号', en: 'Specified Skilled Worker (i)', group: 'work' },
  { ja: '特定技能2号', en: 'Specified Skilled Worker (ii)', group: 'work' },
  { ja: '技能実習1号', en: 'Technical Intern Training (i)', group: 'work' },
  { ja: '技能実習2号', en: 'Technical Intern Training (ii)', group: 'work' },
  { ja: '技能実習3号', en: 'Technical Intern Training (iii)', group: 'work' },
  { ja: '企業内転勤', en: 'Intra-company Transferee', group: 'work' },
  { ja: '技能', en: 'Skilled Labor', group: 'work' },
  { ja: '介護', en: 'Nursing Care', group: 'work' },
  { ja: '高度専門職1号イ', en: 'Highly Skilled Professional (i)(a)', group: 'work' },
  { ja: '高度専門職1号ロ', en: 'Highly Skilled Professional (i)(b)', group: 'work' },
  { ja: '高度専門職1号ハ', en: 'Highly Skilled Professional (i)(c)', group: 'work' },
  { ja: '高度専門職2号', en: 'Highly Skilled Professional (ii)', group: 'work' },
  { ja: '経営・管理', en: 'Business Manager', group: 'work' },
  { ja: '法律・会計業務', en: 'Legal/Accounting Services', group: 'work' },
  { ja: '医療', en: 'Medical Services', group: 'work' },
  { ja: '研究', en: 'Researcher', group: 'work' },
  { ja: '教育', en: 'Instructor', group: 'work' },
  { ja: '教授', en: 'Professor', group: 'work' },
  { ja: '芸術', en: 'Artist', group: 'work' },
  { ja: '宗教', en: 'Religious Activities', group: 'work' },
  { ja: '報道', en: 'Journalist', group: 'work' },
  { ja: '興行', en: 'Entertainer', group: 'work' },
  { ja: '特定活動', en: 'Designated Activities', group: 'work' },
  // 身分・地位による資格（仕事の制限なし）
  { ja: '永住者', en: 'Permanent Resident', group: 'status' },
  { ja: '日本人の配偶者等', en: 'Spouse or Child of Japanese National', group: 'status' },
  { ja: '永住者の配偶者等', en: 'Spouse or Child of Permanent Resident', group: 'status' },
  { ja: '定住者', en: 'Long Term Resident', group: 'status' },
  { ja: '特別永住者', en: 'Special Permanent Resident', group: 'status' },
  // 就労できない資格（働くには資格外活動の許可が要る）
  { ja: '留学', en: 'Student', group: 'nonWork' },
  { ja: '家族滞在', en: 'Dependent', group: 'nonWork' },
  { ja: '文化活動', en: 'Cultural Activities', group: 'nonWork' },
  { ja: '研修', en: 'Trainee', group: 'nonWork' },
  { ja: '短期滞在', en: 'Temporary Visitor', group: 'nonWork' },
  // 外交・公用（社会保険の場面ではまれなので、いちばん下）
  { ja: '外交', en: 'Diplomat', group: 'diplomatic' },
  { ja: '公用', en: 'Official', group: 'diplomatic' },
];

export const RESIDENCE_GROUPS: readonly ResidenceGroup[] = ['work', 'status', 'nonWork', 'diplomatic'];

/** 働くのに資格外活動の許可が要る在留資格か（週28時間の管理の対象） */
export function needsWorkPermit(status: string | null): boolean {
  return RESIDENCE_STATUSES.some((s) => s.ja === status && s.group === 'nonWork');
}
