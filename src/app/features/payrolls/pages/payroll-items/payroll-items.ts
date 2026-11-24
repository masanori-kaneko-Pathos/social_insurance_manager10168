import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { DEFAULT_TEMPLATE_NAMES, PAYROLL_ITEM_CATEGORIES, PayrollItem, PayrollItemCategory } from '../../../../core/models/payroll-item';
import { categoryOf, itemKey, itemNames } from '../../logic/payroll-lines';
import { OfficeContext } from '../../../office/office-context.service';
import { PayrollItemService } from '../../payroll-item.service';
import { itemRows, parseItemLabels, PayrollItemError, PayrollItemRow, validatePayrollItem } from '../../logic/payroll-items';

/** 編集中の内容（id が null なら新しい項目。初期値の分類を決め直すときも新しい項目になる） */
interface Draft {
  id: string | null;
  name: string;
  labels: string;
  category: PayrollItemCategory | null;
}

/**
 * 給与の項目と分類（給与明細の項目名 → 社会保険での分類。11/24）
 * 一覧＋その下の編集のカード（賞与の分類と同じ形）。アプリのよくある名前は「初期値」として並べ、分類を決め直せる
 */
@Component({
  selector: 'app-payroll-items',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './payroll-items.html',
  styleUrl: './payroll-items.css',
})
export class PayrollItems {
  readonly context = inject(OfficeContext);
  private readonly api = inject(PayrollItemService);
  private readonly transloco = inject(TranslocoService);

  readonly categories = PAYROLL_ITEM_CATEGORIES;
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  readonly items = signal<PayrollItem[]>([]);
  readonly rows = computed<PayrollItemRow[]>(() => itemRows(this.items()));

  readonly draft = signal<Draft | null>(null);
  readonly formErrors = signal<(PayrollItemError | 'category')[]>([]);
  readonly saving = signal(false);
  readonly savedName = signal<string | null>(null);

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
      const [items, template] = await Promise.all([this.api.list(officeId), this.api.template(officeId)]);
      this.items.set(items);
      this.savedTemplate.set(template);
      this.templateNames.set([...(template ?? DEFAULT_TEMPLATE_NAMES)]);
    } catch (err) {
      console.error(err);
      this.errorKey.set('payrollItem.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 内訳のひな形（内訳を入れ始めるときに並べる項目名の順。11/24） =====

  /** 保存済みのひな形（null ＝ まだない：アプリの例を並べている） */
  readonly savedTemplate = signal<string[] | null>(null);
  /** 編集中のひな形 */
  readonly templateNames = signal<string[]>([]);
  readonly newName = signal('');
  readonly templateSaved = signal(false);
  readonly names = computed(() => itemNames(this.items()));
  readonly templateDirty = computed(() => {
    const saved = this.savedTemplate() ?? [...DEFAULT_TEMPLATE_NAMES];
    const now = this.templateNames();
    return this.savedTemplate() === null || now.length !== saved.length || now.some((n, i) => n !== saved[i]);
  });

  /** その名前の分類（札に出す。決まっていなければ null） */
  categoryOfName(name: string): PayrollItemCategory | null {
    return categoryOf(name, this.items());
  }

  moveName(i: number, d: -1 | 1): void {
    const list = [...this.templateNames()];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.templateNames.set(list);
    this.templateSaved.set(false);
  }

  removeName(i: number): void {
    this.templateNames.set(this.templateNames().filter((_, k) => k !== i));
    this.templateSaved.set(false);
  }

  addName(): void {
    const n = this.newName().trim();
    if (!n || n.length > 30 || this.templateNames().some((x) => itemKey(x) === itemKey(n)) || this.templateNames().length >= 40) return;
    this.templateNames.set([...this.templateNames(), n]);
    this.newName.set('');
    this.templateSaved.set(false);
  }

  async saveTemplate(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || this.saving()) return;
    this.saving.set(true);
    try {
      await this.api.saveTemplate(officeId, this.templateNames());
      this.savedTemplate.set([...this.templateNames()]);
      this.templateSaved.set(true);
    } catch (err) {
      console.error(err);
      this.errorKey.set('payrollItem.error.save');
    } finally {
      this.saving.set(false);
    }
  }

  startNew(): void {
    this.open({ id: null, name: '', labels: '', category: null });
  }

  /** 事業所の項目は直す。初期値の行は、同じ名前で事業所の項目を作る（分類を決め直す） */
  startEdit(r: PayrollItemRow): void {
    this.open({
      id: r.item?.id ?? null,
      name: r.value.name,
      labels: r.value.labels.join('、'),
      category: r.value.category,
    });
  }

  private open(d: Draft): void {
    this.savedName.set(null);
    this.formErrors.set([]);
    this.draft.set(d);
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
    const name = d.name.trim();
    const errors: (PayrollItemError | 'category')[] = [];
    if (!d.category) errors.push('category');
    const input = { name, labels: parseItemLabels(d.labels, name), category: d.category ?? 'variable' };
    errors.push(...validatePayrollItem(input, this.items().filter((i) => i.id !== d.id)));
    this.formErrors.set(errors);
    if (errors.length > 0) return;
    this.saving.set(true);
    try {
      if (d.id) await this.api.update(officeId, d.id, input);
      else await this.api.create(officeId, input);
      this.draft.set(null);
      this.savedName.set(name);
      await this.load(officeId);
    } catch (err) {
      console.error(err);
      this.errorKey.set('payrollItem.error.save');
    } finally {
      this.saving.set(false);
    }
  }

  /** 消す（保存済みの給与は、行に分類を写して持っているので計算は変わらない。初期値と同じ名前なら初期値に戻る） */
  async remove(it: PayrollItem): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || this.saving()) return;
    if (!window.confirm(this.transloco.translate('payrollItem.confirmDelete', { name: it.name }))) return;
    this.saving.set(true);
    try {
      await this.api.remove(officeId, it.id);
      this.savedName.set(null);
      await this.load(officeId);
    } catch (err) {
      console.error(err);
      this.errorKey.set('payrollItem.error.save');
    } finally {
      this.saving.set(false);
    }
  }
}
