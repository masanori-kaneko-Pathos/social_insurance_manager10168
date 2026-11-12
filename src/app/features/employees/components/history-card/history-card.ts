import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { auth } from '../../../../core/firebase';
import { Employee } from '../../../../core/models/employee';
import { ChangeHistory } from '../../../../core/models/employee-records';
import { OfficeContext } from '../../../office/office-context.service';
import { HistoryService } from '../../history.service';
import { displayValue, HistoryEntry, recordSummary, valuesAt } from '../../logic/history';

/** 最初に出す件数（「もっと見る」で全部） */
const FIRST = 20;

/**
 * 変更履歴（カタログ【3】）：誰が・いつ・何を・変更前 → 変更後
 * 足すだけの記録なので、ここからは直せない・消せない
 */
@Component({
  selector: 'app-history-card',
  imports: [TranslocoPipe],
  templateUrl: './history-card.html',
  styleUrl: './history-card.css',
})
export class HistoryCard {
  private readonly api = inject(HistoryService);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();

  readonly rows = signal<ChangeHistory[]>([]);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  readonly showAll = signal(false);
  readonly visible = computed(() => (this.showAll() ? this.rows() : this.rows().slice(0, FIRST)));
  readonly hasMore = computed(() => this.rows().length > FIRST);

  // ===== その日の時点の値と比べる（変更履歴を巻き戻す。1人分の履歴だけ） =====
  readonly compareDate = signal('');
  readonly compared = computed(() => {
    const d = this.compareDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    // その日の終わり（23:59:59.999）までの変更は、その日の値に入れる
    const end = new Date(`${d}T23:59:59.999`).getTime();
    const entries: HistoryEntry[] = this.rows()
      .filter((h) => h.field !== '*' && !!h.changedAt)
      .map((h) => ({ target: h.target, field: h.field, before: h.before, after: h.after, at: h.changedAt.toMillis() }));
    return valuesAt(entries, end);
  });

  /** 変更履歴の項目の名前（比べる表で使う） */
  compareLabel(target: string, field: string): string {
    return this.field({ target, field } as ChangeHistory);
  }

  constructor() {
    // 従業員が読み直されたら（編集・扶養・休業のあと）、履歴も読み直す
    effect(() => {
      this.employee();
      this.load();
    });
  }

  /** 保存のあとに呼んでもらう（詳細の画面の changed から） */
  async load(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId) return;
    this.loading.set(true);
    try {
      this.rows.set(await this.api.list(officeId, this.employee().id));
    } catch (err) {
      console.error(err);
      this.errorKey.set('history.error');
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 表示 =====

  private t(key: string, params?: Record<string, unknown>): string | null {
    const v = this.transloco.translate(key, params);
    return v && v !== key ? v : null;
  }

  when(h: ChangeHistory): string {
    const d = h.changedAt?.toDate?.();
    if (!d) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  who(h: ChangeHistory): string {
    return h.changedBy === auth.currentUser?.uid ? (this.t('history.me') ?? 'me') : h.changedBy.slice(0, 6);
  }

  /** 何の記録か（従業員の情報・雇用契約（2026-04-01〜）など） */
  target(h: ChangeHistory): string {
    const [kind, key] = h.target.split('/');
    return this.t(`history.target.${kind}`, { key }) ?? h.target;
  }

  /** どの項目か（作成・削除は「登録」「削除」） */
  field(h: ChangeHistory): string {
    if (h.field === '*') return this.t(h.before === null ? 'history.created' : 'history.deleted') ?? h.field;
    const kind = h.target.split('/')[0];
    return h.field
      .split(',')
      .map((f) => this.fieldLabel(kind, f))
      .join('・');
  }

  private fieldLabel(kind: string, path: string): string {
    const parts = path.split('.');
    const last = parts[parts.length - 1];
    const tryKeys: string[] = [`history.field.${path.replace(/\./g, '_')}`];
    if (kind === 'contracts') tryKeys.push(`contract.field.${last}`);
    if (kind === 'remunerations') tryKeys.push(`remuneration.field.${parts[0]}`);
    if (kind === 'payrolls') tryKeys.push(`payroll.col.${last === 'workMinutes' ? 'hours' : last}`);
    if (kind === 'dependents') tryKeys.push(`dependent.field.${last}`);
    if (kind === 'bonusPayments') tryKeys.push(`history.bonus.${last}`);
    tryKeys.push(`employee.field.${last}`);
    for (const k of tryKeys) {
      const v = this.t(k);
      if (v) {
        // 健保・厚年の資格は、どちらの保険かを前に付ける
        if (kind === 'employee' && (parts[0] === 'health' || parts[0] === 'pension') && parts.length > 1) {
          return `${this.t(`history.ins.${parts[0]}`) ?? parts[0]}：${v}`;
        }
        return v;
      }
    }
    return path;
  }

  /**
   * 変更前・変更後の欄
   * 登録・削除の行は中身の JSON を出さず、種類ごとの短い要約（氏名・契約の始まる日など）にする
   */
  cell(h: ChangeHistory, side: 'before' | 'after'): string {
    const v = h[side];
    if (h.field !== '*') return this.value(v);
    if (v === null) return '—';
    const kind = h.target.split('/')[0];
    return recordSummary(kind, v, (k) => this.t(k) ?? k) ?? '—';
  }

  value(v: string | null): string {
    return displayValue(v, this.t('history.yes') ?? 'yes', this.t('history.no') ?? 'no');
  }
}
