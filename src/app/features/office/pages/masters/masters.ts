import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type {
  GradeTableDoc,
  KumiaiRateDoc,
  PickedRate,
  RateSplit,
} from '../../../../core/models/rates';
import { PREFECTURES } from '../../../../core/master/prefectures';
import { todayLocal, toYearMonth, YEAR_MONTH_RE } from '../../../../shared/utils/date';
import { formatMilli } from '../../../premiums/logic/rounding';
import { pickGradeTable } from '../../../rates/logic/grade';
import { isHalf, premiumTable, TableAmount } from '../../../rates/logic/premium-table';
import { formatPercent } from '../../../rates/logic/rate-format';
import { RateService } from '../../../rates/rate.service';
import { RateTables } from '../../../rates/logic/pick-rates';
import { SettingsTabs } from '../../components/settings-tabs/settings-tabs';
import { OfficeContext } from '../../office-context.service';
import { latest } from '../../../rates/logic/pick-rates';
import { everKumiai, insurerFor, insurerHistoryOf, ratesForOffice } from '../../office-settings';

/** 額表の上に出す料率の1行 */
interface RateLine {
  key: string;
  rate: PickedRate;
}

/**
 * 設定 › マスタ（11/26）
 * 給与明細の項目・賞与の項目への入口と、保険料額表・組合の料率の閲覧
 */
@Component({
  selector: 'app-masters',
  imports: [RouterLink, TranslocoPipe, SettingsTabs],
  templateUrl: './masters.html',
  styleUrl: './masters.css',
})
export class Masters {
  readonly context = inject(OfficeContext);
  private readonly rates = inject(RateService);
  private readonly transloco = inject(TranslocoService);

  readonly month = signal(toYearMonth(todayLocal()));
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  private readonly tables = signal<RateTables | null>(null);
  private readonly grades = signal<GradeTableDoc[]>([]);
  readonly kumiai = signal<KumiaiRateDoc[]>([]);

  constructor() {
    effect(() => {
      const office = this.context.current();
      if (office) void this.load(office.id, everKumiai(office));
    });
  }

  private async load(officeId: string, needKumiai: boolean): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [tables, grades] = await Promise.all([
        this.rates.tablesFor(officeId, needKumiai),
        this.rates.grades(),
      ]);
      this.tables.set(tables);
      this.grades.set(grades);
      this.kumiai.set(
        needKumiai
          ? [...(tables.kumiai as KumiaiRateDoc[])].sort((a, b) => b.from.localeCompare(a.from))
          : [],
      );
    } catch {
      this.errorKey.set('masters.loadError');
    } finally {
      this.loading.set(false);
    }
  }

  setMonth(value: string): void {
    if (YEAR_MONTH_RE.test(value)) this.month.set(value);
  }

  /** その月の保険者（協会けんぽ・組合）と都道府県。保険者の履歴より前なら null */
  readonly insurer = computed(() => {
    const office = this.context.current();
    return office ? insurerFor(office, this.month()) : null;
  });

  readonly picked = computed(() => {
    const office = this.context.current();
    const tables = this.tables();
    return office && tables ? ratesForOffice(office, tables)(this.month()) : null;
  });

  /** その月の組合の名前（保険者の履歴から） */
  readonly kumiaiName = computed(() => {
    const office = this.context.current();
    const p = office ? latest(insurerHistoryOf(office), this.month()) : null;
    return p?.healthInsurer.type === 'kumiai' ? (p.healthInsurer.kumiaiName ?? '') : '';
  });

  readonly isKumiai = computed(() => this.insurer()?.healthInsurer.type === 'kumiai');

  readonly prefectureName = computed(() => {
    const code = this.insurer()?.prefecture;
    const p = PREFECTURES.find((x) => x.code === code);
    return p ? (this.transloco.getActiveLang() === 'en' ? p.en : p.ja) : '';
  });

  readonly rateLines = computed<RateLine[]>(() => {
    const r = this.picked();
    if (!r) return [];
    const lines: RateLine[] = [];
    if (r.health) lines.push({ key: 'health', rate: r.health });
    if (r.care) lines.push({ key: 'care', rate: r.care });
    if (r.childSupport && r.childSupport.employee + r.childSupport.employer > 0)
      lines.push({ key: 'childSupport', rate: r.childSupport });
    if (r.pension) lines.push({ key: 'pension', rate: r.pension });
    if (r.childContribution) lines.push({ key: 'childContribution', rate: r.childContribution });
    return lines;
  });

  /** 本人と会社が半分ずつなら「折半額」の1列、違えば「本人」「会社」の2列 */
  readonly half = computed(() => {
    const r = this.picked();
    return !r || isHalf(r);
  });

  readonly hasSupport = computed(() => {
    const s = this.picked()?.childSupport;
    return !!s && s.employee + s.employer > 0;
  });

  /** 額表。料率（健保）か等級表がない月は null */
  readonly table = computed(() => {
    const r = this.picked();
    const month = this.month();
    const health = pickGradeTable(this.grades(), 'health', month);
    const pension = pickGradeTable(this.grades(), 'pension', month);
    if (!r || !r.health || !health) return null;
    try {
      return premiumTable(health.grades, pension?.grades ?? [], r);
    } catch {
      return null;
    }
  });

  readonly gradeSource = computed(
    () => pickGradeTable(this.grades(), 'health', this.month())?.from ?? null,
  );

  pct(rate: number): string {
    return formatPercent(rate);
  }

  total(s: RateSplit): number {
    return s.employee + s.employer;
  }

  yen(milli: number): string {
    return formatMilli(milli);
  }

  /** 折半の列。1/1000円まで出す（端数の処理は、払い方で変わるので額表では丸めない） */
  cell(a: TableAmount | null, part: 'total' | 'employee' | 'employer'): string {
    return a ? formatMilli(a[part]) : '—';
  }

  monthLabel(month: string): string {
    const [y, m] = month.split('-');
    return this.transloco.translate('masters.monthOf', { y, m: Number(m) });
  }
}
