import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { BONUS_TREATMENTS, BonusItem, BonusTreatment } from '../../../../core/models/bonus-item';
import { BonusPayment } from '../../../../core/models/bonus';
import { todayLocal } from '../../../../shared/utils/date';
import { OfficeContext } from '../../../office/office-context.service';
import { BonusItemService } from '../../bonus-item.service';
import { BonusService } from '../../bonus.service';
import {
  currentTreatment,
  ItemError,
  namesInUse,
  nextDecisionYear,
  parseLabels,
  treatmentAt,
  validateItem,
  withRename,
  withTreatment,
} from '../../logic/bonus-items';
import { DEFAULT_NATURE } from '../../logic/bonus-nature';

/** 編集中の内容（null の id は新しい項目） */
interface Draft {
  id: string | null;
  name: string;
  labels: string;
  treatment: BonusTreatment;
  plannedCount: string;
  /** 「年4回以上の賞与」の規程が前からある（新しく作った規程なら、次の定時決定までは賞与。11/19） */
  ruleExisted: boolean;
  /** 規程が効く日（扱いを変えたとき、どの年の定時決定から効くかを決める。初期値は今日。事例10。11/19） */
  effectiveDate: string;
}

/** 支給に出てくるが、どの項目にも入っていない名前（11/19） */
export interface LooseName {
  name: string;
  /** その名前の支給の数 */
  count: number;
}

interface ItemRow {
  item: BonusItem;
  /** 今の定時決定の年の扱い */
  now: BonusTreatment;
  /** 先の年から変わる扱い（なければ null） */
  next: { fromYear: number; treatment: BonusTreatment } | null;
  /** この項目に当たる支給の数 */
  used: number;
}

/**
 * 賞与の項目（年4回以上かを数えるまとまりと、社会保険の扱い。11/19）
 * 一覧＋その下の編集のカード。項目は消さない（過去の支給の扱いが変わるため）
 */
@Component({
  selector: 'app-bonus-items',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './bonus-items.html',
  styleUrl: './bonus-items.css',
})
export class BonusItems {
  readonly context = inject(OfficeContext);
  private readonly api = inject(BonusItemService);
  private readonly bonusApi = inject(BonusService);
  private readonly route = inject(ActivatedRoute);

  readonly treatments = BONUS_TREATMENTS;
  readonly today = todayLocal();
  readonly nextYear = nextDecisionYear(this.today);
  /** 編集中の「規程が効く日」から出した、効き始める定時決定の年 */
  readonly draftYear = computed(() => nextDecisionYear(this.draft()?.effectiveDate || this.today));
  /** 今の定時決定の年（次の7月1日の前の年） */
  private readonly thisYear = this.nextYear - 1;

  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  readonly items = signal<BonusItem[]>([]);
  private readonly payments = signal<BonusPayment[]>([]);

  readonly draft = signal<Draft | null>(null);
  readonly formErrors = signal<(ItemError | 'labelInUse')[]>([]);
  readonly saving = signal(false);
  readonly savedName = signal<string | null>(null);

  readonly rows = computed<ItemRow[]>(() =>
    this.items().map((item) => {
      const cur = currentTreatment(item);
      const now = treatmentAt(item, this.thisYear);
      return {
        item,
        now,
        next: cur && cur.fromYear > this.thisYear ? cur : null,
        used: this.payments().filter((p) => p.group === item.name).length,
      };
    }),
  );

