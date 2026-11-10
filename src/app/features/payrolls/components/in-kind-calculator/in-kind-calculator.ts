import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { InKindDoc } from '../../../../core/models/master';
import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { InKindService } from '../../in-kind.service';
import { emptyInKindForm, inKindAmount, InKindFormValue, inKindTableAt, readInKindForm } from '../../logic/in-kind';

/**
 * 現物給与の計算（食事・住宅を、都道府県の価額で円に直す）
 * 給与の月の画面で、1人分を開いて使う。「この額を入れる」で現物の欄に入る
 */
@Component({
  selector: 'app-in-kind-calculator',
  imports: [HalfWidthDigits, ReactiveFormsModule, TranslocoPipe],
  templateUrl: './in-kind-calculator.html',
  styleUrl: './in-kind-calculator.css',
})
export class InKindCalculator {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(InKindService);

  /** 支払の月（その月に効いている表を使う） */
  readonly month = input.required<string>();
  /** 勤務地の都道府県 '01'〜'47'（事業所の都道府県） */
  readonly prefecture = input.required<string>();
  /** 健康保険組合（規約で別の価額を決めていることがある） */
  readonly kumiai = input(false);
  readonly employeeName = input('');

  readonly apply = output<number>();
  readonly closed = output<void>();

  readonly tables = signal<InKindDoc[] | null>(null);
  readonly loadError = signal(false);

  readonly table = computed(() => {
    const list = this.tables();
    return list ? inKindTableAt(list, this.month()) : null;
  });
  /** 選び直した都道府県（null ＝ 事業所の都道府県のまま） */
  readonly chosenPrefecture = signal<string | null>(null);
  /** 都道府県を選び直しているところか（「変更」を押したら選べる） */
  readonly changingPrefecture = signal(false);
  readonly prefectureCode = computed(() => this.chosenPrefecture() ?? this.prefecture());
  readonly pref = computed(() => this.table()?.prefectures[this.prefectureCode()] ?? null);
  /** 選べる都道府県（コード順） */
  readonly prefectureOptions = computed(() =>
    Object.entries(this.table()?.prefectures ?? {})
      .map(([code, p]) => ({ code, name: p.name }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  );

  readonly form = this.fb.group(emptyInKindForm());
  private readonly value = signal<InKindFormValue>(this.form.getRawValue());
  readonly read = computed(() => readInKindForm(this.value(), this.month()));
  readonly result = computed(() => {
    const r = this.read();
    const p = this.pref();
    return p && 'input' in r ? inKindAmount(p, r.input) : null;
  });
  readonly errors = computed(() => {
    const r = this.read();
    return 'errors' in r ? r.errors.filter((e) => e !== 'nothing') : [];
  });

  constructor() {
    this.form.valueChanges.subscribe(() => this.value.set(this.form.getRawValue()));
    this.api.list().then(
      (list) => this.tables.set(list),
      (err) => {
        console.error(err);
        this.loadError.set(true);
      },
    );
  }

  choosePrefecture(code: string): void {
    this.chosenPrefecture.set(code === this.prefecture() ? null : code);
  }

  use(): void {
    const r = this.result();
    if (r) this.apply.emit(r.total);
  }
}
