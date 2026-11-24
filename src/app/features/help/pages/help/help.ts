import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { flowSteps, HELP_TOPICS, matchesHelp } from '../../logic/help-search';
import { OfficeContext } from '../../../office/office-context.service';

/**
 * 使い方（ヘルプ）：キーワードで絞り込める1枚のページ。中身は翻訳ファイル（help.topic.*）にあるので英語も出る
 * 絞り込みの言葉は URL（?q=）に持つ（「この説明を見て」とリンクで渡せるように）
 */
@Component({
  selector: 'app-help',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './help.html',
  styleUrl: './help.css',
})
export class HelpPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);
  /** 業務の流れ（場面 → すること → 使う画面） */
  readonly flow = flowSteps(new Date().getFullYear());

  /** 業務の流れの表のリンク（テンプレートでは配列の ... が使えないので、ここで組み立てる。11/24） */
  linkOf(path: readonly string[]): string[] {
    return ['/o', this.context.current()?.id ?? '', ...path];
  }

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly query = computed(() => this.params().get('q') ?? '');
  /** 言語が変わったら絞り込み直す */
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  readonly topics = computed(() => {
    this.lang();
    const q = this.query();
    // 業務の流れは、場面ごとの文でも探せるようにする
    const flowText = this.flow
      .map((s) => `${this.transloco.translate(`help.flow.${s.key}.scene`)} ${this.transloco.translate(`help.flow.${s.key}.todo`)}`)
      .join(' ');
    return HELP_TOPICS.filter((t) =>
      matchesHelp(
        `${this.transloco.translate(`help.topic.${t}.title`)} ${this.transloco.translate(`help.topic.${t}.body`)}${t === 'flow' ? ' ' + flowText : ''}`,
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
