import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { EmployeeRequest } from '../../../../core/models/office-records';
import { AnswerForm } from '../../../requests/components/answer-form/answer-form';
import { AnswerView } from '../../../requests/components/answer-view/answer-view';
import {
  answerErrors,
  cleanAnswers,
  currentValue,
  isAnswerable,
  REQUEST_FIELDS,
} from '../../../requests/logic/request-model';
import { RequestService } from '../../../requests/request.service';
import { MeHeader } from '../../components/me-header/me-header';
import { MeContext } from '../../me-context.service';

/** マイページ：依頼に答える（まだ・差し戻し）／出したものを見る */
@Component({
  selector: 'app-my-request',
  imports: [AnswerForm, AnswerView, MeHeader, RouterLink, TranslocoPipe],
  templateUrl: './my-request.html',
  styleUrl: '../me.css',
})
export class MyRequest implements OnInit {
  readonly me = inject(MeContext);
  private readonly api = inject(RequestService);
  private readonly route = inject(ActivatedRoute);

  readonly request = signal<EmployeeRequest | null>(null);
  readonly answers = signal<Record<string, string>>({});
  readonly loading = signal(true);
  readonly sending = signal(false);
  readonly submitted = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly done = signal(false);

  readonly answerable = computed(() => {
    const r = this.request();
    return !!r && isAnswerable(r.status);
  });
  readonly current = computed<Record<string, string | null>>(() => {
    const e = this.me.employee();
    return e ? Object.fromEntries(REQUEST_FIELDS.map((f) => [f, currentValue(e, f)])) : {};
  });

  async ngOnInit(): Promise<void> {
    await this.me.load();
    await this.reload();
  }

  private async reload(): Promise<void> {
    const ref = this.me.ref();
    const id = this.route.snapshot.paramMap.get('requestId');
    if (!ref || !id) return;
    this.loading.set(true);
    try {
      const r = await this.api.get(ref.officeId, id);
      this.request.set(r);
      this.answers.set({ ...(r?.answers ?? {}) }); // 差し戻しのときは、前の答えから直せる
    } catch (err) {
      console.error(err);
      this.errorKey.set('me.error.request');
    } finally {
      this.loading.set(false);
    }
  }

  async send(): Promise<void> {
    this.submitted.set(true);
    const ref = this.me.ref();
    const r = this.request();
    if (!ref || !r || this.sending()) return;
    if (Object.keys(answerErrors(r.questions, this.answers())).length > 0) return;
    this.sending.set(true);
    this.errorKey.set(null);
    try {
      await this.api.submit(ref.officeId, r.id, cleanAnswers(r.questions, this.answers()));
      this.done.set(true);
      this.submitted.set(false);
      await this.reload();
    } catch (err) {
      console.error(err);
      this.errorKey.set('me.error.submit');
    } finally {
      this.sending.set(false);
    }
  }
}
