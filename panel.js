// =====================================================================
// panel.js  ―  バトル画面右側のパネル（行動順／強化／アイテム をタブで切り替え）
// どのタブを開いていても戦闘とダンジョン進行は止まらない。
// 強化・装備の変更は、戦闘中の味方にもすぐ反映される（syncBattleAllies）。
// =====================================================================
'use strict';

const Panel = {
  tab: 'order', // 'order'（行動順） / 'upgrade'（強化） / 'items'（アイテム） / 'log'（ログ）

  init() {
    for (const btn of document.querySelectorAll('#panel-tabs button')) {
      btn.addEventListener('click', () => this.setTab(btn.dataset.tab));
    }
    document.getElementById('reward-badge').addEventListener('click', () => this.setTab('items'));
    this.setTab('order');
  },

  setTab(name) {
    this.tab = name;
    ItemUI.message = '';
    const panel = document.getElementById('side-panel');
    panel.dataset.tab = name; // CSS で幅や位置を切り替える
    for (const btn of document.querySelectorAll('#panel-tabs button')) {
      btn.classList.toggle('active', btn.dataset.tab === name);
    }
    document.getElementById('order-list').classList.toggle('hidden', name !== 'order');
    document.getElementById('upgrade-root').classList.toggle('hidden', name !== 'upgrade');
    document.getElementById('item-root').classList.toggle('hidden', name !== 'items');
    document.getElementById('log-root').classList.toggle('hidden', name !== 'log');
    if (name === 'log') { const log = document.getElementById('log'); log.scrollTop = log.scrollHeight; }
    this.refresh();
  },

  // 開いているタブを描き直す（ポイントや報酬が増えたときにも呼ぶ）
  refresh() {
    if (this.tab === 'upgrade') UpgradeUI.render();
    if (this.tab === 'items') ItemUI.render();
    this.renderBadge();
  },

  // 未選択の報酬があれば「アイテムを選べます」バッジを出す
  renderBadge() {
    const n = gameState.pendingRewards.length;
    const header = document.getElementById('reward-badge');
    header.classList.toggle('hidden', n === 0);
    header.textContent = `🎁 アイテムを選べます（${n}）`;
    const tabBadge = document.getElementById('items-tab-badge');
    tabBadge.classList.toggle('hidden', n === 0);
    tabBadge.textContent = n;
  },
};

// 強化・装備などを変えたあとの共通処理
function afterProgressChange() {
  syncBattleAllies(); // 戦闘中の味方にもすぐ反映
  UI.renderHeader();
  Panel.refresh();
  Cloud.save('upgrade'); // 育成（強化・装備・合成など）したらクラウドへ保存
}

// 押したら処理して、変更を反映するボタン
function panelButton(label, disabled, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.disabled = disabled;
  btn.addEventListener('click', () => { onClick(); afterProgressChange(); });
  return btn;
}

// アイテム名（上級は色を変える）
function itemLabel(id) {
  const item = ITEMS[id];
  return `<span class="item-name tier${item.tier}">${item.name}</span>`;
}

// アイテムのアイコン（上級は金色の枠）。size: 'sm' / 'md' / 'lg'
// unknown: true なら図鑑の未入手（シルエット・名前を出さない）
// 画像が読み込めないときは、名前の1文字目を代わりに出す
function itemIcon(id, size = 'md', unknown = false) {
  const item = ITEMS[id];
  const initial = unknown ? '？' : item.name.charAt(0);
  const title = unknown ? '？？？' : `${item.name}：${item.desc}`;
  const inner = item.image
    ? `<img src="${item.image}" alt="" onerror="this.parentNode.classList.add('noimg');this.remove()">`
    : '';
  return `<span class="item-icon ${size} tier${item.tier}${item.image ? '' : ' noimg'}${unknown ? ' unknown' : ''}" data-initial="${initial}" title="${title}">${inner}</span>`;
}

