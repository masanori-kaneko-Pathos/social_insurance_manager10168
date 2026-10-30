import { Injectable, computed, signal } from '@angular/core';
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../firebase';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _user = signal<User | null>(null);
  private readonly _ready = signal(false);

  /** 現在のユーザー（未ログインなら null） */
  readonly user = this._user.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);
  /** 初回のログイン状態チェックが終わったか */
  readonly ready = this._ready.asReadonly();

  /** 初回チェックが終わるまで待つ（ガードで使う） */
  readonly whenReady: Promise<void>;

  constructor() {
    this.whenReady = new Promise<void>((resolve) => {
      onAuthStateChanged(auth, (user) => {
        this._user.set(user);
        this._ready.set(true);
        resolve(); // 2回目以降は何も起きない
      });
    });
  }

  async signUp(email: string, password: string, displayName: string): Promise<User> {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    return cred.user;
  }

  async login(email: string, password: string): Promise<User> {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  }

  logout(): Promise<void> {
    return signOut(auth);
  }
}

/** Firebaseのエラーコードを翻訳キーに変換（表示は画面側で | transloco） */
export function toAuthErrorKey(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'auth.error.invalidEmail';
    case 'auth/email-already-in-use':
      return 'auth.error.emailInUse';
    case 'auth/password-does-not-meet-requirements':
    case 'auth/weak-password':
      return 'auth.error.passwordRule';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'auth.error.invalidCredential';
    case 'auth/too-many-requests':
      return 'auth.error.tooManyRequests';
    case 'auth/network-request-failed':
      return 'auth.error.network';
    default:
      console.error(err); // 想定外のエラーは開発者が調べられるように残す
      return 'auth.error.unknown';
  }
}