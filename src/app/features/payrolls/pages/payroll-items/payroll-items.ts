import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { DEFAULT_TEMPLATE_NAMES, PAYROLL_ITEM_CATEGORIES, PayrollItem, PayrollItemCategory } from '../../../../core/models/payroll-item';
import { categoryOf, itemKey } from '../../logic/payroll-lines';
import { OfficeContext } from '../../../office/office-context.service';
import { PayrollItemService } from '../../payroll-item.service';
import { itemRows, parseItemLabels, PayrollItemError, PayrollItemRow, validatePayrollItem } from '../../logic/payroll-items';

/** 編集中の内容（id が null なら新しい項目。初期値の分類を決め直すときも新しい項目になる） */
interface Draft {
  id: string | null;
  name: string;
  labels: string;
  category: PayrollItemCategory | null;
  /** 事業所の給与項目に入れる（新しい項目は最初からオン） */
  inTemplate: boolean;
  /** 編集を始めたときの名前（名前を変えたら、並びの中の名前も変える） */
  before: string;
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

  // ===== 事業所の給与項目（内訳のひな形：内訳を入れ始めるときに並べる項目名の順。11/24） =====
  // 「追加」は右上の「項目を追加する」だけ。並べるかは一覧のチェックと入力枠のチェックで決め、変えたらすぐ保存する

  /** 保存済みの並び（null ＝ まだない：アプリの例を並べている） */
  readonly savedTemplate = signal<string[] | null>(null);
  /** 今の並び（まだ保存していなければアプリの例） */
  readonly templateNames = signal<string[]>([]);
  readonly templateSaved = signal(false);

  /** その名前の分類（札に出す。決まっていなければ null） */
  categoryOfName(name: string): PayrollItemCategory | null {
    return categoryOf(name, this.items());
  }

  /** 事業所の給与項目に入っているか */
  inTemplate(name: string): boolean {
    return this.templateNames().some((n) => itemKey(n) === itemKey(name));
  }

  /** 並びを変えて、すぐ保存する */
  private async setTemplate(names: string[]): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId) return;
    const before = this.templateNames();
    this.templateNames.set(names);
    this.templateSaved.set(false);
    try {
      await this.api.saveTemplate(officeId, names);
      this.savedTemplate.set([...names]);
      this.templateSaved.set(true);
    } catch (err) {
      console.error(err);
      this.templateNames.set(before);
      this.errorKey.set('payrollItem.error.save');
    }
  }

  moveName(i: number, d: -1 | 1): void {
    const list = [...this.templateNames()];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    void this.setTemplate(list);
  }

  /** 並びから外す（項目そのものは消さない） */
  removeName(i: number): void {
    void this.setTemplate(this.templateNames().filter((_, k) => k !== i));
  }

  /** 一覧のチェック：入れると並びの最後に足し、外すと並びから外す */
  toggleTemplate(name: string, on: boolean): void {
    const list = this.templateNames();
    if (on && !this.inTemplate(name) && list.length < 40) void this.setTemplate([...list, name]);
    if (!on) void this.setTemplate(list.filter((n) => itemKey(n) !== itemKey(name)));
  }

  startNew(): void {
    this.open({ id: null, name: '', labels: '', category: null, inTemplate: true, before: '' });
  }

  /** 事業所の項目は直す。初期値の行は、同じ名前で事業所の項目を作る（分類を決め直す） */
  startEdit(r: PayrollItemRow): void {
    this.open({
      id: r.item?.id ?? null,
      name: r.value.name,
      labels: r.value.labels.join('、'),
      category: r.value.category,
      inTemplate: this.inTemplate(r.value.name),
      before: r.value.name,
    });
  }

  private readonly editCard = viewChild<ElementRef<HTMLElement>>('editCard');

  private open(d: Draft): void {
    this.savedName.set(null);
    this.formErrors.set([]);
    this.draft.set(d);
    // 入力の枠まで送って、項目名にカーソルを置く（枠は一覧の上に出るので、下の行から押しても見失わない）
    setTimeout(() => {
      const el = this.editCard()?.nativeElement;
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el?.querySelector<HTMLInputElement>('#pi-name')?.focus({ preventScroll: true });
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
      // 事業所の給与項目：チェックどおりに入れる・外す。名前を変えたら、並びの位置はそのままで名前だけ変える
      const list = this.templateNames();
      const at = d.before ? list.findIndex((n) => itemKey(n) === itemKey(d.before)) : -1;
      let next = list;
      if (d.inTemplate && at >= 0) next = list.map((n, k) => (k === at ? name : n));
      else if (d.inTemplate && !this.inTemplate(name)) next = [...list, name];
      else if (!d.inTemplate) next = list.filter((n) => itemKey(n) !== itemKey(name) && itemKey(n) !== itemKey(d.before));
      if (next.length !== list.length || next.some((n, k) => n !== list[k])) await this.setTemplate(next);
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
