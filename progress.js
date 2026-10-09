// =====================================================================
// progress.js  ―  戦闘の外の成長要素（全体レベル・ポイント・強化・出撃枠・アイテム）
// 数値の設定は data.js の PROGRESSION にあります。
// =====================================================================
'use strict';

const SAVE_KEY = 'turnBattleSave';
const SAVE_VERSION = 2;                   // セーブデータの版（形が変わるたびに上げて、移行処理を足す）
const BACKUP_KEY = 'save_backup_v1';      // 移行の前の元データ（設定画面から戻せる）
// 51階以降が新しくなり、2周目がなくなったとき（版1 → 2）の移行の設定
const MIGRATION_V2 = {
  restartFloor: 51,         // 対象の人は、今いる階・チェックポイントをここにする
  baseFloor: 50,            // 補償の計算：以前の到達度 ＝ 1周目の最高到達階 − 50（2周目の人は ＋ 2周目の最高到達階 ＋ 50）
  pointsPer10: 20,          // 到達度10ごとのポイント
  itemsPer10: 1,            // 到達度10ごとの上級アイテム選択の回数
  title: '先駆者',          // 称号
  veteranTitle: '歴戦の先駆者', // 2周目以降だった人の称号
};

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
    // オートバトル・戦闘速度・ステータスを常に表示・軽量モード（null ＝ 自動：スマホなら ON）
    settings: { auto: false, speed: 1, showStats: false, lite: null },
    lastSaved: null,  // 最後に保存した時刻（放置経験値の計算に使う）
    inventory: [],      // 所持品（装備していないアイテムのID。同じものは複数並ぶ）
    equips: {},         // 装備 { キャラID: [アイテムID, ...]（最大 ITEM_CONFIG.slotsPerChar 個） }
    pendingRewards: [], // まだ選んでいない報酬 [[アイテムID × 5], ...]
    discovered: [],     // 一度でも手に入れたアイテム（合成図鑑・📖図鑑で表示する）
    legendBest: {},     // 特級装備：系統ごとに入手した最高ランク { sword: 3, ... }（📖図鑑）
    saveVersion: SAVE_VERSION, // セーブデータの版（古ければ読み込み時に移行する）
    titles: [],         // 称号（名前の横に表示。例：先駆者）
    oldMaxFloor: 0,     // アップデート前の最高到達階（記録として表示）
    oldRecord: null,    // アップデート前の旧記録 { maxFloor, cycle, cycleFloor }（図鑑・記録画面に表示）
    endlessUnlocked: false, // 無限モードが解放されたか（100階クリアで解放）
    endlessBest: 0,     // 無限モードの最高到達階
    noticeVersion: 0,   // アップデートのお知らせをどの版まで見たか
    bestiary: {},       // 倒した敵の記録 { 敵ID: { kills: 倒した数, firstFloor: 初めて倒した階 } }（📖図鑑）
    endingShown: false, // 真のエンディングを見たか
    partsShown: [],     // 「第○部クリア」を見た階（DUNGEON.partClears のキー）
    endingFloor: DUNGEON.finalFloor, // エンディングの階（最終ボスの階が変わったときの引き継ぎ用）
    towerWipes: {},     // 神々の塔で全滅した回数 { 階: 回数 }（ボスのHPが下がる救済措置）
    playSeconds: 0,     // 遊んだ時間（秒。画面を開いている間だけ数える）
    totalWipes: 0,      // 全滅した回数の合計（エンディングの記録）
    tutorialSeen: false, // 遊び方の説明を見たか（初回だけ自動で表示）
    bestFloor: 1,       // これまでの最高到達階（減らない。ランキングに使う）
    nickname: '',       // ランキングに出す名前
  };
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

