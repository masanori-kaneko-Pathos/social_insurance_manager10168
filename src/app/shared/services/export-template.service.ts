import { Injectable } from '@angular/core';
import { collection, deleteDoc, doc, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { auth, db } from '../../core/firebase';
import { countedGetDocs } from '../../core/read-meter';
import { ExportPick } from '../export/export-table';

/** 出力のテンプレート（事業所ごと。dataset：premiums・employees など。11/24） */
export interface ExportTemplate {
  id: string;
  dataset: string;
  name: string;
  columns: ExportPick[];
}

/**
 * offices/{officeId}/exportTemplates/{id}
 * 読むのはメンバー、作る・書き換える・消すのは管理者（ルール）
 */
@Injectable({ providedIn: 'root' })
export class ExportTemplateService {
  private col(officeId: string) {
    return collection(db, 'offices', officeId, 'exportTemplates');
  }

  async list(officeId: string, dataset: string): Promise<ExportTemplate[]> {
    const snap = await countedGetDocs(query(this.col(officeId), where('dataset', '==', dataset)));
    return snap.docs
      .map((d) => {
        const x = d.data() as Omit<ExportTemplate, 'id'>;
        return { id: d.id, dataset: x.dataset, name: x.name, columns: x.columns ?? [] };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  /** 作る（id なし）か、上書き。返すのはテンプレートの id */
  async save(officeId: string, t: Omit<ExportTemplate, 'id'> & { id?: string }): Promise<string> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('not signed in');
    const ref = t.id ? doc(this.col(officeId), t.id) : doc(this.col(officeId));
    await setDoc(ref, {
      dataset: t.dataset,
      name: t.name,
      columns: t.columns.map((c) => ({ key: c.key, header: c.header?.trim() || null })),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  }

  async remove(officeId: string, id: string): Promise<void> {
    await deleteDoc(doc(this.col(officeId), id));
  }
}
