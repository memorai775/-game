// =====================================================================
// overlay.js  ―  タップで開くパネル（キャラの詳細・🎒アイテム変換）と設定
// パネルが開いている間は後ろに透明な幕（#overlay-backdrop）を敷いて、ほかの操作を受け付けない。
// 幕（パネルの外側）をタップするか ✕ で閉じる。戦闘はそのまま進む。
// =====================================================================
'use strict';

// ---------------------------------------------------------------------
// パネルの開け閉めと置き場所
// ---------------------------------------------------------------------
const Overlay = {
  backdrop: document.getElementById('overlay-backdrop'),

  show(panel) {
    this.closeAll();
    this.backdrop.classList.remove('hidden');
    panel.classList.remove('hidden');
  },

  closeAll() {
    this.backdrop.classList.add('hidden');
    for (const p of document.querySelectorAll('.float-panel')) p.classList.add('hidden');
    UnitDetail.unit = null;
  },

  // ステージの中での位置（拡大縮小前の座標）に直す
  stageRect(el) {
    const s = document.getElementById('stage').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      left: (r.left - s.left) / stageScale,
      top: (r.top - s.top) / stageScale,
      width: r.width / stageScale,
      height: r.height / stageScale,
    };
  },

  // パネルを置く。縦画面は画面の下から出す。横画面は anchor（キャラのカードなど）の横に出す
  place(panel, anchor) {
    panel.classList.toggle('sheet', isPortraitLayout());
    panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = '';
    if (isPortraitLayout() || !anchor) return; // 縦画面・置き場所の指定なし → CSS の下からのシート

    const stage = document.getElementById('stage');
    const W = stage.offsetWidth;
    const H = stage.offsetHeight;
    const a = this.stageRect(anchor);
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const gap = 8;
    // 右に入るなら右、入らなければ左（キャラが画面の右側なら左）
    let left = a.left + a.width + gap;
    if (left + pw > W - 4) left = a.left - pw - gap;
    left = Math.max(4, Math.min(left, W - pw - 4));
    let top = a.top + a.height / 2 - ph / 2;
    top = Math.max(4, Math.min(top, H - ph - 4));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  },
};

Overlay.backdrop.addEventListener('click', () => Overlay.closeAll());