// ---------------------------------------------------------------------
// 強化タブ
// ---------------------------------------------------------------------
const UpgradeUI = {
  root: document.getElementById('upgrade-root'),

  render() {
    this.root.innerHTML = '';

    // --- 残りポイント ---
    const head = document.createElement('div');
    head.className = 'upgrade-head';
    head.innerHTML = `<div class="points">残りポイント：<strong>${gameState.points}</strong></div>`;
    this.root.appendChild(head);

    // --- 出撃枠 ---
    const slotBox = document.createElement('div');
    slotBox.className = 'slot-box';
    const cost = nextSlotCost();
    slotBox.innerHTML = `出撃枠：${gameState.slots} / ${maxSlots()}　出撃：${gameState.sortie.length} / ${gameState.slots}<br>`;
    if (cost === null) {
      slotBox.append('（最大）');
    } else {
      slotBox.appendChild(panelButton(`枠を増やす（${cost}pt）`, gameState.points < cost, () => buySlot()));
    }
    const note = document.createElement('div');
    note.className = 'panel-note';
    note.textContent = '※ 出撃メンバーの入れ替えは次の階から。強化・装備はすぐ反映されます。';
    slotBox.appendChild(note);
    this.root.appendChild(slotBox);

    // --- キャラ一覧（加入済みは強化カード、未加入はシルエット） ---
    const list = document.createElement('div');
    list.className = 'char-list';
    for (const id of Object.keys(CHARACTERS)) {
      list.appendChild(gameState.party.includes(id) ? this.charCard(id) : this.lockedCard(id));
    }
    this.root.appendChild(list);

    // --- データ初期化 ---
    const reset = document.createElement('button');
    reset.textContent = 'データを初期化';
    reset.className = 'danger';
    reset.addEventListener('click', () => {
      if (confirm('全体レベル・ポイント・強化・到達階・アイテムをすべて最初に戻します。よろしいですか？')) {
        restartFromScratch();
      }
    });
    this.root.appendChild(reset);
  },

  // キャラ1人分のカード
  charCard(id) {
    const t = CHARACTERS[id];
    const c = gameState.chars[id];
    const total = charTotalStats(id);
    const gear = itemEffects(id).stats;
    const inSortie = gameState.sortie.includes(id);

    const card = document.createElement('div');
    card.className = 'char-card' + (inSortie ? ' sortie' : '');
    card.innerHTML = `
      ${t.image ? `<img class="portrait" src="${t.image}" alt="${t.name}">` : ''}
      <div class="name">${t.name}　Lv${charLevel(id)}</div>
      <div class="sub">${ROLE_LABELS[t.role] || ''}　使用ポイント ${c.spent}</div>`;

    // 出撃チェック（枠がいっぱいなら新しくは選べない／最後の1人は外せない）
    const label = document.createElement('label');
    label.className = 'sortie-check';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = inSortie;
    check.disabled = inSortie
      ? gameState.sortie.length <= 1
      : gameState.sortie.length >= gameState.slots;
    check.addEventListener('change', () => { toggleSortie(id); afterProgressChange(); });
    label.append(check, ' 出撃する');
    if (!inSortie && gameState.sortie.length >= gameState.slots) {
      const hint = document.createElement('span');
      hint.className = 'sortie-hint';
      hint.textContent = '（出撃枠がいっぱい）';
      label.appendChild(hint);
    }
    card.appendChild(label);

    // ステータス（合計値と内訳：緑 = 強化、青 = 装備）と「＋」ボタン
    const table = document.createElement('table');
    table.className = 'stat-table';
    for (const s of ['hp', 'atk', 'def', 'spd']) {
      const up = PROGRESSION.statUpgrades[s];
      const fromUp = c.upgrades[s] * up.gain;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <th>${STAT_LABELS[s]}</th>
        <td class="val">${total[s]}</td>
        <td class="bonus">${fromUp > 0 ? `+${fromUp}` : ''}${gear[s] > 0 ? ` <span class="gear-bonus">+${gear[s]}</span>` : ''}</td>`;
      const td = document.createElement('td');
      td.className = 'up';
      td.appendChild(panelButton(`＋${up.gain}`, !canUpgrade(id, s), () => upgradeStat(id, s)));
      td.append(` ${upgradeCost(id, s)}pt`);
      tr.appendChild(td);
      table.appendChild(tr);
    }
    card.appendChild(table);

    // 装備中のアイテム（効果の説明つき）
    const equips = equippedItems(id);
    const eq = document.createElement('div');
    eq.className = 'equip-summary';
    eq.innerHTML = `<div class="equip-title">装備（${equips.length}/${ITEM_CONFIG.slotsPerChar}）</div>` +
      (equips.length
        ? equips.map(i => `<div class="icon-row">${itemIcon(i, 'sm')}<span>${itemLabel(i)}：${ITEMS[i].desc}</span></div>`).join('')
        : '<div class="panel-note">なし（「アイテム」タブで装備）</div>');
    card.appendChild(eq);

    // 振り直し
    card.appendChild(panelButton('振り直し', c.spent === 0, () => {
      if (confirm(`${t.name}に使った ${c.spent} ポイントを全部戻します。よろしいですか？`)) resetCharUpgrades(id);
    }));
    return card;
  },

  // 未加入キャラのカード（シルエット＋「？？？」＋加入条件）
  lockedCard(id) {
    const t = CHARACTERS[id];
    const card = document.createElement('div');
    card.className = 'char-card locked';
    card.innerHTML = `
      ${t.image ? `<img class="portrait" src="${t.image}" alt="">` : ''}
      <div class="name">？？？</div>
      <div class="join-cond">加入条件：${joinConditionText(t.join)}</div>`;
    return card;
  },
};

// ---------------------------------------------------------------------
// アイテムタブ（報酬の受け取り・装備・所持品・合成）
// ---------------------------------------------------------------------
const ItemUI = {
  root: document.getElementById('item-root'),
  message: '', // 合成の結果などのお知らせ

  render() {
    this.root.innerHTML = '';
    this.renderRewards();
    this.renderEquips();
    this.renderInventory();
    this.renderCrafting();
  },

  section(title) {
    const sec = document.createElement('section');
    sec.className = 'item-section';
    sec.innerHTML = `<h3>${title}</h3>`;
    this.root.appendChild(sec);
    return sec;
  },

  // --- 報酬：5個から1個選ぶ（貯まっている分は古い順） ---
  renderRewards() {
    const pending = gameState.pendingRewards;
    if (pending.length === 0) return;
    const sec = this.section(`🎁 報酬を選ぶ（残り ${pending.length} 回）`);
    sec.classList.add('reward');
    const list = document.createElement('div');
    list.className = 'reward-list';
    pending[0].forEach((itemId, i) => {
      const btn = document.createElement('button');
      btn.className = `reward-choice tier${ITEMS[itemId].tier}`;
      btn.innerHTML = `${itemIcon(itemId, 'lg')}
        <span>${itemLabel(itemId)}${ITEMS[itemId].tier === 2 ? ' ★上級' : ''}<small>${ITEMS[itemId].desc}</small></span>`;
      btn.addEventListener('click', () => {
        const got = claimReward(i);
        this.message = `${ITEMS[got].name}を手に入れた！`;
        afterProgressChange();
      });
      list.appendChild(btn);
    });
    sec.appendChild(list);
  },

  // --- 装備：加入済みのキャラ全員（出撃していなくても装備できる） ---
  renderEquips() {
    const sec = this.section('装備');
    const counts = inventoryCounts();
    for (const charId of gameState.party) {
      const box = document.createElement('div');
      box.className = 'equip-box';
      box.innerHTML = `<div class="equip-char">${CHARACTERS[charId].name}${gameState.sortie.includes(charId) ? '' : '（控え）'}</div>`;
      const equips = equippedItems(charId);
      for (let slot = 0; slot < ITEM_CONFIG.slotsPerChar; slot++) {
        const row = document.createElement('div');
        row.className = 'equip-slot';
        const itemId = equips[slot];
        if (itemId) {
          // 装備中：アイコン＋名前、外すボタン
          row.innerHTML = `${itemIcon(itemId, 'md')}<span class="slot-text">${itemLabel(itemId)}<small>${ITEMS[itemId].desc}</small></span>`;
          row.appendChild(panelButton('外す', false, () => unequipItem(charId, slot)));
        } else {
          // 空き枠：点線の枠＋所持品から選んで装備
          row.insertAdjacentHTML('beforeend', '<span class="item-icon md empty"></span>');
          const select = document.createElement('select');
          select.innerHTML = '<option value="">― 空き（所持品から装備）―</option>' +
            Object.keys(counts).map(id => `<option value="${id}">${ITEMS[id].name} ×${counts[id]}</option>`).join('');
          select.disabled = Object.keys(counts).length === 0;
          select.addEventListener('change', () => {
            if (!select.value) return;
            equipItem(charId, select.value);
            afterProgressChange();
          });
          row.appendChild(select);
        }
        box.appendChild(row);
      }
      sec.appendChild(box);
    }
  },

  // --- 所持品（装備していないもの） ---
  renderInventory() {
    const sec = this.section('所持品');
    const counts = inventoryCounts();
    const ids = Object.keys(counts);
    if (ids.length === 0) {
      sec.insertAdjacentHTML('beforeend', '<div class="panel-note">なし（5階ごとのクリア報酬で手に入る）</div>');
      return;
    }
    for (const id of ids) {
      sec.insertAdjacentHTML('beforeend',
        `<div class="inv-row icon-row">${itemIcon(id, 'md')}<span>${itemLabel(id)} ×${counts[id]}<small>${ITEMS[id].desc}</small></span></div>`);
    }
  },

  // --- 合成：レシピ一覧（作れるものは光る）と、2つ選んで合成 ---
  renderCrafting() {
    const sec = this.section('合成');
    if (this.message) {
      sec.insertAdjacentHTML('beforeend', `<div class="craft-message">${this.message}</div>`);
    }

    // 2つ選んで合成（下級2つならどの組み合わせでも上級になる）
    const counts = inventoryCounts();
    const options = '<option value="">― 選ぶ ―</option>' +
      Object.keys(counts).map(id => `<option value="${id}">${ITEMS[id].name}</option>`).join('');
    const free = document.createElement('div');
    free.className = 'craft-free';
    const a = document.createElement('select');
    const b = document.createElement('select');
    a.innerHTML = options;
    b.innerHTML = options;
    const btn = document.createElement('button');
    btn.textContent = '合成';
    btn.addEventListener('click', () => {
      if (!a.value || !b.value) {
        this.message = '素材を2つ選んでください。';
      } else {
        const recipe = findRecipe(a.value, b.value);
        if (!recipe) this.message = 'その組み合わせのレシピはありません。';
        else this.doCraft(recipe);
      }
      afterProgressChange();
    });
    free.append(a, ' ＋ ', b, ' ', btn);
    sec.appendChild(free);

    // --- 合成図鑑（全レシピ。未入手はシルエットで素材だけ見せる） ---
    const found = RECIPES.filter(r => gameState.discovered.includes(r.result)).length;
    const head = document.createElement('div');
    head.className = 'zukan-head';
    head.innerHTML = `<span>📖 合成図鑑 <strong>${found}</strong> / ${RECIPES.length}</span>`;
    const filter = document.createElement('label');
    const onlyReady = document.createElement('input');
    onlyReady.type = 'checkbox';
    onlyReady.checked = this.onlyReady;
    onlyReady.addEventListener('change', () => { this.onlyReady = onlyReady.checked; this.render(); });
    filter.append(onlyReady, ' 作れるものだけ');
    head.appendChild(filter);
    sec.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'zukan-grid';
    // 今の所持品で合成できるものを上に（それ以外は図鑑の並び順のまま）
    const sorted = RECIPES
      .map((recipe, i) => ({ recipe, i, ready: canCraft(recipe) }))
      .sort((a, b) => (b.ready - a.ready) || (a.i - b.i));
    for (const { recipe, ready } of sorted) {
      if (this.onlyReady && !ready) continue;
      const known = gameState.discovered.includes(recipe.result);
      const [x, y] = recipe.items;
      const ultimate = x === y; // 同じ素材2つ ＝「極」
      const need = ultimate ? 2 : 1; // 同じ素材なら2個必要
      const card = document.createElement('div');
      card.className = 'zukan-card' + (ready ? ' ready' : '') + (known ? '' : ' unknown') + (ultimate ? ' ultimate' : '');
      // 素材のアイコンと所持数（足りない素材は薄く）
      const mat = id => `<span class="recipe-mat${(counts[id] || 0) >= need ? '' : ' missing'}">${itemIcon(id, 'sm')}<span class="have">${counts[id] || 0}</span></span>`;
      card.innerHTML = `
        ${ultimate ? '<span class="kiwami" title="同じ素材2つで作る究極の一品">極</span>' : ''}
        <div class="zukan-result">${itemIcon(recipe.result, 'md', !known)}</div>
        <div class="zukan-name">${known ? itemLabel(recipe.result) : '<span class="item-name unknown-name">？？？</span>'}</div>
        <div class="recipe-icons">${mat(x)}＋${mat(y)}</div>
        ${known ? `<small>${ITEMS[recipe.result].desc}</small>` : '<small>まだ作っていない</small>'}`;
      card.appendChild(panelButton('合成', !ready, () => this.doCraft(recipe)));
      grid.appendChild(card);
    }
    if (!grid.children.length) grid.innerHTML = '<div class="panel-note">今の所持品で作れるものはありません。</div>';
    sec.appendChild(grid);
  },
  onlyReady: false, // 図鑑で「作れるものだけ」表示するか

  doCraft(recipe) {
    if (!canCraft(recipe)) {
      this.message = '素材が足りません。';
      return;
    }
    const isNew = !gameState.discovered.includes(recipe.result);
    const made = craft(recipe);
    this.message = `${ITEMS[made].name}ができた！${isNew ? '（図鑑に登録）' : ''}`;
  },
};
