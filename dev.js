// =====================================================================
// dev.js  ―  開発者モード（テスト用の道具）
// localhost・127.0.0.1・ファイルを直接開いたとき（file://）だけ有効。公開サイト（github.io など）では何もしない。
// 開発者モードのときは、クラウド保存とランキングへの書き込みをしない（cloud.js が window.DEV_MODE を見て止める）。
// 画面の右下の「🛠」ボタンで開発者パネルが開く。
// =====================================================================
'use strict';

window.DEV_MODE = (() => {
  const host = location.hostname;
  if (/github\.io$/i.test(host)) return false; // 公開サイトでは絶対に有効にしない
  return location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
})();

if (window.DEV_MODE) {
  // ほかのスクリプト（main.js など）が全部読み込まれてから、パネルを作る
  window.addEventListener('load', () => DevPanel.init());
}

const DevPanel = {
  el: null,

  init() {
    const stage = document.getElementById('stage');
    // 今どっちで動いているか分かるように、小さく表示
    const badge = document.createElement('div');
    badge.id = 'dev-badge';
    badge.textContent = '🛠 開発者モード';
    badge.title = 'クラウド保存・ランキングへの書き込みはオフです';
    stage.appendChild(badge);

    const btn = document.createElement('button');
    btn.id = 'dev-btn';
    btn.type = 'button';
    btn.textContent = '🛠';
    btn.title = '開発者パネル';
    btn.addEventListener('click', () => this.toggle());
    stage.appendChild(btn);

    this.el = document.createElement('div');
    this.el.id = 'dev-panel';
    this.el.className = 'hidden';
    stage.appendChild(this.el);
    this.addStyle();
  },

  toggle() {
    if (this.el.classList.contains('hidden')) {
      this.render();
      this.el.classList.remove('hidden');
    } else {
      this.el.classList.add('hidden');
    }
  },

  // 変更を画面と保存に反映する
  refresh(msg) {
    saveGame();
    if (typeof syncBattleAllies === 'function') syncBattleAllies();
    UI.renderHeader();
    Panel.refresh();
    if (battle) UI.render(battle);
    if (msg) showToast(`🛠 ${msg}`);
    this.render();
  },

  // 今の階をやり直す（味方は全回復）
  restartFloor() {
    allyHp = {};
    battle = null;
    UI.renderHeader();
    startFloor();
  },

  render() {
    const g = gameState;
    const itemOpts = tier => Object.keys(ITEMS).filter(id => ITEMS[id].tier === tier)
      .map(id => `<option value="${id}">${ITEMS[id].name}</option>`).join('');
    this.el.innerHTML = `
      <div class="dev-head"><b>🛠 開発者パネル</b><button type="button" data-act="close">✕</button></div>
      <div class="dev-body">
        <p class="dev-note">クラウド保存・ランキングはオフです。データはこのブラウザの中だけに保存されます。</p>

        <div class="dev-sec">階層</div>
        <div class="dev-row">今 ${g.floor}階（最高 ${g.maxFloor}階・チェックポイント ${g.checkpoint}階）</div>
        <div class="dev-row"><input id="dev-floor" type="number" min="1" value="${g.floor}">
          <button type="button" data-act="warp">この階へワープ</button></div>
        <label class="dev-row"><input id="dev-floor-max" type="checkbox" checked> 最高到達階・チェックポイントも合わせる</label>

        <div class="dev-sec">レベル・経験値・ポイント</div>
        <div class="dev-grid">
          <label>全体Lv<input id="dev-lv" type="number" min="1" value="${g.globalLevel}"></label>
          <label>経験値<input id="dev-exp" type="number" min="0" value="${g.exp}"></label>
          <label>ポイント<input id="dev-pt" type="number" min="0" value="${g.points}"></label>
        </div>
        <div class="dev-row"><button type="button" data-act="stats">この数値にする</button></div>

        <div class="dev-sec">仲間</div>
        <div class="dev-row"><button type="button" data-act="party">仲間を全員加入させる</button></div>

        <div class="dev-sec">アイテム・装備</div>
        <div class="dev-row"><select id="dev-item">
          <optgroup label="下級">${itemOpts(1)}</optgroup>
          <optgroup label="上級">${itemOpts(2)}</optgroup>
          <optgroup label="特級">${itemOpts(3)}</optgroup>
        </select><input id="dev-item-n" type="number" min="1" max="99" value="1"><button type="button" data-act="item">入手</button></div>
        <div class="dev-row"><button type="button" data-act="lows">下級を全部6個ずつ</button><button type="button" data-act="highs">上級を全部1個ずつ</button></div>
        <div class="dev-row"><button type="button" data-act="legendUnlock">特級合成を解放</button></div>

        <div class="dev-sec">戦闘</div>
        <div class="dev-row"><button type="button" data-act="killAll">敵を全員倒す</button><button type="button" data-act="healAll">味方を全回復</button></div>
        <div class="dev-row"><button type="button" data-act="restart">今の階をやり直す</button></div>

        <div class="dev-sec">演出の確認</div>
        <div class="dev-row"><button type="button" data-act="part50">第一部クリア</button><button type="button" data-act="part70">第二部クリア</button></div>
        <div class="dev-row"><button type="button" data-act="ending">真のエンディング</button><button type="button" data-act="legendPopup">特級合成の解放</button></div>
        <div class="dev-row"><button type="button" data-act="slotPopup">装備枠4つ</button><button type="button" data-act="notice">アップデートのお知らせ</button></div>

        <div class="dev-sec">セーブデータ</div>
        <div class="dev-row"><button type="button" class="danger" data-act="reset">セーブデータをリセット</button></div>
      </div>`;
    for (const b of this.el.querySelectorAll('[data-act]')) {
      b.addEventListener('click', () => this.act(b.dataset.act));
    }
  },

  num(id, min = 0) {
    const v = Math.floor(Number(document.getElementById(id).value));
    return Number.isFinite(v) ? Math.max(min, v) : min;
  },

  act(name) {
    const g = gameState;
    switch (name) {
      case 'close':
        this.el.classList.add('hidden');
        return;

      // ---- 階層 ----
      case 'warp': {
        const f = this.num('dev-floor', 1);
        g.floor = f;
        g.selectedFloor = null;
        g.repeatFloor = false;
        if (document.getElementById('dev-floor-max').checked) {
          g.maxFloor = Math.max(g.maxFloor, f);
          g.bestFloor = Math.max(g.bestFloor || 1, f);
          g.checkpoint = f;
          if (f > DUNGEON.finalFloor) { g.endlessUnlocked = true; g.endlessBest = Math.max(g.endlessBest || 0, f); }
        }
        saveGame();
        this.restartFloor();
        this.refresh(`${f}階へワープしました`);
        return;
      }

      // ---- レベル・経験値・ポイント ----
      case 'stats':
        g.globalLevel = this.num('dev-lv', 1);
        g.exp = Math.min(this.num('dev-exp', 0), expToNext(g.globalLevel) - 1);
        g.points = this.num('dev-pt', 0);
        this.refresh('レベル・経験値・ポイントを変更しました');
        return;

      // ---- 仲間 ----
      case 'party': {
        const joined = Object.keys(CHARACTERS).filter(id => !g.party.includes(id));
        joined.forEach(addPartyMember);
        this.refresh(joined.length ? `${joined.length}人を加入させました` : 'すでに全員そろっています');
        return;
      }

      // ---- アイテム ----
      case 'item': {
        const id = document.getElementById('dev-item').value;
        const n = Math.min(99, this.num('dev-item-n', 1));
        this.give(id, n);
        this.refresh(`${ITEMS[id].name}を${n}個入手しました`);
        return;
      }
      case 'lows':
        Object.keys(ITEMS).filter(id => ITEMS[id].tier === 1).forEach(id => this.give(id, 6));
        this.refresh('下級装備を全部6個ずつ入手しました');
        return;
      case 'highs':
        Object.keys(ITEMS).filter(id => ITEMS[id].tier === 2).forEach(id => this.give(id, 1));
        this.refresh('上級装備を全部1個ずつ入手しました');
        return;
      case 'legendUnlock':
        g.legendUnlocked = true;
        this.refresh('特級合成を解放しました');
        return;

      // ---- 戦闘 ----
      case 'killAll': {
        const b = battle;
        if (!b || b.over) { showToast('🛠 戦闘中ではありません'); return; }
        for (const e of b.enemies.filter(u => u.alive)) {
          // 復活・分裂・命のストックなどで生き返らないようにしてから倒す
          Object.assign(e, { rebirthUsed: true, reanimateUsed: true, snowUsed: true, splitDone: true, tails: 0, chronoRewound: true });
          e.traits = e.traits.filter(t => !['splitOnDeath', 'splitAt', 'snowballSplit', 'reanimate', 'rebirth', 'nineLives', 'endure'].includes(t.type));
          e.statuses = [];
          e.hp = 0;
          b.defeat(e, null);
        }
        for (const e of b.enemies) e.alive = false; // 呼び出された敵なども残さない
        b.checkEnd();
        UI.render(b);
        showToast('🛠 敵を全員倒しました');
        return;
      }
      case 'healAll': {
        const b = battle;
        if (!b) { showToast('🛠 戦闘中ではありません'); return; }
        for (const u of b.allies) {
          if (!u.alive) b.revive(u, 1, '🛠 ');
          u.hp = u.base.hp;
          u.statuses = u.statuses.filter(s => !BAD_STATUSES.includes(s.id));
        }
        UI.render(b);
        showToast('🛠 味方を全回復しました');
        return;
      }
      case 'restart':
        this.restartFloor();
        showToast('🛠 今の階をやり直します');
        return;

      // ---- 演出の確認 ----
      case 'part50': showPartClear(50); return;
      case 'part70': showPartClear(70); return;
      case 'ending':
        // 「無限モードへ」を押すと、今の階の戦闘からやり直す（階は変わらない）
        showEnding();
        this.el.classList.add('hidden');
        return;
      case 'legendPopup':
        UI.popup(`
          <p class="popup-title">✨ 特級合成が解放されました！</p>
          <p>上級装備を3つ合成すると、強力な<b>特級装備</b>（★1〜★5）が作れるようになりました。</p>
          <p class="popup-note">（開発者モードでの確認用の表示です）</p>`);
        return;
      case 'slotPopup':
        UI.popup(`
          <p class="popup-title">🎒 装備枠が${ITEM_CONFIG.slotsPerChar}つになりました！</p>
          <p>${ITEM_CONFIG.extraSlotFloor}階に到達したので、みんなの装備枠が1つ増えました。</p>
          <p class="popup-note">（開発者モードでの確認用の表示です）</p>`);
        return;
      case 'notice': {
        // お知らせを出すために、一時的に「まだ見ていない」状態にする
        const saved = g.noticeVersion;
        g.noticeVersion = 0;
        showUpdateNotice();
        g.noticeVersion = saved;
        saveGame();
        return;
      }

      // ---- セーブデータ ----
      case 'reset':
        if (!confirm('セーブデータをリセットして1階からやり直します（このブラウザの中だけ）。よろしいですか？')) return;
        restartFromScratch();
        this.refresh('セーブデータをリセットしました');
        return;
    }
  },

  // アイテムを入手（図鑑にも登録。特級は系統ごとの最高ランクも記録）
  give(id, n) {
    for (let i = 0; i < n; i++) gameState.inventory.push(id);
    markDiscovered(id);
    const it = ITEMS[id];
    if (it.tier === 3) {
      const key = LEGEND.families[it.family].key;
      gameState.legendBest[key] = Math.max(gameState.legendBest[key] || 0, it.rank);
    }
  },

  addStyle() {
    const css = document.createElement('style');
    css.textContent = `
      #dev-badge { position: absolute; right: 6px; bottom: 4px; z-index: 70; padding: 1px 6px; border-radius: 6px;
        font-size: 10px; color: #ffd54a; background: rgba(60, 40, 0, 0.75); pointer-events: none; }
      #dev-btn { position: absolute; right: 6px; bottom: 22px; z-index: 70; width: 34px; height: 30px; padding: 0;
        font-size: 16px; border-color: #ffd54a; background: rgba(40, 30, 0, 0.85); }
      #dev-panel { position: absolute; right: 6px; bottom: 56px; z-index: 71; width: 320px; max-height: 80%;
        display: flex; flex-direction: column; border: 1px solid #ffd54a; border-radius: 10px;
        background: rgba(20, 22, 32, 0.97); color: #e8e8f0; font-size: 12px; box-shadow: 0 6px 24px rgba(0,0,0,0.5); }
      #dev-panel.hidden { display: none; }
      #dev-panel .dev-head { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid #3a4058; }
      #dev-panel .dev-head button { padding: 0 8px; }
      #dev-panel .dev-body { overflow-y: auto; padding: 6px 8px 10px; }
      #dev-panel .dev-note { margin: 0 0 4px; color: #9aa3c0; font-size: 11px; }
      #dev-panel .dev-sec { margin: 8px 0 3px; font-weight: bold; color: #ffd54a; }
      #dev-panel .dev-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 3px 0; }
      #dev-panel .dev-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
      #dev-panel .dev-grid label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: #c0c6dc; }
      #dev-panel input[type=number] { width: 70px; padding: 3px 4px; }
      #dev-panel .dev-grid input[type=number] { width: 100%; }
      #dev-panel select { flex: 1; min-width: 0; padding: 3px; }
      #dev-panel button { padding: 3px 8px; font-size: 12px; }
      #stage.portrait #dev-panel { width: auto; left: 6px; }`;
    document.head.appendChild(css);
  },
};
