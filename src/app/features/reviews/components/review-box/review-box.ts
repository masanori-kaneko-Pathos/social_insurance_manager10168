import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { auth } from '../../../../core/firebase';
import { OfficeContext } from '../../../office/office-context.service';
import { canCheck, canRequest, reviewState } from '../../logic/review';
import { Review, ReviewService } from '../../review.service';

/**
 * ダブルチェックの小さな枠：「確認を頼む」（管理者）→「確認した」（頼んだ人とは別の人。一般でもよい）
 * 届書の一覧・納付の突き合わせに置く。対象（鍵）が変わったら読み直す（1件）
 */
@Component({
  selector: 'app-review-box',
  imports: [TranslocoPipe],
  templateUrl: './review-box.html',
  styleUrl: './review-box.css',
})
export class ReviewBox {
  private readonly api = inject(ReviewService);
  readonly context = inject(OfficeContext);

  /** 対象の鍵（filingReviewId・noticeReviewId） */
  readonly target = input.required<string>();

  readonly review = signal<Review | null | undefined>(undefined);
  readonly busy = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly comment = signal('');

  readonly state = computed(() => reviewState(this.review() ?? null));
  readonly canRequest = computed(() => canRequest(this.review() ?? null, this.context.isAdmin()));
  readonly canCheck = computed(() => canCheck(this.review() ?? null, auth.currentUser?.uid ?? null));
  readonly isRequester = computed(() => this.review()?.requestedBy === auth.currentUser?.uid);

  constructor() {
    effect(() => {
      const officeId = this.context.current()?.id;
      const target = this.target();
      if (officeId) this.load(officeId, target);
    });
  }

  private async load(officeId: string, target: string): Promise<void> {
    this.review.set(undefined);
    this.errorKey.set(null);
    try {
      const r = await this.api.get(officeId, target);
      if (target === this.target()) this.review.set(r);
    } catch (err) {
      console.error(err);
      this.review.set(null);
    }
  }

  private async run(fn: (officeId: string) => Promise<void>): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      await fn(officeId);
      await this.load(officeId, this.target());
    } catch (err) {
      console.error(err);
      this.errorKey.set('review.error');
    } finally {
      this.busy.set(false);
    }
  }

  request(): Promise<void> {
    return this.run((o) => this.api.request(o, this.target()));
  }

  check(): Promise<void> {
    return this.run((o) => this.api.check(o, this.target(), this.comment().trim() || null));
  }

  reset(): Promise<void> {
    return this.run((o) => this.api.reset(o, this.target()));
  }

  when(r: Review, key: 'requestedAt' | 'checkedAt'): string {
    const t = r[key];
    return t ? t.toDate().toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }) : '';
  }
}
