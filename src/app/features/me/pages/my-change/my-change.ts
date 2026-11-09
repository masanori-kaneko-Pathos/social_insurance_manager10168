import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AnswerForm } from '../../../requests/components/answer-form/answer-form';
import {
  answerErrors,
  changeRequestQuestions,
  cleanAnswers,
  currentValue,
  REQUEST_FIELDS,
  RequestField,
} from '../../../requests/logic/request-model';
import { RequestService } from '../../../requests/request.service';
import { MeHeader } from '../../components/me-header/me-header';
import { MeContext } from '../../me-context.service';

/** 項目のまとまり（選ぶ画面で見出しをつける） */
const GROUPS: { key: string; fields: RequestField[] }[] = [
  { key: 'contact', fields: REQUEST_FIELDS.filter((f) => f.startsWith('contact.')) },
  { key: 'commute', fields: REQUEST_FIELDS.filter((f) => f.startsWith('commute.')) },
  { key: 'bankAccount', fields: REQUEST_FIELDS.filter((f) => f.startsWith('bankAccount.')) },
];

/** マイページ：自分から変更を申請する（変える項目を選んで、新しい値を入れる） */
@Component({
  selector: 'app-my-change',
  imports: [AnswerForm, MeHeader, RouterLink, TranslocoPipe],
  templateUrl: './my-change.html',
  styleUrl: '../me.css',
})
export class MyChange implements OnInit {
  readonly me = inject(MeContext);
  private readonly api = inject(RequestService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  readonly groups = GROUPS;
  readonly chosen = signal<ReadonlySet<RequestField>>(new Set());
  readonly answers = signal<Record<string, string>>({});
  readonly questions = computed(() => changeRequestQuestions([...this.chosen()]));
  readonly current = computed<Record<string, string | null>>(() => {
    const e = this.me.employee();
    return e ? Object.fromEntries(REQUEST_FIELDS.map((f) => [f, currentValue(e, f)])) : {};
  });
  readonly sending = signal(false);
  readonly submitted = signal(false);
  readonly errorKey = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.me.load();
  }

  toggle(f: RequestField): void {
    this.chosen.update((s) => {
      const next = new Set(s);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  async send(): Promise<void> {
    this.submitted.set(true);
    const ref = this.me.ref();
    const qs = this.questions();
    if (!ref || qs.length === 0 || this.sending()) return;
    if (Object.keys(answerErrors(qs, this.answers())).length > 0) return;
    this.sending.set(true);
    this.errorKey.set(null);
    try {
      const id = await this.api.applyChange(
        ref.officeId,
        ref.employeeId,
        this.transloco.translate('me.changeTitle'),
        qs,
        cleanAnswers(qs, this.answers()),
      );
      await this.router.navigate(['/me', 'requests', id]);
    } catch (err) {
      console.error(err);
      this.errorKey.set('me.error.submit');
    } finally {
      this.sending.set(false);
    }
  }
}
