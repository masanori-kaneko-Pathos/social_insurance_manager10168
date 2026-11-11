/**
 * 使える言語の一覧（ここが1か所の元。言語を足すときは、まずここに1行足す）
 *
 * 言語を足す手順（例：ベトナム語 vi）
 *   1. この一覧に { code: 'vi', label: 'Tiếng Việt', locale: 'vi-VN' } を足す
 *   2. public/i18n/vi.json を置く（ja.json を写して訳す）
 *   3. node scripts/check-i18n.mjs で、ja.json とキーがそろっているか確かめる
 *   4. app.config.ts の availableLangs に 'vi' を足す（または LANG_CODES を使う形に直す）
 *   5. firestore.rules の langs() に 'vi' を足して、firebase deploy --only firestore
 * 言語の切り替え（設定のメニュー・ログイン画面）は、この一覧から自動で並ぶ
 */
export const LANGUAGES = [
  { code: 'ja', label: '日本語', locale: 'ja-JP' },
  { code: 'en', label: 'English', locale: 'en-US' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];

export const LANG_CODES: readonly Lang[] = LANGUAGES.map((l) => l.code);

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANG_CODES as readonly string[]).includes(v);
}

/** 日付・月の名前に使うロケール（知らない言語なら日本語） */
export function localeOf(lang: string): string {
  return LANGUAGES.find((l) => l.code === lang)?.locale ?? 'ja-JP';
}