// ---------------------------------------------------------------------
// セーブデータの移行（古い版のデータを今の形にする）
// ---------------------------------------------------------------------
// 版1 → 2：51〜100階が新しくなったので、51階より上にいた人は51階から再スタート（育成・アイテムはそのまま）
// 補償：以前の最高到達階が51階以上なら、10階ごとにポイントと上級アイテム選択、称号「先駆者」
function migrateV1toV2(s) {
  const m = MIGRATION_V2;
  const cycle = s.cycle || 1;
  const floor = s.floor || 1;
  const curMax = s.maxFloor || 1;
  // 対象：2周目以降の人、または51階以上にいる（いた）人。それ以外は新しい項目を足すだけ
  const target = cycle >= 2 || floor >= m.restartFloor || curMax >= m.restartFloor;
  // 1周目の最高到達階：2周目以降なら、周回しても減らない記録（bestFloor）が1周目の到達階
  const firstMax = cycle >= 2 ? Math.max(s.bestFloor || 1, curMax) : curMax;
  const info = { target, cycle, firstMax, cycleFloor: cycle >= 2 ? curMax : 0, progress: 0, points: 0, items: 0, title: null };
  delete s.cycle; // 周回はなくなった
  if (target) {
    // 以前の到達度
    info.progress = Math.max(0, firstMax - m.baseFloor) + (cycle >= 2 ? curMax + m.baseFloor : 0);
    const tens = Math.floor(info.progress / 10);
    info.points = tens * m.pointsPer10;
    info.items = tens * m.itemsPer10;
    // 旧記録（図鑑・記録画面に残す）
    s.oldRecord = { maxFloor: firstMax, cycle, cycleFloor: info.cycleFloor };
    s.oldMaxFloor = firstMax;
    // 51階から再スタート（新しい51〜100階をもう一度楽しめるよう、最高到達階も51階に）
    s.floor = m.restartFloor;
    s.checkpoint = m.restartFloor;
    s.maxFloor = m.restartFloor;
    s.bestFloor = Math.max(s.bestFloor || 1, firstMax); // ランキングの記録は減らさない
    s.endingShown = false;                               // 100階の真のエンディングは未閲覧
    s.points = (s.points || 0) + info.points;
    const high = Object.keys(ITEMS).filter(id => ITEMS[id].tier === 2);
    s.pendingRewards = Array.isArray(s.pendingRewards) ? s.pendingRewards : [];
    for (let i = 0; i < info.items; i++) {
      s.pendingRewards.push(high.slice().sort(() => Math.random() - 0.5).slice(0, ITEM_CONFIG.rewardChoices));
    }
    info.title = cycle >= 2 ? m.veteranTitle : m.title;
    s.titles = Array.isArray(s.titles) ? s.titles : [];
    if (!s.titles.includes(info.title)) s.titles.push(info.title);
  }
  s.migrationNotice = info; // 次の起動時に1回だけお知らせを出す
  s.saveVersion = 2;
  return s;
}
// 古い版なら移行する（移行の前に元のデータをバックアップ）。失敗したら元のデータのまま返す
function migrateSave(saved) {
  if (!saved || typeof saved !== 'object') return saved;
  const version = saved.saveVersion || 1;
  if (version >= SAVE_VERSION) return saved;
  try {
    if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, JSON.stringify(saved));
  } catch (e) { /* バックアップを保存できなくても続行 */ }
  let s = JSON.parse(JSON.stringify(saved));
  if (version < 2) s = migrateV1toV2(s);
  return s;
}

// バックアップがあるか（設定画面の「アップデート前のデータに戻す」ボタン用）
function hasSaveBackup() {
  try { return !!localStorage.getItem(BACKUP_KEY); } catch (e) { return false; }
}

// バックアップ（アップデート前のデータ）に戻す。戻したデータは移行しない（51階より上でもそのまま遊ぶ）
function restoreSaveBackup() {
  const raw = localStorage.getItem(BACKUP_KEY);
  if (!raw) return false;
  const data = JSON.parse(raw);
  data.saveVersion = SAVE_VERSION;
  data.restoredFromBackup = true;
  applySaveData(data);
  saveGame(); // 保存時刻を今にする（クラウドの古いデータで上書きされないように）
  return true;
}

// セーブデータ（ブラウザ・クラウドのどちらから読んだものでも）を gameState にする
// 古い版なら移行する。移行や読み込みでエラーが起きたら、元のデータのまま読み込み直す
function applySaveData(saved) {
  let migrated;
  try {
    migrated = migrateSave(saved);
    applySaveDataRaw(migrated);
    if (migrated !== saved) saveGame(); // 移行したら新しい版で保存
  } catch (e) {
    console.error('セーブデータの移行に失敗しました。元のデータで続けます', e);
    if (typeof showToast === 'function') showToast('⚠ データの移行に失敗したため、アップデート前のデータで続けます');
    applySaveDataRaw(saved);
    // 版は元のまま（次に開いたとき、もう一度移行を試す）
    if (saved && typeof saved === 'object') gameState.saveVersion = saved.saveVersion || 1;
  }
}

// 足りない項目は初期値で補い、data.js / items.js から消えたキャラやアイテムは取り除く
function applySaveDataRaw(saved) {
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
  // ランキング用の最高到達階（減らない）
  gameState.bestFloor = Math.max(gameState.bestFloor || 1, gameState.maxFloor || 1);

  // 最終ボスの階が変わった（50階 → 70階 → 100階）古いセーブデータ：
  // 以前のエンディングを見ていたら、その階の「第○部クリア」を見た扱いにし、新しいエンディングはまだ見ていない扱いにする
  if (saved && saved.endingFloor !== DUNGEON.finalFloor) {
    const oldFinal = saved.endingFloor || 50; // endingFloor が無いのは50階がエンディングだったころのデータ
    const shown = new Set(Array.isArray(saved.partsShown) ? saved.partsShown : []);
    for (const f of Object.keys(DUNGEON.partClears).map(Number)) {
      const sawOldEnding = !!saved.endingShown && f === oldFinal;
      const sawPart1 = f === 50 && !!saved.part1Shown;
      if (sawOldEnding || sawPart1 || gameState.maxFloor > f) shown.add(f);
    }
    gameState.partsShown = [...shown];
    gameState.endingShown = gameState.maxFloor > DUNGEON.finalFloor;
    gameState.endingFloor = DUNGEON.finalFloor;
  }
  if (!Array.isArray(gameState.partsShown)) gameState.partsShown = [];
  if (!gameState.legendBest || typeof gameState.legendBest !== 'object') gameState.legendBest = {};
  // 装備枠：多すぎる分は所持品に戻す（枠を減らしたときのため）
  for (const id in gameState.equips) {
    const extra = gameState.equips[id].splice(ITEM_CONFIG.slotsPerChar);
    gameState.inventory.push(...extra);
  }
  if (!gameState.towerWipes || typeof gameState.towerWipes !== 'object') gameState.towerWipes = {};
  delete gameState.part1Shown;
  delete gameState.cycle; // 周回はなくなった
}

