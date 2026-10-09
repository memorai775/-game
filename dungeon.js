// =====================================================================
// dungeon.js  ―  ダンジョン（階層）の処理
// 設定値は data.js の DUNGEON にあります。
// =====================================================================
'use strict';

function isBossFloor(floor) {
  return floor % DUNGEON.bossEvery === 0 || isTowerFloor(floor);
}

// 神々の塔の階か（1階に1体ずつボスが出る）
function isTowerFloor(floor) {
  const t = DUNGEON.tower;
  return !!t && !isEndless(floor) && floor >= t.from && floor <= t.to;
}

// 神々の塔で全滅した回数に応じたボスのHPの減り（救済措置）。0〜wipeHpCutMax
function towerHpCut(floor) {
  if (!isTowerFloor(floor)) return 0;
  const wipes = (gameState.towerWipes && gameState.towerWipes[floor]) || 0;
  return Math.min(DUNGEON.tower.wipeHpCutMax, wipes * DUNGEON.tower.wipeHpCut);
}

// 敵ステータスの倍率（1階 = 1.0、1階ごとに DUNGEON.statPerFloor ずつ上がる）
function floorStatScale(floor) {
  return 1 + DUNGEON.statPerFloor * (floor - 1);
}

// 獲得経験値の倍率
function floorExpScale(floor) {
  return 1 + DUNGEON.expPerFloor * (floor - 1);
}

// 無限モード（決まったエリアが全部終わった先）か
function isEndless(floor) {
  return floor >= DUNGEON.endlessFrom;
}

// その階のエリア（data.js の AREAS）
function areaOf(floor) {
  const list = AREAS.filter(a => floor >= a.from);
  return list[list.length - 1];
}

// その階の背景画像（無限モードは5枚を10階ごとに順番に：51〜60階が1枚目、61〜70階が2枚目…）
function backgroundOf(floor) {
  const area = areaOf(floor);
  if (area.images && area.images.length) {
    const n = Math.floor((floor - area.from) / DUNGEON.bossEvery);
    return area.images[n % area.images.length];
  }
  return area.image || null;
}

// その階で使う出現表（無限モードでは全部）
function poolsFor(floor) {
  if (isEndless(floor)) return DUNGEON.enemyPools;
  return DUNGEON.enemyPools.filter(p => floor >= p.from && (!p.to || floor <= p.to));
}

// その階で出現しうる敵の一覧（重複なし）
function enemyPool(floor) {
  return [...new Set(poolsFor(floor).flatMap(p => p.add || []))];
}

// その階で、まれに出る敵 { 敵ID: 確率 }（ミミックなど）
function rareEnemies(floor) {
  const result = {};
  for (const p of poolsFor(floor)) {
    if (p.rare) Object.assign(result, p.rare);
  }
  return result;
}


// その階の敵の数の範囲 { min, max }
function enemyCountRange(floor) {
  const list = DUNGEON.enemyCount.filter(c => floor >= c.from);
  return list[list.length - 1];
}

// ボス階の敵
// 無限モードでは endlessBosses を順番に（110階→1番目、120階→2番目…）
// それ以外でその階のボスが未定義なら、それより前で一番深いボス
function bossEnemies(floor) {
  if (isEndless(floor)) {
    const list = DUNGEON.endlessBosses;
    const n = Math.floor((floor - (DUNGEON.endlessFrom - 1)) / DUNGEON.bossEvery) - 1;
    return [list[((n % list.length) + list.length) % list.length]];
  }
  const floors = Object.keys(DUNGEON.bosses).map(Number).sort((a, b) => a - b);
  const usable = floors.filter(f => f <= floor);
  return DUNGEON.bosses[usable.length ? usable[usable.length - 1] : floors[0]];
}

// その階に出す敵のIDを決める
function rollFloorEnemyIds(floor) {
  if (isBossFloor(floor)) return bossEnemies(floor);
  const pool = enemyPool(floor);
  const rare = rareEnemies(floor);
  const { min, max } = enemyCountRange(floor);
  const count = min + Math.floor(Math.random() * (max - min + 1));
  const ids = Array.from({ length: count }, () => {
    // まれな敵の抽選が先。外れたら通常の敵からランダム
    for (const id in rare) {
      if (Math.random() < rare[id]) return id;
    }
    return pool[Math.floor(Math.random() * pool.length)];
  });
  // 群れ（氷狼など）：出たら同じ敵が最低 pack 体そろうように足す（場の上限まで）
  for (const id of [...new Set(ids)]) {
    const pack = ENEMIES[id].pack || 0;
    while (ids.filter(x => x === id).length < pack && ids.length < DUNGEON.maxEnemies) ids.push(id);
  }
  return ids;
}

