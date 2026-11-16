// 失敗したときの知らせの文（翻訳のキー）を、原因で分ける（11/16）
// 前は、権限がないときも「時間をおいてお試しください」と出ていた（待っても直らないのに、待たせてしまう）
// - permission-denied：権限がない（管理者でない・名簿から外された・ルールで止めた）→ 待っても直らない
// - unavailable：つながらない・混んでいる → 少し待つと直ることがある
// - それ以外：画面ごとの文（fallback）
// ※ 関数（siMyNumber* など）の断る理由（details.reason）は、呼ぶ側で先に読む。ここは Firestore の失敗のため

export function errorKeyOf(err: unknown, fallback: string): string {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  if (code === 'permission-denied' || code === 'firestore/permission-denied') return 'common.error.permission';
  if (code === 'unavailable' || code === 'firestore/unavailable' || code === 'deadline-exceeded') {
    return 'common.error.offline';
  }
  return fallback;
}
