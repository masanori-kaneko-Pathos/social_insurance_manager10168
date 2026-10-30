import { Injectable, computed, signal } from '@angular/core';
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
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

  async signUp(email: string, password: string): Promise<User> {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
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

/** Firebaseのエラーコードを画面表示用の日本語に変換 */
export function toAuthErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'メールアドレスの形式が正しくありません。';
    case 'auth/email-already-in-use':
      return 'このメールアドレスはすでに登録されています。';
    case 'auth/weak-password':
      return 'パスワードは6文字以上にしてください。';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'メールアドレスまたはパスワードが違います。';
    case 'auth/too-many-requests':
      return '試行回数が多すぎます。しばらくしてからお試しください。';
    case 'auth/network-request-failed':
      return 'ネットワークに接続できません。';
    default:
      return 'エラーが発生しました。（' + code + '）';
  }
}