  /**
   * まだ決めていない名前：支給に出てくるが、どの項目にも当たらない名前（多い順）
   * 項目を決めないままでも、名前ごとに回数で判定するので計算は正しい。ここで扱いを決めてもらう
   */
  readonly looseNames = computed<LooseName[]>(() => {
    const counts = new Map<string, number>();
    for (const p of this.payments()) {
      if (p.group) continue;
      const name = p.nature?.trim() || DEFAULT_NATURE;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
  });

  /** 「ほかの項目に入れる」で選んでいる項目（名前 → 項目ID） */
  readonly joinTarget = signal<Record<string, string>>({});

  /** 編集中の項目が、もう支給に使われているか（扱いの変更が次の定時決定の年からになる） */
  readonly draftUsed = computed(() => {
    const d = this.draft();
    return !!d?.id && (this.rows().find((r) => r.item.id === d.id)?.used ?? 0) > 0;
  });

  constructor() {
    effect(() => {
      const id = this.context.current()?.id;
      if (id) untracked(() => void this.load(id));
    });
  }

  private async load(officeId: string): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [items, payments] = await Promise.all([this.api.list(officeId), this.bonusApi.list(officeId)]);
      this.items.set(items);
      this.payments.set(payments);
      // 賞与の入力・一覧の「項目にする」から来たとき：その名前で新しい項目を開く（1回だけ）
      const name = this.route.snapshot.queryParamMap.get('name');
      if (name && !this.draft() && this.context.isAdmin() && this.looseNames().some((l) => l.name === name)) {
        this.startNew(name);
      }
    } catch (err) {
      console.error(err);
      this.errorKey.set('bonusItem.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 編集 =====

  startNew(name = ''): void {
    this.savedName.set(null);
    this.formErrors.set([]);
    this.draft.set({ id: null, name, labels: '', treatment: 'count', plannedCount: '', ruleExisted: false, effectiveDate: this.today });
  }

  setJoinTarget(name: string, itemId: string): void {
    this.joinTarget.set({ ...this.joinTarget(), [name]: itemId });
  }

  /** まだ決めていない名前を、選んだ項目の取り込みの名前に足す（扱いはその項目のもの） */
  async join(name: string): Promise<void> {
    const officeId = this.context.current()?.id;
    const it = this.items().find((i) => i.id === this.joinTarget()[name]);
    if (!officeId || !it || this.saving()) return;
    const input = { name: it.name, labels: [...it.labels, name], plannedCount: it.plannedCount, treatments: it.treatments };
    const errors = validateItem(input, this.items().filter((i) => i.id !== it.id));
    if (errors.length > 0) {
      this.errorKey.set('bonusItem.error.' + errors[0]);
      return;
    }
    this.saving.set(true);
    try {
      await this.api.update(officeId, it.id, input);
      this.savedName.set(it.name);
      await this.load(officeId);
    } catch (err) {
      console.error(err);
      this.errorKey.set('bonusItem.error.save');
    } finally {
      this.saving.set(false);
    }
  }

  startEdit(it: BonusItem): void {
    this.savedName.set(null);
    this.formErrors.set([]);
    this.draft.set({
      id: it.id,
      name: it.name,
      labels: it.labels.join('、'),
      treatment: currentTreatment(it)?.treatment ?? 'count',
      plannedCount: it.plannedCount === null ? '' : String(it.plannedCount),
      ruleExisted: treatmentAt(it, 0) === 'remuneration',
      effectiveDate: this.today,
    });
  }

  cancel(): void {
    this.draft.set(null);
    this.formErrors.set([]);
  }

  patch(p: Partial<Draft>): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, ...p });
  }

  async save(): Promise<void> {
    const d = this.draft();
    const officeId = this.context.current()?.id;
    if (!d || !officeId || this.saving()) return;
    const before = d.id ? (this.items().find((i) => i.id === d.id) ?? null) : null;
    const count = d.plannedCount.trim() === '' ? null : Number(d.plannedCount);
    const input = withRename(before, {
      name: d.name.trim(),
      labels: parseLabels(d.labels, d.name),
      plannedCount: count,
      treatments: withTreatment(before?.treatments ?? [], d.treatment, this.draftUsed(), d.effectiveDate || this.today, d.ruleExisted),
    });
    const errors: (ItemError | 'labelInUse')[] = validateItem(
      input,
      this.items().filter((i) => i.id !== d.id),
    );
    // 支給に使っている取り込みの名前は消せない（過去の支給がどの項目かわからなくなる）
    if (before) {
      const inUse = namesInUse(this.payments(), DEFAULT_NATURE);
      if (before.labels.some((l) => inUse.has(l) && !input.labels.includes(l) && l !== input.name)) errors.push('labelInUse');
    }
    this.formErrors.set(errors);
    if (errors.length > 0) return;
    this.saving.set(true);
    try {
      if (d.id) await this.api.update(officeId, d.id, input);
      else await this.api.create(officeId, input);
      this.draft.set(null);
      this.savedName.set(input.name);
      await this.load(officeId);
    } catch (err) {
      console.error(err);
      this.errorKey.set('bonusItem.error.save');
    } finally {
      this.saving.set(false);
    }
  }
}
