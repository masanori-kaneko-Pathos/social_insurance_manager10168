import { Component, computed, input, model } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { RequestQuestion } from '../../../../core/models/office-records';
import { answerErrors } from '../../logic/request-model';

/**
 * 依頼・申請の答えを入れる欄（質問の種類ごとに入力の形を変える）
 * 答えは [(answers)] で親と共有する。チェックは親が送る前に answerErrors で行い、showErrors で赤くする
 */
@Component({
  selector: 'app-answer-form',
  imports: [TranslocoPipe],
  templateUrl: './answer-form.html',
  styleUrl: './answer-form.css',
})
export class AnswerForm {
  readonly questions = input.required<RequestQuestion[]>();
  readonly answers = model<Record<string, string>>({});
  readonly showErrors = input(false);
  readonly disabled = input(false);
  /** 書き込み先のある質問の、今の値（「今：…」として出す。null の項目は出さない） */
  readonly current = input<Record<string, string | null>>({});

  readonly errors = computed(() => answerErrors(this.questions(), this.answers()));

  value(id: string): string {
    return this.answers()[id] ?? '';
  }

  set(id: string, v: string): void {
    this.answers.update((a) => ({ ...a, [id]: v }));
  }

  errorOf(id: string): string | null {
    const e = this.errors()[id];
    return this.showErrors() && e ? `request.answerError.${e}` : null;
  }

  /** 口座の種別は翻訳して出す。ほかの選択肢は書いたまま */
  choiceLabel(q: RequestQuestion, c: string): string {
    return q.field === 'bankAccount.accountType' ? `employee.accountType.${c}` : c;
  }

  readonly inputId = (q: RequestQuestion) => `ans-${q.id.replace(/\W/g, '-')}`;
}
