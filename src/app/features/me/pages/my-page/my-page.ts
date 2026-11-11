import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { EmployeeRequest, InboxNotification } from '../../../../core/models/office-records';
import { monthsBetween, shiftMonth, todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { formatPostalCode } from '../../../../shared/utils/text';
import { PremiumCard } from '../../../premiums/components/premium-card/premium-card';
import { isAnswerable, sortRequests } from '../../../requests/logic/request-model';
import { RequestService } from '../../../requests/request.service';
import { MyNumberSubmit } from '../../../my-number/components/my-number-submit/my-number-submit';
import { MeHeader } from '../../components/me-header/me-header';
import { MeContext } from '../../me-context.service';
import { MeInboxService } from '../../me-inbox.service';

/** 保険料を並べる月数（今月を含めて） */
const PREMIUM_MONTHS = 6;

/**
 * 従業員のマイページ
 * - 受信箱（依頼・お知らせ）と、自分への依頼・自分の申請
 * - 自分の情報（連絡先・口座は下4桁だけ）
 * - 保険料（等級・料率・計算の式まで開ける。管理者の詳細画面と同じカード）
 */
@Component({
  selector: 'app-my-page',
  imports: [MeHeader, MyNumberSubmit, PremiumCard, RouterLink, TranslocoPipe],
  templateUrl: './my-page.html',
  styleUrl: '../me.css',
})
export class MyPage implements OnInit {
  readonly me = inject(MeContext);
  private readonly requestsApi = inject(RequestService);
  private readonly router = inject(Router);

  readonly thisMonth = toYearMonth(todayLocal());
  readonly months = monthsBetween(shiftMonth(this.thisMonth, -(PREMIUM_MONTHS - 1)), this.thisMonth);

  /** 受信箱はヘッダーのベルと同じ見張り（ベルで既読にしたら、ここも変わる） */
  private readonly inboxSvc = inject(MeInboxService);
  readonly inbox = this.inboxSvc.list;
  readonly requests = signal<EmployeeRequest[]>([]);
  readonly listError = signal<string | null>(null);

  readonly unread = this.inboxSvc.unread;
  /** 自分への依頼（答えるものが上） */
  readonly toMe = computed(() =>
    sortRequests(
      this.requests()
        .filter((r) => r.direction === 'toEmployee')
        .map((r) => ({ ...r, updatedMs: r.updatedAt?.toMillis() ?? 0 })),
    ).sort((a, b) => Number(isAnswerable(b.status)) - Number(isAnswerable(a.status))),
  );
  readonly fromMe = computed(() =>
    sortRequests(
      this.requests()
        .filter((r) => r.direction === 'fromEmployee')
        .map((r) => ({ ...r, updatedMs: r.updatedAt?.toMillis() ?? 0 })),
    ),
  );

  readonly answerable = isAnswerable;
  readonly postal = formatPostalCode;

  async ngOnInit(): Promise<void> {
    await this.me.load(true);
    await this.loadLists();
  }

  private async loadLists(): Promise<void> {
    const ref = this.me.ref();
    if (!ref) return;
    try {
      this.requests.set(await this.requestsApi.listFor(ref.officeId, ref.employeeId));
    } catch (err) {
      console.error(err);
      this.listError.set('me.error.lists');
    }
  }

  /** お知らせを開く：既読にして、依頼があればそこへ */
  async open(n: InboxNotification): Promise<void> {
    const ref = this.me.ref();
    if (!ref) return;
    this.inboxSvc.markRead(n).catch((err) => console.error(err));
    if (n.link && this.requests().some((r) => r.id === n.link)) {
      await this.router.navigate(['/me', 'requests', n.link]);
    }
  }

  date(n: { createdAt: { toDate(): Date } | null }): string {
    return n.createdAt ? n.createdAt.toDate().toLocaleDateString() : '';
  }

  /** 口座番号は下4桁だけ */
  masked(v: string | null): string {
    if (!v) return '';
    return v.length <= 4 ? v : `${'•'.repeat(v.length - 4)}${v.slice(-4)}`;
  }
}
