import { afterNextRender, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { flowSteps, HELP_GROUPS, HELP_SECTIONS, HELP_TOPICS, HelpTopic, matchesHelp } from '../../logic/help-search';
import { OfficeContext } from '../../../office/office-context.service';

/**
 * 使い方（ヘルプ）：キーワードで絞り込める1枚のページ。中身は翻訳ファイル（help.topic.*）にあるので英語も出る
 * 絞り込みの言葉は URL（?q=）に持つ（「この説明を見て」とリンクで渡せるように）
 * 11/27：箱を2つに分けた
 * - 業務の流れ：いつも開いている表（ヘルプの地図）
 * - 業務の内容：まとまりごとに閉じた項目。押すと開く。探したときは当たった項目を開いて出す。?topic= の項目も開いて出す
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

  readonly groups = HELP_GROUPS;
  readonly sectionsOf = (t: HelpTopic): readonly string[] => HELP_SECTIONS[t] ?? [];
  /** ?topic= で開いて渡す項目（「この説明を見て」のリンク用） */
  readonly openTopic = computed(() => this.params().get('topic'));
  /** 探しているか（当たった項目を開いて出す） */
  readonly searching = computed(() => this.query().trim() !== '');

  /** 項目の本文（小見出しのある項目は、小見出しと本文をつなげる。探すときに使う） */
  private textOf(t: HelpTopic): string {
    const tr = (k: string) => this.transloco.translate(k);
    const secs = this.sectionsOf(t);
    const body = secs.length
      ? secs.map((s) => `${tr(`help.topic.${t}.sections.${s}.title`)} ${tr(`help.topic.${t}.sections.${s}.body`)}`).join(' ')
      : tr(`help.topic.${t}.body`);
    return `${tr(`help.topic.${t}.title`)} ${body}`;
  }

  /** まとまりごとの、当たった項目（当たる項目のないまとまりは出さない） */
  readonly shownGroups = computed(() => {
    const shown = new Set<string>(this.topics());
    return HELP_GROUPS.map((g) => ({ key: g.key, topics: g.topics.filter((t) => shown.has(t)) })).filter((g) => g.topics.length > 0);
  });
  readonly showFlow = computed(() => this.topics().includes('flow'));

  constructor() {
    // ?topic= の項目まで動かす（開いて描いてから）
    const id = this.route.snapshot.queryParamMap.get('topic');
    if (id) afterNextRender(() => document.getElementById(`help-${id}`)?.scrollIntoView({ block: 'start' }));
  }

  readonly topics = computed(() => {
    this.lang();
    const q = this.query();
    // 業務の流れは、場面ごとの文でも探せるようにする
    const flowText = this.flow
      .map((s) => `${this.transloco.translate(`help.flow.${s.key}.scene`)} ${this.transloco.translate(`help.flow.${s.key}.todo`)}`)
      .join(' ');
    return HELP_TOPICS.filter((t) => matchesHelp(`${this.textOf(t)}${t === 'flow' ? ' ' + flowText : ''}`, q));
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
