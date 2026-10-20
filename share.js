// =====================================================================
// share.js  ―  到達階層を X（旧Twitter）などでシェアする
//
// ・ヘッダーの「📣 シェア」、ランキング、第○部クリア、エンディングから開ける
// ・data-share 属性が付いたボタンを押すと、どこからでもシェア画面が開く
// ・シェアするURLは、いま開いているページのURL（URLを引っ越しても自動でついてくる）
// =====================================================================
'use strict';

// ファイルを直接開いているとき（file://）だけ使う、公開ページのURL
const SHARE_FALLBACK_URL = 'https://memorai775.github.io/-game/';
const SHARE_HASHTAGS = ['ゆーるぴーじー', 'ブラウザゲーム'];

const Share = {
  // シェアするURL（?や#は付けない）
  url() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return location.origin + location.pathname.replace(/index\.html$/, '');
    }
    return SHARE_FALLBACK_URL;
  },

  // 最高到達階（ランキングと同じ「減らない記録」）
  bestFloor() {
    return Math.max(gameState.bestFloor || 1, gameState.maxFloor || 1);
  },

  // 投稿する文章（URL・ハッシュタグは別で付く）
  text(opts = {}) {
    const floor = this.bestFloor();
    const lines = [];
    if (opts.event === 'ending') {
      lines.push(`ゆーるぴーじーで${DUNGEON.finalFloor}階の終焉の神を倒して、真のエンディングを見た！🎉`);
    } else if (opts.event === 'part' && opts.title) {
      const part = opts.title.replace(/\s*クリア[！!]?\s*$/, ''); // 「第一部 クリア！」→「第一部」
      lines.push(`ゆーるぴーじーの${part}をクリア！🎉 最高${floor}階まで到達`);
    } else if (gameState.endlessBest) {
      lines.push(`ゆーるぴーじーの無限モードで${gameState.endlessBest}階まで到達！♾`);
    } else {
      lines.push(`ゆーるぴーじーで最高${floor}階まで到達！⚔️`);
    }
    const info = [`全体Lv${gameState.globalLevel}`, `仲間${gameState.party.length}人`];
    if (opts.rank) info.push(`ランキング${opts.rank}位`);
    lines.push(info.join('・'));
    lines.push('あなたは何階までいける？');
    return lines.join('\n');
  },

  // 全部入りの文章（コピー・ほかのアプリ用）
  fullText(opts) {
    return `${this.text(opts)}\n${SHARE_HASHTAGS.map(t => `#${t}`).join(' ')}\n${this.url()}`;
  },

  xUrl(opts) {
    const p = new URLSearchParams({
      text: this.text(opts),
      url: this.url(),
      hashtags: SHARE_HASHTAGS.join(','),
    });
    return `https://twitter.com/intent/tweet?${p.toString()}`;
  },

  // シェア画面を開く。opts: { event: 'ending' | 'part', title, rank }
  open(opts = {}) {
    this.opts = opts;
    const canNative = typeof navigator.share === 'function';
    Modal.open('📣 記録をシェア', `
      <p>いまの記録をシェアして、友だちに挑戦してもらおう！</p>
      <div class="share-preview">${escapeHtml(this.fullText(opts)).replace(/\n/g, '<br>')}</div>
      <div class="modal-buttons share-buttons">
        <button type="button" class="primary share-x" id="share-x">𝕏 でポスト</button>
        ${canNative ? '<button type="button" id="share-native">ほかのアプリ</button>' : ''}
        <button type="button" id="share-copy">文章をコピー</button>
      </div>
      <p class="modal-note">ポストする前に、文章は自由に書きかえられます。</p>`);
    document.getElementById('share-x').addEventListener('click', () => this.toX());
    const nativeBtn = document.getElementById('share-native');
    if (nativeBtn) nativeBtn.addEventListener('click', () => this.toNative());
    document.getElementById('share-copy').addEventListener('click', () => this.copy());
  },

  toX() {
    // 別タブで開く（スマホでXアプリが入っていれば、アプリが開く）
    const w = window.open(this.xUrl(this.opts), '_blank', 'noopener');
    if (!w) location.href = this.xUrl(this.opts); // ポップアップがブロックされたとき
  },

  async toNative() {
    try {
      await navigator.share({
        title: 'ゆーるぴーじー',
        text: `${this.text(this.opts)}\n${SHARE_HASHTAGS.map(t => `#${t}`).join(' ')}`,
        url: this.url(),
      });
    } catch (e) {
      // キャンセルしたときは何もしない
      if (e && e.name !== 'AbortError') showToast('シェアできませんでした');
    }
  },

  async copy() {
    const text = this.fullText(this.opts);
    try {
      await navigator.clipboard.writeText(text);
      showToast('コピーしました！');
    } catch (e) {
      // clipboard が使えないブラウザ向け
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      showToast(ok ? 'コピーしました！' : 'コピーできませんでした');
    }
  },

  // 起動時に1回呼ぶ
  init() {
    document.getElementById('share-btn').addEventListener('click', () => this.open());
    // data-share="ending" / data-share="part" data-share-title="…" / data-share-rank="3" のボタン
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-share]');
      if (!btn) return;
      const opts = {};
      if (btn.dataset.share) opts.event = btn.dataset.share;
      if (btn.dataset.shareTitle) opts.title = btn.dataset.shareTitle;
      if (btn.dataset.shareRank) opts.rank = Number(btn.dataset.shareRank);
      this.open(opts);
    });
  },
};

Share.init();
