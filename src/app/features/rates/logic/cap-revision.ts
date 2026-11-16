/**
 * 等級の上限が上がったときの一斉改定（11/16）
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 *
 * 等級表に上の等級が足されると（厚年：2027-09 に33級、2028-09 に34級、2029-09 に35級）、
 * その前の月に「一番上の等級」だった人のうち、報酬月額が新しい等級の下限以上の人は、
 * 届出なしで年金事務所が標準報酬を改定し、「標準報酬改定通知書」が会社に届く
 * （2020-09 の31級→32級と同じ仕組み。厚年法20条2項）。
 *
 * 健保も同じ（2016-04 に47級→50級。上限が121万円→139万円）。
 * 一番上かどうか・上がったかは、等級の番号ではなく標準報酬月額で比べる
 * （2016-10 に厚年の下に88千円の等級が足され、番号が1つずつずれた。上限は62万円のままなので改定ではない）
 *
 * 保存してある報酬の履歴は書き換えない。計算に使うときだけ、改定の月から始まる行を足す。
 * - 新しい等級表の月から決まった行（定時決定など）がある人は、その行がもう新しい表で決まっているので何もしない
 * - 一番上でない人・報酬月額が新しい下限に届かない人も何もしない
 * - 等級表が続けて変わるとき（33級→34級）は、前に足した行をもとに次の改定を判断する
 */
import { GradeTableDoc } from '../../../core/models/rates';
import { StandardRemuneration } from '../../../core/models/remuneration';
import { shiftMonth } from '../../../shared/utils/date';
import { gradeOf, pickGradeTable } from './grade';
import { latest } from './pick-rates';

export type CapKind = 'health' | 'pension';

/** 一斉改定を判断するのに要る、報酬の履歴の1行 */
export interface CapRevisable {
  from: string;
  monthlyAmount?: number;
  health: StandardRemuneration;
  pension: StandardRemuneration;
}

/** 一斉改定で足した行の印（どの保険が改定されたか） */
export interface CapMark {
  capRevised?: readonly CapKind[];
}

const KINDS: CapKind[] = ['health', 'pension'];

/** 等級表の一番上の標準報酬月額 */
function topStandard(t: GradeTableDoc): number {
  return t.grades.reduce((m, r) => Math.max(m, r.standard), 0);
}

/**
 * 報酬の履歴に、一斉改定の行を足して返す（元の配列は変えない。改定がなければ同じ中身）
 * 足した行は、前の行をそのまま写して、改定された保険の等級だけ変え、capRevised を付ける。
 */
export function withCapRevisions<T extends CapRevisable>(
  rems: readonly T[],
  tables: readonly GradeTableDoc[],
): (T & CapMark)[] {
  const out: (T & CapMark)[] = [...rems];
  if (rems.length === 0) return out;
  // 等級表が切り替わる月（古い順）。一番古い表は「前の表」がないので見ない
  const months = [...new Set(tables.map((t) => t.from))].sort();
  for (const month of months) {
    const base = latest(out, month);
    if (!base || base.from >= month) continue; // この月以降に決まった行がある（もう新しい表で決まっている）
    const amount = base.monthlyAmount;
    if (amount == null || !Number.isSafeInteger(amount) || amount < 0) continue;

    const revised: Partial<Record<CapKind, StandardRemuneration>> = {};
    for (const kind of KINDS) {
      const next = tables.find((t) => t.kind === kind && t.from === month);
      const prev = pickGradeTable([...tables], kind, shiftMonth(month, -1));
      if (!next || !prev) continue;
      if (base[kind].standard !== topStandard(prev)) continue;
      const after = gradeOf(next.grades, amount);
      if (after.standard > base[kind].standard) revised[kind] = after;
    }
    const kinds = KINDS.filter((k) => revised[k]);
    if (kinds.length === 0) continue;
    out.push({ ...base, from: month, ...revised, capRevised: kinds });
  }
  return out;
}

/** 一斉改定の行だけ（標準報酬のカードで「上限の改定」として見せる） */
export function capRevisionsOf<T extends CapRevisable>(
  rems: readonly T[],
  tables: readonly GradeTableDoc[],
): (T & CapMark)[] {
  return withCapRevisions(rems, tables)
    .filter((r) => r.capRevised)
    .sort((a, b) => a.from.localeCompare(b.from));
}
