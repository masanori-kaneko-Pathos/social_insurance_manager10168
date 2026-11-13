import { Component, input, model, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Department } from '../../../../core/models/office';
import { addDepartment, departmentError, removeDepartment, renameDepartment } from '../../logic/departments';

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

  add(): void {
    const err = departmentError(this.list(), this.newName());
    if (err) return this.errorKey.set(`office.department.error.${err}`);
    this.list.set(addDepartment(this.list(), this.newName(), this.newKana()));
    this.newName.set('');
    this.newKana.set('');
    this.errorKey.set(null);
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
}
