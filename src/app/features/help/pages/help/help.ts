import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HELP_TOPICS, matchesHelp } from '../../logic/help-search';

/**
 * 使い方（ヘルプ）：キーワードで絞り込める1枚のページ。中身は翻訳ファイル（help.topic.*）にあるので英語も出る
 * 絞り込みの言葉は URL（?q=）に持つ（「この説明を見て」とリンクで渡せるように）
 */
@Component({
  selector: 'app-help',
  imports: [TranslocoPipe],
  templateUrl: './help.html',
  styleUrl: './help.css',
})
export class HelpPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly query = computed(() => this.params().get('q') ?? '');
  /** 言語が変わったら絞り込み直す */
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  readonly topics = computed(() => {
    this.lang();
    const q = this.query();
    return HELP_TOPICS.filter((t) =>
      matchesHelp(
        `${this.transloco.translate(`help.topic.${t}.title`)} ${this.transloco.translate(`help.topic.${t}.body`)}`,
        q,
      ),
    );
  });

  search(q: string): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: q.trim() || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
