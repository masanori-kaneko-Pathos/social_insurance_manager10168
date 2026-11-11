// マイナンバーの暗号化（AES-256-GCM）
// - 鍵：環境変数 MYNUMBER_KEY（32バイトを base64。functions/.env.<プロジェクトID> に置き、git には入れない）
// - 付加データ（AAD）に「事業所/従業員」を入れる → 暗号文を別の人の場所へ写しても開けない
// - v：鍵の版。鍵を替えるときは v を上げ、古い版も読めるようにしてから入れ替える

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface Sealed {
  v: number;
  iv: string;
  tag: string;
  data: string;
}

export const KEY_VERSION = 1;

export function keyFrom(base64: string | undefined): Buffer {
  const key = Buffer.from(base64 ?? '', 'base64');
  if (key.length !== 32) throw new Error('MYNUMBER_KEY must be 32 bytes in base64');
  return key;
}

export function seal(key: Buffer, plain: string, aad: string): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { v: KEY_VERSION, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function open(key: Buffer, s: Sealed, aad: string): string {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'));
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(s.data, 'base64')), d.final()]).toString('utf8');
}
