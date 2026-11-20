import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { RemunerationDoc } from '../../../../core/models/remuneration';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { formatYen } from '../../../../shared/utils/number';
import { toYearMonth } from '../../../../shared/utils/date';
import { healthLostDate, pensionGradeNeeded, pensionLostDate } from '../../../employees/logic/coverage';
import { EmployeeService } from '../../../employees/employee.service';
import { RemunerationService } from '../../../employees/remuneration.service';
import { OfficeContext } from '../../../office/office-context.service';
import { everKumiai, insurerKeyOf, premiumOf, ratesForOffice } from '../../../office/office-settings';
import { RateService } from '../../../rates/rate.service';
import { BonusService } from '../../bonus.service';
import { DecisionNoticeService, NoticeItem } from '../../decision-notice.service';
import { buildBonusRow } from '../../logic/bonus-rows';
import { recipientsOf } from '../../logic/bonus-nature';
import { PENSION_BONUS_CAP_PER_MONTH } from '../../logic/calc-bonus';
import {
  bonusDecisionTextJa,
  decisionTextJa,
  encodeBonusDecision,
  encodeDecision,
  encodeQualification,
  noticeLinkRange,
  qualificationTextJa,
} from '../../logic/decision-notice';
import { PersonName } from '../../../../shared/components/person-name/person-name';

/** どの決定を知らせるか（年金機構の通知書の様式の欄。11/19） */
export type NoticeKind = 'monthly' | 'bonus' | 'qualification';
export const NOTICE_KINDS: readonly NoticeKind[] = ['monthly', 'bonus', 'qualification'];

interface Row {
  key: string;
  employee: Employee;
  /** 内容の欄（翻訳キーと差し込み） */
  what: { key: string; params: Record<string, string | number> };
  health: string;
  pension: string;
  /** 賞与：本人負担の保険料／資格：日付 */
  extra: string;
  item: NoticeItem;
  /** 印刷に使う、通知書の欄（資格取得時決定・定時決定・随時改定・賞与支払時の決定・資格喪失日） */
  /** 印刷に使う日付（決定の月・支払日・喪失日など） */
  sortDate: string;
  sent: boolean;
  hasAccount: boolean;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 決定の内容を本人に知らせる（健康保険法49条2項・厚生年金保険法29条2項。B12・カタログ【5】。11/17、11/19 に広げた）
 * - 標準報酬月額：選んだ月から始まる標準報酬月額（資格取得時決定・定時決定・随時改定・休業終了時改定など）
 * - 標準賞与額：選んだ月に払った賞与（上限を当てたあとの額と、本人負担の保険料）
 * - 資格の取得・喪失：選んだ月に取得・喪失した人（年齢による喪失を含む）
 * マイページの受信箱に届ける。マイページがない人・退職した人には、通知書の形で印刷して渡す
 */
@Component({
  selector: 'app-decision-notice-card',
  imports: [PersonName, TranslocoPipe],
  templateUrl: './decision-notice-card.html',
  styleUrl: './decision-notice-card.css',
})
export class DecisionNoticeCard implements OnInit {
  private readonly employeesApi = inject(EmployeeService);
  private readonly remunerationApi = inject(RemunerationService);
  private readonly bonusApi = inject(BonusService);
  private readonly rates = inject(RateService);
  private readonly api = inject(DecisionNoticeService);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  /** 初めに選んでおく月（定時決定なら9月） */
  readonly initialMonth = input.required<string>();
  /** 初めに選んでおく種類（賞与の一覧なら標準賞与額） */
  readonly initialKind = input<NoticeKind>('monthly');

  readonly kinds = NOTICE_KINDS;
  readonly kind = signal<NoticeKind>('monthly');
  readonly month = signal('');
  readonly open = signal(false);
  readonly loading = signal(false);
  readonly sending = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly sentCount = signal<number | null>(null);
  readonly rows = signal<Row[]>([]);
  readonly selected = signal<Set<string>>(new Set());
  readonly yen = formatYen;

  readonly toSend = computed(() => this.rows().filter((r) => this.selected().has(r.key)));

  ngOnInit(): void {
    this.month.set(this.initialMonth());
    this.kind.set(this.initialKind());
  }

