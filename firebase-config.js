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
  apiKey: 'AIzaSyCATmkrQ6_38IbilrugqNNgXe_6fxpWcPE',
  authDomain: 'yurugame-123dc.firebaseapp.com',
  projectId: 'yurugame-123dc',
  storageBucket: 'yurugame-123dc.firebasestorage.app',
  messagingSenderId: '650334385973',
  appId: '1:650334385973:web:4d1bd670f2e49268d9be7c',
  measurementId: 'G-3GHLR1NG4Z',
};