// 敵ユニットを1体作る（階層に応じてステータスと経験値を上げる。elite なら強化個体）
function createEnemyUnit(id, floor, name, elite = false) {
  const t = ENEMIES[id];
  const scale = floorStatScale(floor);
  const stats = {};
  for (const s of ['hp', 'atk', 'def', 'spd']) {
    stats[s] = DUNGEON.scaledStats.includes(s) ? Math.round(t[s] * scale) : t[s];
  }
  const unit = createUnit(t, 'enemy', name, stats);
  unit.templateId = id;
  unit.exp = Math.round(t.exp * floorExpScale(floor));
  // 導火線（爆弾岩）：最初から大技を予告している
  const fuse = (t.traits || []).find(tr => tr.type === 'fuse');
  if (fuse) unit.countdown = { skill: fuse.skill, turns: fuse.turns };
  // 星の点（星座の獣）：体の星の数
  const stars = (t.traits || []).find(tr => tr.type === 'stars');
  if (stars) unit.stars = stars.count;
  if (elite) makeElite(unit);
  return unit;
}

// 強化個体にする：名前に★、ステータス強化、ランダムな特殊能力1つ、倒すとアイテム選択
function makeElite(unit) {
  unit.elite = true;
  unit.name = `★${unit.name}`;
  for (const s of ELITE.stats) unit.base[s] = Math.round(unit.base[s] * ELITE.statRate);
  unit.hp = unit.base.hp;
  unit.exp = Math.round(unit.exp * ELITE.expRate);

  const extra = { ...ELITE.traits[Math.floor(Math.random() * ELITE.traits.length)] };
  // 能力値を上げる特殊能力（俊足など）はここで反映
  if (extra.type === 'statBoost') unit.base[extra.stat] = Math.round(unit.base[extra.stat] * extra.rate);
  unit.traits.push(extra, { type: 'rewardOnDefeat' });
}

// その階の敵ユニットを作る
function createFloorEnemies(floor) {
  const ids = rollFloorEnemyIds(floor);

  // 同じ敵が複数いるときは A, B, C… をつける
  const counts = {};
  ids.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
  const seen = {};

  return ids.map(id => {
    seen[id] = (seen[id] || 0) + 1;
    const name = counts[id] > 1 ? ENEMIES[id].name + String.fromCharCode(64 + seen[id]) : ENEMIES[id].name;
    // 強化個体（ボス階と、まれな敵は対象外）
    const elite = !isBossFloor(floor) && floor >= ELITE.from && !ENEMIES[id].noElite && Math.random() < ELITE.chance;
    const unit = createEnemyUnit(id, floor, name, elite);
    // 神々の塔：全滅した回数だけボスのHPが下がる（救済措置）
    const cut = towerHpCut(floor);
    if (cut > 0 && unit.type === 'boss') {
      unit.base.hp = Math.max(1, Math.round(unit.base.hp * (1 - cut)));
      unit.hp = unit.base.hp;
      unit.reliefCut = cut;
    }
    return unit;
  });
}

// 階をクリアしたとき：次の階へ進む（ボス階ならチェックポイント更新）
function advanceFloor() {
  const f = gameState.floor;
  // 神々の塔は1階ごとにチェックポイント（全滅しても次の階＝今いた階からやり直し）
  if (isTowerFloor(f)) gameState.checkpoint = f + 1;
  else if (isBossFloor(f)) gameState.checkpoint = f + DUNGEON.checkpointOffset;
  gameState.floor = f + 1;
  gameState.maxFloor = Math.max(gameState.maxFloor, gameState.floor);
  gameState.bestFloor = Math.max(gameState.bestFloor || 1, gameState.maxFloor); // 減らない記録（ランキング用）
  // 100階（終焉の神）を倒したら無限モードが解放される。無限モードの最高到達階も記録
  if (f === DUNGEON.finalFloor) gameState.endlessUnlocked = true;
  if (isEndless(gameState.floor)) gameState.endlessBest = Math.max(gameState.endlessBest || 0, gameState.floor);
  saveGame();
  Cloud.save('floor'); // 階層クリア時にクラウドへ保存（最高記録ならランキングも更新）
}

// 全滅したとき：チェックポイントへ戻る
function returnToCheckpoint() {
  gameState.floor = gameState.checkpoint;
  saveGame();
  Cloud.save('wipe');
}
