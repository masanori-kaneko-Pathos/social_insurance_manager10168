import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { AuthService } from '../../core/auth/auth.service';
import { db } from '../../core/firebase';
import { InboxNotification, NotificationDoc } from '../../core/models/office-records';
import { RequestService } from '../requests/request.service';

/** ベルの小窓に出す件数 */
const BELL_MAX = 5;

/**
 * マイページの受信箱を見張る（ベルの数字）。課題管理アプリの NotificationService と同じ考え方
 * - ログインした従業員の分だけ（employeeId で絞る。ルールもこの絞り方だけ通す）
 * - 並べ替えは画面でする（orderBy を足すと、複合インデックスが要るため）
 * - 見張りは、お知らせが増えた・既読になったときだけ読み込みが増える
 */
@Injectable({ providedIn: 'root' })
export class MeInboxService {
  private readonly auth = inject(AuthService);
  private readonly requestsApi = inject(RequestService);

  readonly list = signal<InboxNotification[]>([]);
  readonly unread = computed(() => this.list().filter((n) => !n.readAt).length);
  /** ベルの小窓：未読を先に、新しい順で5件まで */
  readonly latest = computed(() =>
    [...this.list()].sort((a, b) => Number(!!a.readAt) - Number(!!b.readAt)).slice(0, BELL_MAX),
  );

  constructor() {
    // ログインしている従業員が変わったら見張り直す。ログアウトしたらやめる
    effect((onCleanup) => {
      const ref = this.auth.profile()?.employeeRef;
      if (!ref) {
        this.list.set([]);
        return;
      }
      const q = query(
        collection(db, 'offices', ref.officeId, 'notifications'),
        where('employeeId', '==', ref.employeeId),
      );
      const stop = onSnapshot(
        q,
        (snap) =>
          this.list.set(
            snap.docs
              .map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as NotificationDoc) }))
              .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
          ),
        (err) => console.error('受信箱の見張りに失敗', err),
      );
      onCleanup(() => stop());
    });
  }

  async markRead(n: InboxNotification): Promise<void> {
    const ref = this.auth.profile()?.employeeRef;
    if (!ref || n.readAt) return;
    await this.requestsApi.markRead(ref.officeId, n.id);
  }
}
