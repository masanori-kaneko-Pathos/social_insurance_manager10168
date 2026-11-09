import { Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { RequestQuestion } from '../../../../core/models/office-records';
import { FIELD_SPECS, isRequestField } from '../../logic/request-model';

interface Row {
  q: RequestQuestion;
  answer: string;
  /** 書き込み先のある質問：今の値と、書き込む値（変わらないなら same） */
  now: string | null;
  willBe: string | null;
  same: boolean;
}

/** 答えを読むだけの表（管理者の確認・従業員の提出後）。今の値と並べて、変わるところに印をつける */
@Component({
  selector: 'app-answer-view',
  imports: [TranslocoPipe],
  templateUrl: './answer-view.html',
  styleUrl: './answer-view.css',
})
export class AnswerView {
  readonly questions = input.required<RequestQuestion[]>();
  readonly answers = input.required<Record<string, string>>();
  /** 今の値（渡さなければ「今」の列を出さない） */
  readonly current = input<Record<string, string | null> | null>(null);

  readonly rows = computed<Row[]>(() =>
    this.questions().map((q) => {
      const answer = this.answers()[q.id] ?? '';
      const now = q.field ? (this.current()?.[q.field] ?? null) : null;
      const willBe = isRequestField(q.field) && answer ? (FIELD_SPECS[q.field].normalize(answer) ?? null) : null;
      return { q, answer, now, willBe, same: willBe !== null && willBe === now };
    }),
  );

  display(q: RequestQuestion, v: string | null): string {
    if (v === null || v === '') return '';
    if (q.field === 'bankAccount.accountType') return `employee.accountType.${v}`;
    if (q.type === 'yesno') return `request.yesno.${v}`;
    return v;
  }

  translatable(q: RequestQuestion): boolean {
    return q.field === 'bankAccount.accountType' || q.type === 'yesno';
  }
}
