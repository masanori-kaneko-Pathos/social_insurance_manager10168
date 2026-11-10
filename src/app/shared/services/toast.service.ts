import { Injectable, signal } from '@angular/core';

/**
 * 「保存しました」などの短い知らせ（画面の下に3秒だけ出す）
 * 中身は翻訳のキー。出す場所は office-shell（画面が移っても消えないように、外側の枠に置く）
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly message = signal<string | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(key: string, ms = 3000): void {
    if (this.timer) clearTimeout(this.timer);
    this.message.set(key);
    this.timer = setTimeout(() => this.message.set(null), ms);
  }
}
