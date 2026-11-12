import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../../../core/auth/auth.service';
import { Icon, IconName } from '../../../../shared/components/icon/icon';
import { AccountMenu } from '../../components/account-menu/account-menu';

/**
 * はじめに（/start）：事業所がまだない管理者のホーム（11/12）
 * 新規登録の直後に、いきなり事業所の登録のフォームを見せない。
 * 「最初にやること」の大きなボタンと、そのあとの流れだけを見せて、迷わず1つ目を押してもらう
 */
@Component({
  selector: 'app-welcome',
  imports: [RouterLink, TranslocoPipe, Icon, AccountMenu],
  templateUrl: './welcome.html',
  styleUrl: './welcome.css',
})
export class Welcome {
  private readonly auth = inject(AuthService);
  readonly name = computed(() => this.auth.profile()?.displayName ?? '');

  /** このあとの流れ（2つ目からは事業所を作ったあとにホームの「よく使うメニュー」から） */
  readonly steps: readonly { key: string; icon: IconName }[] = [
    { key: 'office', icon: 'settings' },
    { key: 'employees', icon: 'people' },
    { key: 'payroll', icon: 'payroll' },
    { key: 'premiums', icon: 'premium' },
  ];
}
