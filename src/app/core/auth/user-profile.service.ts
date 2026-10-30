import { Injectable, signal } from '@angular/core';
import { User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Lang } from '../i18n/language.service';
import { AppUser, AppUserDoc } from '../models/app-user';

@Injectable({ providedIn: 'root' })
export class UserProfileService {
  private readonly _profile = signal<AppUser | null>(null);
  /** 読み込み済みのユーザー情報（未読み込み・未ログインなら null） */
  readonly profile = this._profile.asReadonly();

  private ref(uid: string) {
    return doc(db, 'users', uid);
  }

  /** 新規登録時：管理者として作成（事業所は未登録） */
  async create(user: User, displayName: string, lang: Lang): Promise<void> {
    await setDoc(this.ref(user.uid), {
      email: user.email,
      displayName,
      role: 'admin',
      officeId: null,
      lang,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  /** 読み込んで保持する。存在しなければ null */
  async load(uid: string): Promise<AppUser | null> {
    const snap = await getDoc(this.ref(uid));
    const profile = snap.exists() ? { uid, ...(snap.data() as AppUserDoc) } : null;
    this._profile.set(profile);
    return profile;
  }

  async updateLang(uid: string, lang: Lang): Promise<void> {
    await updateDoc(this.ref(uid), { lang, updatedAt: serverTimestamp() });
    this._profile.update((p) => (p ? { ...p, lang } : p));
  }

  clear(): void {
    this._profile.set(null);
  }
}