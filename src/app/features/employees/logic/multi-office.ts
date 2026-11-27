import type { MultiOffice, MultiOfficeInsurer } from '../../../core/models/remuneration';
import { parseYen } from '../../rates/logic/grade';

/**
 * 二以上事業所勤務の按分の入力（11/28。標準報酬月額の履歴の窓）
 * 決定通知書の「この事業所の報酬月額」と「全部の事業所の合計」、本人が選んだ健康保険を入れる
 * 報酬の2つとも空なら按分しない（null）。片方だけ・合計がこの事業所より少ないなどは誤り
 */
export interface MultiOfficeForm {
  own: string;
  total: string;
  insurer: MultiOfficeInsurer;
  prefecture: string;
}

export type MultiOfficeError = 'own' | 'total' | 'totalLess' | 'prefecture';

export function readMultiOffice(v: MultiOfficeForm): { multi: MultiOffice | null; errors: MultiOfficeError[] } {
  const ownText = v.own.trim();
  const totalText = v.total.trim();
  if (!ownText && !totalText) return { multi: null, errors: [] };
  const own = parseYen(ownText);
  const total = parseYen(totalText);
  const errors: MultiOfficeError[] = [];
  if (own === null || own <= 0) errors.push('own');
  if (total === null || total <= 0) errors.push('total');
  else if (own !== null && own > 0 && total < own) errors.push('totalLess');
  const pref = v.insurer === 'kyokai' ? v.prefecture : '';
  if (v.insurer === 'kyokai' && !/^(0[1-9]|[1-3]\d|4[0-7])$/.test(pref)) errors.push('prefecture');
  if (errors.length > 0) return { multi: null, errors };
  return { multi: { own: own!, total: total!, insurer: v.insurer, prefecture: v.insurer === 'kyokai' ? pref : null }, errors };
}

/** 保存済み → 入力 */
export function multiOfficeForm(m: MultiOffice | null | undefined, officePrefecture = ''): MultiOfficeForm {
  return m
    ? { own: m.own.toLocaleString('ja-JP'), total: m.total.toLocaleString('ja-JP'), insurer: m.insurer, prefecture: m.prefecture ?? officePrefecture }
    : { own: '', total: '', insurer: 'office', prefecture: officePrefecture };
}
