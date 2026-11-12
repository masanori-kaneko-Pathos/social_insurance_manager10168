import { Component, inject, signal } from '@angular/core';
import { ThemeService } from './core/theme/theme.service';
import { RouterOutlet } from '@angular/router';
import { ReadMeter } from './shared/components/read-meter/read-meter';

@Component({
  selector: 'app-root',
  imports: [ReadMeter, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('socialinsurance10168');
  /** ライト／ダークを最初に当てる（選んだものはブラウザに覚えさせる） */
  private readonly theme = inject(ThemeService);
}
