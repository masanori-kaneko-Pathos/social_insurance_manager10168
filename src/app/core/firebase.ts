import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { environment } from '../../environments/environment';

export const firebaseApp = initializeApp(environment.firebase);

export const auth = getAuth(firebaseApp);

// 課題管理アプリの(default)と混ざらないようにする
export const db = getFirestore(firebaseApp, 'socialinsurance-db');

// 関数（functions/ の codebase: shaho）。事業所の名簿の書き換えは、ここ経由でだけ行う
export const functions = getFunctions(firebaseApp, 'asia-northeast1');
