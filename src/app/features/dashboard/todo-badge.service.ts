import { inject, Injectable, signal } from '@angular/core';
import { RequestService } from '../requests/request.service';

/**
 * ヘッダーのベルに出す数（管理者）
 * - To-do の件数：To-do リストを開いたときに数えた数（ベルのためだけに全員の契約を読み直すと、読み込みが増えるため）
 *   ログインしたら最初に To-do リストが開くので、ふだんは数が入っている
 * - 確認待ちの依頼・申請：件数を数えるだけの問い合わせ（読み込み1回分）
 */
@Injectable({ providedIn: 'root' })
export class TodoBadgeService {
  private readonly requestsApi = inject(RequestService);

  /** null ＝ まだ数えていない（この事業所の To-do リストを開いていない） */
  readonly todoCount = signal<number | null>(null);
  readonly requestCount = signal(0);
  private officeId: string | null = null;

  /** 事業所が変わったら数え直す */
  async refresh(officeId: string, isAdmin: boolean): Promise<void> {
    if (this.officeId !== officeId) {
      this.officeId = officeId;
      this.todoCount.set(null);
      this.requestCount.set(0);
    }
    if (!isAdmin) return;
    try {
      this.requestCount.set(await this.requestsApi.countSubmitted(officeId));
    } catch (err) {
      console.error(err);
    }
  }

  setTodoCount(officeId: string, n: number): void {
    if (this.officeId === officeId) this.todoCount.set(n);
  }
}
