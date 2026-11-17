import { DestroyRef, inject, Injectable } from '@angular/core';
import type { CanDeactivateFn, Route } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';

/**
 * 保存していない入力があるときに、画面を離れる前に確かめる（11/17。保存できる画面はすべて）
 * - 画面の部品は watchUnsaved(() => まだ保存していない入力があるか) で登録する。部品が消えたら外れる
 * - ルートを移るとき：unsavedChangesGuard が確かめる（ルートの定義に一括で付ける。withUnsavedGuard）
 * - タブを閉じる・再読み込み：ブラウザの決まった確認（文は変えられない）
 * - 保存して画面を移るときは release() で外してから移る（保存したのに確かめられないように）
 */
@Injectable({ providedIn: 'root' })
export class UnsavedChanges {
  private readonly transloco = inject(TranslocoService);
  private readonly checks = new Set<() => boolean>();

  constructor() {
    window.addEventListener('beforeunload', (e) => {
      if (!this.any()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  any(): boolean {
    for (const c of this.checks) if (c()) return true;
    return false;
  }

  add(check: () => boolean): () => void {
    this.checks.add(check);
    return () => this.checks.delete(check);
  }

  /** 離れてよいか（保存していない入力があれば、確認の窓を出す） */
  confirmLeave(): boolean {
    if (!this.any()) return true;
    return window.confirm(this.transloco.translate('common.unsavedConfirm'));
  }
}

export interface UnsavedHandle {
  /** 保存したので、もう確かめない（このあと画面を移るとき） */
  release(): void;
}

/** 部品の中で呼ぶ（フィールドの初期化か constructor で）。部品が消えたら自動で外れる */
export function watchUnsaved(dirty: () => boolean): UnsavedHandle {
  const service = inject(UnsavedChanges);
  let released = false;
  const remove = service.add(() => !released && dirty());
  inject(DestroyRef).onDestroy(remove);
  return {
    release: () => {
      released = true;
    },
  };
}

export const unsavedChangesGuard: CanDeactivateFn<unknown> = () => inject(UnsavedChanges).confirmLeave();

/** 画面を持つルート（子のないもの）すべてに、離れる前の確認を付ける */
export function withUnsavedGuard(routes: Route[]): Route[] {
  for (const r of routes) {
    if (r.children?.length) withUnsavedGuard(r.children);
    else if (r.loadComponent || r.component) r.canDeactivate = [...(r.canDeactivate ?? []), unsavedChangesGuard];
  }
  return routes;
}
