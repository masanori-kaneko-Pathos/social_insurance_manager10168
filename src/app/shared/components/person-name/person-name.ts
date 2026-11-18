import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** 氏名の部品に渡す人（従業員・扶養家族など。カナと通称はあれば出す） */
export interface PersonNameLike {
  readonly lastName: string;
  readonly firstName: string;
  readonly lastNameKana?: string | null;
  readonly firstNameKana?: string | null;
  /** 外国籍の情報（通称があればフリガナの後ろに出す。形の違う人の型も受けられるよう unknown） */
  readonly foreign?: unknown;
}

/**
 * 氏名の共通の書き方（11/18。すべての一覧で同じ見た目にする）
 * - 氏名は太字、フリガナは小さく灰色。どの画面でもフリガナを付ける
 * - layout="inline"：幅のある画面。氏名の横にフリガナ（はみ出すときはその人だけ折り返す）
 * - layout="stack"：数字の多い表。氏名の下にフリガナ
 * - 長い名前（外国人の名前など）は幅を抑え、空白のところでだけ折り返す（名前の途中では切らない）
 * 社員番号は部品に入れず、表の欄に class="emp-no" で書く（styles.css の共通の書き方）
 */
@Component({
  selector: 'app-person-name',
  imports: [RouterLink],
  template: `
    <span class="pn" [class.stack]="layout() === 'stack'">
      @if (link(); as l) {
        <a class="pn-name" [routerLink]="l">{{ full() }}</a>
      } @else {
        <span class="pn-name">{{ full() }}</span>
      }
      @if (kana()) {
        <span class="pn-kana">{{ kana() }}</span>
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-block;
      vertical-align: top;
    }
    .pn {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: 0.6em;
      max-width: 24em;
      white-space: normal;
    }
    .pn.stack {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      max-width: 11em;
    }
    .pn-name,
    .pn-kana {
      word-break: keep-all;
      overflow-wrap: normal;
    }
    .pn-name {
      font-weight: 600;
      color: var(--color-text);
    }
    a.pn-name:hover {
      color: var(--color-primary-hover);
    }
    .pn-kana {
      font-size: var(--font-xs);
      font-weight: 400;
      color: var(--color-text-sub);
    }
  `,
})
export class PersonName {
  readonly person = input.required<PersonNameLike>();
  /** 押すと開く先（なければ文字だけ） */
  readonly link = input<string | readonly unknown[] | null>(null);
  readonly layout = input<'inline' | 'stack'>('stack');

  readonly full = computed(() => `${this.person().lastName ?? ''} ${this.person().firstName ?? ''}`.trim() || '—');
  readonly kana = computed(() => {
    const p = this.person();
    const k = `${p.lastNameKana ?? ''} ${p.firstNameKana ?? ''}`.trim();
    const f = p.foreign;
    const a = f && typeof f === 'object' ? (f as { alias?: { last: string; first: string } | null }).alias : null;
    return a ? `${k}（${a.last} ${a.first}）`.trim() : k;
  });
}
