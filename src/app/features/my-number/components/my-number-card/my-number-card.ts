import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EmployeeFull } from '../../../../core/models/employee';
import {
  MY_NUMBER_DOC_TYPES,
  MyNumberAction,
  MyNumberDocType,
  MyNumberEntry,
  MyNumberLog,
} from '../../../../core/models/my-number';
import { OfficeContext } from '../../../office/office-context.service';
import { adminActions, disposalDate, formatMyNumber, hasNumber, myNumberProblem, normalizeMyNumber } from '../../logic/my-number';
import { myNumberReason, MyNumberService } from '../../my-number.service';
import { PasswordGate } from '../password-gate/password-gate';

/** 開いている入力（null ＝ 閉じている） */
type Mode = 'set' | 'return' | 'refuse' | 'dispose' | 'view' | null;

/** 全桁を出しておく時間（過ぎたら隠す） */
const SHOW_MS = 60_000;

/**
 * 従業員の「本人の情報」タブのマイナンバー（管理者だけ）
 * 状態・確認書類・理由を出し、状態に合わせた操作を並べる。番号は関数でだけ扱う
 */
@Component({
  selector: 'app-my-number-card',
  imports: [PasswordGate, TranslocoPipe],
  templateUrl: './my-number-card.html',
  styleUrl: './my-number-card.css',
})
export class MyNumberCard {
  private readonly api = inject(MyNumberService);
  readonly context = inject(OfficeContext);
  readonly employee = input.required<EmployeeFull>();

  readonly docTypes = MY_NUMBER_DOC_TYPES;
  readonly entry = signal<MyNumberEntry | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly doneKey = signal<string | null>(null);

  readonly mode = signal<Mode>(null);
  readonly numberText = signal('');
  readonly docType = signal<MyNumberDocType | ''>('card');
  readonly note = signal('');
  readonly shown = signal<string | null>(null);
  readonly logs = signal<MyNumberLog[] | null>(null);
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  readonly status = computed(() => this.entry()?.status ?? null);
  /** 操作のボタン（登録・変更は入力を開くので別に出す） */
  readonly actions = computed(() => adminActions(this.status()));
  readonly canView = computed(() => hasNumber(this.status()));
  readonly numberProblem = computed(() => myNumberProblem(this.numberText()));
  /** 退職した人：廃棄してよい日の目安 */
  readonly disposal = computed(() => disposalDate(this.employee(), this.entry()));
  readonly format = formatMyNumber;

  constructor() {
    effect(() => {
      const officeId = this.context.current()?.id;
      const id = this.employee().id;
      if (officeId && this.context.isAdmin()) void this.load(officeId, id);
    });
  }

  private async load(officeId: string, employeeId: string): Promise<void> {
    this.loading.set(true);
    try {
      this.entry.set(await this.api.entry(officeId, employeeId));
    } catch (err) {
      console.error(err);
      this.errorKey.set('myNumber.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  open(mode: Mode): void {
    this.mode.set(this.mode() === mode ? null : mode);
    this.errorKey.set(null);
    this.doneKey.set(null);
    this.numberText.set('');
    this.note.set('');
    this.docType.set(this.entry()?.docType ?? 'card');
  }

  /** 入力を開かずに済む操作（依頼・取り消し・承認） */
  async quick(action: MyNumberAction): Promise<void> {
    await this.run(action, {});
  }

  async saveNumber(): Promise<void> {
    const n = normalizeMyNumber(this.numberText());
    if (!n || this.numberProblem()) return;
    await this.run('set', { number: n, docType: this.docType() || null });
  }

  async saveNote(action: 'return' | 'refuse'): Promise<void> {
    if (!this.note().trim()) return;
    await this.run(action, { note: this.note().trim() });
  }

  async dispose(): Promise<void> {
    await this.run('dispose', {});
  }

  private async run(
    action: MyNumberAction,
    extra: { number?: string; docType?: MyNumberDocType | null; note?: string },
  ): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      await this.api.act(officeId, this.employee().id, action, extra);
      this.mode.set(null);
      this.hide();
      this.numberText.set('');
      this.doneKey.set(`myNumber.done.${action}`);
      await this.load(officeId, this.employee().id);
      if (this.logs()) await this.loadLogs();
    } catch (err) {
      console.error(err);
      this.errorKey.set(`myNumber.reason.${myNumberReason(err)}`);
    } finally {
      this.busy.set(false);
    }
  }

  /** パスワードを確かめたあと：全桁を出す（1分で隠す） */
  async reveal(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId) return;
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      this.shown.set(await this.api.view(officeId, this.employee().id));
      this.mode.set(null);
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => this.hide(), SHOW_MS);
      if (this.logs()) await this.loadLogs();
    } catch (err) {
      console.error(err);
      this.errorKey.set(`myNumber.reason.${myNumberReason(err)}`);
    } finally {
      this.busy.set(false);
    }
  }

  hide(): void {
    this.shown.set(null);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  async toggleLogs(): Promise<void> {
    if (this.logs()) {
      this.logs.set(null);
      return;
    }
    await this.loadLogs();
  }

  private async loadLogs(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId) return;
    try {
      this.logs.set(await this.api.logs(officeId, this.employee().id));
    } catch (err) {
      console.error(err);
      this.errorKey.set('myNumber.error.logs');
    }
  }

  when(d: Date | null): string {
    return d ? d.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  }

  input(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
}
