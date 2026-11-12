import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Dependent } from '../../../../core/models/dependent';
import { EmployeeFull } from '../../../../core/models/employee';
import {
  MY_NUMBER_DOC_TYPES,
  MY_NUMBER_VERIFIED_BY,
  MyNumberAction,
  MyNumberDocType,
  MyNumberEntry,
  MyNumberLog,
  MyNumberStatus,
  MyNumberVerifiedBy,
} from '../../../../core/models/my-number';
import { attachOmission, familyDisposalDate, spouseVerifyWarning } from '../../logic/family-my-number';
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
 * dependent を渡すと、その家族（被扶養者）の番号を扱う（11/12。本人確認をした人と、届の添付のヒントを足す）
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
  /** 家族の番号のとき（なければ従業員本人） */
  readonly dependent = input<Dependent | null>(null);
  /** 家族のとき：従業員本人の番号の状態（届の添付を省けるかに使う） */
  readonly selfStatus = input<MyNumberStatus | null>(null);

  readonly docTypes = MY_NUMBER_DOC_TYPES;
  readonly verifiers = MY_NUMBER_VERIFIED_BY;
  readonly verifiedBy = signal<MyNumberVerifiedBy>('employer');
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
  /** 退職した人（家族は扶養を外れた人）：廃棄してよい日の目安 */
  readonly disposal = computed(() => {
    const d = this.dependent();
    return d ? familyDisposalDate(d.to, this.entry()) : disposalDate(this.employee(), this.entry());
  });
  /** 家族：被扶養者届の続柄の書類を省けるか */
  readonly attach = computed(() => {
    const d = this.dependent();
    return d ? attachOmission(this.selfStatus(), this.entry(), d.relationshipConfirmed) : null;
  });
  /** 家族：配偶者を従業員が本人確認した（会社から任せている場合だけ） */
  readonly spouseWarning = computed(() => {
    const d = this.dependent();
    return !!d && spouseVerifyWarning(d.relationship, this.entry());
  });
  private readonly dependentId = computed(() => this.dependent()?.id ?? null);
  readonly format = formatMyNumber;

  constructor() {
    effect(() => {
      const officeId = this.context.current()?.id;
      const id = this.employee().id;
      this.dependentId();
      if (officeId && this.context.isAdmin()) void this.load(officeId, id);
    });
  }

  private async load(officeId: string, employeeId: string): Promise<void> {
    this.loading.set(true);
    try {
      const dependentId = this.dependentId();
      this.entry.set(
        dependentId
          ? ((await this.api.familyEntries(officeId, employeeId)).get(dependentId) ?? null)
          : await this.api.entry(officeId, employeeId),
      );
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
    // 初めての登録：配偶者は会社、ほかの家族は従業員が本人確認をする扱い
    this.verifiedBy.set(
      this.entry()?.verifiedBy ?? (this.dependent()?.relationship === 'spouse' ? 'employer' : 'employee'),
    );
  }

  /** 入力を開かずに済む操作（依頼・取り消し・承認） */
  async quick(action: MyNumberAction): Promise<void> {
    await this.run(action, {});
  }

  async saveNumber(): Promise<void> {
    const n = normalizeMyNumber(this.numberText());
    if (!n || this.numberProblem()) return;
    await this.run('set', {
      number: n,
      docType: this.docType() || null,
      ...(this.dependentId() ? { verifiedBy: this.verifiedBy() } : {}),
    });
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
    extra: { number?: string; docType?: MyNumberDocType | null; note?: string; verifiedBy?: MyNumberVerifiedBy },
  ): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      await this.api.act(officeId, this.employee().id, action, { ...extra, dependentId: this.dependentId() });
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
      this.shown.set(await this.api.view(officeId, this.employee().id, this.dependentId()));
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
      // 記録は従業員ごとに読む → この人（本人か、この家族）の分だけ出す
      const dependentId = this.dependentId();
      const all = await this.api.logs(officeId, this.employee().id);
      this.logs.set(all.filter((l) => (l.dependentId ?? null) === dependentId));
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