// ---------------------------------------------------------------------
// キャラの詳細パネル（カードをタップすると開く）
// ---------------------------------------------------------------------
const UnitDetail = {
  el: document.getElementById('unit-detail'),
  unit: null,

  open(u) {
    this.unit = u;
    Overlay.show(this.el);
    this.unit = u; // closeAll で消えるので入れ直す
    this.render();
    Overlay.place(this.el, u.dom && u.dom.card);
  },

  // 戦闘の表示が更新されたら、開いているパネルの数値も更新（位置はそのまま）
  refresh() {
    if (this.unit && !this.el.classList.contains('hidden')) this.render();
  },

  render() {
    const u = this.unit;
    const b = battle;
    const pct = v => `${Math.round(v * 100)}%`;

    // 能力値：今の値（バフ込み）と、元の値との違い
    const statRow = (key, label) => {
      const now = Math.round(getStat(u, key));
      const base = u.base[key];
      const diff = now - base;
      const mark = diff > 0 ? `<span class="up">▲${diff}</span>` : diff < 0 ? `<span class="down">▼${-diff}</span>` : '';
      return `<tr><th>${label}</th><td>${now} ${mark}</td></tr>`;
    };

    const pos = UI.turnPos.get(u.uid);
    const turnText = !u.alive ? '倒れている'
      : b && u === b.current ? '今行動中'
      : UI.inked ? '墨で見えない'
      : pos !== undefined ? `${pos + 1}番目` : 'まだ先';

    // バフ／デバフ・状態
    const effects = [];
    if (u.guarding) effects.push('<li>🛡 防御中（受けるダメージ半減）</li>');
    if (u.coveredBy && u.coveredBy.alive) effects.push(`<li>🤝 ${escapeHtml(u.coveredBy.name)}がかばっている</li>`);
    if (isCharging(u)) effects.push('<li>⚠ 力をためている（次の攻撃が強い）</li>');
    for (const bf of u.buffs) {
      const up = bf.rate > 1;
      const turns = bf.turns >= 99 ? '戦闘中ずっと' : `あと${bf.turns}ターン`;
      effects.push(`<li class="${up ? 'buff' : 'debuff'}">${up ? '▲' : '▼'} ${STAT_LABELS[bf.stat]} ×${Math.round(bf.rate * 100) / 100}（${turns}）</li>`);
    }
    for (const s of u.statuses) {
      const info = STATUS_INFO[s.id];
      effects.push(`<li class="debuff">${info.icon} ${info.name}：${info.desc(s)}（あと${s.turns}ターン）</li>`);
    }
    if (u.countdown) effects.push(`<li class="debuff">⏳ ${SKILLS[u.countdown.skill].name}まで あと${u.countdown.turns}ターン</li>`);
    if (u.dormant) effects.push('<li>💤 擬態中（攻撃されるまで動かない）</li>');

    // 敵：特殊能力と次の行動の予定
    const traits = (u.traits || []).filter(t => TRAIT_INFO[t.type]).map(t => {
      const info = TRAIT_INFO[t.type];
      return `<li>${info.icon} <b>${t.label || info.name}</b>：${info.desc(t)}</li>`;
    });
    const intent = u.side === 'enemy' && u.alive && b ? b.dangerOf(u) : null;

    // 味方：装備
    const gear = u.side === 'ally' && u.charId ? equippedItems(u.charId) : [];

    const sub = u.side === 'ally'
      ? `Lv${u.level}　${ROLE_LABELS[u.role] || ''}`
      : `${ENEMY_TYPE_LABELS[u.type] || ''}${u.elite ? '　★強化個体' : ''}`;

    this.el.innerHTML = `
      <div class="fp-head">
        <div class="fp-title ${u.side}">${escapeHtml(u.name)}<small>${sub}</small></div>
        <button class="fp-close" type="button" aria-label="閉じる">✕</button>
      </div>
      <div class="fp-body">
        <div class="detail-hp">HP <b>${u.hp}</b> / ${u.base.hp}
          <div class="hpbar"><div style="width:${(u.hp / u.base.hp) * 100}%"></div></div></div>
        <table class="detail-stats">
          ${statRow('atk', '攻撃')}${statRow('def', '防御')}${statRow('spd', '速さ')}
          <tr><th>行動順</th><td>${turnText}</td></tr>
          ${u.side === 'ally' ? `<tr><th>レベル</th><td>${u.level}</td></tr>` : ''}
        </table>
        ${intent ? `<div class="detail-intent">${escapeHtml(intent)}</div>` : ''}
        <div class="detail-sec">バフ・デバフ・状態</div>
        <ul class="detail-list">${effects.join('') || '<li class="none">なし</li>'}</ul>
        ${traits.length ? `<div class="detail-sec">特殊能力</div><ul class="detail-list">${traits.join('')}</ul>` : ''}
        ${u.side === 'ally' ? `<div class="detail-sec">装備</div><ul class="detail-list">${
          gear.length ? gear.map(id => `<li>${itemIcon(id, 'sm')} ${ITEMS[id].name}：${ITEMS[id].desc}</li>`).join('') : '<li class="none">なし</li>'}</ul>` : ''}
      </div>`;
    this.el.querySelector('.fp-close').addEventListener('click', () => Overlay.closeAll());
  },
};

