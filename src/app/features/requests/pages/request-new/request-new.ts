import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import {
  QUESTION_TYPES,
  QuestionType,
  REQUEST_TYPES,
  RequestQuestion,
  RequestType,
} from '../../../../core/models/office-records';
import { DATE_RE, todayLocal } from '../../../../shared/utils/date';
import { toKatakana } from '../../../../shared/utils/text';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import { customQuestion, fieldQuestion, REQUEST_FIELDS, RequestField, templateQuestions } from '../../logic/request-model';
import { RequestService } from '../../request.service';

/** ルールの上限と同じ */
const MAX_QUESTIONS = 50;

/**
 * 新しい依頼：ひな形を選び、質問を足し引きして、1人にでも、まとめてでも出す
 * ?employee=ID で開くと、その人を選んだ状態で始まる（従業員の詳細の「依頼を出す」）
 */
@Component({
  selector: 'app-request-new',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './request-new.html',
  styleUrl: '../requests.css',
})
export class RequestNew {
  private readonly api = inject(RequestService);
  private readonly employeesApi = inject(EmployeeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  readonly types = REQUEST_TYPES;
  readonly questionTypes = QUESTION_TYPES;
  readonly fields = REQUEST_FIELDS;
  readonly today = todayLocal();

  // ===== 中身 =====
  readonly type = signal<RequestType>('onboarding');
  readonly title = signal('');
  readonly dueDate = signal('');
  readonly questions = signal<RequestQuestion[]>(templateQuestions('onboarding'));

  // 質問を足す
  readonly newLabel = signal('');
  readonly newType = signal<QuestionType>('text');
  readonly newChoices = signal('');
  readonly newRequired = signal(false);
  readonly newField = signal<RequestField | ''>('');

  // ===== あて先 =====
  readonly employees = signal<Employee[]>([]);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly search = signal('');
  readonly visible = computed(() => {
    const q = toKatakana(this.search().trim());
    return this.employees().filter((e) => {
      if (!q) return true;
      const text = `${e.lastName}${e.firstName}${e.lastNameKana}${e.firstNameKana}${e.employeeNumber ?? ''}`;
      return toKatakana(text).includes(q);
    });
  });
  readonly selectedNoAccount = computed(
    () => this.employees().filter((e) => this.selected().has(e.id) && !e.userUid).length,
  );

  readonly sending = signal(false);
  readonly submitted = signal(false);
  readonly errorKey = signal<string | null>(null);

  /** 送る前のチェック（出すのは翻訳キー） */
  readonly problems = computed(() => {
    const out: string[] = [];
    if (!this.title().trim()) out.push('request.problem.title');
    if (this.questions().length === 0) out.push('request.problem.noQuestion');
    if (this.selected().size === 0) out.push('request.problem.noEmployee');
    const d = this.dueDate();
    if (d && (!DATE_RE.test(d) || d < this.today)) out.push('request.problem.due');
    return out;
  });

  readonly usedFields = computed(() => new Set(this.questions().map((q) => q.field).filter((f) => f)));

  constructor() {
    this.title.set(this.defaultTitle('onboarding'));
    effect(() => {
      const office = this.context.current();
      if (office) this.load(office.id);
    });
  }

  private async load(officeId: string): Promise<void> {
    try {
      const today = this.today;
      const list = (await this.employeesApi.list(officeId)).filter((e) => !e.retireDate || e.retireDate >= today);
      this.employees.set(list);
      const pre = this.route.snapshot.queryParamMap.get('employee');
      if (pre && list.some((e) => e.id === pre)) this.selected.set(new Set([pre]));
    } catch (err) {
      console.error(err);
      this.errorKey.set('request.error.load');
    }
  }

  private defaultTitle(type: RequestType): string {
    return type === 'custom' ? '' : this.transloco.translate(`request.defaultTitle.${type}`);
  }

  // ===== 中身の操作 =====

  chooseType(type: RequestType): void {
    const old = this.type();
    this.type.set(type);
    // 題名を手で変えていなければ、ひな形の題名にそろえる
    if (!this.title().trim() || this.title() === this.defaultTitle(old)) this.title.set(this.defaultTitle(type));
    // ひな形の質問に入れ替える（足した質問は残す）
    const custom = this.questions().filter((q) => !q.field);
    this.questions.set([...templateQuestions(type), ...custom]);
  }

  toggleRequired(id: string): void {
    this.questions.update((list) => list.map((q) => (q.id === id ? { ...q, required: !q.required } : q)));
  }

  removeQuestion(id: string): void {
    this.questions.update((list) => list.filter((q) => q.id !== id));
  }

  move(id: string, diff: -1 | 1): void {
    this.questions.update((list) => {
      const i = list.findIndex((q) => q.id === id);
      const j = i + diff;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  /** 書き込み先のある項目を足す */
  addField(): void {
    const f = this.newField();
    if (!f || this.usedFields().has(f) || this.questions().length >= MAX_QUESTIONS) return;
    this.questions.update((list) => [...list, fieldQuestion(f, this.newRequired())]);
    this.newField.set('');
  }

  /** 自由な質問を足す */
  addCustom(): void {
    const label = this.newLabel().trim();
    if (!label || this.questions().length >= MAX_QUESTIONS) return;
    const choices = this.newType() === 'choice' ? this.newChoices().split(/[,、\n]/) : null;
    if (this.newType() === 'choice' && (choices ?? []).filter((c) => c.trim()).length < 2) return;
    this.questions.update((list) => [...list, customQuestion(list, label, this.newType(), choices, this.newRequired())]);
    this.newLabel.set('');
    this.newChoices.set('');
  }

  canAddCustom(): boolean {
    if (!this.newLabel().trim()) return false;
    if (this.newType() !== 'choice') return true;
    return this.newChoices().split(/[,、\n]/).filter((c) => c.trim()).length >= 2;
  }

  // ===== あて先の操作 =====

  toggle(id: string): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  selectVisible(on: boolean): void {
    this.selected.update((s) => {
      const next = new Set(s);
      for (const e of this.visible()) {
        if (on) next.add(e.id);
        else next.delete(e.id);
      }
      return next;
    });
  }

  // ===== 送る =====

  async send(): Promise<void> {
    this.submitted.set(true);
    const officeId = this.context.current()?.id;
    if (!officeId || this.problems().length > 0 || this.sending()) return;
    this.sending.set(true);
    this.errorKey.set(null);
    try {
      await this.api.sendToEmployees(officeId, [...this.selected()], {
        type: this.type(),
        title: this.title().trim().slice(0, 100),
        questions: this.questions(),
        dueDate: this.dueDate() || null,
      });
      await this.router.navigate(['/o', officeId, 'requests'], { queryParams: { status: 'open' } });
    } catch (err) {
      console.error(err);
      this.errorKey.set('request.error.send');
    } finally {
      this.sending.set(false);
    }
  }

  nameOf(e: Employee): string {
    return `${e.lastName} ${e.firstName}`.trim();
  }
}
