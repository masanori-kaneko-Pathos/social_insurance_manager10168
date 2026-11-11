import { Injectable, computed, signal, inject } from '@angular/core';
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendPasswordResetEmail, deleteUser,
  sendEmailVerification,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  verifyBeforeUpdateEmail,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../firebase';
import { LanguageService, Lang } from '../i18n/language.service';
import { UserProfileService } from './user-profile.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly profiles = inject(UserProfileService);
  private readonly language = inject(LanguageService);

  /** 読み込み済みのユーザー情報（画面で使う） */
  readonly profile = this.profiles.profile;
  // 確認のメールのあと user.reload() は同じ入れ物の中身だけを変えるので、同じでも知らせる（equal: 常に false）
  private readonly _user = signal<User | null>(null, { equal: () => false });
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

  async signUp(email: string, password: string, displayName: string): Promise<void> {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await updateProfile(cred.user, { displayName });
      await this.profiles.create(cred.user, displayName, this.language.lang() as Lang);
      await this.profiles.load(cred.user.uid);
    } catch (err) {
      // users の保存に失敗したら、Auth のアカウントも消して「中途半端」を残さない
      await deleteUser(cred.user).catch(() => { });
      throw err;
    }
  }

  /**
   * 招待からの新規登録：Auth のアカウントを作り、attach（users などを書く）を呼ぶ
   * attach が失敗したら Auth のアカウントも消して「中途半端」を残さない（signUp と同じ考え方）
   */
  async signUpWith(
    email: string,
    password: string,
    displayName: string,
    attach: (user: User, lang: Lang) => Promise<void>,
  ): Promise<void> {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await updateProfile(cred.user, { displayName });
      await attach(cred.user, this.language.lang() as Lang);
      const profile = await this.profiles.load(cred.user.uid);
      if (profile) this.language.applyFromProfile(profile.lang);
    } catch (err) {
      await deleteUser(cred.user).catch(() => { });
      throw err;
    }
  }

  async login(email: string, password: string): Promise<void> {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const ok = await this.loadProfileOrSignOut(cred.user);
    if (!ok) {
      throw Object.assign(new Error('No app account'), { code: 'app/no-account' });
    }
  }

  // ===== 事業所への招待（/join）で使う：users を作らずに Auth だけ扱う =====
  // users は、メールの確認が済んで参加するときに関数（siAcceptMemberInvite）が作る

  /** Auth のアカウントだけ作り、確認のメールを送る（戻り先は招待の画面） */
  async createAuthOnly(email: string, password: string, displayName: string, returnUrl: string): Promise<void> {
    await this.createAuthUser(email, password, displayName);
    await this.sendVerification(returnUrl);
  }

  /** Auth のアカウントだけ作る（確認のメールを送るかは、呼ぶ側が招待を見て決める） */
  async createAuthUser(email: string, password: string, displayName: string): Promise<void> {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
  }

  /** 招待を使えなかったとき：users のない Auth のアカウントを消す（同じアドレスで作り直せるように） */
  async discardPendingUser(): Promise<void> {
    const user = auth.currentUser;
    if (!user || this.profiles.profile()?.uid === user.uid) return; // users がある人は消さない
    await deleteUser(user).catch(() => {});
    this.profiles.clear();
  }

  /** users があるかを見ずにログインする（招待の画面の中だけで使う） */
  async signInOnly(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(auth, email, password);
  }

  /** 確認のメールを（もう一度）送る。メールのリンクを押すと returnUrl に戻る */
  async sendVerification(returnUrl: string): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;
    auth.languageCode = this.language.lang();
    await sendEmailVerification(user, { url: returnUrl });
  }

  /** メールの確認が済んだかを、Firebase に聞き直す（済んでいれば、関数に渡す鍵（ID トークン）も新しくする） */
  async refreshVerified(): Promise<boolean> {
    const user = auth.currentUser;
    if (!user) return false;
    await user.reload();
    const ok = auth.currentUser?.emailVerified === true;
    if (ok) await auth.currentUser!.getIdToken(true);
    this._user.set(auth.currentUser);
    return ok;
  }

  /** users を読むだけ（なくてもログアウトしない。招待の画面で、確認待ちの人を追い出さないため） */
  async peekProfile(): Promise<boolean> {
    const user = this._user();
    return user ? !!(await this.profiles.load(user.uid)) : false;
  }

  /** 参加したあと：users を読み込み直す（関数が作った・書き換えたため） */
  async reloadProfile(): Promise<void> {
    const user = this._user();
    if (user) await this.loadProfileOrSignOut(user);
  }

  /** ガード用：ログイン中のユーザーに users があるか確認する */
  async ensureProfile(): Promise<boolean> {
    const user = this._user();
    if (!user) return false;
    if (this.profiles.profile()?.uid === user.uid) return true; // 読み込み済み
    return this.loadProfileOrSignOut(user);
  }

  /** users を読み込む。なければログアウトして false */
  private async loadProfileOrSignOut(user: User): Promise<boolean> {
    const profile = await this.profiles.load(user.uid);
    if (!profile) {
      await this.logout();
      return false;
    }
    this.language.applyFromProfile(profile.lang);
    // メールアドレスを変えた（確認のリンクで Auth の側が切り替わった）あと：users の写しを合わせる
    if (user.email && profile.email !== user.email) {
      await this.profiles.syncEmail(user.uid, user.email).catch((err) => console.error(err));
    }
    return true;
  }

  // ===== アカウントの設定（労務担当・マイページ共通） =====

  /** 大事な変更の前に、今のパスワードで本人かを確かめ直す（Firebase の決まり：最近ログインした人だけが変えられる） */
  private async reauth(currentPassword: string): Promise<User> {
    const user = auth.currentUser;
    if (!user?.email) throw Object.assign(new Error('no user'), { code: 'auth/requires-recent-login' });
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
    return user;
  }

  /** 大事な情報（マイナンバーの全桁など）を見る前に、パスワードで本人を確かめ直す（ID トークンの auth_time が新しくなる） */
  async confirmPassword(currentPassword: string): Promise<void> {
    const user = await this.reauth(currentPassword);
    await user.getIdToken(true);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.reauth(currentPassword);
    await updatePassword(user, newPassword);
  }

  /** 新しいアドレスに確認のメールを送る。リンクを押した時点で切り替わる（それまでは今のアドレスのまま） */
  async changeEmail(currentPassword: string, newEmail: string): Promise<void> {
    const user = await this.reauth(currentPassword);
    auth.languageCode = this.language.lang();
    await verifyBeforeUpdateEmail(user, newEmail, { url: `${location.origin}/login` });
  }

  async changeDisplayName(displayName: string): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;
    await updateProfile(user, { displayName });
    await this.profiles.updateDisplayName(user.uid, displayName);
  }

  /**
   * 本人のアカウントを消す（管理者・一般だけ）。今のパスワードで本人を確かめ直してから、関数で消す
   * 消せないとき（代表・従業員）は関数が理由を返す（details.reason）。消えたらログアウトする
   */
  async deleteAccount(currentPassword: string): Promise<void> {
    await this.reauth(currentPassword);
    await httpsCallable(functions, 'siDeleteAccount')({});
    this.profiles.clear();
    await signOut(auth);
  }

  async logout(): Promise<void> {
    this.profiles.clear();
    await signOut(auth);
  }

  /** パスワード再設定メールを送る（メールの言語と、再設定後の戻り先を指定） */
  async sendPasswordReset(email: string, lang: string): Promise<void> {
    auth.languageCode = lang;
    await sendPasswordResetEmail(auth, email, {
      url: `${location.origin}/login`,
    });
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
    case 'app/no-account':
      return 'auth.error.noAppAccount';
    case 'auth/missing-password':
      return 'auth.error.invalidCredential';
    case 'auth/requires-recent-login':
      return 'auth.error.recentLogin';
    default:
      console.error(err); // 想定外のエラーは開発者が調べられるように残す
      return 'auth.error.unknown';
  }
}