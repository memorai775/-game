// =====================================================================
// cloud.js  ―  アカウント・クラウドセーブ・ランキング（Firebase）
//
// ・起動するとまず匿名ログイン（何もしなくてもクラウドに保存される）
// ・「Googleアカウントで引き継ぐ」で連携すると、別の端末でも続きから遊べる
// ・セーブは users/{uid}、ランキングは rankings/{uid} に保存
// ・Firebase の設定（firebase-config.js）が空のときや、file:// で開いたときは
//   クラウドなし（ブラウザ内保存だけ）で動く
// =====================================================================
'use strict';

const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const CLOUD_SAVE_INTERVAL = 10000; // クラウドへの保存は最短でも10秒おき（書き込み回数を抑える）
const NICKNAME_MAX = 12;

// HTML に入れる文字を無害化（他の人のニックネームを表示するため）
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 画面下に短いお知らせを出す
function showToast(text) {
  const toast = document.getElementById('toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ---------------------------------------------------------------------
// 汎用のウィンドウ（アカウント・ランキング・ニックネーム入力）
// ---------------------------------------------------------------------
const Modal = {
  open(title, html) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal').classList.remove('hidden');
  },
  setBody(html) {
    document.getElementById('modal-body').innerHTML = html;
  },
  close() {
    document.getElementById('modal').classList.add('hidden');
  },
  isOpen() {
    return !document.getElementById('modal').classList.contains('hidden');
  },
};

// ---------------------------------------------------------------------
// クラウド本体
// ---------------------------------------------------------------------
const Cloud = {
  enabled: false,    // Firebase を読み込めたか
  ready: false,      // ログインしてセーブの読み込みまで終わったか
  status: '',        // ヘッダーに出す状態
  fb: null,          // 読み込んだ Firebase の関数
  auth: null,
  db: null,
  user: null,
  rankDoc: null,     // 自分のランキング記録 { name, bestFloor, updatedAt }
  dirty: false,      // まだクラウドに送っていない変更があるか
  saveTimer: null,
  lastPush: 0,
  preferRemote: false, // 次に読み込むとき、クラウドのセーブを優先する（別アカウントに切り替えたとき）

  configured() {
    return typeof FIREBASE_CONFIG === 'object' && !!FIREBASE_CONFIG.apiKey && !!FIREBASE_CONFIG.projectId;
  },

  // 起動時に1回呼ぶ
  async init() {
    document.getElementById('account-btn').addEventListener('click', () => this.openAccount());
    document.getElementById('ranking-btn').addEventListener('click', () => this.openRanking());
    document.getElementById('modal-close').addEventListener('click', () => Modal.close());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });

    if (!this.configured()) return this.setStatus('オフライン（Firebase未設定）');
    if (location.protocol === 'file:') return this.setStatus('オフライン（ファイルを直接開いているため）');

    try {
      this.setStatus('接続中…');
      const [app, auth, fs] = await Promise.all([
        import(`${FIREBASE_SDK}/firebase-app.js`),
        import(`${FIREBASE_SDK}/firebase-auth.js`),
        import(`${FIREBASE_SDK}/firebase-firestore.js`),
      ]);
      this.fb = { ...auth, ...fs };
      const firebaseApp = app.initializeApp(FIREBASE_CONFIG);
      this.auth = auth.getAuth(firebaseApp);
      this.db = fs.getFirestore(firebaseApp);
      this.enabled = true;
      // ログイン状態が変わるたびに呼ばれる（前回のログインが残っていればそのまま使う）
      auth.onAuthStateChanged(this.auth, user => this.onUser(user));
    } catch (e) {
      console.error('Firebase の読み込みに失敗', e);
      this.setStatus('オフライン（接続できません）');
    }
  },

  // ログインしたとき（していなければ匿名でログイン）
  async onUser(user) {
    if (!user) {
      try {
        await this.fb.signInAnonymously(this.auth);
      } catch (e) {
        console.error('匿名ログインに失敗', e);
        // 原因が分かるようにエラーの種類も出す（例：auth/operation-not-allowed = 匿名ログインが無効）
        this.setStatus(`オフライン（ログインできません：${e.code || e.message}）`);
      }
      return; // ログインできると、もう一度 onUser が呼ばれる
    }
    this.user = user;
    this.ready = false;
    try {
      this.setStatus('読み込み中…');
      await this.loadOrPush();
      await this.loadRanking();
      this.ready = true;
      this.setStatus('☁ 保存済み');
      if (!gameState.nickname) this.askNickname(true); // 初回はニックネームを決めてもらう
      else await this.submitRanking();
    } catch (e) {
      console.error('クラウドの読み込みに失敗', e);
      this.setStatus(`⚠ クラウドに接続できません：${e.code || e.message}`);
    }
  },

  // ---- セーブ ----
  userRef() {
    return this.fb.doc(this.db, 'users', this.user.uid);
  },

  // クラウドのセーブとブラウザのセーブを比べて、新しいほうを使う
  async loadOrPush() {
    const snap = await this.fb.getDoc(this.userRef());
    if (snap.exists()) {
      const remote = JSON.parse(snap.data().data);
      const remoteTime = remote.lastSaved || 0;
      const localTime = gameState.lastSaved || 0;
      if (this.preferRemote || remoteTime > localTime) {
        this.preferRemote = false;
        this.applyRemote(remote);
        return;
      }
    }
    this.preferRemote = false;
    await this.push();
  },

  // クラウドのセーブで続きから再開する
  applyRemote(remote) {
    applySaveData(remote); // 古い版のデータなら、ここで移行される
    saveGame();
    allyHp = {};
    battle = null; // 進行中の戦闘を止める
    UI.renderControls();
    startFloor();
    Panel.refresh();
    UI.renderHeader();
    showToast('クラウドのセーブデータから続きを始めます');
    showUpdateNotice(); // 移行した人へのお知らせ（まだ見ていなければ）
  },

  async push() {
    await this.fb.setDoc(this.userRef(), {
      data: JSON.stringify(gameState),
      lastSaved: gameState.lastSaved || Date.now(),
      updatedAt: this.fb.serverTimestamp(),
    });
    this.lastPush = Date.now();
    this.setStatus('☁ 保存済み');
  },

  // 階層クリア時・育成時に呼ぶ（10秒に1回までにまとめて送る）
  save(reason) {
    if (!this.enabled) return;
    this.dirty = true;
    if (this.saveTimer) return;
    const wait = Math.max(0, this.lastPush + CLOUD_SAVE_INTERVAL - Date.now());
    this.saveTimer = setTimeout(() => this.flush(), wait);
  },

  // たまっている変更をすぐ送る（画面を閉じるときなど）
  async flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.ready || !this.dirty) return;
    this.dirty = false;
    try {
      await this.push();
      await this.submitRanking();
    } catch (e) {
      console.error('クラウド保存に失敗', e);
      this.dirty = true; // 次の機会にもう一度
      this.setStatus('⚠ 保存に失敗（あとで再試行）');
    }
  },

  // ---- アカウント（Google 連携） ----
  isAnonymous() {
    return !this.user || this.user.isAnonymous;
  },

  async linkGoogle() {
    const provider = new this.fb.GoogleAuthProvider();
    try {
      const result = await this.fb.linkWithPopup(this.auth.currentUser, provider);
      this.user = result.user; // uid は変わらない（今の進行がそのまま Google アカウントのものになる）
      this.dirty = true;
      await this.flush();
      showToast('Googleアカウントと連携しました');
      this.openAccount();
    } catch (e) {
      if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') {
        // その Google アカウントは別の進行と連携済み → そちらに切り替える（別の端末からの引き継ぎ）
        const cred = this.fb.GoogleAuthProvider.credentialFromError(e);
        if (!cred) return alert('切り替えに失敗しました。もう一度お試しください。');
        const ok = confirm('このGoogleアカウントには、すでにセーブデータがあります。\n' +
          'そちらに切り替えて続きから遊びますか？\n\n（この端末で今遊んでいる進行は使えなくなります）');
        if (!ok) return;
        this.preferRemote = true;
        Modal.close();
        await this.fb.signInWithCredential(this.auth, cred); // ログイン状態が変わり onUser で読み込まれる
      } else if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
        // 自分で閉じた
      } else if (e.code === 'auth/popup-blocked') {
        alert('ポップアップがブロックされました。ブラウザの設定でこのサイトのポップアップを許可してください。');
      } else if (e.code === 'auth/unauthorized-domain') {
        alert('このサイトのドメインが Firebase に登録されていません（Authentication → 設定 → 承認済みドメイン）。');
      } else {
        console.error(e);
        alert(`連携できませんでした（${e.code || e.message}）`);
      }
    }
  },

  // アカウント画面
  openAccount() {
    if (!this.user) {
      Modal.open('☁ アカウント', `<p>${escapeHtml(this.status)}</p>
        <p class="modal-note">クラウドセーブとランキングを使うには、Firebase の設定と、Webサーバー上での公開（またはローカルサーバー）が必要です。今はこのブラウザの中にだけ保存されています。</p>`);
      return;
    }
    const google = !this.isAnonymous();
    const email = google ? (this.user.email || (this.user.providerData[0] && this.user.providerData[0].email) || '') : '';
    const last = this.lastPush ? new Date(this.lastPush).toLocaleString() : '—';
    Modal.open('☁ アカウント', `
      <table class="account-table">
        <tr><th>状態</th><td>${google ? `Googleアカウント連携済み<br><small>${escapeHtml(email)}</small>` : 'ゲスト（匿名）'}</td></tr>
        <tr><th>ニックネーム</th><td>${escapeHtml(gameState.nickname || '未設定')}${(gameState.titles || []).map(t => ` <span class="title-badge">🏅${escapeHtml(t)}</span>`).join('')}</td></tr>
        <tr><th>最高到達</th><td>${gameState.bestFloor}階</td></tr>
        ${gameState.endlessBest ? `<tr><th>無限モード</th><td>最高 ${gameState.endlessBest}階</td></tr>` : ''}
        ${oldRecordText() ? `<tr><th>旧記録</th><td><small>${oldRecordText()}</small></td></tr>` : ''}
        <tr><th>最後の保存</th><td>${escapeHtml(last)}</td></tr>
      </table>
      ${google ? '<p class="modal-note">別の端末でも「Googleアカウントで引き継ぐ」を押して同じアカウントを選ぶと、続きから遊べます。</p>'
               : '<p class="modal-note">ゲストのままだと、ブラウザのデータを消したり別の端末で遊ぶと、続きから遊べません。<br>Googleアカウントと連携しておくと安心です。別の端末で続きを遊ぶときも、このボタンから同じアカウントを選んでください。</p>'}
      <div class="modal-buttons">
        ${google ? '' : '<button id="link-google-btn" class="primary">Googleアカウントで引き継ぐ</button>'}
        <button id="change-name-btn">ニックネームを変更</button>
        <button id="save-now-btn">今すぐ保存</button>
      </div>`);
    const linkBtn = document.getElementById('link-google-btn');
    if (linkBtn) linkBtn.addEventListener('click', () => this.linkGoogle());
    document.getElementById('change-name-btn').addEventListener('click', () => this.askNickname(false));
    document.getElementById('save-now-btn').addEventListener('click', async () => {
      this.dirty = true;
      await this.flush();
      showToast('保存しました');
      this.openAccount();
    });
  },

  // ---- ニックネーム ----
  askNickname(first) {
    Modal.open(first ? 'ようこそ！' : 'ニックネームを変更', `
      <p>${first ? 'ランキングに表示するニックネームを決めてください。' : '新しいニックネームを入力してください。'}</p>
      <input id="nickname-input" type="text" maxlength="${NICKNAME_MAX}" value="${escapeHtml(gameState.nickname || '')}" placeholder="${NICKNAME_MAX}文字まで" autocomplete="off">
      <p id="nickname-error" class="modal-error"></p>
      <div class="modal-buttons"><button id="nickname-ok" class="primary">決定</button></div>
      <p class="modal-note">ほかの人に見えます。個人を特定できる名前や、人を不快にさせる名前は避けてください。</p>`);
    const input = document.getElementById('nickname-input');
    const submit = async () => {
      const name = input.value.replace(/\s+/g, ' ').trim();
      if (name.length < 1 || name.length > NICKNAME_MAX) {
        document.getElementById('nickname-error').textContent = `1〜${NICKNAME_MAX}文字で入力してください`;
        return;
      }
      gameState.nickname = name;
      saveGame();
      Modal.close();
      try {
        await this.submitRanking();
        this.save('nickname');
        showToast(`ニックネームを「${name}」にしました`);
      } catch (e) {
        console.error(e);
        showToast('ランキングへの登録に失敗しました');
      }
    };
    document.getElementById('nickname-ok').addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    input.focus();
  },

  // ---- ランキング ----
  rankRef() {
    return this.fb.doc(this.db, 'rankings', this.user.uid);
  },

  async loadRanking() {
    const snap = await this.fb.getDoc(this.rankRef());
    this.rankDoc = snap.exists() ? snap.data() : null;
    if (this.rankDoc && !gameState.nickname) gameState.nickname = this.rankDoc.name;
  },

  // 最高記録を更新したとき（またはニックネーム・称号が変わったとき）だけ書き込む
  titleUnsupported: false, // Firestore のルールが古くて称号を保存できないとき true（称号なしで登録する）
  async submitRanking() {
    if (!this.ready || !gameState.nickname) return;
    const name = gameState.nickname;
    const title = this.titleUnsupported ? '' : currentTitle();
    const best = Math.floor(gameState.bestFloor || 1);
    const cur = this.rankDoc;
    if (cur && best <= cur.bestFloor && cur.name === name && (cur.title || '') === title) return; // 変更なし

    let data;
    if (!cur || best > cur.bestFloor) {
      // 記録更新：到達した時刻を記録（同じ階層なら早く到達した人が上）
      data = { name, bestFloor: best, updatedAt: this.fb.serverTimestamp() };
    } else {
      // 名前・称号だけ変更：記録と到達時刻はそのまま
      data = { name, bestFloor: cur.bestFloor, updatedAt: cur.updatedAt };
    }
    if (title) data.title = title; // 称号（名前の横に表示）
    try {
      await this.fb.setDoc(this.rankRef(), data);
    } catch (e) {
      // ルールがまだ古い（称号の項目を許可していない）ときは、称号なしで登録し直す
      if (!data.title || e.code !== 'permission-denied') throw e;
      console.warn('ランキングに称号を保存できませんでした。Firestore のルールを更新してください', e);
      this.titleUnsupported = true;
      delete data.title;
      await this.fb.setDoc(this.rankRef(), data);
    }
    const snap = await this.fb.getDoc(this.rankRef());
    this.rankDoc = snap.data();
  },

  async openRanking() {
    Modal.open('🏆 到達階層ランキング', '<p class="modal-note">読み込み中…</p>');
    if (!this.ready) {
      Modal.setBody(`<p>${escapeHtml(this.status)}</p><p class="modal-note">ランキングはクラウドに接続しているときに見られます。</p>`);
      return;
    }
    const f = this.fb;
    try {
      await this.flush(); // 自分の最新記録を先に送る
      const col = f.collection(this.db, 'rankings');
      const top = await f.getDocs(f.query(col, f.orderBy('bestFloor', 'desc'), f.orderBy('updatedAt', 'asc'), f.limit(100)));

      // 自分の順位 = 自分より深い人の数 ＋ 同じ階層で先に到達した人の数 ＋ 1
      let myRank = null;
      const me = this.rankDoc;
      if (me) {
        const higher = await f.getCountFromServer(f.query(col, f.where('bestFloor', '>', me.bestFloor)));
        const earlier = await f.getCountFromServer(f.query(col, f.where('bestFloor', '==', me.bestFloor), f.where('updatedAt', '<', me.updatedAt)));
        myRank = higher.data().count + earlier.data().count + 1;
      }

      const rows = top.docs.map((d, i) => {
        const r = d.data();
        const mine = d.id === this.user.uid;
        return `<tr class="${mine ? 'mine' : ''}${i < 3 ? ` top${i + 1}` : ''}">
          <td class="rank">${i + 1}</td><td class="rname">${escapeHtml(r.name)}${r.title ? ` <span class="title-badge">🏅${escapeHtml(r.title)}</span>` : ''}${mine ? '（あなた）' : ''}</td><td class="rfloor">${r.bestFloor}階</td></tr>`;
      }).join('');
      const mine = me
        ? `<div class="my-rank">あなたの順位：<strong>${myRank}位</strong>（${me.bestFloor}階・${escapeHtml(me.name)}${me.title ? ` 🏅${escapeHtml(me.title)}` : ''}）</div>`
        : `<div class="my-rank">まだランキングに登録されていません。<button id="rank-name-btn">ニックネームを決めて登録</button></div>`;
      Modal.setBody(`${mine}
        <div class="rank-scroll"><table class="rank-table">
          <thead><tr><th>順位</th><th>名前</th><th>最高到達</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3">まだだれも登録していません</td></tr>'}</tbody>
        </table></div>
        <p class="modal-note">同じ階層なら、先に到達した人が上になります（上位100人まで表示）。</p>`);
      const nameBtn = document.getElementById('rank-name-btn');
      if (nameBtn) nameBtn.addEventListener('click', () => this.askNickname(true));
    } catch (e) {
      console.error(e);
      // 複合インデックスが無いときは、作成用のURLがエラーに含まれる
      const link = (String(e.message).match(/https:\/\/console\.firebase\.google\.com\S+/) || [])[0];
      Modal.setBody(`<p class="modal-error">ランキングを読み込めませんでした。</p>
        ${link ? `<p class="modal-note">Firestore のインデックスが必要です（管理者向け）：<br><a href="${escapeHtml(link)}" target="_blank" rel="noopener">インデックスを作成する</a></p>` : `<p class="modal-note">${escapeHtml(e.code || e.message)}</p>`}`);
    }
  },

  // ---- 状態表示 ----
  setStatus(text) {
    this.status = text;
    const el = document.getElementById('cloud-status');
    if (el) el.textContent = text;
  },
};
