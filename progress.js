// =====================================================================
// progress.js  ―  戦闘の外の成長要素（全体レベル・ポイント・強化・出撃枠・アイテム）
// 数値の設定は data.js の PROGRESSION にあります。
// =====================================================================
'use strict';

const SAVE_KEY = 'turnBattleSave';

// ---------------------------------------------------------------------
// ゲーム全体の状態（ブラウザに自動保存される）
// ---------------------------------------------------------------------
let gameState = newGameState();

function newGameState() {
  return {
    globalLevel: 1,   // 全体レベル
    exp: 0,           // 次の全体レベルに向けてたまっている経験値
    points: 0,        // 残りポイント（全キャラ共通）
    party: [],        // 仲間になっているキャラ（CHARACTERS のキー）
    slots: PROGRESSION.startSlots, // 出撃枠
    sortie: [],       // 出撃メンバー（party の中から slots 人まで）
    chars: {},        // キャラごとの強化状況 { upgrades: {hp,atk,def,spd の強化回数}, spent: 使ったポイント合計 }
    floor: 1,         // 現在の階
    maxFloor: 1,      // 最高到達階
    checkpoint: 1,    // 全滅時に戻る階
    settings: { auto: false, speed: 1 }, // オートバトルと戦闘速度
    lastSaved: null,  // 最後に保存した時刻（放置経験値の計算に使う）
    inventory: [],      // 所持品（装備していないアイテムのID。同じものは複数並ぶ）
    equips: {},         // 装備 { キャラID: [アイテムID, ...]（最大 ITEM_CONFIG.slotsPerChar 個） }
    pendingRewards: [], // まだ選んでいない報酬 [[アイテムID × 5], ...]
    discovered: [],     // 一度でも手に入れたアイテム（合成図鑑で表示する）
    cycle: 1,           // 何周目か（最終ボスを倒すと次の周へ進める）
    endingShown: false, // この周でエンディングを見たか
    tutorialSeen: false, // 遊び方の説明を見たか（初回だけ自動で表示）
    bestFloor: 1,       // これまでの最高到達階（周回しても減らない。ランキングに使う）
    nickname: '',       // ランキングに出す名前
  };
}

// 次の周へ（レベル・ポイント・強化・仲間・アイテムはそのまま、1階から。敵が強くなる）
function startNewCycle() {
  gameState.cycle++;
  gameState.floor = 1;
  gameState.maxFloor = 1;
  gameState.checkpoint = 1;
  gameState.endingShown = false;
  saveGame();
}

// 仲間を加える。出撃枠に空きがあれば出撃メンバーにも入れる（空きが無ければ控え）
// 戻り値：出撃メンバーに入ったら true
function addPartyMember(id) {
  if (!CHARACTERS[id] || gameState.party.includes(id)) return false;
  gameState.party.push(id);
  gameState.chars[id] = gameState.chars[id] || { upgrades: { hp: 0, atk: 0, def: 0, spd: 0 }, spent: 0 };
  if (gameState.sortie.length < gameState.slots) {
    gameState.sortie.push(id);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------
// 仲間の加入条件（data.js の各キャラの join）
// ---------------------------------------------------------------------
// 最初から仲間のキャラ（join が書かれていない）
function startingMembers() {
  return Object.keys(CHARACTERS).filter(id => !CHARACTERS[id].join);
}

// 加入条件を満たしているか
function isJoinMet(join) {
  if (!join) return true;
  if (join.reachFloor && gameState.maxFloor < join.reachFloor) return false;
  // ボス階を倒すと次の階へ進むので「最高到達階がボス階より深い」= 倒した
  if (join.defeatBoss && gameState.maxFloor <= join.defeatBoss) return false;
  return true;
}

// 加入条件の説明文（強化画面で未加入キャラに表示）
function joinConditionText(join) {
  const texts = [];
  if (join.reachFloor) texts.push(`ダンジョン${join.reachFloor}階に到達`);
  if (join.defeatBoss) {
    const names = bossEnemies(join.defeatBoss).map(id => ENEMIES[id].name).join('・');
    texts.push(`${join.defeatBoss}階のボス（${names}）を倒す`);
  }
  return texts.join('、');
}

// 条件を満たした未加入キャラを仲間にする。新しく加入したキャラの一覧を返す
// [{ id, inSortie: 出撃メンバーに入ったか }]
function checkRecruits() {
  const joined = [];
  for (const id of Object.keys(CHARACTERS)) {
    if (gameState.party.includes(id) || !isJoinMet(CHARACTERS[id].join)) continue;
    joined.push({ id, inSortie: addPartyMember(id) });
  }
  if (joined.length) saveGame();
  return joined;
}

// ---------------------------------------------------------------------
// 保存・読み込み（localStorage が使えない環境では保存しないだけで動く）
// ---------------------------------------------------------------------
function saveGame() {
  gameState.lastSaved = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(gameState)); } catch (e) { /* 保存できなくても続行 */ }
}

