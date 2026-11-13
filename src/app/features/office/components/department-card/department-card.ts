import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Department } from '../../../../core/models/office';
import { OfficeContext } from '../../office-context.service';
import { OfficeService } from '../../office.service';
import { addDepartment, departmentError, removeDepartment, renameDepartment } from '../../logic/departments';

/**
 * 事業所の設定：部署の一覧（足す・名前を変える・消す）
 * 部署だけを書く（事業所のほかの設定と別に保存する。登録のときの項目の決まりを変えないため）
 */
@Component({
  selector: 'app-department-card',
  imports: [TranslocoPipe],
  templateUrl: './department-card.html',
  styleUrl: './department-card.css',
})
export class DepartmentCard {
  readonly context = inject(OfficeContext);
  private readonly offices = inject(OfficeService);

  readonly list = computed<Department[]>(() => this.context.current()?.departments ?? []);
  readonly newName = signal('');
  /** 読み（任意。漢字の部署名を あいうえお順 に並べるため） */
  readonly newKana = signal('');
  readonly editKana = signal('');
  readonly editing = signal<string | null>(null);
  readonly editName = signal('');
  readonly errorKey = signal<string | null>(null);
  readonly busy = signal(false);

  async add(): Promise<void> {
    const err = departmentError(this.list(), this.newName());
    if (err) return this.errorKey.set(`office.department.error.${err}`);
    await this.save(addDepartment(this.list(), this.newName(), this.newKana()));
    this.newName.set('');
    this.newKana.set('');
  }

  startEdit(d: Department): void {
    this.editing.set(d.id);
    this.editName.set(d.name);
    this.editKana.set(d.kana ?? '');
    this.errorKey.set(null);
  }

  async rename(id: string): Promise<void> {
    const err = departmentError(this.list(), this.editName(), id);
    if (err) return this.errorKey.set(`office.department.error.${err}`);
    await this.save(renameDepartment(this.list(), id, this.editName(), this.editKana()));
    this.editing.set(null);
  }

  async remove(d: Department): Promise<void> {
    if (!window.confirm(`${d.name}`)) return;
    await this.save(removeDepartment(this.list(), d.id));
  }

  private async save(departments: Department[]): Promise<void> {
    const office = this.context.current();
    if (!office || this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      await this.offices.update(office.id, { departments });
      const fresh = await this.offices.get(office.id);
      if (fresh) this.context.setCurrent(fresh);
    } catch (err) {
      console.error(err);
      this.errorKey.set('office.department.error.save');
    } finally {
      this.busy.set(false);
    }
  }
}
