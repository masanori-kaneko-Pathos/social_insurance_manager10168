import { Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { payTotal, Payroll } from '../../../../core/models/payroll';
import { GradeTableDoc } from '../../../../core/models/rates';
import { RemunerationDoc, RemunerationInput } from '../../../../core/models/remuneration';
import { SpecialRevision } from '../../../../core/models/revision';
import { shiftMonth, todayLocal } from '../../../../shared/utils/date';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { OfficeContext } from '../../../office/office-context.service';
import { CapMark } from '../../../rates/logic/cap-revision';
import { pickGradeTable } from '../../../rates/logic/grade';
import { standardAt } from '../../logic/revision-base';
import {
  judgeSpecial,
  SPECIAL_REASONS,
  SPECIAL_REVISION_START,
  SpecialDirection,
  specialAfter,
  SpecialReason,
} from '../../logic/special-revision';
import { RevisionService } from '../../revision.service';

/** 特例改定の材料（1人分。改定の候補の画面が読んだものを渡す） */
export interface SpecialPerson {
  employee: Employee;
  payrolls: ReadonlyMap<string, Payroll>;
  /** 標準報酬の履歴（届出なしの一斉改定の行も入っている） */
  remunerations: (RemunerationDoc & CapMark)[];
  minDaysAt: (paidMonth: string) => number;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 標準報酬月額の特例改定（令和9年1月から。療養・育児・介護で報酬が急に下がった・戻った人）
 * 本人の申出が要るので、自動の候補にはしない。担当者が人と月を選ぶと、給与の実績から判定する（11/16）
 */
@Component({
  selector: 'app-special-revision-card',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './special-revision-card.html',
  styleUrl: './special-revision-card.css',
})
export class SpecialRevisionCard {
  private readonly api = inject(RevisionService);
  readonly context = inject(OfficeContext);

  readonly people = input.required<SpecialPerson[]>();
  readonly gradeTables = input.required<GradeTableDoc[]>();
  /** 反映したら、画面全体を読み直してもらう */
  readonly saved = output<void>();

  readonly today = todayLocal();
  readonly reasons = SPECIAL_REASONS;
  readonly startMonth = SPECIAL_REVISION_START;

  readonly open = signal(false);
  readonly employeeId = signal('');
  readonly direction = signal<SpecialDirection>('down');
  readonly reason = signal<SpecialReason>('medical');
  readonly firstMonth = signal('');
  /** 支払基礎日数（空なら給与の実績の日数を使う） */
  readonly daysInput = signal('');
  readonly requestedOn = signal(this.today);
  readonly ended = signal(false);
  readonly saving = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly savedKey = signal<string | null>(null);

  /** 選べる人（どちらかの保険に入っている人。名前順） */
  readonly choices = computed(() =>
    this.people()
      .filter((p) => p.employee.health.enrolled || p.employee.pension.enrolled)
      .sort((a, b) => (a.employee.employeeNumber ?? '').localeCompare(b.employee.employeeNumber ?? '')),
  );
  readonly person = computed(() => this.people().find((p) => p.employee.id === this.employeeId()) ?? null);
  readonly payroll = computed(() => {
    const p = this.person();
    const m = this.firstMonth();
    return p && MONTH.test(m) ? (p.payrolls.get(m) ?? null) : null;
  });
  readonly amount = computed(() => {
    const p = this.payroll();
    return p ? payTotal(p) : null;
  });
  readonly days = computed<number | null>(() => {
    const s = this.daysInput().trim();
    if (s !== '') return /^\d{1,2}$/.test(s) ? Number(s) : null;
    return this.payroll()?.days ?? null;
  });
  /** 保存してある標準報酬（一斉改定の行は除く） */
  private readonly stored = computed(() => (this.person()?.remunerations ?? []).filter((r) => !r.capRevised));

  readonly result = computed(() => {
    const p = this.person();
    const m = this.firstMonth();
    const amount = this.amount();
    const days = this.days();
    if (!p || !MONTH.test(m) || amount === null || days === null || !DATE.test(this.requestedOn())) return null;
    const tables = this.gradeTables();
    return judgeSpecial({
      direction: this.direction(),
      firstMonth: m,
      amount,
      days,
      minDays: p.minDaysAt(m),
      requestedOn: this.requestedOn(),
      ended: this.ended(),
      downMonths: this.stored().filter((r) => r.reason === 'special').map((r) => r.from),
      employee: p.employee,
      remunerations: p.remunerations,
      gradesAt: (month) => ({
        health: pickGradeTable(tables, 'health', month)?.grades ?? [],
        pension: pickGradeTable(tables, 'pension', month)?.grades ?? [],
      }),
    });
  });
  readonly minDays = computed(() => {
    const p = this.person();
    const m = this.firstMonth();
    return p && MONTH.test(m) ? p.minDaysAt(m) : null;
  });
  /** 改定月の標準報酬がもうある（上書きしない） */
  readonly exists = computed(() => {
    const r = this.result();
    return !!r && this.stored().some((x) => x.from === r.revisedFrom);
  });
  readonly canSave = computed(
    () => this.context.isAdmin() && !this.saving() && this.result()?.status === 'candidate' && !this.exists(),
  );

  /** 反映済みの特例改定（新しい順） */
  readonly registered = computed(() =>
    this.people()
      .flatMap((p) =>
        p.remunerations.filter((r) => r.reason === 'special' && !r.capRevised).map((r) => ({ employee: p.employee, r })),
      )
      .sort((a, b) => b.r.from.localeCompare(a.r.from)),
  );

  toggle(): void {
    this.open.update((o) => !o);
    this.savedKey.set(null);
  }

  setEmployee(id: string): void {
    this.employeeId.set(id);
    this.daysInput.set('');
  }

  setMonth(m: string): void {
    this.firstMonth.set(m);
    this.daysInput.set('');
  }

  setDirection(d: SpecialDirection): void {
    this.direction.set(d);
    this.daysInput.set('');
    if (d === 'down') this.ended.set(false);
  }

  async save(): Promise<void> {
    const p = this.person();
    const r = this.result();
    const office = this.context.current();
    if (!this.canSave() || !p || !r || !office) return;
    // 改定しない保険・資格のない保険は、改定月の前の月の標準報酬のまま
    const before = standardAt(p.remunerations, shiftMonth(r.revisedFrom, -1))!;
    const { health, pension } = specialAfter(r, before);
    const monthlyAmount = this.amount()!;
    const record: SpecialRevision = {
      officeId: office.id,
      employeeId: p.employee.id,
      revisedFrom: r.revisedFrom,
      direction: this.direction(),
      reason: this.reason(),
      firstMonth: this.firstMonth(),
      monthlyAmount,
      days: this.days()!,
      requestedOn: this.requestedOn(),
      ended: this.direction() === 'up' && this.ended(),
      health,
      pension,
    };
    const remuneration: RemunerationInput = { from: r.revisedFrom, reason: 'special', monthlyAmount, health, pension };
    this.saving.set(true);
    this.errorKey.set(null);
    try {
      await this.api.reflectSpecial(record, remuneration);
      this.savedKey.set('special.saved');
      this.firstMonth.set('');
      this.daysInput.set('');
      this.ended.set(false);
      this.saved.emit();
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'special.error.save'));
    } finally {
      this.saving.set(false);
    }
  }

  readonly name = (e: Employee) => `${e.lastName} ${e.firstName}`;
  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly diffLabel = (d: number) => (d > 0 ? `+${d}` : String(d));
}