// 定期的に保存し、閉じるときにも保存する（放置時間を正しく測るため）
setInterval(saveGame, 30000);
window.addEventListener('beforeunload', saveGame);

function loadGame() {
  let saved = null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) {
    saved = null;
  }
  applySaveData(saved);
}

// セーブデータ（ブラウザ・クラウドのどちらから読んだものでも）を gameState にする
// 足りない項目は初期値で補い、data.js / items.js から消えたキャラやアイテムは取り除く
function applySaveData(saved) {
  gameState = newGameState();
  if (saved && typeof saved === 'object') {
    gameState = Object.assign(newGameState(), saved);
    gameState.settings = Object.assign(newGameState().settings, saved.settings);
  }
  // data.js から消えたキャラは除外し、最初から仲間のキャラ（join なし）は加える
  // ※ 条件を満たした仲間の加入は、ポップアップを出すため main.js 側で checkRecruits() を呼ぶ
  gameState.party = gameState.party.filter(id => CHARACTERS[id]);
  for (const id of gameState.party) {
    gameState.chars[id] = gameState.chars[id] || { upgrades: { hp: 0, atk: 0, def: 0, spd: 0 }, spent: 0 };
  }
  gameState.sortie = gameState.sortie.filter(id => gameState.party.includes(id)).slice(0, gameState.slots);
  startingMembers().forEach(addPartyMember);
  if (gameState.sortie.length === 0 && gameState.party.length > 0) gameState.sortie.push(gameState.party[0]);

  // items.js から消えたアイテムは除外
  gameState.inventory = gameState.inventory.filter(id => ITEMS[id]);
  for (const id in gameState.equips) gameState.equips[id] = gameState.equips[id].filter(i => ITEMS[i]);
  gameState.pendingRewards = gameState.pendingRewards.map(set => set.filter(i => ITEMS[i])).filter(set => set.length);
  // 図鑑：今持っている・装備しているアイテムは「入手済み」にする（古いセーブデータ向け）
  gameState.inventory.forEach(markDiscovered);
  for (const id in gameState.equips) gameState.equips[id].forEach(markDiscovered);
  // ランキング用の最高到達階（周回してもリセットしない）
  gameState.bestFloor = Math.max(gameState.bestFloor || 1, gameState.maxFloor || 1);
}

// 図鑑に「入手済み」として記録する
function markDiscovered(itemId) {
  if (ITEMS[itemId] && !gameState.discovered.includes(itemId)) gameState.discovered.push(itemId);
}

function resetGame() {
  gameState = newGameState();
  startingMembers().forEach(addPartyMember);
  saveGame();
}

// ---------------------------------------------------------------------
// 放置経験値：前回保存してから今までの時間に応じて経験値を得る（上限あり）
// 何も無ければ null、あれば { minutes, exp, levels, points } を返す
// ---------------------------------------------------------------------
function applyOfflineProgress() {
  if (!gameState.lastSaved) return null;
  const elapsedMin = (Date.now() - gameState.lastSaved) / 60000;
  const minutes = Math.floor(Math.min(elapsedMin, IDLE.maxHours * 60));
  if (minutes < IDLE.minMinutes) return null;

  // 最高到達階が深いほど、1分あたりの経験値が増える
  const exp = Math.floor(minutes * IDLE.expPerMinute * floorExpScale(gameState.maxFloor));
  if (exp <= 0) return null;
  const gained = gainExp(exp);
  return { minutes, exp, ...gained };
}