// ---------------------------------------------------------------------
// 🎒 アイテム → 経験値の変換パネル
// ---------------------------------------------------------------------
const Bag = {
  el: document.getElementById('bag-panel'),
  picks: {}, // 変換するアイテム { アイテムID: 個数 }

  open() {
    this.picks = {};
    Overlay.show(this.el);
    this.render();
    Overlay.place(this.el, document.getElementById('bag-btn'));
  },

  render() {
    const counts = inventoryCounts();
    // 上級を上に、それぞれ名前順
    const ids = Object.keys(counts).sort((a, b) => (ITEMS[b].tier - ITEMS[a].tier) || ITEMS[a].name.localeCompare(ITEMS[b].name, 'ja'));
    for (const id in this.picks) if (!counts[id]) delete this.picks[id];

    let total = 0;
    let n = 0;
    for (const id in this.picks) { total += this.picks[id] * itemExpValue(id); n += this.picks[id]; }
    const lowAll = ids.filter(id => ITEMS[id].tier === 1).reduce((s, id) => s + counts[id] * itemExpValue(id), 0);

    const rows = ids.map(id => {
      const pick = this.picks[id] || 0;
      return `<div class="bag-row${pick ? ' picked' : ''}" data-id="${id}">
        ${itemIcon(id, 'sm')}
        <div class="bag-name">${itemLabel(id)}<small>所持 ${counts[id]}　1個 +${itemExpValue(id)} EXP</small></div>
        <div class="bag-step">
          <button data-act="minus" ${pick ? '' : 'disabled'}>－</button>
          <span>${pick}</span>
          <button data-act="plus" ${pick < counts[id] ? '' : 'disabled'}>＋</button>
          <button data-act="all" class="bag-all" ${pick < counts[id] ? '' : 'disabled'}>全部</button>
        </div>
      </div>`;
    }).join('');

    this.el.innerHTML = `
      <div class="fp-head">
        <div class="fp-title">🎒 アイテム → 経験値</div>
        <button class="fp-close" type="button" aria-label="閉じる">✕</button>
      </div>
      <div class="fp-body">
        <p class="bag-note">変換したアイテムはなくなります（装備中のものは出てきません）。</p>
        <div class="bag-list">${rows || '<p class="bag-empty">所持品がありません</p>'}</div>
      </div>
      <div class="bag-foot">
        <div class="bag-total">${n}個を選択中　→　<b>+${total} EXP</b></div>
        <div class="bag-buttons">
          <button id="bag-convert" class="primary" ${n ? '' : 'disabled'}>変換する</button>
          <button id="bag-convert-low" ${lowAll ? '' : 'disabled'}>下級をまとめて変換（+${lowAll}）</button>
        </div>
      </div>`;

    this.el.querySelector('.fp-close').addEventListener('click', () => Overlay.closeAll());
    for (const row of this.el.querySelectorAll('.bag-row')) {
      const id = row.dataset.id;
      row.addEventListener('click', e => {
        const act = e.target.dataset && e.target.dataset.act;
        const have = counts[id];
        const pick = this.picks[id] || 0;
        if (act === 'minus') this.picks[id] = Math.max(0, pick - 1);
        else if (act === 'plus') this.picks[id] = Math.min(have, pick + 1);
        else if (act === 'all') this.picks[id] = have;
        else if (!act) this.picks[id] = pick ? 0 : 1; // 行そのものをタップ：選ぶ／外す
        if (!this.picks[id]) delete this.picks[id];
        this.render();
      });
    }
    document.getElementById('bag-convert').addEventListener('click', () => this.convert(this.picks));
    document.getElementById('bag-convert-low').addEventListener('click', () => {
      const low = {};
      for (const id of ids) if (ITEMS[id].tier === 1) low[id] = counts[id];
      const count = Object.values(low).reduce((s, v) => s + v, 0);
      if (confirm(`下級アイテム${count}個をすべて経験値に変換します（+${lowAll} EXP）。\n合成の素材がなくなりますが、よろしいですか？`)) this.convert(low);
    });
  },

  convert(picks) {
    const r = convertItemsToExp(picks);
    if (!r.count) return;
    this.picks = {};
    let msg = `${r.count}個を変換して +${r.exp} EXP！`;
    if (r.levels > 0) msg += ` 全体レベルが ${gameState.globalLevel} に上がった！（ポイント +${r.points}）`;
    showToast(msg);
    if (battle) battle.log(msg, 'system');
    UI.renderHeader();
    Panel.refresh();
    Cloud.save('convert');
    this.render();
  },
};

document.getElementById('bag-btn').addEventListener('click', () => Bag.open());

// ---------------------------------------------------------------------
// ⚙ 設定
// ---------------------------------------------------------------------
function openSettings() {
  const s = gameState.settings;
  Modal.open('⚙ 設定', `
    <label class="setting-row">
      <input type="checkbox" id="set-show-stats" ${s.showStats ? 'checked' : ''}>
      <span><b>ステータスを常に表示</b><br>
      <small>OFF：キャラは名前・HPバー・行動順だけ（タップで詳細）。ON：攻撃・防御・速さ・バフなどもカードに表示</small></span>
    </label>`);
  document.getElementById('set-show-stats').addEventListener('change', e => {
    gameState.settings.showStats = e.target.checked;
    saveGame();
    UI.renderControls();
    Cloud.save('settings');
  });
}

document.getElementById('settings-btn').addEventListener('click', openSettings);
