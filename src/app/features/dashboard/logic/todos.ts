// 「やること」：区分の判定と加入の状態から、手続きが要りそうな人を出す
// Angular・Firebase に依存しない純粋な関数。結果は保存せず、開くたびに計算する
//
// - acquire：今日の区分は加入なのに、加入していない → 資格取得届（いつから加入の区分になったかも出す）
// - lose：今日の区分は加入しないのに、加入している → 資格喪失届か、区分の材料（契約など）の見直し
// - upcoming：この先 horizon 日以内に、加入する／しない が変わる → その日に取得届・喪失届
// - categoryChange：この先、加入のまま区分（通常 ⇄ 短時間）が変わる → 被保険者区分変更届（2026-10〜）
// - noContract：その日に効いている契約がない（判定できない）
// - agreement：社会保障協定の適用証明書が効いているのに、免除される保険に加入している → 資格喪失届（協定）
// - certificateEnd：この先 horizon 日以内に適用証明書が切れる → 翌日から日本の保険に加入（資格取得届）
// 年齢による喪失（70歳・75歳）は年齢到達の一覧で扱うので、ここでは見ない

import type { EnrollmentDoc } from '../../../core/models/employee';
import { addDays, DateStr } from '../../../shared/utils/date';
import { CertificateLike, exemptOn } from '../../employees/logic/agreement';
import {
  classify,
  Classification,
  ClassifyContract,
  ClassifyCriteria,
  ClassifyOffice,
  isInsured,
} from '../../employees/logic/classify';

export type TodoKind =
  | 'acquire'
  | 'lose'
  | 'agreement'
  | 'certificateEnd'
  | 'upcoming'
  | 'categoryChange'
  | 'noContract';

export interface TodoPerson {
  id: string;
  birthDate: DateStr;
  hireDate: DateStr;
  retireDate: DateStr | null;
  optInDate: DateStr | null;
  optOutDate?: DateStr | null;
  health: Pick<EnrollmentDoc, 'enrolled' | 'acquiredDate' | 'lostDate'>;
  pension: Pick<EnrollmentDoc, 'enrolled' | 'acquiredDate' | 'lostDate'>;
  contracts: ClassifyContract[];
  /** 社会保障協定の適用証明書（外国籍の人だけ。なければ null） */
  certificate?: CertificateLike | null;
}

export interface Todo {
  kind: TodoKind;
  employeeId: string;
  /** 今日の区分 */
  today: Classification;
  /** acquire：加入の区分になった日（さかのぼって分かった範囲で）／upcoming・categoryChange：変わる日 */
  date: DateStr | null;
  /** upcoming・categoryChange：変わったあとの区分 */
  next: Classification | null;
}

/** その日に加入しているか（資格取得日〜喪失日の前日） */
function enrolledOn(e: TodoPerson['health'], date: DateStr): boolean {
  return (
    e.enrolled &&
    !!e.acquiredDate &&
    e.acquiredDate <= date &&
    (!e.lostDate || e.lostDate > date)
  );
}

export interface TodoOptions {
  /** この先何日まで見るか */
  horizonDays?: number;
  /** acquire の「いつから」を何日さかのぼって探すか */
  lookbackDays?: number;
}

export function personTodos(
  p: TodoPerson,
  office: ClassifyOffice,
  criteria: ClassifyCriteria[],
  today: DateStr,
  opt: TodoOptions = {},
): Todo[] {
  const horizon = opt.horizonDays ?? 60;
  const lookback = opt.lookbackDays ?? 400;
  if (p.retireDate && p.retireDate < today) return []; // 退職した人
  if (p.hireDate > today) return []; // まだ入社していない人

  const person = {
    birthDate: p.birthDate,
    optInDate: p.optInDate,
    optOutDate: p.optOutDate ?? null,
    contracts: p.contracts,
  };
  const at = (d: DateStr) => classify(person, office, criteria, d);
  const now = at(today);
  // 事業所の所定がない・基準がないのは事業所の問題（呼ぶ側で1枚にまとめる）
  if (now.reason === 'noStandard' || now.reason === 'noCriteria') return [];
  if (now.reason === 'noContract') {
    return [{ kind: 'noContract', employeeId: p.id, today: now, date: null, next: null }];
  }

  const todos: Todo[] = [];
  const insuredNow = isInsured(now);
  // 適用証明書で免除される保険は「入っていなくてよい」。残った保険のどれかに入っていれば加入とみなす
  const exempt = exemptOn(p.certificate, today);
  const healthOn = enrolledOn(p.health, today);
  const pensionOn = enrolledOn(p.pension, today);
  const enrolledNow = (!exempt.health && healthOn) || (!exempt.pension && pensionOn);
  const allExempt = exempt.health && exempt.pension;

  if (insuredNow && (exempt.health && healthOn || exempt.pension && pensionOn)) {
    // 証明書が効いているのに、免除される保険に入っている（入社時に取得してしまった・証明書があとから届いた など）
    todos.push({ kind: 'agreement', employeeId: p.id, today: now, date: p.certificate!.from, next: null });
  }

  if (insuredNow && !allExempt && !enrolledNow) {
    // いつから加入の区分か：入社日か、さかのぼって加入しない区分だった日の翌日
    let since = today;
    for (let i = 1; i <= lookback; i++) {
      const d = addDays(today, -i);
      if (d < p.hireDate || !isInsured(at(d))) break;
      since = d;
    }
    // 適用証明書が切れて加入になった人は、切れた日の翌日から
    const certTo = p.certificate?.to;
    if (certTo && certTo < today && addDays(certTo, 1) > since) since = addDays(certTo, 1);
    todos.push({ kind: 'acquire', employeeId: p.id, today: now, date: since, next: null });
  } else if (!insuredNow && now.category === 'excluded' && enrolledNow) {
    todos.push({ kind: 'lose', employeeId: p.id, today: now, date: null, next: null });
  }

  // 適用証明書が切れる：翌日から日本の保険に入る（そのとき加入の区分なら）
  const certEnd = p.certificate?.to;
  if (certEnd && certEnd >= today && certEnd <= addDays(today, horizon)) {
    const next = addDays(certEnd, 1);
    if (!(p.retireDate && next > p.retireDate) && isInsured(at(next))) {
      todos.push({ kind: 'certificateEnd', employeeId: p.id, today: now, date: next, next: null });
    }
  }

  // この先：最初に「加入する／しない」か区分が変わる日（退職日より後は見ない）
  for (let i = 1; i <= horizon; i++) {
    const d = addDays(today, i);
    if (p.retireDate && d > p.retireDate) break;
    const c = at(d);
    if (c.category === 'unknown') continue;
    if (isInsured(c) !== insuredNow) {
      todos.push({ kind: 'upcoming', employeeId: p.id, today: now, date: d, next: c });
      break;
    }
    if (insuredNow && c.category !== now.category) {
      todos.push({ kind: 'categoryChange', employeeId: p.id, today: now, date: d, next: c });
      break;
    }
  }
  return todos;
}

/** 並べる順：取得届・喪失届（今すぐ）→ これから → 判定できない */
const ORDER: Record<TodoKind, number> = {
  acquire: 0,
  lose: 1,
  agreement: 2,
  certificateEnd: 3,
  upcoming: 4,
  categoryChange: 5,
  noContract: 6,
};

export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort(
    (a, b) => ORDER[a.kind] - ORDER[b.kind] || (a.date ?? '').localeCompare(b.date ?? ''),
  );
}