// ---------------------------------------------------------------------
// 全体レベルと経験値
// ---------------------------------------------------------------------
function expToNext(level) {
  const e = PROGRESSION.expToNext;
  return e.base + e.perLevel * (level - 1);
}

// 経験値を加える。上がったレベル数ともらったポイントを返す
function gainExp(amount) {
  let levels = 0;
  gameState.exp += amount;
  while (gameState.exp >= expToNext(gameState.globalLevel)) {
    gameState.exp -= expToNext(gameState.globalLevel);
    gameState.globalLevel++;
    levels++;
  }
  const points = levels * PROGRESSION.pointsPerLevel;
  gameState.points += points;
  saveGame();
  return { levels, points };
}

// ---------------------------------------------------------------------
// キャラのステータス強化
// ---------------------------------------------------------------------
// 次にそのステータスを強化するのに必要なポイント
function upgradeCost(id, stat) {
  const count = gameState.chars[id].upgrades[stat];
  const p = PROGRESSION;
  return p.statUpgrades[stat].cost + Math.floor(count / p.costStepEvery) * p.costStepAmount;
}

function canUpgrade(id, stat) {
  return gameState.points >= upgradeCost(id, stat);
}

function upgradeStat(id, stat) {
  if (!canUpgrade(id, stat)) return;
  const cost = upgradeCost(id, stat);
  const c = gameState.chars[id];
  gameState.points -= cost;
  c.spent += cost;
  c.upgrades[stat]++;
  saveGame();
}

// 振り直し：使ったポイントを全部戻す
function resetCharUpgrades(id) {
  const c = gameState.chars[id];
  gameState.points += c.spent;
  c.spent = 0;
  for (const s in c.upgrades) c.upgrades[s] = 0;
  saveGame();
}

// キャラLv（使ったポイント 5 ごとに +1）
function charLevel(id) {
  return 1 + Math.floor(gameState.chars[id].spent / PROGRESSION.pointsPerCharLevel);
}

// 強化込みのステータス
function charStats(id) {
  const t = CHARACTERS[id];
  const up = gameState.chars[id].upgrades;
  const result = {};
  for (const s of ['hp', 'atk', 'def', 'spd']) {
    result[s] = t[s] + up[s] * PROGRESSION.statUpgrades[s].gain;
  }
  return result;
}

// 強化＋装備込みのステータス（戦闘ではこれを使う）
function charTotalStats(id) {
  const s = charStats(id);
  const g = itemEffects(id).stats;
  for (const k in s) s[k] += g[k];
  return s;
}

// ---------------------------------------------------------------------
// アイテム：装備の効果
// ---------------------------------------------------------------------
// 装備中のアイテムの効果をまとめる
// { stats: {hp,atk,def,spd の加算}, bonus: {key: 合計値}, specials: [特殊効果の部品] }
function itemEffects(id) {
  const result = { stats: { hp: 0, atk: 0, def: 0, spd: 0 }, bonus: {}, specials: [] };
  for (const itemId of gameState.equips[id] || []) {
    for (const e of ITEMS[itemId].effects) {
      if (e.type === 'stat')    result.stats[e.stat] += e.value;
      if (e.type === 'bonus')   result.bonus[e.key] = (result.bonus[e.key] || 0) + e.value;
      if (e.type === 'special') result.specials.push(e);
    }
  }
  return result;
}

// ---------------------------------------------------------------------
// アイテム：装備の付け外し
// ---------------------------------------------------------------------
function equippedItems(charId) {
  return gameState.equips[charId] || [];
}

function equipItem(charId, itemId) {
  const list = gameState.equips[charId] = equippedItems(charId);
  const idx = gameState.inventory.indexOf(itemId);
  if (idx === -1 || list.length >= ITEM_CONFIG.slotsPerChar) return;
  gameState.inventory.splice(idx, 1);
  list.push(itemId);
  saveGame();
}

// 外したアイテムは所持品に戻る
function unequipItem(charId, slot) {
  const list = equippedItems(charId);
  const [itemId] = list.splice(slot, 1);
  if (itemId) gameState.inventory.push(itemId);
  saveGame();
}

