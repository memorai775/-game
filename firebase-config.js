// =====================================================================
// firebase-config.js  ―  Firebase の接続設定
// Firebaseコンソール →（歯車）プロジェクトの設定 → 全般 →「マイアプリ」の
// 「SDK の設定と構成」にある firebaseConfig の中身を、下にそのまま貼り付けてください。
//
// ※ この値はWebに公開しても問題ありません（だれが何を書き込めるかは
//    Firestore のセキュリティルール firestore.rules で守ります）。
// ※ 設定していない間は、クラウド機能なし（ブラウザ内保存だけ）で遊べます。
// =====================================================================
const FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
