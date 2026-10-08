// =====================================================================
// dungeon.js  ―  ダンジョン（階層）の処理
// 設定値は data.js の DUNGEON にあります。
// =====================================================================
'use strict';

function isBossFloor(floor) {
  return floor % DUNGEON.bossEvery === 0;
}

// 敵ステータスの倍率（1階 = 1.0、1階ごとに DUNGEON.statPerFloor ずつ上がる）
function floorStatScale(floor) {
  return 1 + DUNGEON.statPerFloor * (floor - 1);
}

// 獲得経験値の倍率
function floorExpScale(floor) {
  return 1 + DUNGEON.expPerFloor * (floor - 1);
}

// 無限モード（最終ボスの階より先）か
function isEndless(floor) {
  return floor > DUNGEON.finalFloor;
}

// その階のエリア（data.js の AREAS）
function areaOf(floor) {
  const list = AREAS.filter(a => floor >= a.from);
  return list[list.length - 1];
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

// 周回による敵の強さ・経験値の倍率（1周目 = 1）
function cycleStatRate() {
  return 1 + NEW_GAME_PLUS.statRatePerCycle * (gameState.cycle - 1);
}
function cycleExpRate() {
  return 1 + NEW_GAME_PLUS.expRatePerCycle * (gameState.cycle - 1);
}

// その階の敵の数の範囲 { min, max }
function enemyCountRange(floor) {
  const list = DUNGEON.enemyCount.filter(c => floor >= c.from);
  return list[list.length - 1];
}

// ボス階の敵
// 無限モードでは endlessBosses を順番に（60階→1番目、70階→2番目…）
// それ以外でその階のボスが未定義なら、それより前で一番深いボス
function bossEnemies(floor) {
  if (isEndless(floor)) {
    const list = DUNGEON.endlessBosses;
    const n = Math.floor((floor - DUNGEON.finalFloor) / DUNGEON.bossEvery) - 1;
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
  return Array.from({ length: count }, () => {
    // まれな敵の抽選が先。外れたら通常の敵からランダム
    for (const id in rare) {
      if (Math.random() < rare[id]) return id;
    }
    return pool[Math.floor(Math.random() * pool.length)];
  });
}

// 敵ユニットを1体作る（階層に応じてステータスと経験値を上げる。elite なら強化個体）
function createEnemyUnit(id, floor, name, elite = false) {
  const t = ENEMIES[id];
  const scale = floorStatScale(floor) * cycleStatRate();
  const stats = {};
  for (const s of ['hp', 'atk', 'def', 'spd']) {
    stats[s] = DUNGEON.scaledStats.includes(s) ? Math.round(t[s] * scale) : t[s];
  }
  const unit = createUnit(t, 'enemy', name, stats);
  unit.templateId = id;
  unit.exp = Math.round(t.exp * floorExpScale(floor) * cycleExpRate());
  // 導火線（爆弾岩）：最初から大技を予告している
  const fuse = (t.traits || []).find(tr => tr.type === 'fuse');
  if (fuse) unit.countdown = { skill: fuse.skill, turns: fuse.turns };
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
    return createEnemyUnit(id, floor, name, elite);
  });
}

// 階をクリアしたとき：次の階へ進む（ボス階ならチェックポイント更新）
function advanceFloor() {
  const f = gameState.floor;
  if (isBossFloor(f)) gameState.checkpoint = f + DUNGEON.checkpointOffset;
  gameState.floor = f + 1;
  gameState.maxFloor = Math.max(gameState.maxFloor, gameState.floor);
  saveGame();
}

// 全滅したとき：チェックポイントへ戻る
function returnToCheckpoint() {
  gameState.floor = gameState.checkpoint;
  saveGame();
}
