import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { environment } from '../../environments/environment';

export const firebaseApp = initializeApp(environment.firebase);

export const auth = getAuth(firebaseApp);

// 課題管理アプリの(default)と混ざらないようにする
export const db = getFirestore(firebaseApp, 'socialinsurance-db');