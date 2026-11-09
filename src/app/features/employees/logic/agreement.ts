// 社会保障協定（R5）
// Angular・Firebase に依存しない純粋な関数
//
// 協定を結んだ国から日本へ一時派遣された人は、相手国の「適用証明書」がある期間、
// 日本の年金（国によっては医療保険も）に加入しない。証明書が切れたら日本の保険に入る。
// どの国で何が免除されるかは masterAgreements（日本年金機構の一覧表）で決まり、
// 1人ずつの証明書は従業員の foreign.certificate に入っている。

import type { AgreementCovers, CertificateDoc } from '../../../core/models/employee';
import type { AgreementDoc } from '../../../core/models/master';
import { addDays, DateStr, toYearMonth } from '../../../shared/utils/date';

export type CertificateLike = Pick<CertificateDoc, 'country' | 'from' | 'to' | 'covers'>;
export type AgreementLike = Pick<AgreementDoc, 'country' | 'from' | 'covers'>;

/** その日に証明書が効いているか（終わりの日を含む） */
export function certificateValidOn(cert: CertificateLike | null | undefined, date: DateStr): boolean {
  return !!cert && cert.from <= date && (!cert.to || date <= cert.to);
}

/** その日に日本の保険のどれが免除されるか（証明書の範囲どおり） */
export function exemptOn(
  cert: CertificateLike | null | undefined,
  date: DateStr,
): { pension: boolean; health: boolean } {
  if (!certificateValidOn(cert, date)) return { pension: false, health: false };
  return { pension: true, health: cert!.covers === 'pensionAndHealth' };
}

export type CertificateWarning =
  | 'noAgreement' // 協定を結んでいない国
  | 'beforeEffective' // 協定の発効より前から
  | 'coversWider' // 協定では年金だけなのに、医療も免除にしている
  | 'coversNarrower' // 協定では医療も免除できるのに、年金だけにしている（証明書のとおりならよい）
  | 'noEnd' // 終わりの日がない（証明書には派遣の期間が書いてある）
  | 'expired' // もう切れている
  | 'expiringSoon'; // まもなく切れる

/** 協定のマスタと照らして、証明書の入力に気をつけるところ */
export function certificateWarnings(
  cert: CertificateLike | null | undefined,
  agreements: readonly AgreementLike[],
  today: DateStr,
  soonDays = 60,
): CertificateWarning[] {
  if (!cert) return [];
  const out: CertificateWarning[] = [];
  const a = agreements.find((x) => x.country === cert.country);
  if (!a) out.push('noAgreement');
  else {
    if (toYearMonth(cert.from) < a.from) out.push('beforeEffective');
    if (cert.covers === 'pensionAndHealth' && a.covers === 'pension') out.push('coversWider');
    if (cert.covers === 'pension' && a.covers === 'pensionAndHealth') out.push('coversNarrower');
  }
  if (!cert.to) out.push('noEnd');
  else if (cert.to < today) out.push('expired');
  else if (cert.to <= addDays(today, soonDays)) out.push('expiringSoon');
  return out;
}

/** 協定のマスタから、その国の証明書の範囲の初期値（協定がなければ null） */
export function defaultCovers(country: string, agreements: readonly AgreementLike[]): AgreementCovers | null {
  return agreements.find((a) => a.country === country)?.covers ?? null;
}