// 所持品の数を数える { アイテムID: 個数 }
function inventoryCounts() {
  const counts = {};
  for (const id of gameState.inventory) counts[id] = (counts[id] || 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------
// アイテム：報酬（5階ごとのクリアで、ランダムな5個から1個選ぶ）
// ---------------------------------------------------------------------
function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function rollRewardChoices(floor) {
  const low = Object.keys(ITEMS).filter(id => ITEMS[id].tier === 1);
  const high = Object.keys(ITEMS).filter(id => ITEMS[id].tier === 2);
  // 下級アイテムを重ならないように並べ替えて先頭から取る
  const shuffled = low.slice().sort(() => Math.random() - 0.5);
  const choices = shuffled.slice(0, ITEM_CONFIG.rewardChoices);
  // 深い階では、たまに1個が上級アイテムになる
  if (floor >= ITEM_CONFIG.highTierFrom && high.length && Math.random() < ITEM_CONFIG.highTierChance) {
    choices[Math.floor(Math.random() * choices.length)] = randomPick(high);
  }
  return choices;
}

// 階をクリアしたとき、報酬の階なら選択待ちに追加する。追加したら true
function grantFloorReward(clearedFloor) {
  if (clearedFloor % ITEM_CONFIG.rewardEvery !== 0) return false;
  gameState.pendingRewards.push(rollRewardChoices(clearedFloor));
  saveGame();
  return true;
}

// 特別な報酬（ミミック・強化個体を倒したとき）：選択待ちに1回分追加
function grantBonusReward(floor) {
  gameState.pendingRewards.push(rollRewardChoices(floor));
  saveGame();
}

// ボス撃破の報酬：上級アイテムだけの中から1個選べる
function grantBossReward() {
  const high = Object.keys(ITEMS).filter(id => ITEMS[id].tier === 2);
  const choices = high.slice().sort(() => Math.random() - 0.5).slice(0, ITEM_CONFIG.rewardChoices);
  gameState.pendingRewards.push(choices);
  saveGame();
}

// 一番古い報酬から index 番目のアイテムを受け取る
function claimReward(index) {
  const set = gameState.pendingRewards.shift();
  if (!set) return null;
  gameState.inventory.push(set[index]);
  markDiscovered(set[index]);
  saveGame();
  return set[index];
}

// ---------------------------------------------------------------------
// アイテム：合成（レシピにある組み合わせだけ）
// ---------------------------------------------------------------------
// 2つのアイテムのレシピを探す（並び順は関係なし）。無ければ null
function findRecipe(a, b) {
  return RECIPES.find(r =>
    (r.items[0] === a && r.items[1] === b) || (r.items[0] === b && r.items[1] === a)) || null;
}

// 所持品だけで作れるか（同じアイテム2つのレシピなら2個必要）
function canCraft(recipe) {
  const counts = inventoryCounts();
  const need = {};
  for (const id of recipe.items) need[id] = (need[id] || 0) + 1;
  return Object.keys(need).every(id => (counts[id] || 0) >= need[id]);
}

function craft(recipe) {
  if (!canCraft(recipe)) return null;
  for (const id of recipe.items) gameState.inventory.splice(gameState.inventory.indexOf(id), 1);
  gameState.inventory.push(recipe.result);
  markDiscovered(recipe.result);
  saveGame();
  return recipe.result;
}

// ---------------------------------------------------------------------
// 出撃枠と出撃メンバー
// ---------------------------------------------------------------------
function maxSlots() {
  return PROGRESSION.startSlots + PROGRESSION.slotCosts.length;
}

// 次の枠の値段（上限なら null）
function nextSlotCost() {
  if (gameState.slots >= maxSlots()) return null;
  return PROGRESSION.slotCosts[gameState.slots - PROGRESSION.startSlots];
}

function buySlot() {
  const cost = nextSlotCost();
  if (cost === null || gameState.points < cost) return;
  gameState.points -= cost;
  gameState.slots++;
  saveGame();
}

// 出撃メンバーの入れ替え（最低1人は出撃、枠より多くは選べない）
function toggleSortie(id) {
  const s = gameState.sortie;
  if (s.includes(id)) {
    if (s.length > 1) s.splice(s.indexOf(id), 1);
  } else if (s.length < gameState.slots) {
    s.push(id);
  }
  saveGame();
}
