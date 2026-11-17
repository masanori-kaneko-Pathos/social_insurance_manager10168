import { Component, input, model, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Department } from '../../../../core/models/office';
import { addDepartment, departmentError, removeDepartment, renameDepartment } from '../../logic/departments';
import { focusNextField } from '../../../../shared/directives/enter-next';

/**
 * 事業所の設定：部署の一覧（足す・名前を変える・消す）
 * 11/13 から、事業所のフォームの中の一部にした（新規登録でも入れられ、「保存する」で事業所と一緒に保存する）
 * ここでは Firestore に書かない。一覧は親（事業所のフォーム）が持つ
 */
@Component({
  selector: 'app-department-card',
  imports: [TranslocoPipe],
  templateUrl: './department-card.html',
  styleUrl: './department-card.css',
})
export class DepartmentCard {
  /** 部署の一覧（親と双方向） */
  readonly list = model.required<Department[]>();
  readonly readOnly = input(false);

  readonly newName = signal('');
  /** 読み（任意。漢字の部署名を あいうえお順 に並べるため） */
  readonly newKana = signal('');
  readonly editing = signal<string | null>(null);
  readonly editName = signal('');
  readonly editKana = signal('');
  readonly errorKey = signal<string | null>(null);

  /** 足せたら true（画面は、次の部署名を続けて入れられるよう、部署名の欄へ戻る） */
  add(): boolean {
    const err = departmentError(this.list(), this.newName());
    if (err) {
      this.errorKey.set(`office.department.error.${err}`);
      return false;
    }
    this.list.set(addDepartment(this.list(), this.newName(), this.newKana()));
    this.newName.set('');
    this.newKana.set('');
    this.errorKey.set(null);
    return true;
  }

  startEdit(d: Department): void {
    this.editing.set(d.id);
    this.editName.set(d.name);
    this.editKana.set(d.kana ?? '');
    this.errorKey.set(null);
  }

  rename(id: string): void {
    const err = departmentError(this.list(), this.editName(), id);
    if (err) return this.errorKey.set(`office.department.error.${err}`);
    this.list.set(renameDepartment(this.list(), id, this.editName(), this.editKana()));
    this.editing.set(null);
    this.errorKey.set(null);
  }

  remove(d: Department): void {
    if (!window.confirm(`${d.name}`)) return;
    this.list.set(removeDepartment(this.list(), d.id));
  }

  // ===== Enter の流れ（11/17）：部署名で変換を確定 → Enter で読みの欄へ → 読みで Enter → 登録 =====
  // 変換の確定の Enter（isComposing）は何もしない（日本語入力の確定で登録されてしまわないように）

  /** 部署名の欄で Enter：読みの欄へ移る。部署名が空なら、部署の欄を飛ばして下の所在地へ */
  toKana(e: Event, kana: HTMLInputElement): void {
    if (composing(e)) return;
    e.preventDefault();
    if (!this.newName().trim() && !this.newKana().trim()) focusNextField(kana);
    else kana.focus();
  }

  /** 読みの欄で Enter：登録してよいか（変換の確定なら false）。部署名が空なら、下の所在地へ移って false */
  onKanaEnter(e: Event): boolean {
    if (composing(e)) return false;
    e.preventDefault();
    if (!this.newName().trim()) {
      focusNextField(e.target as HTMLElement);
      return false;
    }
    return true;
  }
}

/** 日本語入力の変換中の Enter か（Safari は isComposing が false のことがあるので keyCode 229 も見る） */
function composing(e: Event): boolean {
  const k = e as KeyboardEvent;
  return k.isComposing || k.keyCode === 229;
}