// 旧記録（アップデート前の記録）の文章。無ければ ''
function oldRecordText() {
  const r = gameState.oldRecord;
  if (!r) return gameState.oldMaxFloor ? `アップデート前の最高到達階 ${gameState.oldMaxFloor}階` : '';
  return `アップデート前：最高 ${r.maxFloor}階${r.cycle >= 2 ? `（${r.cycle}周目 ${r.cycleFloor}階まで）` : ''}`;
}

// 総撃破数（図鑑の記録の合計）
function totalKills() {
  return Object.values(gameState.bestiary || {}).reduce((s, r) => s + (r.kills || 0), 0);
}

// 📖図鑑：敵を倒したことを記録する。初めて倒したなら true を返す
function recordDefeat(enemyId, floor) {
  if (!ENEMIES[enemyId]) return false;
  const rec = gameState.bestiary[enemyId];
  if (rec) {
    rec.kills++;
    return false;
  }
  gameState.bestiary[enemyId] = { kills: 1, firstFloor: floor };
  return true;
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

// ボス撃破の報酬：上級アイテムだけの中から1個選べる（count：並べる数。無限モードは2つ）
function grantBossReward(count = ITEM_CONFIG.rewardChoices) {
  const high = Object.keys(ITEMS).filter(id => ITEMS[id].tier === 2);
  const choices = high.slice().sort(() => Math.random() - 0.5).slice(0, count);
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
// アイテム：経験値に変換（🎒ボタンから）
// ---------------------------------------------------------------------
// 1個あたりの経験値（今の全体レベルで次のレベルまでに必要な経験値 × 割合。レベルが上がっても価値が下がらない）
function itemExpValue(itemId) {
  const rate = ITEM_CONFIG.expRate[ITEMS[itemId].tier] || 0;
  return Math.max(1, Math.round(expToNext(gameState.globalLevel) * rate));
}

// 変換する。picks = { アイテムID: 個数 }。所持品から減らして経験値を得る
// 戻り値：{ count: 変換した個数, exp, levels, points }
function convertItemsToExp(picks) {
  let exp = 0;
  let count = 0;
  for (const id in picks) {
    for (let i = 0; i < picks[id]; i++) {
      const idx = gameState.inventory.indexOf(id);
      if (idx === -1) break;
      exp += itemExpValue(id); // 1個ずつ計算（途中でレベルが上がっても、選んだときの値と同じになるよう先に合計）
      gameState.inventory.splice(idx, 1);
      count++;
    }
  }
  const gained = exp > 0 ? gainExp(exp) : { levels: 0, points: 0 };
  saveGame();
  return { count, exp, ...gained };
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
// アイテム：特級合成（上級3つ → 特級1つ。系統とランクは items.js の LEGEND で決まる）
// ---------------------------------------------------------------------
// 所持品だけで、この上級3つを用意できるか
function hasItems(ids) {
  const counts = inventoryCounts();
  const need = {};
  for (const id of ids) need[id] = (need[id] || 0) + 1;
  return Object.keys(need).every(id => (counts[id] || 0) >= need[id]);
}

// 特級合成する。family：同数で並んだときに選んだ系統（下級素材のID）。できた特級装備のIDを返す
function craftLegend(highIds, family) {
  if (highIds.length !== 3 || !highIds.every(id => ITEMS[id] && ITEMS[id].tier === 2) || !hasItems(highIds)) return null;
  const pv = legendPreview(highIds);
  const base = pv.candidates.includes(family) ? family : pv.candidates[0];
  if (!base) return null;
  for (const id of highIds) gameState.inventory.splice(gameState.inventory.indexOf(id), 1);
  const made = legendId(base, pv.rank);
  gameState.inventory.push(made);
  markDiscovered(made);
  // 図鑑：系統ごとに入手した最高ランクを記録
  const key = LEGEND.families[base].key;
  gameState.legendBest[key] = Math.max(gameState.legendBest[key] || 0, pv.rank);
  saveGame();
  return made;
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