  readonly name = (e: Employee) => `${e.lastName} ${e.firstName}`.trim();

  async toggle(): Promise<void> {
    this.open.set(!this.open());
    if (this.open() && this.rows().length === 0) await this.load();
  }

  async setMonth(m: string): Promise<void> {
    if (!MONTH.test(m)) return;
    this.month.set(m);
    await this.load();
  }

  async setKind(k: NoticeKind): Promise<void> {
    if (this.kind() === k) return;
    this.kind.set(k);
    this.rows.set([]);
    await this.load();
  }

  private async load(): Promise<void> {
    const office = this.context.current();
    const month = this.month();
    if (!office || !MONTH.test(month)) return;
    this.loading.set(true);
    this.errorKey.set(null);
    this.sentCount.set(null);
    try {
      const employees = await this.employeesApi.list(office.id);
      const rows =
        this.kind() === 'monthly'
          ? await this.monthlyRows(office.id, month, employees)
          : this.kind() === 'bonus'
            ? await this.bonusRows(month, employees)
            : await this.qualificationRows(office.id, month, employees);
      rows.sort(
        (a, b) =>
          (a.employee.employeeNumber ?? '').localeCompare(b.employee.employeeNumber ?? '', 'ja', { numeric: true }) ||
          a.sortDate.localeCompare(b.sortDate),
      );
      this.rows.set(rows);
      // 初めは、まだ送っていない人を選んでおく
      this.selected.set(new Set(rows.filter((r) => !r.sent).map((r) => r.key)));
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'decisionNotice.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  /** 標準報酬月額：選んだ月から始まる標準報酬月額がある人（在籍している人だけ） */
  private async monthlyRows(officeId: string, month: string, all: Employee[]): Promise<Row[]> {
    const employees = all.filter(
      (e) => (e.health.enrolled || e.pension.enrolled) && (!e.retireDate || e.retireDate >= `${month}-01`),
    );
    const [lists, sent] = await Promise.all([
      Promise.all(employees.map((e) => this.remunerationApi.list(officeId, e.id))),
      this.api.sentFor(officeId, month),
    ]);
    const rows: Row[] = [];
    employees.forEach((e, i) => {
      const r = (lists[i] as RemunerationDoc[]).find((x) => x.from === month);
      if (!r) return;
      const decision = {
        from: r.from,
        reason: r.reason,
        health: e.health.enrolled ? { grade: r.health.grade, standard: r.health.standard } : null,
        pension: pensionGradeNeeded(e, month) ? { grade: r.pension.grade, standard: r.pension.standard } : null,
      };
      const t = decisionTextJa(decision);
      const grade = (x: { grade: number; standard: number } | null) =>
        x ? `${this.transloco.translate('remuneration.gradeShort', { grade: x.grade })} ${formatYen(x.standard)}` : '—';
      rows.push({
        key: `${e.id}|m|${month}`,
        employee: e,
        what: { key: `remuneration.reason.${r.reason}`, params: {} },
        health: grade(decision.health),
        pension: grade(decision.pension),
        extra: '',
        item: { employeeId: e.id, title: t.title, body: t.body, link: encodeDecision(decision) },
        sortDate: `${month}-01`,
        sent: sent.has(e.id),
        hasAccount: !!e.userUid,
      });
    });
    return rows;
  }

  /** 標準賞与額：選んだ月に払った賞与で、標準賞与額が決まった人（保険料がかかる・喪失月・産休育休の免除） */
  private async bonusRows(month: string, employees: Employee[]): Promise<Row[]> {
    const office = this.context.current()!;
    const [payments, tables, sent] = await Promise.all([
      this.bonusApi.list(office.id),
      this.rates.tablesFor(office.id, everKumiai(office)),
      this.api.sentLinks(office.id, noticeLinkRange('bonus', month)),
    ]);
    const ctx = { ratesFor: ratesForOffice(office, tables), insurerOf: insurerKeyOf(office), options: premiumOf(office) };
    const byId = new Map(employees.map((e) => [e.id, e]));
    const rows: Row[] = [];
    for (const p of payments.filter((x) => x.paidDate.startsWith(month))) {
      for (const id of recipientsOf(p)) {
        const e = byId.get(id);
        if (!e) continue;
        const row = buildBonusRow(e, payments, p.paidDate, ctx);
        const r = row.result;
        if (!r || !(row.state === 'ok' || row.state === 'counted' || row.state === 'exempt')) continue;
        // 健保は年度の上限（573万円）、厚年は月の上限（150万円）を当てたあとの額。免除の月も標準賞与額は決まる
        const health = r.healthStatus !== 'none' ? r.healthBase : null;
        const pension =
          r.pensionStatus === 'charged'
            ? r.pensionBase
            : row.state === 'exempt' && pensionGradeNeeded(e, month)
              ? Math.min(r.standardBonus, PENSION_BONUS_CAP_PER_MONTH)
              : null;
        if (health === null && pension === null) continue;
        const d = { paidDate: p.paidDate, health, pension, employeeYen: r.employeeYen };
        const link = encodeBonusDecision(d);
        const t = bonusDecisionTextJa(d);
        rows.push({
          key: `${e.id}|b|${p.paidDate}`,
          employee: e,
          what: { key: 'decisionNotice.what.bonus', params: { date: p.paidDate } },
          health: health === null ? '—' : formatYen(health),
          pension: pension === null ? '—' : formatYen(pension),
          extra: formatYen(r.employeeYen),
          item: { employeeId: e.id, title: t.title, body: t.body, link },
          sortDate: p.paidDate,
          sent: sent.has(`${e.id}|${link}`),
          hasAccount: !!e.userUid,
        });
      }
    }
    return rows;
  }

  /** 資格の取得・喪失：選んだ月に取得・喪失した人（70歳・75歳の年齢による喪失を含む。退職した人も） */
  private async qualificationRows(officeId: string, month: string, employees: Employee[]): Promise<Row[]> {
    const sent = await this.api.sentLinks(officeId, noticeLinkRange('qual', month));
    const rows: Row[] = [];
    for (const e of employees) {
      const events: { event: 'acquire' | 'loss'; health: string | null; pension: string | null }[] = [
        { event: 'acquire', health: e.health.enrolled ? e.health.acquiredDate : null, pension: e.pension.enrolled ? e.pension.acquiredDate : null },
        { event: 'loss', health: e.health.enrolled ? healthLostDate(e) : null, pension: e.pension.enrolled ? pensionLostDate(e) : null },
      ];
      for (const ev of events) {
        // 健保と厚年で日が同じなら1通、違えばそれぞれ（75歳・70歳など）
        const dates = [...new Set([ev.health, ev.pension].filter((d): d is string => !!d && toYearMonth(d) === month))];
        for (const date of dates.sort()) {
          const d = { event: ev.event, date, health: ev.health === date, pension: ev.pension === date };
          const link = encodeQualification(d);
          const t = qualificationTextJa(d);
          rows.push({
            key: `${e.id}|q|${ev.event}|${date}`,
            employee: e,
            what: { key: `decisionNotice.what.${ev.event}`, params: {} },
            health: d.health ? '○' : '—',
            pension: d.pension ? '○' : '—',
            extra: date,
            item: { employeeId: e.id, title: t.title, body: t.body, link },
            sortDate: date,
            sent: sent.has(`${e.id}|${link}`),
            hasAccount: !!e.userUid,
          });
        }
      }
    }
    return rows;
  }

  check(key: string, on: boolean): void {
    const next = new Set(this.selected());
    if (on) next.add(key);
    else next.delete(key);
    this.selected.set(next);
  }

  checkAll(on: boolean): void {
    this.selected.set(on ? new Set(this.rows().map((r) => r.key)) : new Set());
  }

  async send(): Promise<void> {
    const office = this.context.current();
    const items = this.toSend();
    if (!office || !this.context.isAdmin() || items.length === 0 || this.sending()) return;
    this.sending.set(true);
    this.errorKey.set(null);
    try {
      await this.api.sendNotices(office.id, items.map((r) => r.item));
      const n = items.length;
      await this.load();
      this.sentCount.set(n);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'decisionNotice.error.send'));
    } finally {
      this.sending.set(false);
    }
  }
}
