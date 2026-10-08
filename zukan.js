// =====================================================================
// zukan.js  ―  📖 図鑑（倒した敵・手に入れたアイテム）
// 敵：一度倒すと登録（progress.js の recordDefeat。gameState.bestiary）
// アイテム：一度手に入れると登録（報酬・合成。gameState.discovered）
// 未登録のものはシルエットと「？？？」で、手がかり（出現する階・作り方）だけ見せる
// =====================================================================
'use strict';

const Zukan = {
  tab: 'monster', // 'monster' / 'item'

  open(tab) {
    if (tab) this.tab = tab;
    Modal.open('📖 図鑑', '');
    this.renderList();
  },

  // ---- 手がかり ----
  // その敵が最初に出てくる階（ボスはボス階。分裂・召喚でしか出ない敵はその説明）
  enemyHint(id) {
    const bossFloor = Object.keys(DUNGEON.bosses).find(f => DUNGEON.bosses[f].includes(id));
    if (bossFloor) return `${bossFloor}階のボス`;
    const pool = DUNGEON.enemyPools.find(p => (p.add || []).includes(id) || (p.rare && p.rare[id]));
    if (pool) return `${pool.from}階〜${pool.rare && pool.rare[id] ? '（まれに出現）' : ''}`;
    // ほかの敵の能力から出てくるもの
    for (const key in ENEMIES) {
      const e = ENEMIES[key];
      const split = (e.traits || []).find(t => t.type === 'splitOnDeath' && t.into === id);
      if (split) return `${e.name}が分裂して出現`;
    }
    return '？？？';
  },

  // 敵の並び順：出てくる階の順（ボスはその階の位置）
  enemyOrder() {
    const firstFloor = id => {
      const boss = Object.keys(DUNGEON.bosses).find(f => DUNGEON.bosses[f].includes(id));
      if (boss) return Number(boss) + 0.5;
      const pool = DUNGEON.enemyPools.find(p => (p.add || []).includes(id) || (p.rare && p.rare[id]));
      if (pool) return pool.from + (pool.rare ? 0.3 : 0);
      return 999;
    };
    const keys = Object.keys(ENEMIES);
    return keys.sort((a, b) => (firstFloor(a) - firstFloor(b)) || (keys.indexOf(a) - keys.indexOf(b)));
  },

  itemHint(id) {
    if (ITEMS[id].tier === 1) return '階層クリアの報酬で手に入る';
    const r = RECIPES.find(x => x.result === id);
    return r ? `合成：${ITEMS[r.items[0]].name}＋${ITEMS[r.items[1]].name}` : '？？？';
  },

  // ---- 一覧 ----
  renderList() {
    const enemyIds = this.enemyOrder();
    const itemIds = Object.keys(ITEMS).sort((a, b) => ITEMS[a].tier - ITEMS[b].tier); // 下級 → 上級
    const knownEnemies = enemyIds.filter(id => gameState.bestiary[id]).length;
    const knownItems = itemIds.filter(id => gameState.discovered.includes(id)).length;

    let grid;
    if (this.tab === 'monster') {
      grid = enemyIds.map(id => {
        const e = ENEMIES[id];
        const rec = gameState.bestiary[id];
        const boss = e.type === 'boss';
        return `<button class="zk-cell${rec ? '' : ' unknown'}${boss ? ' boss' : ''}" data-kind="monster" data-id="${id}">
          <span class="zk-img">${e.image ? `<img src="${e.image}" alt="">` : ''}</span>
          <span class="zk-name">${rec ? e.name : '？？？'}</span>
          ${boss ? '<span class="zk-tag">BOSS</span>' : ''}
        </button>`;
      }).join('');
    } else {
      grid = itemIds.map(id => {
        const known = gameState.discovered.includes(id);
        return `<button class="zk-cell item${known ? '' : ' unknown'}" data-kind="item" data-id="${id}">
          ${itemIcon(id, 'md', !known)}
          <span class="zk-name">${known ? ITEMS[id].name : '？？？'}</span>
        </button>`;
      }).join('');
    }

    Modal.setBody(`
      <div class="zk-tabs">
        <button data-tab="monster" class="${this.tab === 'monster' ? 'active' : ''}">モンスター ${knownEnemies}/${enemyIds.length}</button>
        <button data-tab="item" class="${this.tab === 'item' ? 'active' : ''}">アイテム ${knownItems}/${itemIds.length}</button>
      </div>
      <div class="zk-progress"><div style="width:${(this.tab === 'monster' ? knownEnemies / enemyIds.length : knownItems / itemIds.length) * 100}%"></div></div>
      <div class="zk-grid">${grid}</div>
      <p class="modal-note">タップすると詳しく見られます。まだ見つけていないものは、手がかりだけ表示されます。</p>`);

    const body = document.getElementById('modal-body');
    for (const btn of body.querySelectorAll('.zk-tabs button')) {
      btn.addEventListener('click', () => { this.tab = btn.dataset.tab; this.renderList(); });
    }
    for (const cell of body.querySelectorAll('.zk-cell')) {
      cell.addEventListener('click', () => {
        if (cell.dataset.kind === 'monster') this.showMonster(cell.dataset.id);
        else this.showItem(cell.dataset.id);
      });
    }
  },

  // ---- 敵の詳細 ----
  showMonster(id) {
    const e = ENEMIES[id];
    const rec = gameState.bestiary[id];
    let html;
    if (!rec) {
      html = `
        <div class="zk-detail unknown">
          <div class="zk-big">${e.image ? `<img src="${e.image}" alt="">` : ''}</div>
          <div class="zk-dname">？？？</div>
          <p class="zk-hint">手がかり：${this.enemyHint(id)}</p>
          <p class="modal-note">倒すと図鑑に登録されます。</p>
        </div>`;
    } else {
      const traits = (e.traits || []).filter(t => TRAIT_INFO[t.type]).map(t => {
        const info = TRAIT_INFO[t.type];
        return `<li>${info.icon} <b>${t.label || info.name}</b>：${info.desc(t)}</li>`;
      }).join('');
      // 使う技（行動パターンに出てくるもの）
      const skillIds = [...new Set((e.ai || []).map(a => a.skill))];
      const skills = skillIds.map(s => `<li><b>${SKILLS[s].name}</b>${SKILLS[s].danger ? ' ⚠' : ''}：${SKILLS[s].desc || ''}</li>`).join('');
      html = `
        <div class="zk-detail">
          <div class="zk-big">${e.image ? `<img src="${e.image}" alt="">` : ''}</div>
          <div class="zk-dname">${e.name}${e.type === 'boss' ? ' <span class="zk-tag">BOSS</span>' : ''}</div>
          <div class="zk-sub">${ENEMY_TYPE_LABELS[e.type] || ''}　出現：${this.enemyHint(id)}</div>
          <table class="zk-stats">
            <tr><th>HP</th><td>${e.hp}</td><th>攻撃</th><td>${e.atk}</td></tr>
            <tr><th>防御</th><td>${e.def}</td><th>速さ</th><td>${e.spd}</td></tr>
          </table>
          <p class="modal-note">※ ステータスは1階での基準値。深い階ほど強くなります。</p>
          <table class="zk-stats">
            <tr><th>倒した数</th><td>${rec.kills}体</td><th>初めて倒した階</th><td>${rec.firstFloor}階</td></tr>
          </table>
          ${traits ? `<div class="detail-sec">特殊能力</div><ul class="detail-list">${traits}</ul>` : ''}
          ${skills ? `<div class="detail-sec">使う技</div><ul class="detail-list">${skills}</ul>` : ''}
        </div>`;
    }
    this.showDetail(html);
  },

  // ---- アイテムの詳細 ----
  showItem(id) {
    const item = ITEMS[id];
    const known = gameState.discovered.includes(id);
    const owned = inventoryCounts()[id] || 0;
    const equipped = Object.keys(gameState.equips).filter(c => gameState.equips[c].includes(id)).map(c => CHARACTERS[c].name);
    const recipe = RECIPES.find(r => r.result === id);
    const recipeHtml = recipe
      ? `<div class="zk-recipe">${itemIcon(recipe.items[0], 'sm')} ＋ ${itemIcon(recipe.items[1], 'sm')} → ${itemIcon(id, 'sm', !known)}${recipe.items[0] === recipe.items[1] ? ' <span class="kiwami">極</span>' : ''}</div>`
      : '';
    // この下級アイテムを素材に使う上級アイテム（見つけたものだけ名前を出す）
    const usedIn = item.tier === 1
      ? RECIPES.filter(r => r.items.includes(id)).map(r => (gameState.discovered.includes(r.result) ? ITEMS[r.result].name : '？？？'))
      : [];
    const html = known ? `
      <div class="zk-detail">
        <div class="zk-big">${itemIcon(id, 'lg')}</div>
        <div class="zk-dname">${itemLabel(id)}</div>
        <div class="zk-sub">${item.tier === 2 ? '上級アイテム' : '下級アイテム'}</div>
        <p class="zk-desc">${item.desc}</p>
        <table class="zk-stats">
          <tr><th>所持</th><td>${owned}個</td><th>装備中</th><td>${equipped.length ? equipped.join('・') : 'なし'}</td></tr>
        </table>
        ${recipeHtml ? `<div class="detail-sec">作り方</div>${recipeHtml}` : ''}
        ${usedIn.length ? `<div class="detail-sec">この素材で作れる上級アイテム（${usedIn.length}種）</div><p class="zk-used">${usedIn.join('、')}</p>` : ''}
      </div>` : `
      <div class="zk-detail unknown">
        <div class="zk-big">${itemIcon(id, 'lg', true)}</div>
        <div class="zk-dname">？？？</div>
        <p class="zk-hint">手がかり：${this.itemHint(id)}</p>
        ${recipeHtml}
        <p class="modal-note">手に入れると図鑑に登録されます。</p>
      </div>`;
    this.showDetail(html);
  },

  showDetail(html) {
    Modal.setBody(`<button class="zk-back" type="button">← 一覧にもどる</button>${html}`);
    document.querySelector('#modal-body .zk-back').addEventListener('click', () => this.renderList());
  },
};

document.getElementById('zukan-btn').addEventListener('click', () => Zukan.open());
