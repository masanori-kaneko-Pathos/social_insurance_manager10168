// 読んだデータを覚えておく仕組み（cache-store.ts）に、ログインのつなぎを足したもの。画面・サービスはここから使う
import { onAuthStateChanged } from 'firebase/auth';
import { forgetAll } from './cache-store';
import { auth } from './firebase';

export * from './cache-store';

// ログインしている人が変わったら（ログアウトも）全部忘れる
onAuthStateChanged(auth, () => forgetAll());
