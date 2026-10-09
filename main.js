// =====================================================================
// main.js  ―  バトルの処理と画面表示、ダンジョンの進行、起動
// データ（キャラ・敵・スキル）は data.js、アイテムは items.js、成長要素は progress.js、
// 右側パネル（強化・アイテム）は panel.js にあります。
// =====================================================================
'use strict';

const EPS = 1e-9;     // 小数の誤差対策
let uidCounter = 0;   // ユニットごとの通し番号
let battle = null;    // 現在のバトル

// ---------------------------------------------------------------------
// ユニット（戦闘中のキャラ／敵）の生成
// ---------------------------------------------------------------------
// template: CHARACTERS または ENEMIES の1件
// side:     'ally'（味方） / 'enemy'（敵）
// stats:    強化込みのステータス（省略すると template の値そのまま）
function createUnit(template, side, name, stats = null, level = 1) {
  const base = stats
    ? { ...stats }
    : { hp: template.hp, atk: template.atk, def: template.def, spd: template.spd };
  return {
    uid: ++uidCounter,
    templateId: null,    // ENEMIES のキー（敵のみ。dungeon.js で設定）
    name,
    side,
    level,
    role: template.role || null,
    type: template.type || null,
    image: template.image || null, // 立ち絵
    face: template.face || '50% 0%',          // 行動順リストの顔アイコンの切り抜き位置
    idle: template.idle || 'idle-breath',     // 待機アニメーションのクラス名
    attackEffect: template.attackEffect || null, // 通常攻撃のエフェクト（effects.js）
    attackElement: template.attackElement || null, // 通常攻撃の属性（'fire' / 'light'）
    lastElement: null,   // 最後に受けた攻撃の属性（ゾンビの起き上がり判定）
    size: template.size || null,              // 'small' なら小さく表示
    isPart: !!template.part,                  // 部位（足・首・コア・球など。小さいHPバーつきの別ターゲット）
    autoAvoid: !!template.autoAvoid,          // オートでは後回しにする部位（倒すと増えるヒュドラの首）
    coreLink: !!template.coreLink,            // ダメージを本体に入れる部位（機神のコア）
    hidden: !!template.hidden,                // 画面にカードを出さない（雷帝の太鼓。行動順リストにだけ出る）
    deferredHeals: [],   // 反転（堕天使）で、あとから回復に変わるダメージ [{ amount, turns }]
    intent: null,        // 敵が次に使う予定の技（行動順リストで予告する）
    enrageBelow: template.enrageBelow || null, // 怒りの見た目になるHP割合
    dom: null,           // 画面上の要素（UI.makeCard で設定）
    base,
    hp: base.hp,
    alive: true,
    wait: 0,             // 行動までの待ち時間
    guarding: false,     // 防御中か
    coveredBy: null,     // かばってくれているユニット
    actCount: 0,         // この戦闘で行動した回数
    buffs: [],           // 能力変化 { stat, rate, turns, skip, tag }
    statuses: [],        // 状態異常 { id, value, turns }（毒・やけど・凍結・飛翔など）
    cooldowns: {},       // { スキルID: 残りターン }
    skills: template.skills || ['attack', 'defend'],
    ai: template.ai || null,              // 敵の行動パターン
    autoRules: template.autoRules || null, // 味方のオート行動ルール
    traits: (template.traits || []).map(t => ({ ...t })), // 特殊能力（data.js の TRAIT_INFO）
    phases: template.phases || null,      // ボスの段階（HPが減ると演出つきで変化）
    phaseIndex: 0,       // 次に入る段階の番号
    actionsPerTurn: 1,   // 1ターンに何回行動するか
    chainCount: 0,       // 連続行動の何回目か
    countdown: null,     // 予告中の大技 { skill, turns }
    forcedSkill: null,   // 予告が終わって、このターン必ず使う技
    dormant: (template.traits || []).some(t => t.type === 'dormant'), // 擬態中（行動しない）
    endureUsed: false,   // 不屈を使ったか
    enraged: false,      // 怒り（enrageAt）が発動したか
    elite: false,        // 強化個体か
    gear: null,          // 装備アイテムの効果（味方のみ。progress.js の itemEffects の結果）
    dealtDamage: false,  // この行動でダメージを与えたか（疾風剣の判定用）
    ki: 0,                                        // 気（拳闘家）
    kiMax: template.ki ? template.ki.max : 0,     // 気の上限（0 なら気を使わないキャラ）
    kiAtk: template.ki ? template.ki.atkPer : 0,  // 気1つあたりの攻撃アップ
    hpHistory: [],       // 自分の行動開始時のHPの記録（巻き戻し用）
    nextHaste: 0,        // 行動のあとに進める行動ゲージ（魔力集中）
    exp: template.exp || 0,
  };
}

// 装備の割合ボーナス（無ければ 0）
function gearBonus(unit, key) {
  return (unit.gear && unit.gear.bonus[key]) || 0;
}

// 装備の特殊効果（無ければ null）
function gearSpecial(unit, key) {
  return (unit.gear && unit.gear.specials.find(s => s.key === key)) || null;
}

// 装備の特殊効果の一番大きい値（同じ効果を複数持っていても重ねない効果用。無ければ 0）
function gearMax(unit, key, field = 'value') {
  if (!unit.gear) return 0;
  return unit.gear.specials.filter(s => s.key === key).reduce((m, s) => Math.max(m, s[field] || 0), 0);
}

// 敵の特殊能力（無ければ null）
function trait(unit, type) {
  return unit.traits.find(t => t.type === type) || null;
}

// バフ込みの現在ステータス
function getStat(unit, stat) {
  let value = unit.base[stat];
  for (const b of unit.buffs) {
    if (b.stat === stat) value *= b.rate;
  }
  // 巨人の盾：HPが減ると防御が上がる
  const lowHp = stat === 'def' && gearSpecial(unit, 'lowHpDefense');
  if (lowHp && unit.hp / unit.base.hp <= lowHp.threshold) value *= lowHp.rate;
  // 気（拳闘家）：気1つにつき攻撃アップ
  if (stat === 'atk' && unit.ki > 0) value *= 1 + unit.ki * unit.kiAtk;
  // 状態異常による防御倍率（毒フグのふくらみなど）
  if (stat === 'def') {
    for (const s of unit.statuses) value *= STATUS_INFO[s.id].defRate || 1;
  }
  // 群れ（氷狼）：同じ種類の仲間1体につき速度アップ
  const ps = stat === 'spd' && trait(unit, 'packSpeed');
  if (ps && battle && unit.alive) {
    const mates = battle.living(battle.enemies.includes(unit) ? battle.enemies : battle.allies)
      .filter(u => u !== unit && u.templateId === unit.templateId).length;
    value *= 1 + ps.rate * mates;
  }
  return Math.max(1, value);
}

// 状態異常の数値を合計する（reflect・damageCut など）
function statusSum(unit, key) {
  return unit.statuses.reduce((sum, s) => sum + (STATUS_INFO[s.id][key] || 0), 0);
}

// 攻撃が効かない状態か（地中・海中・殻・石化）
function isInvulnerable(unit) {
  return unit.statuses.some(s => STATUS_INFO[s.id].invulnerable);
}

// 重ねがけできる能力変化（機械兵の加速・渦潮）。limit 倍で止まる
function stackBuff(unit, stat, rate, tag, limit) {
  withSpeedRescale(unit, () => {
    const cur = unit.buffs.find(b => b.tag === tag && b.stat === stat);
    if (cur) {
      cur.rate *= rate;
      cur.rate = rate > 1 ? Math.min(cur.rate, limit) : Math.max(cur.rate, limit);
      cur.turns = 999;
    } else {
      unit.buffs.push({ stat, rate, turns: 999, skip: false, tag });
    }
  });
}

// HPを回復して数字を出す（回復した量を返す）
// noInvert: true なら反転（堕天使）の影響を受けない（反転で戻ってくる回復そのもの）
function restoreHp(b, unit, amount, label = '', noInvert = false) {
  if (!unit.alive) return 0;
  // 世界改変「回復禁止」（終焉の神オリジン）
  if (b && b.rule === 'noHeal' && amount > 0) {
    b.log(`回復禁止の世界では、${unit.name}は回復できない！`, 'info');
    return 0;
  }
  // 反転（堕天使）：回復がダメージに変わる
  if (b && !noInvert && amount > 0 && hasStatus(unit, 'inverted')) {
    directDamage(b, unit, amount, '反転！ 回復がダメージに変わった！ ');
    return 0;
  }
  // 青い炎（ランタンゴースト）：相手側にいる間、回復量が減る
  const aura = b && b.opponentsOf(unit).map(o => trait(o, 'healDown')).find(Boolean);
  if (aura) amount *= 1 - aura.value;
  const before = unit.hp;
  unit.hp = Math.min(unit.base.hp, unit.hp + Math.max(0, Math.round(amount)));
  const healed = unit.hp - before;
  if (healed > 0) {
    b.log(`${unit.name}のHPが ${healed} 回復した！${label}`, 'heal');
    Anim.number(unit, `+${healed}`, 'heal');
  }
  // 魔王の牙：最大HPを超えた回復分は、決まった量までバリアになる
  const cap = gearMax(unit, 'overhealBarrier', 'cap');
  const over = Math.round(amount) - healed;
  if (cap > 0 && over > 0) {
    const max = Math.round(unit.base.hp * cap);
    const gain = Math.min(over, max - (unit.barrier || 0));
    if (gain > 0) {
      unit.barrier = (unit.barrier || 0) + gain;
      if (b) b.log(`${unit.name}はあふれた力をバリアにした！（バリア ${unit.barrier}）`, 'heal');
    }
  }
  return healed;
}

// HPを減らす（不屈なら1度だけHP1で耐える）。実際に減った量と、耐えたかを返す
function loseHp(unit, dmg) {
  let endured = false;
  // バリア（魔王の牙）が先にダメージを受け止める
  if (unit.barrier > 0 && dmg > 0) {
    const absorbed = Math.min(unit.barrier, dmg);
    unit.barrier -= absorbed;
    dmg -= absorbed;
  }
  if (dmg >= unit.hp && trait(unit, 'endure') && !unit.endureUsed) {
    unit.endureUsed = true;
    dmg = unit.hp - 1;
    endured = true;
  }
  unit.hp = Math.max(0, unit.hp - dmg);
  return { dmg, endured };
}

// 直接ダメージ（反射・毒・やけどなど。回避・会心・反射・反撃は起こさない）
// source: ダメージの出どころ（倒したとき「倒した相手」になる）
function directDamage(b, target, amount, label, source = null, element = null) {
  if (!target.alive) return;
  target.lastElement = element;
  const { dmg, endured } = loseHp(target, Math.max(1, Math.round(amount)));
  deferInvertedHeal(b, target, dmg);
  b.log(`${label}${target.name}に ${dmg} のダメージ！`, 'damage');
  b.track(Anim.hit(target));
  Anim.number(target, dmg, 'dmg');
  if (endured) b.log(`${target.name}は不屈の力でHP1で踏みとどまった！`, 'system');
  if (target.hp === 0) b.defeat(target, source);
  else b.afterDamaged(target);
}

// 反転（堕天使）：受けたダメージは2ターン後（その人の行動2回ぶん）に回復に変わる
function deferInvertedHeal(b, unit, dmg) {
  if (!unit.alive || unit.hp <= 0 || dmg <= 0 || !hasStatus(unit, 'inverted')) return;
  unit.deferredHeals.push({ amount: dmg, turns: 2 });
}

// 指定した能力が強化（rate > 1）されているか
function hasBuff(unit, stat) {
  return unit.buffs.some(b => b.stat === stat && b.rate > 1);
}

// 速度が変わる処理を行うとき、残り待ち時間を新しい速度に合わせて伸び縮みさせる
// （ゲージの「進み具合の割合」は変えずに、残り時間だけ速度に合わせる）
function withSpeedRescale(unit, fn) {
  const before = getStat(unit, 'spd');
  fn();
  const after = getStat(unit, 'spd');
  if (before !== after) unit.wait = unit.wait * before / after;
}

// ---------------------------------------------------------------------
// 状態異常（毒・やけど・凍結・飛翔など。種類は data.js の STATUS_INFO）
// ---------------------------------------------------------------------
function applyStatus(b, target, id, value, turns) {
  if (!target.alive) return;
  target.statuses = target.statuses.filter(s => s.id !== id); // 同じ状態異常はかけ直し
  target.statuses.push({ id, value, turns });
  // 状態異常のエフェクト（今の技のエフェクトと同じなら重ねない）
  const fx = Fx.forStatus(id);
  if (fx !== b.currentFx) Fx.play(fx, [target]);
  const info = STATUS_INFO[id];
  b.log(`${target.name}${info.applyText}`, 'info');
}

function hasStatus(unit, id) {
  return unit.statuses.some(s => s.id === id);
}

// 回避率（特殊能力の回避＋状態異常の回避）
function evasionOf(unit) {
  let ev = trait(unit, 'evasion') ? trait(unit, 'evasion').value : 0;
  ev += gearBonus(unit, 'evasion'); // 風の盾
  for (const s of unit.statuses) ev += STATUS_INFO[s.id].evasion || 0;
  return Math.min(0.95, ev);
}

// ---------------------------------------------------------------------
// 攻撃1回分のダメージ処理（スキル・反撃・爆発など共通）
// opts:
//   power        攻撃力に掛ける倍率
//   isSkill      スキルによる攻撃か（通常攻撃は false）
//   aoe          全体攻撃か（護衛の「代わりに受ける」は単体攻撃のみ）
//   isCounter    反撃によるものか（反撃に反撃はしない）
//   unavoidable  回避できない
//   noCrit       会心しない
//   noRedirect   かばう・護衛で代わりに受けない
//   noReflect    反射されない
//   secondary    追加効果（毒・凍結・吸収など）を起こさない
//   label        ログの先頭に付ける文字
// 戻り値：与えたダメージ（外れたら 0）
// ---------------------------------------------------------------------
function strike(b, user, target, opts = {}) {
  if (!target.alive) return 0;

  // 1. 代わりに受ける（騎士の「かばう」、甲冑ゴブリンの「護衛」）
  if (!opts.noRedirect) {
    const coverer = target.coveredBy;
    if (coverer && coverer.alive && coverer !== target) {
      b.log(`${coverer.name}が${target.name}をかばった！`, 'info');
      target = coverer;
    } else if (!opts.aoe) {
      const friends = b.friendsOf(target);
      const taunter = friends.find(u => u !== target && trait(u, 'taunt') && !isInvulnerable(u));
      const guard = friends.find(u => u !== target && trait(u, 'guardian'));
      if (taunter && user.side !== target.side) {
        // 誘いの光（深海アンコウ）：単体攻撃を自分に集める
        b.log(`${taunter.name}の誘いの光に引き寄せられた！`, 'info');
        target = taunter;
      } else if (guard && lowestHp(friends) === target) {
        b.log(`${guard.name}が${target.name}への攻撃を受け止めた！`, 'info');
        target = guard;
      }
    }
  }

  // 2. 無敵（地中・海中・殻・石化）
  if (isInvulnerable(target)) {
    b.log(`${target.name}には攻撃が効かない！`, 'info');
    Anim.number(target, '無効', 'miss');
    return 0;
  }
  // 機神のコア：開いているときだけ攻撃が通り、ダメージは本体に入る
  if (target.coreLink) {
    const owner = b.units.find(u => u.uid === target.linkedTo && u.alive);
    if (!owner) return 0;
    b.log(`開いたコアに攻撃が届いた！`, 'info');
    target = owner;
  }
  target.lastAoe = !!opts.aoe; // 全体攻撃で倒されたか（ヒュドラの首）

  // 氷の壁（氷晶ゴーレム）：次の攻撃を1回だけ無効
  if (hasStatus(target, 'iceWall')) {
    target.statuses = target.statuses.filter(s => s.id !== 'iceWall');
    b.log(`${target.name}の氷の壁が攻撃を防いだ！`, 'info');
    Anim.number(target, '無効', 'miss');
    return 0;
  }
  // 星占い（星読みの魔術師）：単体攻撃を見切ってかわし、反撃する
  if (hasStatus(target, 'foresight') && !opts.aoe && !opts.isCounter && user.side !== target.side) {
    target.statuses = target.statuses.filter(s => s.id !== 'foresight');
    b.log(`${target.name}は星の導きで攻撃を見切った！`, 'info');
    Anim.number(target, 'MISS', 'miss');
    if (user.alive) b.counters.push({ by: target, to: user });
    return 0;
  }

  // 3. 回避
  if (!opts.unavoidable && Math.random() < evasionOf(target)) {
    b.log(`${target.name}はひらりとかわした！`, 'info');
    Anim.number(target, 'MISS', 'miss');
    return 0;
  }

  // 4. ダメージ計算
  const cfg = BATTLE_CONFIG;
  let power = opts.power ?? 1;
  if (opts.isSkill) power *= 1 + gearBonus(user, 'skillPower'); // 魔力の珠など
  // 居合（炎の鬼武者）：自分より遅い相手には倍率アップ
  const iai = trait(user, 'iai');
  if (iai && getStat(target, 'spd') < getStat(user, 'spd')) power *= iai.rate;
  // 群れ（半魚人戦士）：同じ種類の仲間がいると攻撃アップ
  const pack = trait(user, 'pack');
  if (pack && b.friendsOf(user).some(u => u !== user && u.templateId === user.templateId)) power *= pack.rate;
  // 生命の剣：HP満タンなら攻撃アップ
  const fullHp = gearSpecial(user, 'fullHpAtk');
  if (fullHp && user.hp >= user.base.hp) power *= fullHp.rate;
  // 先駆けの剣：戦闘で最初の攻撃が強くなる（反撃は数えない）
  const firstAttack = !user.attackedOnce && !opts.isCounter;
  const first = gearSpecial(user, 'firstStrike');
  if (first && firstAttack) power *= first.rate;
  const def = opts.ignoreDef ? 0 : getStat(target, 'def'); // 突進（ミノタウロス）は防御を無視
  let dmg = getStat(user, 'atk') * power * cfg.defenseConstant / (cfg.defenseConstant + def);
  dmg *= 1 + (Math.random() * 2 - 1) * cfg.variance; // 乱数
  const targetLow = target.hp / target.base.hp <= 0.5;
  if (targetLow) dmg *= 1 + gearBonus(user, 'executeBonus'); // 暗殺者の牙

  // 会心（通常攻撃のみ。賢者の珠ならスキルも。処刑の特殊能力は HP50%以下に確定。
  // 閃光のピアスは最初の攻撃に確定。堅牢な相手・鉄壁の盾を持つ相手には出ない）
  let crit = false;
  if (!opts.noCrit && !trait(target, 'critImmune') && !gearSpecial(target, 'critImmune')) {
    const canCrit = !opts.isSkill || gearSpecial(user, 'skillCrit');
    const sure = (trait(user, 'executeCrit') && targetLow) || (gearSpecial(user, 'firstCrit') && firstAttack)
      || (opts.sureCritBelow && target.hp / target.base.hp <= opts.sureCritBelow); // 狙い撃ち：弱った相手に必ず会心
    if (sure || (canCrit && Math.random() < gearBonus(user, 'critRate'))) {
      crit = true;
      dmg *= ITEM_CONFIG.baseCritMultiplier + gearBonus(user, 'critDamage');
    }
  }
  const cut = trait(target, 'damageCut');               // 硬化
  if (cut) dmg *= 1 - cut.value;
  // 星の点（星座の獣）：星1つにつき軽減。会心を受けると星が1つ消える
  const st = trait(target, 'stars');
  if (st && target.stars > 0) {
    if (crit) {
      target.stars--;
      b.log(`会心の一撃で${target.name}の星が1つ消えた！（残り${target.stars}）`, 'info');
    }
    dmg *= Math.max(0, 1 - st.cut * target.stars);
  }
  dmg *= Math.max(0, 1 - statusSum(target, 'damageCut')); // 天空結界など
  // 呪いの珠：被ダメージが増える状態
  for (const s of target.statuses) if (s.id === 'vulnerable') dmg *= 1 + s.value;
  if (opts.aoe) dmg *= Math.max(0, 1 - gearBonus(target, 'aoeGuard')); // 魔法の盾：全体攻撃を軽減
  const ethereal = trait(target, 'ethereal');           // 霊体：物理（魔法以外）を軽減
  if (ethereal && !opts.magic) dmg *= 1 - ethereal.value;
  const phantom = trait(target, 'phantom');             // 霊体（ゴースト）：通常攻撃を軽減
  if (phantom && !opts.isSkill) dmg *= 1 - phantom.value;
  // 墓石の盾（墓守ゴーレム）：生きている間、仲間全員の被ダメージを軽減
  const tomb = b.friendsOf(target).map(u => trait(u, 'tombShield')).find(Boolean);
  if (tomb) dmg *= 1 - tomb.value;
  // 神盾：味方全員の被ダメージを軽減（複数あっても一番強いものだけ）
  const teamGuard = Math.max(0, ...b.friendsOf(target).map(u => gearMax(u, 'teamGuard')));
  if (teamGuard > 0) dmg *= 1 - teamGuard;
  if (target.guarding) dmg *= cfg.guardRate;           // 防御中は軽減
  dmg = Math.max(1, Math.round(dmg));

  // 5. HPを減らす
  target.lastElement = opts.element || null; // 属性（炎・光で倒したゾンビは起き上がらない）
  const result = loseHp(target, dmg);
  dmg = result.dmg;
  deferInvertedHeal(b, target, dmg); // 反転：このダメージは2ターン後に回復に変わる
  b.log(`${opts.label || ''}${crit ? '会心の一撃！ ' : ''}${target.name}に ${dmg} のダメージ！${target.guarding ? '（防御）' : ''}`, 'damage');
  b.track(Anim.hit(target));
  Anim.number(target, dmg, crit ? 'dmg crit' : 'dmg');
  // エフェクト（攻撃の種類ごと）と、会心のときの追加演出
  if (opts.fx) Fx.play(opts.fx, [target], user);
  if (crit) Fx.crit(target);
  if (result.endured) b.log(`${target.name}は不屈の力でHP1で踏みとどまった！`, 'system');
  user.dealtDamage = true;
  if (target.hp === 0) b.defeat(target, user);
  else b.afterDamaged(target);
  // 包帯しばり（ミイラ）：拘束中に攻撃されると解ける
  if (target.alive && hasStatus(target, 'bound')) {
    target.statuses = target.statuses.filter(s => s.id !== 'bound');
    b.log(`${target.name}の包帯がほどけた！`, 'info');
  }
  // 分裂（闇スライム）：単体攻撃を受けるたびに、HPを半分に分けて分裂（全体攻撃では分裂しない）
  const splitHit = trait(target, 'splitOnHit');
  if (splitHit && target.alive && !opts.aoe && target.hp >= 2) b.splitByHit(target, splitHit);
  // 狼の盾：受けたダメージの一部だけ回復
  const dHeal = gearBonus(target, 'damageHeal');
  if (dHeal > 0 && target.alive) restoreHp(b, target, Math.max(1, dmg * dHeal), '（狼の盾）');
  // 勝利のお守り・吸血のピアス：会心を出したときの回復
  if (crit && user.alive) {
    const ch = gearSpecial(user, 'critHeal');
    if (ch) restoreHp(b, user, user.base.hp * ch.ratio, '（会心）');
    const cl = gearSpecial(user, 'critLifesteal');
    if (cl) restoreHp(b, user, Math.max(1, dmg * cl.value), '（会心吸収）');
  }

  // 6. 攻撃した側の追加効果
  if (!opts.secondary) {
    // 状態異常を付ける（マグマスライムのやけどなど）
    const onHit = trait(user, 'statusOnHit');
    if (onHit && target.alive) applyStatus(b, target, onHit.status, onHit.value, onHit.turns);
    // 麻痺・突風：相手の行動ゲージを戻す
    const push = trait(user, 'delayOnHit');
    if (push && target.alive) {
      target.wait += b.fullWait(target) * push.amount;
      b.log(`${push.label || '麻痺'}！ ${target.name}の行動が遅れた！`, 'info');
    }
    // 速度低下（紫電の魔剣）：より強い速度低下がすでにかかっていれば上書きしない
    const slow = gearSpecial(user, 'slowOnHit');
    if (slow && target.alive) {
      const current = target.buffs.find(x => x.stat === 'spd' && x.rate < 1);
      if (!current || current.rate >= slow.rate) {
        applyBuff(target, { stat: 'spd', rate: slow.rate, turns: slow.turns }, target === b.current);
        if (!current) b.log(`${target.name}の速度が下がった！`, 'info');
      }
    }
    // 毒（毒キノコ）
    const poison = trait(user, 'poisonOnHit');
    if (poison && target.alive) applyStatus(b, target, 'poison', poison.value, poison.turns);
    // 凍結（氷の妖精）：相手の行動ゲージを0に戻す
    const freeze = trait(user, 'freezeOnHit');
    if (freeze && target.alive && Math.random() < freeze.chance) {
      target.wait = b.fullWait(target);
      applyStatus(b, target, 'freeze', 0, 1);
    }
    // 防御ダウン（茨の剣）
    const brk = gearSpecial(user, 'armorBreak');
    if (brk && target.alive) {
      const had = target.buffs.some(x => x.tag === 'break');
      applyBuff(target, { stat: 'def', rate: brk.rate, turns: brk.turns, tag: 'break' }, target === b.current);
      if (!had) b.log(`${target.name}の防御が下がった！`, 'info');
    }
    // 被ダメージアップ（呪いの珠）
    const vul = gearSpecial(user, 'vulnerableOnHit');
    if (vul && target.alive) applyStatus(b, target, 'vulnerable', vul.value, vul.turns);
    // 吸収（鋭い牙など。魂喰らいの珠はスキルの吸収を上乗せ）
    const steal = gearBonus(user, 'lifesteal') + (opts.isSkill ? gearBonus(user, 'skillLifesteal') : 0)
      + (trait(user, 'lifesteal') ? trait(user, 'lifesteal').value : 0); // 吸血鬼
    if (steal > 0 && user.alive) restoreHp(b, user, Math.max(1, dmg * steal), '（吸収）');
    // 天剣：攻撃するたび、ほかの敵全員にも与えたダメージの一部
    const splash = gearMax(user, 'splash', 'ratio');
    if (splash > 0 && dmg > 0 && user.alive) {
      const others = b.opponentsOf(user).filter(o => o !== target);
      for (const o of others) directDamage(b, o, dmg * splash, '天剣の余波！ ', user);
    }
    // 横取り（墓場のカラス）：相手の強化効果を1つ奪って自分に付ける
    if (trait(user, 'stealBuff') && target.alive) {
      const bf = target.buffs.find(x => x.rate > 1);
      if (bf) {
        withSpeedRescale(target, () => { target.buffs = target.buffs.filter(x => x !== bf); });
        withSpeedRescale(user, () => { user.buffs.push({ ...bf, skip: false }); });
        b.log(`${user.name}は${target.name}の${STAT_LABELS[bf.stat]}アップを奪い取った！`, 'info');
      }
    }
    // 闇の剣（悪魔騎士）：相手の最大HPを減らす（戦闘中ずっと。重ねがけ）
    const mh = trait(user, 'maxHpDown');
    if (mh && target.alive) {
      target.maxHpRate = (target.maxHpRate || 1) * mh.rate;
      target.base.hp = Math.max(1, Math.round(target.base.hp * mh.rate));
      target.hp = Math.min(target.hp, target.base.hp);
      b.log(`闇の剣！ ${target.name}の最大HPが下がった！`, 'info');
    }
  }

  // 7. 反射（いばらの鎧・ミラースライム・ふくらんだ毒フグ。棘のピアスは反射にも会心判定）
  if (!opts.noReflect && user !== target && user.alive) {
    const reflect = gearBonus(target, 'reflect') + (trait(target, 'reflect') ? trait(target, 'reflect').value : 0)
      + statusSum(target, 'reflect');
    if (reflect > 0) {
      let amount = dmg * reflect;
      let label = `${target.name}の反射！ `;
      if (gearSpecial(target, 'reflectCrit') && Math.random() < gearBonus(target, 'critRate')) {
        amount *= ITEM_CONFIG.baseCritMultiplier + gearBonus(target, 'critDamage');
        label = `${target.name}の反射が会心！ `;
      }
      directDamage(b, user, amount, label, target);
      // 茨の神鎧：反射するたび相手の行動ゲージを減らす（同じ相手には、その相手の1行動につき1回まで）
      const rd = gearMax(target, 'reflectDelay', 'amount');
      if (rd > 0 && user.alive && user.thornMark !== user.actCount) {
        user.thornMark = user.actCount;
        user.wait += b.fullWait(user) * rd;
        b.log(`茨の神鎧！ ${user.name}の行動が遅れた！`, 'info');
      }
    }
  }

  // 呪い返し（呪いの人形）：受けたダメージの一部を、攻撃した相手とは別の相手1人にも与える
  const link = trait(target, 'curseLink');
  if (link && user.side !== target.side) {
    const others = b.friendsOf(user).filter(u => u !== user);
    if (others.length) {
      const victim = others[Math.floor(Math.random() * others.length)];
      directDamage(b, victim, dmg * link.value, `${target.name}の呪い返し！ `, target);
    }
  }

  // 8. 反撃（反撃の鎧・カニ騎士・拳闘家の構え）：攻撃が全部終わってから行う
  const canCounter = !opts.isCounter && target.alive && user.alive && user.side !== target.side;
  const counter = gearSpecial(target, 'counter') || trait(target, 'counter');
  if (canCounter && hasStatus(target, 'counterStance')) {
    // 構え：次に受けた攻撃に必ず反撃（1回で構えは解ける）
    target.statuses = target.statuses.filter(s => s.id !== 'counterStance');
    b.counters.push({ by: target, to: user });
  } else if (counter && canCounter && Math.random() < counter.chance) {
    b.counters.push({ by: target, to: user });
  }

  // 9. 擬態中のミミックは攻撃されると目覚める
  if (target.dormant && target.alive) b.wake(target);
  return dmg;
}

// ---------------------------------------------------------------------
// スキル効果の処理
// 新しい効果を作るときは、ここに関数を1つ追加し data.js で type を指定する
// 引数: (battle, 使用者, 対象, 効果データ)
// ---------------------------------------------------------------------
const EFFECT_HANDLERS = {
  // ダメージ
  damage(b, user, target, eff) {
    const skill = SKILLS[b.skillId];
    const opts = {
      power: (eff.power ?? 1) * (eff.isCounter ? 1 : b.skillMult), // 魔力集中なら2倍
      isSkill: b.skillId !== 'attack', // 通常攻撃以外は「スキル」
      aoe: skill && (skill.target === 'allEnemies' || skill.target === 'allAllies'),
      isCounter: !!eff.isCounter,
      magic: !!(skill && skill.magic), // 魔法の技（霊体に軽減されない）
      sureCritBelow: eff.sureCritBelow, // 狙い撃ち
      ignoreDef: !!eff.ignoreDef,       // 突進：防御無視
      element: skillElement(user, b.skillId), // 炎・光の属性
      fx: b.currentFx,                  // エフェクト
    };
    // 絶対零度：凍結・氷漬けの相手には効かない
    if (eff.skipFrozen && target.statuses.some(s => STATUS_INFO[s.id].frozen)) {
      b.log(`${target.name}は凍りついていて、絶対零度が効かない！`, 'info');
      Anim.number(target, '無効', 'miss');
      return;
    }
    const hits = eff.hits || 1;
    let total = 0;
    for (let i = 0; i < hits && target.alive && user.alive; i++) total += strike(b, user, target, opts);
    // 魂吸収：与えたダメージの分だけ回復
    if (eff.drain && total > 0 && user.alive) restoreHp(b, user, total * eff.drain, '（魂吸収）');
  },

  // 回復（最大HPの割合）
  heal(b, user, target, eff) {
    let amount = target.base.hp * eff.ratio;
    amount *= 1 + gearBonus(user, 'healPower');   // 癒しの杖
    amount *= 1 + gearBonus(user, 'skillPower');  // 回復はすべてスキル
    amount *= b.skillMult;                         // 魔力集中なら2倍
    const healed = restoreHp(b, target, amount);
    if (healed === 0) b.log(`${target.name}のHPは満タンだ。`, 'heal');
    b.track(Anim.heal(target));
    // 回復で死の宣告が解ける
    if (hasStatus(target, 'doom')) {
      target.statuses = target.statuses.filter(s => s.id !== 'doom');
      b.log(`${target.name}の死の宣告が解けた！`, 'system');
    }
  },

  // 能力変化（rate > 1 で強化、rate < 1 で弱体）
  buff(b, user, target, eff) {
    applyBuff(target, eff, target === b.current);
    b.log(`${target.name}の${STAT_LABELS[eff.stat]}が${eff.rate > 1 ? '上がった' : '下がった'}！`, 'info');
  },

  // 行動を遅らせる（待ち時間を増やす）
  delay(b, user, target, eff) {
    target.wait += b.fullWait(target) * eff.amount;
    b.log(`${target.name}の行動が遅れた！`, 'info');
  },

  // 行動を早める（待ち時間を減らす）※仲間を早める補助スキル向け
  hasten(b, user, target, eff) {
    target.wait = Math.max(0, target.wait - b.fullWait(target) * eff.amount);
    b.log(`${target.name}の行動が早まった！`, 'info');
  },

  // 防御
  guard(b, user, target) {
    target.guarding = true;
    b.log(`${target.name}は身を守っている。`, 'info');
    // 守護の盾：防御を選ぶとHP回復
    const gh = gearSpecial(target, 'guardHeal');
    if (gh) restoreHp(b, target, target.base.hp * gh.ratio, '（守護の盾）');
  },

  // かばう（使用者の次の行動まで、対象への攻撃を使用者が受ける）
  cover(b, user, target) {
    if (target === user) return; // 自分自身はかばえない（一緒に付いている防御だけが効く）
    target.coveredBy = user;
    b.log(`${user.name}は${target.name}をかばっている。`, 'info');
  },

  // 状態異常をかける { type: 'status', status: 'burn', value: 0.03, turns: 2, chance: 0.3 }
  status(b, user, target, eff) {
    if (eff.chance !== undefined && Math.random() >= eff.chance) return;
    if (isInvulnerable(target) && target !== user) return;
    applyStatus(b, target, eff.status, eff.value || 0, eff.turns);
    // かけた相手を覚えておく（リッチが倒れたら死の宣告が解ける）
    const s = target.statuses.find(x => x.id === eff.status);
    if (s) s.from = user.uid;
  },

  // 即死（死神の死の鎌）：HPが below 以下の相手を即死。それ以外（とボス）には power 倍のダメージ
  execute(b, user, target, eff) {
    if (target.hp / target.base.hp > eff.below || target.type === 'boss') {
      EFFECT_HANDLERS.damage(b, user, target, { type: 'damage', power: eff.power ?? 1 });
      return;
    }
    if (Math.random() < evasionOf(target)) {
      b.log(`${target.name}はひらりとかわした！`, 'info');
      Anim.number(target, 'MISS', 'miss');
      return;
    }
    b.log(`${user.name}の鎌が${target.name}の命を刈り取った！`, 'system');
    Fx.play('fx_dark', [target], user);
    target.lastElement = null;
    const { endured } = loseHp(target, target.hp);
    b.track(Anim.hit(target));
    Anim.number(target, '即死', 'dmg crit');
    user.dealtDamage = true;
    if (endured) b.log(`${target.name}は不屈の力でHP1で踏みとどまった！`, 'system');
    if (target.hp === 0) b.defeat(target, user);
    else b.afterDamaged(target);
  },

  // いたずら（インプ）：味方と敵を1人ずつ選んで、行動順（待ち時間）を入れ替える
  swapOrder(b, user) {
    const a = b.living(b.allies).filter(u => u !== b.current);
    const e = b.living(b.enemies).filter(u => u !== b.current);
    if (!a.length || !e.length) return;
    const x = a[Math.floor(Math.random() * a.length)];
    const y = e[Math.floor(Math.random() * e.length)];
    [x.wait, y.wait] = [y.wait, x.wait];
    b.log(`いたずら！ ${x.name}と${y.name}の行動順が入れ替わった！`, 'info');
  },

  // 重ねがけできる能力ダウン（雪の精の吹雪）
  stackDebuff(b, user, target, eff) {
    stackBuff(target, eff.stat, eff.rate, eff.tag, eff.limit);
    b.log(`${target.name}の${STAT_LABELS[eff.stat]}が下がった！`, 'info');
  },

  // 凍結（行動ゲージ0）{ type: 'freeze', chance: 0.2 }
  freeze(b, user, target, eff) {
    if (eff.chance !== undefined && Math.random() >= eff.chance) return;
    target.wait = b.fullWait(target);
    applyStatus(b, target, 'freeze', 0, 1);
  },

  // 氷漬け（氷河の巨人）：相手は行動不能。HPを持つ「氷塊」が出て、壊すと解ける
  entomb(b, user, target, eff) {
    const ice = b.spawnEnemy('iceBlock', { force: true });
    if (!ice) return;
    ice.name = `${target.name}の氷`;
    ice.iceFor = target.uid;
    ice.linkedTo = user.uid; // 巨人が倒れたら氷も消える
    if (ice.dom) ice.dom.card.querySelector('.name').firstChild.textContent = ice.name;
    applyStatus(b, target, 'entombed', 0, eff.turns);
  },

  // この階の敵を1体呼び出す（次元の裂け目）。呼んだ本人が倒れると消える。経験値なし
  summonPool(b, user) {
    const pool = enemyPool(b.floor).filter(id => !trait({ traits: ENEMIES[id].traits || [] }, 'riftLink'));
    if (!pool.length) return;
    const e = b.spawnEnemy(pool[Math.floor(Math.random() * pool.length)]);
    if (!e) { b.log('しかし、これ以上は出てこられない！', 'info'); return; }
    e.linkedTo = user.uid;
    e.exp = 0;
  },

  // 星喰い：相手の強化効果を全部奪って自分に付ける
  devourBuffs(b, user, target) {
    const ups = target.buffs.filter(x => x.rate > 1);
    if (!ups.length) return;
    withSpeedRescale(target, () => { target.buffs = target.buffs.filter(x => x.rate <= 1); });
    withSpeedRescale(user, () => { for (const x of ups) user.buffs.push({ ...x, skip: false }); });
    b.log(`${user.name}は${target.name}の強化効果を喰らった！`, 'info');
  },

  // 残っている部位の数だけ攻撃（クラーケンの触手乱打）
  partStrikes(b, user, target, eff) {
    const count = b.partsOf(user).length;
    if (count === 0) return;
    b.log(`${count}本の足が襲いかかる！`, 'info');
    EFFECT_HANDLERS.damageRandom(b, user, target, { power: eff.power, count });
  },

  // 雷の太鼓（雷帝）：行動順リストにだけ出る「雷」を仕込む。光った順に落ちる
  drums(b, user, target, eff) {
    const full = b.fullWait(user);
    for (let i = 0; i < eff.count; i++) {
      const d = b.spawnEnemy(eff.enemy, { force: true, quiet: true });
      if (!d) break;
      d.name = `${ENEMIES[eff.enemy].name}${'①②③④⑤⑥⑦⑧⑨'[i] || ''}`;
      d.base.atk = user.base.atk;          // 雷の強さは雷帝と同じ
      d.buffs = user.buffs.filter(x => x.stat === 'atk').map(x => ({ ...x }));
      d.linkedTo = user.uid;               // 雷帝が倒れたら消える
      d.wait = full * (0.25 + 0.3 * i);    // 光った順に落ちる
    }
    b.log(`${eff.count}つの太鼓が光った！ 光った順に雷が落ちる！`, 'system');
  },

  // コアを開く（機神）：次の自分の行動まで攻撃が通る
  openCore(b, user) {
    for (const p of b.partsOf(user)) {
      if (!p.coreLink) continue;
      p.statuses = p.statuses.filter(s => s.id !== 'shut');
      b.log(`${user.name}のコアが開いた！ 今がチャンス！`, 'system');
    }
  },

  // 過去のボスを1体呼び出す（終焉の神オリジン）。段階変化はしない
  summonBoss(b, user, target, eff) {
    const id = eff.list[Math.floor(Math.random() * eff.list.length)];
    const boss = b.spawnEnemy(id, { force: true });
    if (!boss) return;
    boss.base.hp = Math.max(1, Math.round(boss.base.hp * eff.hpRate));
    boss.hp = boss.base.hp;
    boss.phases = null;
    boss.exp = 0;
    boss.summonedBy = user.uid;
    b.log(`過去の強敵、${boss.name}がよみがえった！`, 'system');
  },

  // 終焉（オリジン）：相手全員を倒す（帰還の指輪でも防げない）
  annihilate(b, user, target) {
    if (!target.alive) return;
    target.rebirthUsed = true;
    target.annihilated = true;
    target.lastElement = null;
    target.hp = 0;
    Anim.number(target, '終焉', 'dmg crit');
    b.defeat(target, user);
  },

  // 強化効果を消す（闇の波動）
  dispel(b, user, target) {
    if (!target.buffs.some(x => x.rate > 1)) return;
    withSpeedRescale(target, () => { target.buffs = target.buffs.filter(x => x.rate <= 1); });
    b.log(`${target.name}の強化効果が消えた！`, 'info');
  },

  // 次の自分の行動でこの技を使う { type: 'queueSkill', skill: 'emerge' }
  queueSkill(b, user, target, eff) {
    user.forcedSkill = eff.skill;
  },

  // ランダムな相手に何回も攻撃 { type: 'damageRandom', power: 0.7, count: 3 }
  damageRandom(b, user, target, eff) {
    for (let i = 0; i < eff.count && user.alive; i++) {
      const opp = b.opponentsOf(user);
      if (opp.length === 0) break;
      strike(b, user, opp[Math.floor(Math.random() * opp.length)], { power: eff.power * b.skillMult, isSkill: true, aoe: true, fx: b.currentFx, element: skillElement(user, b.skillId) });
    }
  },

  // ---- 15階以降の仲間のスキル ----
  // 盗む：成功するとこの階のクリア時にアイテム選択が1回増える（1戦闘1回まで）
  steal(b, user, target, eff) {
    if (b.stolen) return;
    if (Math.random() < eff.chance) {
      b.stolen = true;
      b.log(`${user.name}は${target.name}から何かを盗んだ！（この階をクリアするとアイテムを1回多く選べる）`, 'system');
      Anim.number(user, '盗んだ！', 'heal');
    } else {
      b.log('盗めなかった…', 'info');
    }
  },

  // 行動のあと、自分の行動ゲージを進める（魔力集中）
  gaugeAfter(b, user, target, eff) {
    user.nextHaste = eff.amount;
  },

  // 眠らせる：行動ゲージ0＋1回休み。ボスは行動ゲージ-50%だけ（効果半分）
  sleep(b, user, target) {
    if (target.type === 'boss') {
      target.wait += b.fullWait(target) * 0.5;
      b.log(`${target.name}は眠気に耐えた…が、行動が遅れた！`, 'info');
      return;
    }
    target.wait = b.fullWait(target);
    applyStatus(b, target, 'sleep', 0, 2); // 次の自分のターンで1回休み、その次に目覚める
  },

  // 奥義・百烈拳：気を全部使い、気の数×per 倍のダメージ
  kiBurst(b, user, target, eff) {
    const ki = user.ki;
    if (ki <= 0) return;
    b.log(`${user.name}は気を${ki}つ解き放った！`, 'system');
    strike(b, user, target, { power: ki * eff.per * b.skillMult, isSkill: true, fx: b.currentFx });
    user.ki = 0;
  },

  // 行動ゲージを満タンに（すぐ行動）
  fillGauge(b, user, target) {
    if (target === user) {
      b.log(`${user.name}自身の時間は早められない…`, 'info');
      return;
    }
    target.wait = 0;
    b.log(`${target.name}の時間が加速した！ すぐに行動できる！`, 'info');
  },

  // 巻き戻し：HPを turns ターン前（その味方の行動で数える）の値に戻す。今より低くはしない
  rewind(b, user, target, eff) {
    const h = target.hpHistory;
    const past = h.length ? h[Math.max(0, h.length - eff.turns)] : target.hp;
    const before = target.hp;
    target.hp = Math.min(target.base.hp, Math.max(target.hp, past));
    if (target.hp > before) {
      b.log(`${target.name}の時間が巻き戻り、HPが ${target.hp} に戻った！`, 'heal');
      Anim.number(target, `+${target.hp - before}`, 'heal');
      b.track(Anim.heal(target));
    } else {
      b.log(`${target.name}の時間を巻き戻したが、HPは変わらなかった。`, 'info');
    }
  },

  // 倒れた仲間を蘇生 { type: 'revive', ratio: 0.5 }
  revive(b, user, target, eff) {
    if (target.alive) return;
    b.revive(target, eff.ratio, `${user.name}の祈りで`);
  },

  // 相手の行動を一番後ろへ { type: 'toBack' }
  toBack(b, user, target) {
    const others = b.living(b.units).filter(u => u !== target);
    const last = Math.max(0, ...others.map(u => u.wait));
    target.wait = Math.max(target.wait, last + 1);
    b.log(`${target.name}は吹き飛ばされ、行動が一番後ろになった！`, 'info');
  },

  // 自分が倒れる（爆弾岩の大爆発）
  selfKill(b, user) {
    if (!user.alive) return;
    user.hp = 0;
    user.rebirthUsed = true; // 自爆では復活しない
    b.defeat(user, null);
  },

  // 仲間を呼ぶ { type: 'summon', enemy: 'assassin', count: 2 }
  summon(b, user, target, eff) {
    for (let i = 0; i < (eff.count || 1); i++) b.spawnEnemy(eff.enemy);
  },

  // 大技の予告 { type: 'countdown', skill: 'abyssFlame', turns: 3 }（turns ターン後にその技を必ず使う）
  countdown(b, user, target, eff) {
    user.countdown = { skill: eff.skill, turns: eff.turns };
    b.log(`${user.name}は${SKILLS[eff.skill].name}の力をためはじめた！（${eff.turns}ターン後）`, 'system');
  },
};

// 技の属性（スキルの element、通常攻撃ならキャラの attackElement）
function skillElement(user, skillId) {
  const skill = SKILLS[skillId];
  if (skill && skill.element) return skill.element;
  return skillId === 'attack' ? user.attackElement : null;
}

// 写し身（鏡の悪魔）：攻撃力が一番高い相手の姿・ステータス・スキルをコピーする
function applyMirrorCopy(b, unit) {
  if (!trait(unit, 'mirrorCopy') || unit.copied) return;
  const opp = b.living(unit.side === 'enemy' ? b.allies : b.enemies);
  if (!opp.length) return;
  const src = opp.reduce((a, c) => (getStat(c, 'atk') > getStat(a, 'atk') ? c : a));
  unit.copied = true;
  unit.base = { ...src.base };
  unit.hp = unit.base.hp;
  unit.image = src.image;
  unit.face = src.face;
  unit.idle = src.idle;
  unit.attackEffect = src.attackEffect;
  unit.attackElement = src.attackElement;
  unit.name = unit.name.replace(ENEMIES[unit.templateId].name, `鏡の${src.name}`);
  // 敵が使うと困る技（盗む・気の奥義・巻き戻し）は除く
  const usable = src.skills.filter(id => !['steal', 'hyakuretsu', 'rewind'].includes(id));
  unit.skills = usable;
  unit.ai = usable.map(id => ({ skill: id, weight: id === 'defend' ? 0.3 : 1 }));
}

// 能力変化をかける（行動順プレビューの計算でも使う）
// skip: 自分にかけた場合、今のターン終了時はカウントしない
function applyBuff(target, eff, skip) {
  const up = eff.rate > 1;
  const tag = eff.tag || null;
  withSpeedRescale(target, () => {
    // 同じ能力・同じ向き（強化/弱体）・同じ種類（tag）のものは上書き（重ねがけはしない）
    // tag が違えば別物として重なる（例：力ため鬼の「力をためる」と「怒り」）
    target.buffs = target.buffs.filter(x => !(x.stat === eff.stat && (x.rate > 1) === up && x.tag === tag));
    target.buffs.push({ stat: eff.stat, rate: eff.rate, turns: eff.turns, skip, tag });
  });
}

// 力をためている（tag: 'charge' のバフがかかっている）か
function isCharging(unit) {
  return unit.buffs.some(b => b.tag === 'charge');
}

// ---------------------------------------------------------------------
// 行動条件の判定（敵AI・味方オート共通）
// ---------------------------------------------------------------------
function checkCondition(b, unit, when) {
  if (!when) return true;
  const ratio = unit.hp / unit.base.hp;
  if (when.firstTurn && unit.actCount > 0) return false;
  if (when.hpBelow !== undefined && !(ratio < when.hpBelow)) return false;
  if (when.hpAbove !== undefined && !(ratio >= when.hpAbove)) return false;
  if (when.hasBuff && !hasBuff(unit, when.hasBuff)) return false;
  if (when.notBuff && hasBuff(unit, when.notBuff)) return false;
  if (when.charging && !isCharging(unit)) return false;
  if (when.notCharging && isCharging(unit)) return false;
  if (when.hasStatus && !hasStatus(unit, when.hasStatus)) return false;
  if (when.notStatus && hasStatus(unit, when.notStatus)) return false;
  if (when.noCountdown && (unit.countdown || unit.forcedSkill)) return false;
  if (when.allyDead && !b.deadFriendsOf(unit).length) return false;
  if (when.notBossBattle && isBossFloor(b.floor)) return false;
  if (when.everyNth && unit.actCount % when.everyNth !== when.everyNth - 1) return false;
  if (when.hasParts && !b.partsOf(unit).length) return false;
  if (when.noSummonAlive && b.units.some(u => u.alive && u.summonedBy === unit.uid)) return false;
  if (when.noOpponentStatus && b.opponentsOf(unit).some(o => hasStatus(o, when.noOpponentStatus))) return false;
  // ---- 15階以降の仲間のオート用 ----
  const opp = b.opponentsOf(unit);
  if (when.enemyCount !== undefined && opp.length < when.enemyCount) return false;
  if (when.enemyHpBelow !== undefined && !opp.some(o => o.hp / o.base.hp <= when.enemyHpBelow)) return false;
  if (when.enemySpdAtLeast !== undefined && !opp.some(o => getStat(o, 'spd') >= when.enemySpdAtLeast)) return false;
  if (when.enemyDanger && !opp.some(o => b.dangerOf(o))) return false;
  if (when.nextEnemyDanger) {
    const next = b.nextOpponent(unit);
    if (!next || !b.dangerOf(next)) return false;
  }
  if (when.allyMissingBuff && !b.friendsOf(unit).some(f => !f.buffs.some(x => x.tag === when.allyMissingBuff))) return false;
  if (when.kiAtLeast !== undefined && unit.ki < when.kiAtLeast) return false;
  if (when.hasOtherAlly && b.friendsOf(unit).length < 2) return false;
  if (when.enemyCharging && !b.opponentsOf(unit).some(isCharging)) return false;
  if (when.allyHpBelow !== undefined) {
    const hurt = b.friendsOf(unit).filter(u => u.hp / u.base.hp < when.allyHpBelow).length;
    if (hurt < (when.allyCount || 1)) return false;
  }
  return true;
}

// 軽量モードか（設定が「自動」なら、タッチ操作の端末＝スマホ・タブレットで ON）
function isLiteMode() {
  const v = gameState.settings.lite;
  if (v === true || v === false) return v;
  return window.matchMedia('(pointer: coarse)').matches;
}

// 戦闘速度に合わせた待ち時間
function scaledDelay(ms) {
  return ms / gameState.settings.speed;
}

// 指定ミリ秒（×1 のとき）待つ。戦闘速度に合わせて短くなる。一時停止中は再開まで待つ
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, scaledDelay(ms))).then(whenRunning);
}

// 指定ミリ秒（×1 のとき）あとに fn を実行する。一時停止中は再開してから実行（ゲームの進行はすべてこれを使う）
// fn の中でエラーが起きても、画面に出して見張り役（下の Watchdog）が立て直せるようにする
function later(fn, ms) {
  setTimeout(() => whenRunning().then(fn).catch(reportError), scaledDelay(ms));
}

// ---------------------------------------------------------------------
// エラーの表示と、進行が止まったときの立て直し
// ---------------------------------------------------------------------
// エラーが起きたら画面の下に出す（スクリーンショットで原因を調べられるように）
function reportError(e) {
  const msg = (e && (e.message || e.reason && e.reason.message)) || String(e);
  console.error(e);
  if (typeof showToast === 'function') showToast(`⚠ エラー：${msg}`);
  if (battle) battle.log(`⚠ エラーが起きました：${msg}`, 'system');
}
window.addEventListener('error', e => reportError(e.error || e.message));
window.addEventListener('unhandledrejection', e => reportError(e.reason));

// 見張り役：戦闘が一定時間まったく進まなかったら、次の行動から再開する
// （プレイヤーの入力待ち・一時停止中・エンディング中・画面を閉じている間は数えない）
const Watchdog = {
  LIMIT_MS: 15000,
  lastProgress: Date.now(),

  // 戦闘が進んだら呼ぶ
  tick() { this.lastProgress = Date.now(); },

  check() {
    const b = battle;
    const endingOpen = !document.getElementById('ending').classList.contains('hidden');
    if (!b || document.hidden || Game.paused || endingOpen || b.waitingInput) { this.tick(); return; }
    if (Date.now() - this.lastProgress < this.LIMIT_MS) return;
    this.tick();
    console.warn('進行が止まっていたので立て直します', b.current && b.current.name);
    showToast('進行が止まっていたので再開しました');
    b.pending = [];
    b.counters = [];
    if (b.over) {
      startFloor();                    // 次の階へ進めなかった
    } else if (b.current) {
      const c = b.current;
      b.endTurn(c, null);              // 行動の途中で止まった → その行動を終わらせる
    } else {
      b.next();                        // 次の行動が始まらなかった
    }
  },
};
setInterval(() => Watchdog.check(), 3000);
// プレイ時間（画面を開いて遊んでいる間だけ数える。エンディングの記録に使う）
setInterval(() => {
  if (!document.hidden && !Game.paused) gameState.playSeconds = (gameState.playSeconds || 0) + 5;
}, 5000);
document.addEventListener('visibilitychange', () => Watchdog.tick()); // 戻ってきた直後に誤作動しないように

// ---------------------------------------------------------------------
// アニメーション（見た目は style.css、ここではクラスの付け外しとタイミングだけ）
// CSS 側の長さは「×1 のときの秒数 ÷ --speed」、JS 側は sleep() で同じ長さだけ待つ
// 戻り値の Promise はアニメーション終了で解決する（終わるまで次の行動に進まないため）
// ---------------------------------------------------------------------
const ANIM_MS = {
  stepIn: 100,   // 攻撃の踏み込み
  stepOut: 300,  // 元の位置に戻る
  hit: 300,      // 被ダメージ
  heal: 400,     // 回復
  defeat: 700,   // 戦闘不能
  quake: 500,    // 画面の揺れ
};

const Anim = {
  // クラスを付けて、ms 後に外す（同じクラスを連続で付けても最初から再生されるよう一度外す）
  play(el, cls, ms) {
    if (!el) return Promise.resolve();
    el.classList.remove(cls);
    void el.offsetWidth; // 再描画させてアニメーションをリセット
    el.classList.add(cls);
    return sleep(ms).then(() => el.classList.remove(cls));
  },

  // 攻撃：相手の方向へ踏み込む（戻るのは stepOut）
  stepIn(unit) {
    if (!unit.dom) return Promise.resolve();
    unit.dom.actor.classList.add('step');
    return sleep(ANIM_MS.stepIn);
  },
  stepOut(unit) {
    if (!unit.dom) return Promise.resolve();
    unit.dom.actor.classList.remove('step');
    return sleep(ANIM_MS.stepOut);
  },

  hit(unit)  { return this.play(unit.dom && unit.dom.actor, 'anim-hit', ANIM_MS.hit); },
  heal(unit) { return this.play(unit.dom && unit.dom.actor, 'anim-heal', ANIM_MS.heal); },

  // 戦闘不能：沈んで消える（クラスは付けたまま）
  defeat(unit) {
    if (!unit.dom) return Promise.resolve();
    unit.dom.actor.classList.add('anim-defeat');
    return sleep(ANIM_MS.defeat);
  },

  // バトル画面全体を揺らす（右側のパネルは操作中かもしれないので揺らさない）
  shakeScreen() {
    return this.play(document.getElementById('battle-main'), 'anim-quake', ANIM_MS.quake);
  },

  // セリフの吹き出し（ボスの段階変化など）。少しのあいだ戦闘を止めて読ませる
  speech(unit, text) {
    if (!unit.dom) return Promise.resolve();
    const bubble = document.createElement('div');
    bubble.className = 'speech';
    bubble.textContent = text;
    unit.dom.card.querySelector('.sprite-box').appendChild(bubble);
    setTimeout(() => bubble.remove(), 3000); // 吹き出しは戦闘速度に関係なく3秒表示
    return sleep(1500);
  },

  // キャラの上に数字を出す（cls: 'dmg' 赤 / 'heal' 緑）。待たない
  number(unit, text, cls) {
    if (!unit.dom) return;
    const box = unit.dom.popups;
    const span = document.createElement('span');
    span.className = `num ${cls}`;
    span.textContent = text;
    span.style.marginTop = `${-box.children.length * 22}px`; // 連続ヒットは少しずらして重ねない
    box.appendChild(span);
    sleep(900).then(() => span.remove());
  },
};

// ---------------------------------------------------------------------
// バトル本体
// ---------------------------------------------------------------------
class Battle {
  constructor(allies, enemies, floor) {
    this.allies = allies;    // 味方の配列（出撃枠ぶん）
    this.enemies = enemies;  // 敵の配列
    this.floor = floor;      // 何階の戦闘か
    this.units = [...allies, ...enemies]; // 同時に行動可能になったときは、この並び順で先に行動
    this.current = null;     // 今行動しているユニット
    this.waitingInput = false; // プレイヤーのコマンド入力待ちか
    this.pending = [];       // 再生中のアニメーション（終わるまで次へ進まない）
    this.counters = [];      // この行動のあとに行う反撃 [{ by, to }]
    this.skillId = null;     // 今使っているスキル
    this.skillMult = 1;      // 今のスキルの効果倍率（魔力集中で2倍）
    this.currentFx = null;   // 今のスキルのエフェクト（effects.js）
    this.stolen = false;     // 盗賊の「盗む」が成功したか（この階のクリア時にアイテム選択+1回）
    this.over = false;
    this.turnCount = 0;
    // 写し身（鏡の悪魔）：戦闘開始時に相手をコピー（待ち時間を決める前に速度もコピーする）
    for (const e of enemies) applyMirrorCopy(this, e);
    // 最初の待ち時間 = 10000 ÷ 速度
    for (const u of this.units) u.wait = this.fullWait(u);
    // 先手のブーツ・神速の靴など：戦闘開始時に行動ゲージを進める（100%で最初に必ず行動）
    for (const u of this.units) {
      const head = Math.min(1, gearBonus(u, 'openingGauge'));
      if (head > 0) u.wait *= 1 - head;
    }
    // 先陣の盾：戦闘開始時に味方全員の防御アップ
    for (const u of this.units) {
      const td = gearSpecial(u, 'openingTeamDef');
      if (!td) continue;
      const team = u.side === 'ally' ? allies : enemies;
      for (const f of team) applyBuff(f, { stat: 'def', rate: td.rate, turns: td.turns, tag: 'vanguard' }, false);
    }
    // 敵は最初に使う技を決めておく（行動順リストで予告するため）
    for (const e of this.enemies) e.intent = this.rollEnemySkill(e);
  }

  // 待ち時間の満タン値
  fullWait(unit) {
    // 世界改変「行動順逆転」：遅いキャラほど待ち時間が短くなる
    if (this.rule === 'reverse') return BATTLE_CONFIG.gaugeBase * getStat(unit, 'spd') / 14400;
    return BATTLE_CONFIG.gaugeBase / getStat(unit, 'spd');
  }

  living(list) { return list.filter(u => u.alive); }
  // 画面に出ない敵（雷帝の太鼓）は、狙う・かばう・回復するなどの相手にはならない
  friendsOf(unit)   { return this.living(unit.side === 'ally' ? this.allies : this.enemies).filter(u => !u.hidden); }
  opponentsOf(unit) { return this.living(unit.side === 'ally' ? this.enemies : this.allies).filter(u => !u.hidden); }
  // 生きている部位（足・首・コア・球・目など）
  partsOf(owner) { return this.units.filter(u => u.alive && u.isPart && u.linkedTo === owner.uid); }

  // 部位を出す（opts.shield: 全部壊すまで本体は無敵）
  spawnParts(owner, enemyId, count, opts = {}) {
    for (let i = 0; i < count; i++) {
      const p = this.spawnEnemy(enemyId, { force: true, quiet: true });
      if (!p) break;
      p.linkedTo = owner.uid;
      p.isPart = true;
      if (opts.shield) p.shieldOf = owner.uid;
      if (p.coreLink) p.statuses.push({ id: 'shut', value: 0, turns: 999 }); // コアは閉じた状態で始まる
    }
    if (opts.shield) applyStatus(this, owner, 'voidVeil', 0, 999);
  }
  // 倒れている仲間（ボスは除く。蘇生の対象）
  deadFriendsOf(unit) {
    return (unit.side === 'ally' ? this.allies : this.enemies).filter(u => !u.alive && u.type !== 'boss');
  }

  // 倒れたユニットを生き返らせる
  revive(unit, ratio, label = '') {
    unit.alive = true;
    unit.hp = Math.max(1, Math.round(unit.base.hp * ratio));
    unit.buffs = [];
    unit.statuses = [];
    unit.wait = this.fullWait(unit);
    if (unit.side === 'enemy') unit.intent = this.rollEnemySkill(unit);
    if (unit.dom) unit.dom.actor.classList.remove('anim-defeat');
    this.log(`${label}${unit.name}がよみがえった！`, 'system');
    this.track(Anim.heal(unit));
    Anim.number(unit, `+${unit.hp}`, 'heal');
  }

  log(text, cls) { UI.log(text, cls); }

  // アニメーションの終了を待つ対象に加える
  track(promise) { this.pending.push(promise); }

  // 戦闘開始
  start() {
    const boss = isBossFloor(this.floor) ? '【ボス階】' : '';
    this.log(`${this.floor}階 ${boss}${this.enemies.map(e => e.name).join('、')} が現れた！`, 'system');
    // 神々の塔の救済措置
    for (const e of this.enemies) {
      if (e.reliefCut) this.log(`何度も挑んだ執念で、${e.name}のHPが${Math.round(e.reliefCut * 100)}%下がっている！`, 'system');
    }
    // 戦闘開始時のHP（時の神クロノスの巻き戻しで使う）と、最初からある部位
    for (const e of [...this.enemies]) {
      e.startHp = e.hp;
      const sp = trait(e, 'startParts');
      if (sp) this.spawnParts(e, sp.enemy, sp.count, { shield: sp.shield });
      if (trait(e, 'coreBody')) e.statuses.push({ id: 'armored', value: 0, turns: 999 });
      const nine = trait(e, 'nineLives');
      if (nine) { e.tails = nine.count; e.origMaxHp = e.base.hp; }
    }
    UI.buildUnits(this);
    this.next();
  }

  // 待ち時間が一番短いユニットを選ぶ（同じなら並び順が先のほう）
  static pickNext(list) {
    let best = list[0];
    for (const x of list) if (x.wait < best.wait - EPS) best = x;
    return best;
  }

  // 時間を進めて、次に行動するユニットを決める
  // 行動するユニット（動かない部位などは行動順に入らない）
  actors() { return this.living(this.units).filter(u => !trait(u, 'noAct')); }

  advanceTime() {
    const alive = this.actors();
    const actor = Battle.pickNext(alive);
    const elapsed = actor.wait;
    for (const u of alive) u.wait -= elapsed; // 全員の待ち時間を同じだけ減らす
    actor.wait = 0;
    // 起き上がり待ちのゾンビも、同じだけ時間が進む
    for (const u of this.units) {
      if (!u.alive && u.reanimateWait > 0) u.reanimateWait -= elapsed;
      if (!u.alive && u.reformWait > 0) u.reformWait -= elapsed;
    }
    return actor;
  }

  // 起き上がり（ゾンビ）：時間が来たら倒れていた敵がよみがえる
  reanimateReady() {
    // 雪だるま兵：時間が来たとき雪玉が1つでも残っていれば、雪玉が集まって復活する
    for (const u of this.units) {
      if (u.alive || typeof u.reformWait !== 'number' || u.reformWait > EPS) continue;
      u.reformWait = null;
      const balls = (u.snowballs || []).filter(x => x.alive);
      if (!balls.length) continue;
      for (const x of balls) this.vanish(x, null);
      this.revive(u, trait(u, 'snowballSplit').ratio, '雪玉が集まって');
    }
    for (const u of this.units) {
      if (u.alive || typeof u.reanimateWait !== 'number' || u.reanimateWait > EPS) continue;
      u.reanimateWait = null;
      this.revive(u, trait(u, 'reanimate').ratio, 'うめき声とともに');
    }
  }

  // これからの行動順を予測する（現在の状態のまま時間を進めた場合の目安）
  predictOrder(count) {
    const sim = this.actors().map(u => ({ unit: u, wait: u.wait }));
    const order = [];
    if (sim.length === 0) return order;
    for (let i = 0; i < count; i++) {
      const s = Battle.pickNext(sim);
      order.push(s.unit);
      const elapsed = s.wait;
      for (const x of sim) x.wait -= elapsed;
      s.wait = this.fullWait(s.unit); // 行動後は待ち時間リセット
    }
    return order;
  }

  // 行動順リスト用のデータ（ユニットの並びに key を付ける）
  // key = 「そのユニットの何回目の行動か」。同じ行動は同じ key になるので、
  // 画面側で行を使い回して、並びが変わったときになめらかに動かせる
  toEntries(units) {
    const seen = {};
    return units.map(u => {
      const k = seen[u.uid] || 0;
      seen[u.uid] = k + 1;
      return { unit: u, key: `${u.uid}-${u.actCount + k}`, first: k === 0 };
    });
  }

  orderEntries(count) {
    return this.toEntries(this.predictOrder(count));
  }

  // 行動順プレビュー：user が skillId を targets に使った「あと」の行動順
  // 実際に待ち時間・速度変化だけを仮に適用して予測し、すぐ元に戻す
  previewEntries(user, skillId, targets, count) {
    const saved = this.units.map(u => ({ u, wait: u.wait, buffs: u.buffs.map(x => ({ ...x })) }));
    let afterHaste = 0;
    for (const eff of SKILLS[skillId].effects) {
      const effTargets = eff.target === 'self' ? [user]
        : eff.target === 'allAllies' ? this.friendsOf(user)
        : targets;
      for (const t of effTargets) {
        if (!t.alive) continue;
        if (eff.type === 'delay')  t.wait += this.fullWait(t) * eff.amount;      // 影縫い・時間停止など
        if (eff.type === 'hasten') t.wait = Math.max(0, t.wait - this.fullWait(t) * eff.amount);
        if (eff.type === 'buff' && eff.stat === 'spd') applyBuff(t, eff, t === user);
        if (eff.type === 'fillGauge' && t !== user) t.wait = 0;                   // 加速：すぐ行動
        if (eff.type === 'sleep') {
          // 子守唄：行動ゲージ0＋1回休み（＝満タン2回分待つ）。ボスは行動ゲージ-50%だけ
          t.wait = t.type === 'boss' ? t.wait + this.fullWait(t) * 0.5 : this.fullWait(t) * 2;
        }
        if (eff.type === 'gaugeAfter') afterHaste = eff.amount;                  // 魔力集中
      }
    }
    user.wait = this.fullWait(user) * (1 - afterHaste); // 行動後の待ち時間リセット
    const after = this.predictOrder(count - 1);
    for (const s of saved) { s.u.wait = s.wait; s.u.buffs = s.buffs; }

    // 先頭は今行動中のキャラのまま、その後ろが使ったあとの順番
    const entries = this.toEntries([user, ...after]);
    // 今の順番と比べて、前に来た／後ろに下がった／新しく入った行に印を付ける
    const before = this.orderEntries(count).map(e => e.key);
    entries.forEach((e, i) => {
      const old = before.indexOf(e.key);
      e.change = old === -1 ? 'new' : i < old ? 'up' : i > old ? 'down' : null;
    });
    return entries;
  }

  // ---- 敵の予定（次に使う技） ----
  // 今の状態で使える候補（条件を満たし、クールダウン中でない）
  enemyCandidates(enemy) {
    return (enemy.ai || []).filter(a => this.canUse(enemy, a.skill) && checkCondition(this, enemy, a.when));
  }

  // 候補から weight の比率で1つ選ぶ（候補が無ければ攻撃）
  rollEnemySkill(enemy) {
    const candidates = this.enemyCandidates(enemy);
    if (candidates.length === 0) return 'attack';
    const total = candidates.reduce((s, a) => s + (a.weight ?? 1), 0);
    let r = Math.random() * total;
    for (const a of candidates) {
      r -= (a.weight ?? 1);
      if (r < 0) return a.skill;
    }
    return candidates[candidates.length - 1].skill;
  }

  // 予定の技が今の状態で使えなくなっていたら（HPが減った等）決め直す
  refreshIntents() {
    for (const e of this.living(this.enemies)) {
      const candidates = this.enemyCandidates(e);
      const valid = candidates.length === 0
        ? e.intent === 'attack'
        : candidates.some(a => a.skill === e.intent);
      if (!valid) e.intent = this.rollEnemySkill(e);
    }
  }

  // 行動順リストに出す危険の予告（無ければ null）
  dangerOf(unit) {
    if (unit.side !== 'enemy') return null;
    if (unit.forcedSkill) return `⚠ ${SKILLS[unit.forcedSkill].name}`;
    if (unit.countdown) return `⚠ ${SKILLS[unit.countdown.skill].name}まで あと${unit.countdown.turns}`;
    const sd = trait(unit, 'selfDestruct');
    if (sd && unit.actCount + 1 >= sd.after) return '⚠ 行動後に自爆';
    const mc = trait(unit, 'merchant');
    if (mc) return `⚠ あと${Math.max(1, mc.turns - unit.actCount)}回で逃走`;
    const hatch = trait(unit, 'hatch');
    if (hatch) return `⚠ あと${Math.max(1, hatch.turns - unit.actCount)}回で孵化`;
    if (trait(unit, 'oneShot')) return '⚡ 雷が落ちる';
    const skill = SKILLS[unit.intent];
    if (skill && skill.danger) return `⚠ ${skill.name}`;
    if (isCharging(unit)) return '⚠ 力をためている';
    return null;
  }

  // 味方側のカウントダウン（死の宣告・氷漬け・反転の回復）を行動順リストに出す（無ければ null）
  allyNotice(unit) {
    if (unit.side !== 'ally') return null;
    const doom = unit.statuses.find(s => s.id === 'doom');
    if (doom) return `💀 死の宣告 あと${doom.turns}`;
    const ice = unit.statuses.find(s => s.id === 'entombed');
    if (ice) return `🧊 氷漬け あと${ice.turns - 1}`;
    if (unit.deferredHeals.length) return `🔄 回復まで あと${Math.min(...unit.deferredHeals.map(h => h.turns))}`;
    return null;
  }

  // 再生中のアニメーションが全部終わるまで待つ
  async flush() {
    while (this.pending.length) {
      const list = this.pending;
      this.pending = [];
      await Promise.all(list);
    }
  }

  // 次の行動へ
  next() {
    Watchdog.tick();
    if (this.over || this.checkEnd()) return;

    const actor = this.advanceTime();
    this.reanimateReady();
    this.current = actor;
    this.turnCount++;
    actor.guarding = false; // 防御は自分の次の行動開始時に解除
    for (const u of this.units) {
      if (u.coveredBy === actor) u.coveredBy = null; // かばうも自分の次の行動開始時に解除
    }
    this.log(`― ${actor.name}の番${actor.chainCount > 0 ? '（連続行動）' : ''} ―`, 'turn');
    this.beginTurn(actor);
  }

  // 行動開始時の処理（状態異常・再生・予告のカウント）→ 行動へ
  async beginTurn(actor) {
    // 魅了は「この行動」に効くので、残りターンが減る前に調べておく
    const charmed = hasStatus(actor, 'charm');
    if (actor.chainCount === 0) { // 連続行動の2回目以降はカウントしない
      // 巻き戻し用：自分の行動開始時のHPを記録（新しい5回分）
      actor.hpHistory.push(actor.hp);
      if (actor.hpHistory.length > 5) actor.hpHistory.shift();
      this.tickStatuses(actor);
      this.turnStartItems(actor);
      const regen = trait(actor, 'regen');
      if (regen && restoreHp(this, actor, actor.base.hp * regen.value, '（再生）') > 0) Fx.play('fx_heal', [actor]);
      if (actor.countdown) {
        actor.countdown.turns--;
        if (actor.countdown.turns <= 0) {
          actor.forcedSkill = actor.countdown.skill;
          actor.countdown = null;
        }
      }
      // ボスの段階で付いた「毎ターンの効果」（炎魔神の熱気・リヴァイアサンの渦潮）
      if (actor.turnAura) {
        const a = actor.turnAura;
        for (const o of this.opponentsOf(actor)) applyStatus(this, o, a.status, a.value, a.turns);
      }
      this.turnStartBoss(actor);
      // 氷の壁（氷晶ゴーレム）：決まったターンごとに、仲間全員に「次の攻撃を1回無効」
      const wall = trait(actor, 'iceWall');
      if (wall && actor.actCount % wall.every === wall.every - 1) {
        for (const f of this.friendsOf(actor)) applyStatus(this, f, 'iceWall', 0, 99);
      }
      // オーロラの光（オーロラの精）：仲間1体の能力をランダムに上げる
      const aurora = trait(actor, 'auroraBless');
      if (aurora) {
        const fr = this.friendsOf(actor);
        const f = fr[Math.floor(Math.random() * fr.length)];
        const stat = ['atk', 'def', 'spd'][Math.floor(Math.random() * 3)];
        applyBuff(f, { stat, rate: aurora.rate, turns: 3, tag: 'aurora' }, f === actor);
        this.log(`オーロラの光！ ${f.name}の${STAT_LABELS[stat]}が上がった！`, 'info');
      }
      // 魔界の時（魔王ディアボロス）：ほかの全員の行動順をランダムに入れ替える
      if (actor.turnShuffle) {
        const others = this.living(this.units).filter(u => u !== actor);
        const waits = others.map(u => u.wait).sort(() => Math.random() - 0.5);
        others.forEach((u, i) => { u.wait = waits[i]; });
        this.log('魔界の時！ 行動順が入れ替わった！', 'info');
      }
      if (actor.turnDebuff) {
        const d = actor.turnDebuff;
        this.log(`${d.label}！ ${this.opponentsOf(actor).map(o => o.name).join('・')}の${STAT_LABELS[d.stat]}が下がった！`, 'info');
        for (const o of this.opponentsOf(actor)) stackBuff(o, d.stat, d.rate, d.tag, d.limit);
      }
    }
    UI.render(this);
    await this.flush();
    if (battle !== this || this.over) return;

    // 毒などで倒れた
    if (!actor.alive) {
      this.current = null;
      UI.render(this);
      later(() => { if (battle === this) this.next(); }, BATTLE_CONFIG.turnInterval);
      return;
    }
    // 動かない敵（氷塊・虚神の目）
    if (trait(actor, 'noAct')) {
      this.endTurn(actor, null);
      return;
    }
    // 擬態中のミミックは何もしない
    if (actor.dormant) {
      this.log(`${actor.name}はじっとしている…`);
      this.endTurn(actor, null);
      return;
    }
    // 海中など、行動しない状態
    const skip = actor.statuses.find(s => STATUS_INFO[s.id].skipTurn);
    if (skip) {
      this.log(`${actor.name}は${STATUS_INFO[skip.id].name}で様子をうかがっている…`);
      this.endTurn(actor, null);
      return;
    }
    // 周期的な無敵化（大貝の殻・ガーゴイルの石化）：その間は行動しない
    const cycle = trait(actor, 'guardCycle');
    if (cycle && actor.chainCount === 0 && actor.actCount % cycle.every === cycle.every - 1) {
      applyStatus(this, actor, cycle.status, 0, 1);
      UI.render(this);
      this.endTurn(actor, null);
      return;
    }
    this.proceedTurn(actor, charmed);
  }

  // 行動開始時の、神々の塔のボスなどの処理
  turnStartBoss(actor) {
    // 反転（堕天使）：受けたダメージが、2ターン後に回復に変わる
    if (actor.deferredHeals.length) {
      let total = 0;
      actor.deferredHeals = actor.deferredHeals.filter(h => {
        h.turns--;
        if (h.turns > 0) return true;
        total += h.amount;
        return false;
      });
      if (total > 0) restoreHp(this, actor, total, '（反転：ダメージが回復に変わった）', true);
    }
    // 機神：自分の番が来たら、開いていたコアが閉じる
    if (trait(actor, 'coreBody')) {
      for (const p of this.partsOf(actor)) {
        if (p.coreLink && !hasStatus(p, 'shut')) {
          p.statuses.push({ id: 'shut', value: 0, turns: 999 });
          this.log(`${actor.name}のコアが閉じた。`, 'info');
        }
      }
    }
    // 昂り（炎獄竜）：毎ターン能力アップ
    const ramp = trait(actor, 'rampUp');
    if (ramp) {
      stackBuff(actor, ramp.stat, ramp.rate, 'ramp', ramp.limit);
      this.log(`${actor.name}の炎が燃え上がる！ ${STAT_LABELS[ramp.stat]}が上がった！`, 'info');
    }
    // 部位の再生（クラーケンの足）：壊れてから決まったターンがたつと生えてくる
    const sp = trait(actor, 'startParts');
    if (sp && sp.regrow && actor.regrowQueue && actor.regrowQueue.length) {
      actor.regrowQueue = actor.regrowQueue.map(t => t - 1);
      const ready = actor.regrowQueue.filter(t => t <= 0).length;
      actor.regrowQueue = actor.regrowQueue.filter(t => t > 0);
      if (ready > 0) {
        this.spawnParts(actor, sp.enemy, ready);
        this.log(`${actor.name}の${ENEMIES[sp.enemy].name}が${ready}本生えてきた！`, 'system');
      }
    }
    // 時の支配（クロノス）：「相手1人の行動を飛ばす」か「自分が2回行動」
    if (trait(actor, 'chronoControl')) {
      const opp = this.opponentsOf(actor);
      if (Math.random() < 0.5 && opp.length) {
        const t = opp[Math.floor(Math.random() * opp.length)];
        t.wait += this.fullWait(t);
        this.log(`時の支配！ ${t.name}の次の行動が飛ばされた！`, 'system');
      } else {
        actor.extraAction = true;
        this.log(`時の支配！ ${actor.name}はこのターン2回行動する！`, 'system');
      }
    }
    // 世界改変（オリジン）：決まった回数動くごとに、ルールを1つ変える
    if (actor.worldRule) {
      actor.ruleTimer--;
      if (actor.ruleTimer <= 0) this.changeRule(actor);
    }
  }

  // 世界改変：今と違うルールをランダムに1つ選んで切り替える
  changeRule(owner) {
    const rules = ['noHeal', 'noSkill', 'reverse'].filter(r => r !== this.rule);
    this.setRule(owner, rules[Math.floor(Math.random() * rules.length)]);
    owner.ruleTimer = owner.worldRule.every;
  }

  // 世界改変のルールを変える（表示用に、オリジンに状態異常としてアイコンを出す）。rule が null なら元に戻す
  setRule(owner, rule) {
    const before = this.rule;
    // 行動順逆転の切り替えでは、今の「ゲージの進み具合」を保ったまま待ち時間を付け替える
    const ratios = this.units.map(u => ({ u, r: u.wait / this.fullWait(u) }));
    this.rule = rule;
    if ((before === 'reverse') !== (rule === 'reverse')) {
      for (const { u, r } of ratios) u.wait = r * this.fullWait(u);
    }
    owner.statuses = owner.statuses.filter(s => !s.id.startsWith('rule_'));
    if (rule) applyStatus(this, owner, `rule_${rule}`, 0, 999);
    this.track(Anim.shakeScreen());
  }

  // 状態異常の効果と残りターン（自分の行動開始時に1減る）
  tickStatuses(actor) {
    let doomed = false;
    for (const s of actor.statuses) {
      const info = STATUS_INFO[s.id];
      // やけどは炎の属性（やけどで倒れたゾンビは起き上がらない）
      if (info.dot && actor.alive) directDamage(this, actor, actor.base.hp * s.value, `${info.name}で `, null, s.id === 'burn' ? 'fire' : null);
      s.turns--;
      if (s.turns <= 0 && info.deathOnExpire) doomed = true;
    }
    const wasEntombed = hasStatus(actor, 'entombed');
    actor.statuses = actor.statuses.filter(s => s.turns > 0);
    // 氷漬けが時間で解けたら、氷塊も溶けて消える
    if (wasEntombed && !hasStatus(actor, 'entombed')) {
      for (const o of this.units) {
        if (o.alive && o.iceFor === actor.uid) this.vanish(o, `${o.name}が溶けて、${actor.name}が動けるようになった！`);
      }
    }
    // 死の宣告：残りが0になったら即死
    if (doomed && actor.alive) {
      this.log(`死の宣告の時が来た… ${actor.name}の命が尽きる！`, 'system');
      Fx.play('fx_dark', [actor]);
      actor.lastElement = null;
      loseHp(actor, actor.hp);
      Anim.number(actor, '即死', 'dmg crit');
      if (actor.hp === 0) this.defeat(actor, null);
    }
  }

  // 行動を決める：魅了／プレイヤー入力／オート／敵AI
  proceedTurn(actor, charmed = false) {
    // 魅了（セイレーン）：1回だけ仲間を攻撃してしまう
    if (charmed) {
      const victims = this.friendsOf(actor).filter(u => u !== actor);
      if (victims.length) {
        UI.showWaiting(actor);
        this.log(`${actor.name}は魅了されて、仲間に襲いかかった！`, 'system');
        const victim = victims[Math.floor(Math.random() * victims.length)];
        later(() => {
          if (battle !== this || this.over) return;
          this.useSkill(actor, 'attack', [victim]);
        }, BATTLE_CONFIG.enemyDelay);
        return;
      }
    }
    if (actor.side === 'ally' && !gameState.settings.auto) {
      this.waitInput(actor); // プレイヤーの入力待ち
      return;
    }
    UI.showWaiting(actor);
    later(() => {
      if (battle !== this || this.over) return; // 別の戦闘が始まっていたら中断
      if (actor.side === 'enemy') {
        this.enemyAct(actor);
      } else if (gameState.settings.auto) {
        this.autoAct(actor);
      } else {
        this.waitInput(actor); // 待っている間にオートが切られた
      }
    }, BATTLE_CONFIG.enemyDelay);
  }

  // 行動開始時のアイテム効果（祈りのお守り・聖なる指輪）
  turnStartItems(actor) {
    const regen = gearBonus(actor, 'regen');
    if (regen > 0) restoreHp(this, actor, actor.base.hp * regen, '（お守り）');
    // 世界樹の護符：持っている人が生きていれば、味方それぞれの行動開始時に回復（重ならない）
    const charm = Math.max(0, ...this.friendsOf(actor).map(u => gearMax(u, 'teamCharm')));
    if (charm > 0) restoreHp(this, actor, actor.base.hp * charm, '（世界樹の護符）');
    const team = gearBonus(actor, 'teamRegen');
    if (team > 0) {
      for (const u of this.friendsOf(actor)) restoreHp(this, u, u.base.hp * team, '（聖なる指輪）');
    }
  }

  // プレイヤーのコマンド入力を待つ
  waitInput(actor) {
    this.waitingInput = true;
    UI.showCommands(this, actor);
  }

  // オート行動：autoRules を上から調べて、最初に当てはまったスキルを使う
  autoAct(unit) {
    this.waitingInput = false;
    const rule = (unit.autoRules || []).find(r =>
      this.canUse(unit, r.skill) && checkCondition(this, unit, r.when)) || { skill: 'attack' };
    this.useSkill(unit, rule.skill, this.ruleTargets(unit, rule));
  }

  // オート行動の対象を決める
  ruleTargets(user, rule) {
    const skill = SKILLS[rule.skill];
    const opp = this.opponentsOf(user);
    const fri = this.friendsOf(user);
    if (rule.target === 'charging') {
      const charging = opp.filter(isCharging);
      if (charging.length) return [lowestHp(charging)];
    }
    if (rule.target === 'nextEnemy') {        // 次に動く敵
      const next = this.nextOpponent(user);
      if (next) return [next];
    }
    if (rule.target === 'danger') {           // 大技を予告している敵
      const d = opp.filter(o => this.dangerOf(o));
      if (d.length) return [d[0]];
    }
    if (rule.target === 'fastest' && opp.length) {
      return [opp.reduce((a, c) => (getStat(c, 'spd') > getStat(a, 'spd') ? c : a))];
    }
    if (rule.target === 'weakestAlly' && fri.length) {
      return [fri.reduce((a, c) => (c.hp / c.base.hp < a.hp / a.base.hp ? c : a))];
    }
    if (rule.target === 'strongestAlly') {    // 攻撃が一番高い、自分以外の味方
      const others = fri.filter(f => f !== user);
      if (others.length) return [others.reduce((a, c) => (getStat(c, 'atk') > getStat(a, 'atk') ? c : a))];
    }
    if (skill.target === 'enemy') return [priorityTarget(opp)];
    return this.autoTargets(user, skill);
  }

  // 相手側で次に行動するユニット（行動順の予測で一番先の相手）
  nextOpponent(unit) {
    const next = this.orderEntries(BATTLE_CONFIG.orderPreview).find(e => e.unit.side !== unit.side && e.unit !== this.current);
    return next ? next.unit : null;
  }

  // スキルを使えるか（クールダウン中でない・気が必要な技は気がある）
  canUse(unit, skillId) {
    if (SKILLS[skillId].needsKi && !(unit.ki > 0)) return false;
    if (skillId !== 'attack' && hasStatus(unit, 'sealed')) return false; // 封印（魔眼）中は通常攻撃のみ
    // 世界改変「スキル禁止」：通常攻撃（と、何もしない）以外は使えない
    if (this.rule === 'noSkill' && !['attack', 'idle', 'haggle'].includes(skillId)) return false;
    return !(unit.cooldowns[skillId] > 0);
  }

  // スキルが対象選択を必要とするか（候補が2体以上いるとき）
  needsTargetChoice(user, skill) {
    if (skill.target === 'enemy') return this.opponentsOf(user).length > 1;
    if (skill.target === 'ally')  return this.friendsOf(user).length > 1;
    return false;
  }

  // 自動で対象を決める（敵AIや、対象が1体しかいないとき）
  autoTargets(user, skill) {
    const opp = this.opponentsOf(user);
    const fri = this.friendsOf(user);
    const byRatio = list => list.reduce((a, c) => (c.hp / c.base.hp < a.hp / a.base.hp ? c : a));
    switch (skill.target) {
      case 'enemy':
        // 狙い撃ち（影の暗殺者）：HP割合が一番低い相手を狙う
        if (trait(user, 'targetWeakest')) return [byRatio(opp)];
        return [opp[Math.floor(Math.random() * opp.length)]];
      case 'allEnemies': return opp;
      case 'weakestEnemy': return opp.length ? [lowestHp(opp)] : []; // 狙い撃ち：HPが一番低い敵（自動で狙う）
      case 'lowestRatioEnemy': return opp.length ? [byRatio(opp)] : []; // 死の鎌：HPの割合が一番低い相手
      case 'self':       return [user];
      case 'ally':       return [byRatio(fri)];
      case 'allAllies':  return fri;
      case 'deadAlly': {  // 倒れた仲間（蘇生）
        const dead = this.deadFriendsOf(user);
        return dead.length ? [dead[Math.floor(Math.random() * dead.length)]] : [];
      }
      default:           return [user];
    }
  }

  // 敵の行動：予告していた大技 → 予定していた技（使えなくなっていれば決め直す）
  enemyAct(enemy) {
    let skillId;
    if (enemy.forcedSkill) {
      skillId = enemy.forcedSkill;
      enemy.forcedSkill = null;
    } else {
      this.refreshIntents();
      skillId = enemy.intent || 'attack';
    }
    this.useSkill(enemy, skillId, this.autoTargets(enemy, SKILLS[skillId]));
  }

  // スキルを使う（味方・敵共通）
  // 流れ：（攻撃なら踏み込む）→ 効果を発動 → 戻る・被弾などのアニメーションが全部終わる → 行動終了
  async useSkill(user, skillId, targets) {
    this.waitingInput = false;
    this.skillId = skillId;
    user.dealtDamage = false;
    const skill = SKILLS[skillId];
    this.log(`${user.name}の${skill.name}！`);

    // 魔力集中：次のスキル（通常攻撃・防御・魔力集中そのもの以外）の効果を2倍にして解ける
    this.skillMult = 1;
    if (hasStatus(user, 'focus') && !['attack', 'defend', 'focus'].includes(skillId)) {
      this.skillMult = 2;
      user.statuses = user.statuses.filter(s => s.id !== 'focus');
      this.log('集中した魔力で、効果が2倍になった！', 'system');
    }

    // 相手にダメージを与えるスキルなら、踏み込んだタイミングでダメージ
    const isAttack = skill.effects.some(e =>
      (e.type === 'damage' && e.target !== 'self') || e.type === 'damageRandom' || e.type === 'kiBurst' || e.type === 'execute');
    if (isAttack) await Anim.stepIn(user);
    if (battle !== this) return; // 途中でやり直しになった
    if (skill.shake) this.track(Anim.shakeScreen());

    // エフェクト：攻撃なら当たった相手ごとに（strike の中で）、それ以外は対象全員にここで出す
    this.currentFx = Fx.forSkill(user, skillId);
    if (this.currentFx && !isAttack) {
      Fx.play(this.currentFx, skill.target === 'self' ? [user] : targets, user);
    }

    for (const eff of skill.effects) {
      const handler = EFFECT_HANDLERS[eff.type];
      if (!handler) { console.warn('未定義の効果:', eff.type); continue; }
      // 効果ごとの対象：self = 自分、allAllies = 自分の仲間全員、省略 = スキルの対象
      const effTargets = eff.target === 'self' ? [user]
        : eff.target === 'allAllies' ? this.friendsOf(user)
        : targets;
      for (const t of effTargets) {
        // 倒れた相手には効果なし（蘇生と、とどめを刺した相手から盗むのは別）
        if (!t.alive && eff.type !== 'revive' && eff.type !== 'steal') continue;
        handler(this, user, t, eff);
      }
    }
    this.skillMult = 1;
    this.currentFx = null;
    UI.render(this);

    if (isAttack) this.track(Anim.stepOut(user));
    await this.flush();
    if (battle !== this) return;

    // 居合（剣聖の亡霊）：相手が行動した直後に、必ずその相手に反撃する
    if (user.alive) {
      for (const o of this.opponentsOf(user)) {
        const iai = trait(o, 'iaiCounter');
        if (iai && !hasStatus(o, 'sleep')) this.counters.push({ by: o, to: user, power: iai.power, label: '居合' });
      }
    }

    // 反撃の鎧：攻撃が終わってから、受けた側が通常攻撃で反撃する
    const counters = this.counters;
    this.counters = [];
    for (const { by, to, power, label } of counters) {
      if (!by.alive || !to.alive) continue;
      this.log(`${by.name}の${label || '反撃'}！`, 'info');
      this.skillId = 'attack';
      this.currentFx = Fx.forSkill(by, 'attack');
      await Anim.stepIn(by);
      EFFECT_HANDLERS.damage(this, by, to, { type: 'damage', power: power || 1, isCounter: true });
      this.currentFx = null;
      UI.render(this);
      this.track(Anim.stepOut(by));
      await this.flush();
      if (battle !== this) return;
    }

    // 自爆（炎の精霊）：決められた回数行動したら爆発する
    const sd = trait(user, 'selfDestruct');
    if (sd && user.alive && user.actCount + 1 >= sd.after) {
      this.log(`${user.name}は自爆した！`, 'system');
      this.track(Anim.shakeScreen());
      Fx.play('fx_explosion', [user]);
      user.hp = 0;
      this.defeat(user, null);
      UI.render(this);
      await this.flush();
      if (battle !== this) return;
    }

    this.refreshIntents(); // HPの変化などで敵の予定が変わることがある
    this.endTurn(user, skillId);
  }

  // ユニットが倒れた（killer：倒した相手。毒などなら null）
  defeat(unit, killer = null) {
    if (!unit.alive) return;
    // 生命の神輪：1戦闘に1回、倒れるダメージを受けてもHPを残して耐える（終焉は防げない）
    const ls = gearSpecial(unit, 'lastStand');
    if (ls && !unit.lastStandUsed && !unit.annihilated) {
      unit.lastStandUsed = true;
      unit.hp = Math.max(1, Math.round(unit.base.hp * ls.ratio));
      this.log(`生命の神輪が輝き、${unit.name}はHP${Math.round(ls.ratio * 100)}%で踏みとどまった！`, 'system');
      this.track(Anim.heal(unit));
      Anim.number(unit, `+${unit.hp}`, 'heal');
      return;
    }
    // 九つの命（九尾の狐）：尾が残っていれば1本失ってHP全回復（尾が減るほどHP上限が下がる）
    const nine = trait(unit, 'nineLives');
    if (nine && unit.tails > 1) {
      unit.tails--;
      const lost = nine.count - unit.tails;
      unit.base.hp = Math.max(1, Math.round(unit.origMaxHp * (1 - nine.hpCut * lost)));
      unit.hp = unit.base.hp;
      unit.statuses = unit.statuses.filter(s => !STATUS_INFO[s.id].dot);
      this.log(`${unit.name}の尾が1本消えた…！ 命はあと${unit.tails}つ。HPが全回復した！`, 'system');
      this.track(Anim.heal(unit));
      Anim.number(unit, `🦊${unit.tails}`, 'heal');
      return;
    }
    // 復活（不死鳥のヒナ・帰還の指輪）：1度だけよみがえる
    const rebirth = trait(unit, 'rebirth') || gearSpecial(unit, 'revive');
    if (rebirth && !unit.rebirthUsed) {
      unit.rebirthUsed = true;
      unit.hp = Math.max(1, Math.round(unit.base.hp * rebirth.ratio));
      unit.statuses = [];
      this.log(unit.side === 'enemy'
        ? `${unit.name}${rebirth.text || 'は炎の中からよみがえった！'}`
        : `帰還の指輪が輝き、${unit.name}は立ち上がった！`, 'system');
      this.track(Anim.heal(unit));
      Anim.number(unit, `+${unit.hp}`, 'heal');
      return;
    }
    unit.alive = false;
    unit.buffs = [];
    unit.statuses = [];
    unit.countdown = null;
    unit.forcedSkill = null;
    this.log(`${unit.name}は倒れた！`, 'system');
    this.track(Anim.defeat(unit));
    // 部位や呼び出された敵（経験値なし）のカードは、倒れたら場から片付ける（再生・召喚でカードが増えすぎないように）
    if (unit.side === 'enemy' && (unit.isPart || unit.exp === 0)) this.dropCard(unit);
    // 起き上がり（ゾンビ）：炎・光の攻撃で倒されていなければ、少しあとに起き上がる（1回）
    const rean = trait(unit, 'reanimate');
    if (rean && !unit.reanimateUsed) {
      unit.reanimateUsed = true;
      if (unit.lastElement === 'fire' || unit.lastElement === 'light') {
        this.log(`${unit.name}は${unit.lastElement === 'fire' ? '炎' : '光'}で浄化され、もう起き上がらない。`, 'info');
      } else {
        unit.reanimateWait = this.fullWait(unit) * rean.turns;
        this.log(`${unit.name}はまだ動いている…（${rean.turns}ターン後に起き上がる）`, 'info');
      }
    }
    // 雪玉分裂（雪だるま兵）：雪玉に分かれ、少しあとに1つでも残っていれば復活する（1回）
    const snow = trait(unit, 'snowballSplit');
    if (snow && !unit.snowUsed) {
      unit.snowUsed = true;
      this.log(`${unit.name}は崩れて雪玉に分かれた！（${snow.turns}ターン後に1つでも残っていると復活）`, 'system');
      unit.snowballs = [];
      for (let i = 0; i < snow.count; i++) {
        const ball = this.spawnEnemy(snow.into, { force: true });
        if (ball) unit.snowballs.push(ball);
      }
      unit.reformWait = this.fullWait(unit) * snow.turns;
    }
    // 星の恵み（星の欠片）：倒されると、相手側の一番弱っている1人を全回復
    if (trait(unit, 'starBless')) {
      const opp = this.opponentsOf(unit);
      if (opp.length) {
        const t = opp.reduce((a, c) => (c.hp / c.base.hp < a.hp / a.base.hp ? c : a));
        this.log(`${unit.name}が砕け、星の光が${t.name}を包んだ！`, 'system');
        restoreHp(this, t, t.base.hp, '（星の恵み）');
        this.track(Anim.heal(t));
      }
    }
    // 呼び出した本人（次元の裂け目・氷河の巨人）が倒れたら、呼ばれた敵や氷も消える
    for (const o of this.units) {
      if (o.alive && o.linkedTo === unit.uid) this.vanish(o, `${o.name}は消えていった…`);
    }
    // 氷塊が壊れた／氷漬けの本人が倒れた：氷漬けを解く・氷を消す
    if (unit.iceFor) {
      const victim = this.units.find(u => u.uid === unit.iceFor);
      if (victim && hasStatus(victim, 'entombed')) {
        victim.statuses = victim.statuses.filter(s => s.id !== 'entombed');
        this.log(`氷が砕けて、${victim.name}が動けるようになった！`, 'system');
      }
    }
    for (const o of this.units) {
      if (o.alive && o.iceFor === unit.uid) this.vanish(o, `${o.name}は溶けて消えた。`);
    }
    // 守りの部位（虚神の目・オリジンの光の球）：全部壊れたら、本体の守りが消える
    if (unit.shieldOf) {
      const left = this.units.some(u => u.alive && u.shieldOf === unit.shieldOf);
      const owner = this.units.find(u => u.uid === unit.shieldOf);
      if (!left && owner && owner.alive && hasStatus(owner, 'voidVeil')) {
        owner.statuses = owner.statuses.filter(s => s.id !== 'voidVeil');
        this.log(`すべての${ENEMIES[unit.templateId].name}が砕けた！ ${owner.name}の守りが消えた！`, 'system');
        owner.intent = this.rollEnemySkill(owner);
      }
    }
    // 部位が壊れた：再生する部位（クラーケンの足）なら、再生を予約
    if (unit.isPart && unit.linkedTo) {
      const owner = this.units.find(u => u.uid === unit.linkedTo && u.alive);
      const sp = owner && trait(owner, 'startParts');
      if (sp && sp.regrow && sp.enemy === unit.templateId) (owner.regrowQueue = owner.regrowQueue || []).push(sp.regrow);
    }
    // ヒュドラの首：単体攻撃で倒されると2本に増える（最大まで）。全体攻撃で倒すと増えない
    const head = trait(unit, 'hydraHead');
    if (head && unit.linkedTo) {
      const owner = this.units.find(u => u.uid === unit.linkedTo && u.alive);
      if (owner && !unit.lastAoe) {
        const room = head.max - this.partsOf(owner).length;
        const grow = Math.min(2, room);
        if (grow > 0) {
          this.spawnParts(owner, unit.templateId, grow);
          this.log(`斬られた首の跡から、新しい首が${grow}本生えてきた！`, 'system');
        }
      } else if (owner) {
        this.log('全体攻撃で焼き払った！ 首は生えてこない！', 'info');
      }
    }
    // 世界改変をしていた本人（オリジン）が倒れたら、ルールは元に戻る
    if (unit.worldRule && this.rule) this.setRule(unit, null);
    // 死の宣告をかけた本人（冥王リッチ）が倒れたら、宣告は解ける
    for (const o of this.units) {
      if (o.statuses.some(s => s.id === 'doom' && s.from === unit.uid)) {
        o.statuses = o.statuses.filter(s => !(s.id === 'doom' && s.from === unit.uid));
        this.log(`${o.name}の死の宣告が解けた！`, 'system');
      }
    }
    // 仲間の仇（ヘルハウンド）：仲間が倒れるたびに攻撃アップ
    for (const f of this.friendsOf(unit)) {
      const fury = trait(f, 'packFury');
      if (!fury) continue;
      stackBuff(f, 'atk', fury.rate, 'fury', Math.pow(fury.rate, 6));
      this.log(`${f.name}は仲間の仇に燃えている！ 攻撃が上がった！`, 'info');
    }
    // 悪魔の商人：逃げる前に倒すとポイント＋上級アイテム
    const mc = trait(unit, 'merchant');
    if (mc && unit.side === 'enemy') {
      gameState.points += mc.points;
      grantBossReward();
      saveGame();
      this.log(`${unit.name}の荷物を手に入れた！ ポイント +${mc.points}、上級アイテムを1個選べる！`, 'system');
      UI.renderHeader();
      Panel.refresh();
    }
    // 📖図鑑に記録（初めて倒した敵ならお知らせ）
    if (unit.side === 'enemy' && unit.templateId && recordDefeat(unit.templateId, this.floor)) {
      this.log(`📖 ${ENEMIES[unit.templateId].name}が図鑑に登録された！`, 'system');
    }

    // 呪い（呪術師）：倒した相手の能力を下げる
    const curse = trait(unit, 'curseOnDeath');
    if (curse && killer && killer.alive && killer.side !== unit.side) {
      applyBuff(killer, { stat: curse.stat, rate: curse.rate, turns: curse.turns }, killer === this.current);
      this.log(`${unit.name}の呪い！ ${killer.name}の${STAT_LABELS[curse.stat]}が下がった！`, 'info');
    }
    // 爆炎（炎の精霊）：相手全員に炎のダメージ
    const blast = trait(unit, 'deathBlast');
    if (blast) {
      this.log(`${unit.name}が炎をまき散らした！`, 'system');
      for (const t of this.opponentsOf(unit)) {
        strike(this, unit, t, {
          power: blast.power, aoe: true, unavoidable: true, noCrit: true,
          noRedirect: true, noReflect: true, secondary: true, isCounter: true, label: '爆炎！ ', fx: 'fx_explosion',
        });
      }
    }
    // 分裂（スライム）
    const split = trait(unit, 'splitOnDeath');
    if (split && Math.random() < split.chance) {
      this.log(`${unit.name}が分裂した！`, 'system');
      for (let i = 0; i < split.count; i++) this.spawnEnemy(split.into);
    }
    // 宝（ミミック・強化個体）：倒すとアイテム選択1回
    if (trait(unit, 'rewardOnDefeat') && unit.side === 'enemy') {
      grantBonusReward(this.floor);
      this.log(`${unit.name}を倒した！ アイテムを1回選べる！`, 'system');
      Panel.refresh();
    }
    // 真珠（大貝）：倒すとポイント
    const pearl = trait(unit, 'pointsOnDefeat');
    if (pearl && unit.side === 'enemy') {
      gameState.points += pearl.value;
      saveGame();
      this.log(`${unit.name}から真珠が出てきた！ ポイント +${pearl.value}`, 'system');
      UI.renderHeader();
      Panel.refresh();
    }
  }

  // ダメージを受けて生き残ったあと（怒り・ボスの段階変化）
  afterDamaged(unit) {
    if (!unit.alive) return;
    const ratio = unit.hp / unit.base.hp;
    // 怒り（力ため鬼・強化個体）
    const enr = trait(unit, 'enrageAt');
    if (enr && !unit.enraged && ratio <= enr.below) {
      unit.enraged = true;
      applyBuff(unit, { stat: 'atk', rate: enr.rate, turns: 999, tag: 'enrage' }, unit === this.current);
      this.log(`${unit.name}は怒り狂った！ 攻撃が上がった！`, 'system');
    }
    // 噴出（溶岩ゴーレム）：HPが減ると、次の行動で大技を使う（1回だけ）
    const trig = trait(unit, 'triggerAt');
    if (trig && !unit.triggered && ratio <= trig.below) {
      unit.triggered = true;
      unit.forcedSkill = trig.skill;
      this.log(`${unit.name}の体から溶岩があふれ出した！`, 'system');
    }
    // 巻き戻し（時の神クロノス）：HPが減ると1回だけ、戦闘開始時のHPに戻る
    const cr = trait(unit, 'chronoRewind');
    if (cr && !unit.chronoRewound && ratio <= cr.below) {
      unit.chronoRewound = true;
      unit.hp = Math.min(unit.base.hp, unit.startHp || unit.base.hp);
      this.log(`${unit.name}「時よ、戻れ。」 時が巻き戻り、HPが戦闘開始時に戻った！`, 'system');
      this.track(Anim.heal(unit));
      this.track(Anim.speech(unit, '時よ、戻れ。'));
      return;
    }
    // ふくらむ（毒フグ）：攻撃を受けると防御2倍＋反射
    if (trait(unit, 'puffUp') && !hasStatus(unit, 'puffed')) applyStatus(this, unit, 'puffed', 0, 2);
    // 変身（吸血鬼）：HPが減ると、コウモリの群れに分かれる
    const sp = trait(unit, 'splitAt');
    if (sp && !unit.splitDone && ratio <= sp.below) {
      unit.splitDone = true;
      this.log(`${unit.name}はコウモリの群れに姿を変えた！`, 'system');
      // 元の体は消える（倒した扱いで図鑑にも記録）
      unit.alive = false;
      unit.hp = 0;
      unit.buffs = [];
      unit.statuses = [];
      this.track(Anim.defeat(unit));
      if (unit.templateId) recordDefeat(unit.templateId, this.floor);
      for (let i = 0; i < sp.count; i++) {
        const bat = this.spawnEnemy(sp.into);
        if (!bat) break;
        bat.base.hp = Math.max(1, Math.round(unit.base.hp * sp.ratio));
        bat.hp = bat.base.hp;
      }
      return;
    }
    // ボスの段階変化
    while (unit.phases && unit.phaseIndex < unit.phases.length && ratio < unit.phases[unit.phaseIndex].below) {
      this.enterPhase(unit, unit.phases[unit.phaseIndex]);
      unit.phaseIndex++;
    }
  }

  // ボスが次の段階に入る（セリフ・画面の揺れ・強化・召喚など）
  enterPhase(unit, ph) {
    this.log(`${unit.name}「${ph.speech}」`, 'system');
    this.track(Anim.speech(unit, ph.speech));
    if (ph.shake) this.track(Anim.shakeScreen());
    if (ph.message) this.log(ph.message, 'system');
    for (const bf of ph.buffs || []) {
      applyBuff(unit, { stat: bf.stat, rate: bf.rate, turns: 999, tag: 'phase' }, unit === this.current);
    }
    if (ph.actionsPerTurn) unit.actionsPerTurn = ph.actionsPerTurn;
    if (ph.summon) {
      for (let i = 0; i < ph.summon.count; i++) this.spawnEnemy(ph.summon.enemy);
    }
    if (ph.enrage) unit.enraged = true; // 見た目を怒り状態に
    // 大技の予告
    if (ph.countdown) {
      unit.countdown = { ...ph.countdown };
      this.log(`${unit.name}は${SKILLS[ph.countdown.skill].name}の力をためはじめた！（${ph.countdown.turns}ターン後）`, 'system');
    }
    // 時を止める：相手全員の行動ゲージを0に
    if (ph.timeStop) {
      for (const o of this.opponentsOf(unit)) o.wait = this.fullWait(o);
    }
    // 毎ターンの効果を付ける（自分の行動開始時に発動）
    if (ph.turnAura) unit.turnAura = ph.turnAura;
    if (ph.turnDebuff) unit.turnDebuff = ph.turnDebuff;
    if (ph.turnShuffle) unit.turnShuffle = true; // 魔界の時：毎ターン行動順を入れ替える
    // 世界改変（オリジン）：すぐにルールを1つ変え、以後は every 回動くごとに変える
    if (ph.worldRule) {
      unit.worldRule = ph.worldRule;
      this.changeRule(unit);
    }
    // 部位を出す（腕の光の球など）。shield なら全部壊すまで本体は無敵
    if (ph.parts) this.spawnParts(unit, ph.parts.enemy, ph.parts.count, { shield: ph.parts.shield });
    // 重力崩壊など：相手全員の能力を下げる（1回）
    if (ph.debuffAll) {
      for (const o of this.opponentsOf(unit)) applyBuff(o, { ...ph.debuffAll, tag: 'phaseDebuff' }, o === this.current);
    }
    // 虚神の目：目を呼び出し、全部壊すまで本体は無敵
    if (ph.eyes) this.spawnParts(unit, ph.eyes.enemy, ph.eyes.count, { shield: true });
    unit.intent = this.rollEnemySkill(unit);
  }

  // 擬態中のミミックが目覚める：行動ゲージ満タン＋次の攻撃2倍
  wake(unit) {
    unit.dormant = false;
    unit.wait = 0;
    applyBuff(unit, { stat: 'atk', rate: 2, turns: 1, tag: 'charge' }, false);
    unit.intent = this.rollEnemySkill(unit);
    this.log(`${unit.name}が正体を現した！`, 'system');
  }

  // 戦闘中に敵を増やす（分裂・召喚）。場に出られるのは最大 DUNGEON.maxEnemies 体
  // opts.force: 場の上限を超えても出す（氷塊・虚神の目）
  spawnEnemy(templateId, opts = {}) {
    if (!opts.force && this.living(this.enemies).length >= DUNGEON.maxEnemies) return null;
    const same = this.enemies.filter(e => e.templateId === templateId).length;
    const name = ENEMIES[templateId].name + (same > 0 ? String.fromCharCode(65 + same) : '');
    const unit = createEnemyUnit(templateId, this.floor, name);
    applyMirrorCopy(this, unit); // 鏡の悪魔：出てきたときに相手をコピー
    unit.wait = this.fullWait(unit);
    unit.intent = this.rollEnemySkill(unit);
    this.enemies.push(unit);
    this.units.push(unit);
    UI.addUnitCard(this, unit);
    if (!opts.quiet) this.log(`${unit.name}が現れた！`, 'system');
    return unit;
  }

  // 分裂（闇スライム）：HPを半分に分けて、同じ敵をもう1体出す（同じ種類は最大 max 体まで）
  splitByHit(unit, t) {
    const same = this.living(this.enemies).filter(e => e.templateId === unit.templateId).length;
    if (unit.side !== 'enemy' || same >= t.max) return;
    const half = Math.floor(unit.hp / 2);
    const copy = this.spawnEnemy(unit.templateId);
    if (!copy) return;
    unit.hp -= half;
    copy.base = { ...unit.base };
    copy.hp = half;
    copy.exp = 0; // 分裂した分には経験値なし（増やし放題にならないように）
    this.log(`${unit.name}が分裂した！`, 'system');
  }

  // 逃走（悪魔の商人）：倒れた扱いにはせず、場からいなくなる（経験値なし）
  flee(unit) {
    unit.alive = false;
    unit.fled = true;
    unit.exp = 0;
    unit.buffs = [];
    unit.statuses = [];
    this.log(`${unit.name}は「またのお越しを…」と逃げ出した！`, 'system');
    this.track(Anim.defeat(unit));
  }

  // 場から消える（呼び出した本人が倒れた・氷が溶けたなど）。倒した扱いにはしない（経験値なし）
  vanish(unit, text) {
    if (!unit.alive) return;
    unit.alive = false;
    unit.exp = 0;
    unit.buffs = [];
    unit.statuses = [];
    unit.countdown = null;
    unit.forcedSkill = null;
    if (text) this.log(text, 'info');
    this.track(Anim.defeat(unit));
    this.dropCard(unit);
  }

  // 倒れた敵のカードを、消える演出のあとに場から取り除く
  dropCard(unit) {
    sleep(ANIM_MS.defeat).then(() => {
      if (unit.alive || !unit.dom) return;
      unit.dom.card.remove();
      unit.dom = null;
      if (battle) UI.render(battle);
    });
  }

  // 孵化（虚無の卵 → 虚神の眷属）：同じ場所で別の敵に生まれ変わる（HPは満タン）
  hatchInto(unit, templateId) {
    const t = ENEMIES[templateId];
    const fresh = createEnemyUnit(templateId, this.floor, t.name);
    const oldName = unit.name;
    withSpeedRescale(unit, () => { unit.base = fresh.base; });
    unit.hp = unit.base.hp;
    unit.name = t.name;
    unit.templateId = templateId;
    unit.type = t.type;
    unit.ai = t.ai;
    unit.traits = fresh.traits;
    unit.attackEffect = t.attackEffect || null;
    unit.exp = 0;
    if (unit.dom) unit.dom.card.querySelector('.name').firstChild.textContent = unit.name;
    this.log(`${oldName}が孵化した！ ${unit.name}が生まれた！`, 'system');
    this.track(Anim.shakeScreen());
    Fx.play('fx_dark', [unit]);
  }

  // 行動終了の処理（usedSkillId：使ったスキル。何もしなかったときは null）
  endTurn(user, usedSkillId) {
    Watchdog.tick();
    user.actCount++;
    // 悪魔の商人：決められた回数行動したら逃げる
    const mc = trait(user, 'merchant');
    if (mc && user.alive && user.actCount >= mc.turns) this.flee(user);
    // 孵化（虚無の卵）：決められた回数行動したら、別の敵に生まれ変わる
    const hatch = trait(user, 'hatch');
    if (hatch && user.alive && user.actCount >= hatch.turns) this.hatchInto(user, hatch.into);
    // クールダウンを1減らしてから、今使ったスキルのクールダウンを設定
    for (const id in user.cooldowns) {
      if (user.cooldowns[id] > 0) user.cooldowns[id]--;
    }
    // 1戦闘1回の技は、その戦闘中はもう使えない（クールダウンを大きくしておく）
    let cd = usedSkillId && (SKILLS[usedSkillId].oncePerBattle ? 9999 : SKILLS[usedSkillId].cooldown);
    // 叡智の宝珠：スキルの使用制限ターンを短くする（1戦闘1回の技は別）
    const cut = gearMax(user, 'cooldownCut');
    if (cd && cd < 9999 && cut > 0) cd = Math.max(0, cd - cut);
    if (cd) user.cooldowns[usedSkillId] = cd;

    // 加速（機械兵）：行動するたびに速度が上がる
    const accel = trait(user, 'accelerate');
    if (accel && user.alive && usedSkillId) stackBuff(user, 'spd', accel.rate, 'accel', accel.max);

    // 攻撃したあとの装備効果
    if (user.dealtDamage && user.alive) {
      user.attackedOnce = true; // 「戦闘で最初の攻撃」はもう終わり（先駆けの剣・閃光のピアス）
      const dOn = gearSpecial(user, 'defOnAttack');                  // 騎士の剣
      if (dOn) stackBuff(user, 'def', dOn.rate, 'knightSword', Math.pow(dOn.rate, dOn.max));
      const hOn = gearSpecial(user, 'healOnAttack');                 // 祝福の剣
      if (hOn) restoreHp(this, user, user.base.hp * hOn.ratio, '（祝福の剣）');
      // 気（拳闘家）：攻撃するたびに1たまる（百烈拳で使い切ったときは増えない）
      if (user.kiMax && usedSkillId !== 'hyakuretsu' && user.ki < user.kiMax) user.ki++;
    }

    // バフの残りターンを減らし、切れたものを消す
    withSpeedRescale(user, () => {
      user.buffs = user.buffs.filter(b => {
        if (b.skip) { b.skip = false; return true; }
        b.turns--;
        if (b.turns <= 0) {
          this.log(`${user.name}の${STAT_LABELS[b.stat]}変化が元に戻った。`, 'info');
          return false;
        }
        return true;
      });
    });

    // 待ち時間をリセット（10000 ÷ 現在の速度）
    if (user.alive) user.wait = this.fullWait(user);
    this.current = null;

    // 魔力集中：行動のあと、行動ゲージを進める
    if (user.nextHaste && user.alive) {
      user.wait = Math.max(0, user.wait - this.fullWait(user) * user.nextHaste);
      user.nextHaste = 0;
    }

    // 風読みの羽：スキル（通常攻撃以外）を使ったあと、行動ゲージを進める
    const sh = gearSpecial(user, 'skillHaste');
    if (sh && user.alive && usedSkillId && usedSkillId !== 'attack') {
      user.wait = Math.max(0, user.wait - this.fullWait(user) * sh.amount);
    }

    // 疾風剣：ダメージを与えた行動のあと、確率で行動ゲージを進める
    const haste = gearSpecial(user, 'hasteOnAttack');
    if (haste && user.alive && user.dealtDamage && Math.random() < haste.chance) {
      user.wait = Math.max(0, user.wait - this.fullWait(user) * haste.amount);
      this.log(`${user.name}は疾風のように次の行動へ！`, 'info');
    }

    // 氷の滑走（ペンギン騎士）：行動のあと、確率で行動ゲージを進める
    const slide = trait(user, 'iceSlide');
    if (slide && user.alive && usedSkillId && Math.random() < slide.chance) {
      user.wait = Math.max(0, user.wait - this.fullWait(user) * slide.amount);
      this.log(`${user.name}は氷の上を滑って次の行動へ！`, 'info');
    }

    // 1ターンに複数回行動（覚醒した竜王など）：すぐにもう一度行動する
    if (user.alive && user.chainCount + 1 < user.actionsPerTurn) {
      user.chainCount++;
      user.wait = 0;
    } else {
      user.chainCount = 0;
    }
    // 時の支配（クロノス）の「2回行動」：すぐにもう一度行動する
    if (user.alive && user.extraAction) {
      user.extraAction = false;
      user.chainCount = Math.max(1, user.chainCount);
      user.wait = 0;
    }
    // 天翼：行動のあと、確率でもう一度行動する
    const et = gearMax(user, 'extraTurn', 'chance');
    if (et > 0 && user.alive && usedSkillId && user.wait > 0 && Math.random() < et) {
      user.chainCount = Math.max(1, user.chainCount);
      user.wait = 0;
      this.log(`天翼の力！ ${user.name}はもう一度行動する！`, 'info');
    }
    // 一撃（雷の太鼓）：1回行動したら消える
    if (trait(user, 'oneShot') && user.alive) this.vanish(user, null);

    // 行動した敵は、次に使う技を決める（力をためた直後なら大技を予定する、など）
    if (user.side === 'enemy' && user.alive && !user.dormant) user.intent = this.rollEnemySkill(user);
    this.refreshIntents();

    UI.render(this);
    later(() => {
      if (battle !== this) return;
      this.next();
    }, BATTLE_CONFIG.turnInterval);
  }

  // 勝敗判定
  checkEnd() {
    if (this.living(this.enemies).length === 0) {
      this.finish(true);
      return true;
    }
    if (this.living(this.allies).length === 0) {
      this.finish(false);
      return true;
    }
    return false;
  }

  // 諦める：全滅と同じ扱いでチェックポイントへ戻る（獲得済みの経験値・アイテムはそのまま）
  giveUp() {
    if (this.over) return;
    this.gaveUp = true;
    this.log('諦めて撤退した…', 'system');
    this.finish(false);
  }

  finish(win) {
    Watchdog.tick();
    this.over = true;
    this.current = null;
    this.waitingInput = false;
    onBattleEnd(this, win);
    UI.render(this);
  }
}

// 一番残りHPが少ないユニット
function lowestHp(list) {
  return list.reduce((a, c) => (c.hp < a.hp ? c : a));
}

// オートで狙う敵：TARGET_PRIORITY のタイプ順 → 残りHPが一番少ない敵
// 攻撃が効かない相手（無敵・閉じたコア）は後回し。部位（足・目・球・開いたコアなど）は優先して狙う
// （倒すと増える部位＝ヒュドラの首は後回し）
function priorityTarget(list) {
  const hittable = list.filter(u => !isInvulnerable(u));
  if (hittable.length) list = hittable;
  const parts = list.filter(u => u.isPart && !u.autoAvoid);
  if (parts.length) return lowestHp(parts);
  const notAvoid = list.filter(u => !u.autoAvoid);
  if (notAvoid.length) list = notAvoid;
  for (const type of TARGET_PRIORITY) {
    const found = list.filter(u => u.type === type);
    if (found.length) return lowestHp(found);
  }
  return lowestHp(list);
}

// ---------------------------------------------------------------------
// 画面表示（DOM操作はここにまとめる）
// ---------------------------------------------------------------------
const UI = {
  el: {
    autoBtn:   document.getElementById('auto-btn'),
    speedBtns: document.getElementById('speed-buttons'),
    floor:     document.getElementById('floor-status'),
    enemies:  document.getElementById('enemy-area'),
    allies:   document.getElementById('ally-area'),
    cmdTitle: document.getElementById('command-title'),
    cmdBtns:  document.getElementById('command-buttons'),
    desc:     document.getElementById('skill-desc'),
    result:   document.getElementById('result'),
    log:      document.getElementById('log'),
    status:   document.getElementById('global-status'),
    tip:      document.getElementById('skill-tip'),
  },

  // 表示を更新する（カードは作り直さないので、再生中のアニメーションは途切れない）
  render(b) {
    // 敵のカードが多いとき（部位・召喚）は小さくして1列に収める（CSS の crowd7 / crowd9）
    const n = this.el.enemies.children.length;
    this.el.enemies.classList.toggle('crowd7', n >= 7);
    this.el.enemies.classList.toggle('crowd9', n >= 9);
    // 各キャラが「何番目に行動するか」（カードの行動順表示に使う。墨で見えないときは出さない）
    const inked = b.allies.some(u => u.alive && hasStatus(u, 'ink'));
    this.turnPos = new Map();
    if (!b.over && !inked) {
      b.orderEntries(BATTLE_CONFIG.orderPreview).forEach((e, i) => {
        if (!this.turnPos.has(e.unit.uid)) this.turnPos.set(e.unit.uid, i);
      });
    }
    this.inked = inked;
    for (const u of b.units) this.updateUnit(u, b);
    OrderList.render(b);
    UnitDetail.refresh(); // 詳細パネルが開いていれば最新の数値に
  },
  turnPos: new Map(),
  inked: false,

  // 戦闘開始時にカードを作る
  //   .sprite-box … 立ち絵の置き場所（数字の表示もここ）
  //     .actor    … 行動アニメーション（踏み込み・被弾・回復・戦闘不能）
  //       .aura   … 状態の色（力をためている・怒り）
  //         img   … 待機アニメーション（data.js の idle で指定したクラス）
  //     .badges   … 状態異常のアイコンと残りターン
  buildUnits(b) {
    this.el.enemies.innerHTML = '';
    this.el.allies.innerHTML = '';
    for (const u of b.units) this.addUnitCard(b, u);
  },

  // カードを1枚作って並べる（戦闘中に増えた敵にも使う）
  addUnitCard(b, u) {
    if (u.hidden) return; // 画面に出ない敵（雷帝の太鼓）は行動順リストにだけ出る
    const card = document.createElement('div');
    card.className = `unit ${u.side}` + (u.elite ? ' elite' : '') + (u.size ? ` ${u.size}` : '') + (u.isPart ? ' part' : '');
    const sub = u.side === 'ally'
      ? `Lv${u.level} / ${ROLE_LABELS[u.role] || ''}`
      : ENEMY_TYPE_LABELS[u.type] || '';
    // 特殊能力のアイコン（マウスを乗せると説明）
    const traits = u.traits
      .filter(t => TRAIT_INFO[t.type])
      .map(t => {
        const info = TRAIT_INFO[t.type];
        const name = t.label || info.name;
        return `<span class="trait-icon" title="${name}：${info.desc(t)}">${info.icon}</span>`;
      }).join('');
    card.innerHTML = `
      <div class="sprite-box">
        <div class="badges"></div>
        <div class="actor"><div class="aura">
          ${u.image ? `<img class="portrait ${u.idle}" src="${u.image}" alt="${u.name}">` : ''}
        </div></div>
        <div class="popups"></div>
      </div>
      <div class="name">${u.name}<span class="traits">${traits}</span></div>
      <div class="sub">${sub}</div>
      <div class="hpbar"><div></div></div>
      <div class="turn-badge"></div>
      <div class="hp-text"></div>
      <div class="stats"></div>
      <div class="status"></div>`;
    // タップで詳細パネル（攻撃・防御・速さ・レベル・バフ／デバフなど）
    // 技の対象を選んでいる最中なら、タップしたキャラ（部位も）をそのまま狙う
    card.addEventListener('click', () => {
      const tg = this.targeting;
      if (tg && battle === tg.b && tg.b.waitingInput && tg.list.includes(u) && u.alive) {
        this.execute(tg.b, tg.actor, tg.skillId, [u]);
        return;
      }
      UnitDetail.open(u);
    });

    // 画像が読み込めないときは、名前の1文字目を代わりに出す
    const img = card.querySelector('img.portrait');
    if (img) {
      img.addEventListener('error', () => {
        const alt = document.createElement('div');
        alt.className = `portrait portrait-fallback ${u.idle}`;
        alt.textContent = u.name.replace('★', '').charAt(0);
        img.replaceWith(alt);
      });
    }

    u.dom = {
      card,
      actor:  card.querySelector('.actor'),
      aura:   card.querySelector('.aura'),
      badges: card.querySelector('.badges'),
      popups: card.querySelector('.popups'),
      hpFill: card.querySelector('.hpbar > div'),
      hpText: card.querySelector('.hp-text'),
      turn:   card.querySelector('.turn-badge'),
      stats:  card.querySelector('.stats'),
      status: card.querySelector('.status'),
    };
    (u.side === 'enemy' ? this.el.enemies : this.el.allies).appendChild(card);
    this.updateUnit(u, b);
  },

  // カード1枚の表示を更新
  updateUnit(u, b) {
    const d = u.dom;
    if (!d) return;
    // 機神のコア：HPバーは本体のHPを映す
    if (u.coreLink && b) {
      const owner = b.units.find(x => x.uid === u.linkedTo);
      if (owner) { u.hp = owner.hp; u.base.hp = owner.base.hp; }
    }
    const ratio = u.hp / u.base.hp;

    d.card.classList.toggle('acting', u === b.current);
    d.card.classList.toggle('dead', !u.alive);
    d.card.classList.toggle('enraged', u.alive && (u.enraged || (u.enrageBelow !== null && ratio < u.enrageBelow)));
    d.aura.classList.toggle('charging', u.alive && isCharging(u));
    d.card.classList.toggle('dormant', u.alive && u.dormant);

    // キャラの上の状態異常アイコン（＋残りターン）、大技の予告、擬態
    const badges = [];
    if (u.alive) {
      for (const s of u.statuses) {
        const info = STATUS_INFO[s.id];
        badges.push(`<span class="sbadge ${s.id}" title="${info.name}：${info.desc(s)}">${info.icon}${s.turns >= 99 ? '' : s.turns}</span>`);
      }
      if (u.countdown) badges.push(`<span class="sbadge countdown" title="${SKILLS[u.countdown.skill].name}まで あと${u.countdown.turns}ターン">⏳${u.countdown.turns}</span>`);
      if (u.dormant) badges.push('<span class="sbadge dormant" title="擬態中（攻撃されるまで動かない）">💤</span>');
      // 星の点（星座の獣）：残りの星の数
      const st = trait(u, 'stars');
      // バリア（魔王の牙）
      if (u.barrier > 0) badges.push(`<span class="sbadge countdown" title="バリア：あと${u.barrier}ダメージまで受け止める">🛡${u.barrier}</span>`);
      // 九つの命（九尾の狐）：残りの命
      if (u.tails) badges.push(`<span class="sbadge countdown" title="九つの命：あと${u.tails}回HPが0になると倒れる">🦊${u.tails}</span>`);
      // 反転（堕天使）：あとで回復に変わるダメージ
      if (u.deferredHeals.length) {
        const h = u.deferredHeals.reduce((s, x) => s + x.amount, 0);
        const t = Math.min(...u.deferredHeals.map(x => x.turns));
        badges.push(`<span class="sbadge countdown" title="反転：受けたダメージ${h}が、あと${t}ターンで回復に変わる">💚${t}</span>`);
      }
      if (st && u.stars > 0) badges.push(`<span class="sbadge stars" title="星の点：受けるダメージ-${Math.round(st.cut * u.stars * 100)}%（会心を受けると1つ消える）">✨${u.stars}</span>`);
      // 歌などの強化（tag が BUFF_BADGES にあるもの）：アイコン＋残りターン
      for (const bf of u.buffs) {
        const bb = BUFF_BADGES[bf.tag];
        if (bb) badges.push(`<span class="sbadge song" title="${bb.name}：${STAT_LABELS[bf.stat]}×${bf.rate}（あと${bf.turns}ターン）">${bb.icon}${bf.turns}</span>`);
      }
      // 気（拳闘家）
      if (u.kiMax) badges.push(`<span class="sbadge ki${u.ki >= u.kiMax ? ' full' : ''}" title="気：${u.ki}/${u.kiMax}（気1つにつき攻撃+${Math.round(u.kiAtk * 100)}%）">気${u.ki}</span>`);
    }
    d.badges.innerHTML = badges.join('');

    d.hpFill.style.width = `${ratio * 100}%`;
    d.hpFill.className = ratio < 0.25 ? 'low' : ratio < 0.5 ? 'mid' : '';
    d.hpText.textContent = `HP ${u.hp} / ${u.base.hp}`;

    // 行動順（常に表示）：今行動中／何番目に行動するか
    const pos = this.turnPos.get(u.uid);
    let turn = '';
    if (!u.alive) turn = '';
    else if (u === b.current) turn = '▶ 行動中';
    else if (this.inked) turn = '⏱ ？';
    else if (pos !== undefined) turn = `⏱ ${pos + 1}番目`;
    else turn = '⏱ まだ先';
    d.turn.textContent = turn;
    d.turn.classList.toggle('now', u === b.current);
    d.turn.classList.toggle('soon', pos !== undefined && pos <= 1 && u !== b.current);
    d.stats.textContent =
      `攻${Math.round(getStat(u, 'atk'))} 防${Math.round(getStat(u, 'def'))} 速${Math.round(getStat(u, 'spd'))}` +
      ` ／ 待ち ${u.alive ? Math.round(u.wait) : '-'}`;

    // 状態表示（防御中・バフ）
    const status = [];
    if (u.guarding) status.push('防御中');
    if (u.coveredBy && u.coveredBy.alive) status.push(`${u.coveredBy.name}がかばい中`);
    if (isCharging(u)) status.push('力をためている');
    for (const bf of u.buffs) {
      const turns = bf.turns >= 99 ? '' : `(${bf.turns})`;
      status.push(`${STAT_LABELS[bf.stat]}${bf.rate > 1 ? '↑' : '↓'}${turns}`);
    }
    d.status.textContent = status.join(' ');
  },

  // 行動順リストのプレビューを出す／消す（entries が null なら通常表示に戻す）
  setPreview(entries) {
    OrderList.preview = entries;
    if (battle) OrderList.render(battle);
  },

  // コマンド欄をクリア（プレビューも終了）
  clearCommands() {
    this.hideTip();
    if (this.targeting) {
      for (const u of this.targeting.list) if (u.dom) u.dom.card.classList.remove('targetable');
      this.targeting = null;
    }
    this.el.cmdBtns.innerHTML = '';
    this.el.desc.textContent = '';
    OrderList.preview = null;
  },

  // コマンドボタンを追加
  // getPreview: マウスを乗せたときに行動順プレビューを作る関数（省略可）
  // tip: 吹き出しに出す説明（HTML。PC はマウスを乗せる、スマホは長押しで出る）
  addButton(label, onClick, disabled = false, desc = '', getPreview = null, tip = '') {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.disabled = disabled;
    // 長押しで説明を出したときは、指を離しても技は使わない
    let longPressed = false;
    let pressTimer = null;
    btn.addEventListener('click', e => {
      if (longPressed) { longPressed = false; e.preventDefault(); return; }
      this.hideTip();
      onClick();
    });
    const enter = () => {
      if (desc) this.el.desc.textContent = desc;
      if (getPreview) this.setPreview(getPreview());
    };
    const leave = () => {
      if (getPreview) this.setPreview(null);
    };
    btn.addEventListener('mouseenter', enter);
    btn.addEventListener('focus', enter);
    btn.addEventListener('mouseleave', leave);
    btn.addEventListener('blur', leave);
    if (tip) {
      // PC：マウスを乗せると吹き出し
      btn.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') this.showTip(btn, tip); });
      btn.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.hideTip(); });
      // スマホ：長押し（0.45秒）で吹き出し。指を離すと少しして消える
      btn.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse') return;
        longPressed = false;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => { longPressed = true; this.showTip(btn, tip); enter(); }, 450);
      });
      const release = () => {
        clearTimeout(pressTimer);
        if (longPressed) setTimeout(() => this.hideTip(), 1500);
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('contextmenu', e => e.preventDefault()); // 長押しメニューを出さない
      // 押せない（使用済みなど）ボタンでも説明は見られるようにする
      if (disabled) {
        btn.disabled = false;
        btn.classList.add('is-disabled');
        btn.setAttribute('aria-disabled', 'true');
        onClick = () => {};
      }
    }
    this.el.cmdBtns.appendChild(btn);
  },

  // 敵の行動中の表示
  showWaiting(actor) {
    this.clearCommands();
    this.el.cmdTitle.textContent = `${actor.name}の行動中…`;
  },

  // 味方のコマンド選択
  showCommands(b, actor) {
    this.clearCommands();
    this.el.cmdTitle.textContent = `${actor.name}の行動を選んでください`;
    const n = BATTLE_CONFIG.orderPreview;
    for (const id of actor.skills) {
      const skill = SKILLS[id];
      const cd = actor.cooldowns[id] || 0;
      // 使えない理由をボタンに出す：1戦闘1回は「使用済み」、気が必要な技は「気が必要」、それ以外は残りターン
      const label = id !== 'attack' && hasStatus(actor, 'sealed') ? `${skill.name}（封印）`
        : skill.oncePerBattle && cd > 0 ? `${skill.name}（使用済み）`
        : cd > 0 ? `${skill.name}（あと${cd}）`
        : skill.needsKi && !(actor.ki > 0) ? `${skill.name}（気が必要）`
        : skill.needsKi ? `${skill.name}（気${actor.ki}）`
        : skill.oncePerBattle ? `${skill.name}（1戦闘1回）`
        : skill.name;
      // プレビューの対象：敵1体ならオートと同じ優先順の敵（対象選択画面では、選ぶ相手ごとにプレビュー）
      const previewTargets = () => skill.target === 'enemy'
        ? [priorityTarget(b.opponentsOf(actor))]
        : b.autoTargets(actor, skill);
      this.addButton(label, () => {
        if (b.needsTargetChoice(actor, skill)) {
          this.showTargets(b, actor, id);
        } else {
          this.execute(b, actor, id, b.autoTargets(actor, skill));
        }
      }, !b.canUse(actor, id), `${skillDescText(skill)}（${skillLimitText(skill)}）`,
      () => b.previewEntries(actor, id, previewTargets(), n), skillTipHtml(skill));
    }
    if (battle === b) OrderList.render(b);
  },

  // 対象の選択
  showTargets(b, actor, skillId) {
    const skill = SKILLS[skillId];
    const list = skill.target === 'enemy' ? b.opponentsOf(actor) : b.friendsOf(actor);
    this.clearCommands();
    this.el.cmdTitle.textContent = `${skill.name}：対象を選んでください（キャラをタップしても選べます）`;
    this.targeting = { b, actor, skillId, list };
    for (const u of list) if (u.dom) u.dom.card.classList.add('targetable');
    for (const t of list) {
      this.addButton(`${t.name}（HP ${t.hp}）`, () => this.execute(b, actor, skillId, [t]), false, '',
        () => b.previewEntries(actor, skillId, [t], BATTLE_CONFIG.orderPreview));
    }
    this.addButton('もどる', () => this.showCommands(b, actor));
    OrderList.render(b);
  },

  // 行動を確定
  execute(b, actor, skillId, targets) {
    this.clearCommands();
    this.el.cmdTitle.textContent = '';
    OrderList.render(b);
    b.useSkill(actor, skillId, targets);
  },

  // 勝敗メッセージ（少し待つと自動で次の戦闘へ進む）
  showResult(win, title, detail) {
    this.clearCommands();
    this.el.cmdTitle.textContent = '';
    const r = this.el.result;
    r.className = win ? 'win' : 'lose';
    r.innerHTML = `${title}<div class="detail">${detail}</div>`;
  },

  // ヘッダーの表示（階層・全体レベル・経験値・ポイント）
  renderHeader() {
    const lv = gameState.globalLevel;
    const endless = isEndless(gameState.floor);
    // アップデート前の最高到達階のほうが深ければ、記録として並べて表示
    const old = gameState.oldMaxFloor > gameState.maxFloor ? `（以前の記録 ${gameState.oldMaxFloor}階）` : '';
    this.el.floor.textContent =
      endless
        ? `${areaOf(gameState.floor).name}　無限 ${gameState.floor}階 ／ 無限モード最高 ${gameState.endlessBest || gameState.floor}階（全滅時は ${gameState.checkpoint}階へ）`
        : `${areaOf(gameState.floor).name}　現在 ${gameState.floor}階 ／ 最高 ${gameState.maxFloor}階${old}（全滅時は ${gameState.checkpoint}階へ）`;
    const titles = (gameState.titles || []).map(t => `🏅${t}`).join(' ');
    // 無限モードを解放した人は、無限モードの最高到達階も出す（無限モード中は上の行に出るので省く）
    const endlessRec = gameState.endlessBest && !endless ? `　♾無限モード：最高${gameState.endlessBest}階` : '';
    this.el.status.textContent =
      `${titles ? `${titles}　` : ''}全体Lv ${lv}　EXP ${gameState.exp} / ${expToNext(lv)}　ポイント ${gameState.points}${endlessRec}`;
    Panel.renderBadge(); // 「アイテムを選べます」のバッジ
  },

  // オート・速度ボタンの表示を更新
  renderControls() {
    const s = gameState.settings;
    this.el.autoBtn.textContent = `オート：${s.auto ? 'ON' : 'OFF'}`;
    this.el.autoBtn.classList.toggle('active', s.auto);
    // CSS のアニメーション速度も戦闘速度に合わせる
    document.documentElement.style.setProperty('--speed', s.speed);
    // 設定「ステータスを常に表示」：OFF ならカードは名前・HPバー・行動順だけ
    document.getElementById('stage').classList.toggle('show-stats', !!s.showStats);
    // 設定「軽量モード」：重い見た目の効果を減らす（スマホで絵が止まるのを防ぐ）
    document.getElementById('stage').classList.toggle('lite', isLiteMode());
    for (const btn of this.el.speedBtns.children) {
      btn.classList.toggle('active', Number(btn.dataset.speed) === s.speed);
    }
  },

  // ポップアップ表示（表示中なら順番待ちにして、OK を押すと次を出す）
  popupQueue: [],
  popup(html) {
    this.popupQueue.push(html);
    if (this.popupQueue.length === 1) this.showNextPopup();
  },
  showNextPopup() {
    const box = document.getElementById('popup');
    if (this.popupQueue.length === 0) {
      box.classList.add('hidden');
      return;
    }
    document.getElementById('popup-body').innerHTML = this.popupQueue[0];
    box.classList.remove('hidden');
  },

  // 仲間加入のお知らせ
  announceRecruits(joined) {
    for (const { id, inSortie } of joined) {
      const t = CHARACTERS[id];
      const note = inSortie
        ? '出撃メンバーに加わりました。'
        : '出撃枠に空きがないため控えにいます。<br>「強化」タブで出撃枠を増やすか、メンバーを入れ替えると出撃できます。';
      this.popup(`
        ${t.image ? `<img class="popup-portrait" src="${t.image}" alt="${t.name}">` : ''}
        <p class="popup-title">${t.name}が仲間になった！</p>
        <p class="popup-note">${note}</p>
        <div class="popup-skills"><div class="popup-skills-title">スキル</div>${skillListHtml(id)}</div>`);
      if (battle) battle.log(`${t.name}が仲間になった！`, 'system');
    }
    if (joined.length) Panel.refresh();
  },

  // ログに1行追加
  log(text, cls = '') {
    const p = document.createElement('p');
    p.textContent = text;
    if (cls) p.className = cls;
    this.el.log.appendChild(p);
    this.el.log.scrollTop = this.el.log.scrollHeight;
  },

  // 初期化
  init() {
    // オート切り替え
    this.el.autoBtn.addEventListener('click', () => {
      gameState.settings.auto = !gameState.settings.auto;
      saveGame();
      this.renderControls();
      // コマンド入力待ちの最中にONにしたら、そのまま自動で行動する
      if (gameState.settings.auto && battle && battle.waitingInput) {
        this.clearCommands();
        battle.autoAct(battle.current);
      }
    });
    // 戦闘速度ボタン
    for (const sp of BATTLE_CONFIG.speedOptions) {
      const btn = document.createElement('button');
      btn.textContent = `×${sp}`;
      btn.dataset.speed = sp;
      btn.addEventListener('click', () => {
        gameState.settings.speed = sp;
        saveGame();
        this.renderControls();
      });
      this.el.speedBtns.appendChild(btn);
    }
    document.getElementById('popup-ok').addEventListener('click', () => {
      this.popupQueue.shift();
      this.showNextPopup();
    });
    // 諦める（確認してから。ボス戦中も使える）
    document.getElementById('giveup-btn').addEventListener('click', () => {
      const b = battle;
      if (!b || b.over) return;
      if (!confirm(`諦めてチェックポイント（${gameState.checkpoint}階）に戻りますか？`)) return;
      if (battle === b && !b.over) b.giveUp(); // 確認している間に戦闘が終わっていたら何もしない
    });
  },

  // スキルの説明の吹き出し（PC はマウスを乗せる、スマホは長押しで出る）
  showTip(btn, html) {
    const tip = this.el.tip;
    tip.innerHTML = html;
    tip.classList.add('show');
    // ボタンの真上に出す（#stage は拡大縮小されているので、その倍率で割って位置を出す）
    const stageRect = document.getElementById('stage').getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    const scale = stageRect.width / document.getElementById('stage').offsetWidth || 1;
    const stageW = document.getElementById('stage').offsetWidth;
    const w = tip.offsetWidth;
    let left = (r.left + r.width / 2 - stageRect.left) / scale - w / 2;
    left = Math.max(6, Math.min(stageW - w - 6, left));
    let top = (r.top - stageRect.top) / scale - tip.offsetHeight - 8;
    if (top < 6) top = (r.bottom - stageRect.top) / scale + 8; // 上に入らなければ下に出す
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  },
  hideTip() {
    this.el.tip.classList.remove('show');
  },
};

// スキルの説明（吹き出し用）：名前・使用制限・効果
function skillTipHtml(skill) {
  return `<b>${skill.name}</b><span class="tip-limit">${skillLimitText(skill)}</span><br>${skillDescText(skill)}`;
}

// ---------------------------------------------------------------------
// 行動順リスト（バトル画面の右側）
// 行は key（そのキャラの何回目の行動か）ごとに使い回し、位置が変わったら
// 「元の位置から新しい位置へ」なめらかに動かす（FLIP という手法）
// ---------------------------------------------------------------------
const ORDER_ANIM_MS = 300; // 行の移動・出入りの長さ（×1 のとき）。style.css の .order-row と合わせる

const OrderList = {
  el: document.getElementById('order-list'),
  rows: new Map(),  // key → 行の要素
  preview: null,    // プレビュー中の並び（null なら通常の予測）

  render(b) {
    // 墨（タコ魔導士）をかぶった味方がいる間は、行動順が見えない
    const inked = b.allies.some(u => u.alive && hasStatus(u, 'ink'));
    const entries = (b.over || inked) ? [] : (this.preview || b.orderEntries(BATTLE_CONFIG.orderPreview));
    this.el.classList.toggle('inked', inked);
    this.el.classList.toggle('previewing', !!this.preview && !inked);

    // 1. 動かす前の位置を覚えておく
    const oldPos = new Map();
    for (const [key, li] of this.rows) oldPos.set(key, li.getBoundingClientRect());

    // 2. リストから外れた行（行動が終わった・倒れた・後ろに押し出された）は左へ消す
    const keys = new Set(entries.map(e => e.key));
    for (const [key, li] of this.rows) {
      if (!keys.has(key)) {
        this.leave(li);
        this.rows.delete(key);
      }
    }

    // 3. 新しい順番に並べる（既存の行は使い回し、新しい行は作る）
    const entering = [];
    entries.forEach((e, i) => {
      let li = this.rows.get(e.key);
      if (!li) {
        li = this.createRow(e.unit);
        li.classList.add('entering');
        entering.push(li);
        this.rows.set(e.key, li);
      }
      this.updateRow(li, e, i, b);
      this.el.appendChild(li); // 末尾へ移動 = 順番どおりに並ぶ
    });

    // 4. 元の位置から新しい位置へ動かす
    for (const [key, li] of this.rows) {
      const old = oldPos.get(key);
      if (!old) continue;
      const now = li.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      li.style.transition = 'none';
      li.style.transform = `translate(${dx}px, ${dy}px)`; // いったん元の位置に見せかけて
      void li.offsetWidth;
      li.style.transition = '';
      li.style.transform = '';                            // 新しい位置へ移動させる
    }

    // 5. 新しい行はふわっと出す
    if (entering.length) {
      void this.el.offsetWidth;
      entering.forEach(li => li.classList.remove('entering'));
    }
  },

  // 行を作る（顔アイコン＋名前）
  createRow(unit) {
    const li = document.createElement('li');
    li.className = `order-row ${unit.side}`;
    li.innerHTML = `
      <span class="arrow">▶</span>
      <span class="face"></span>
      <span class="info"><span class="oname"></span><span class="warn"></span></span>
      <span class="mark"></span>`;
    const face = li.querySelector('.face');
    if (unit.image) {
      face.style.backgroundImage = `url("${unit.image}")`;
      face.style.backgroundPosition = unit.face;
    } else {
      face.textContent = unit.name.charAt(0);
    }
    li.querySelector('.oname').textContent = unit.name;

    // 行にマウスを乗せると、バトル画面のそのキャラを光らせる
    li._unit = unit;
    li.addEventListener('mouseenter', () => this.focusUnit(unit, true));
    li.addEventListener('mouseleave', () => this.focusUnit(unit, false));
    return li;
  },

  // 行の状態を更新（今行動中・危険の予告・プレビューの印）
  updateRow(li, e, i, b) {
    li.classList.toggle('now', i === 0 && e.unit === b.current);

    // 危険の予告はそのキャラの一番近い行動にだけ出す
    const danger = e.first ? (b.dangerOf(e.unit) || b.allyNotice(e.unit)) : null;
    li.classList.toggle('danger', !!danger);
    li.querySelector('.warn').textContent = danger || '';

    // プレビュー：前に来た ▲ ／ 後ろに下がった ▼ ／ 新しく入った ＋
    const marks = { up: '▲', down: '▼', new: '＋' };
    li.classList.remove('chg-up', 'chg-down', 'chg-new');
    if (e.change) li.classList.add(`chg-${e.change}`);
    li.querySelector('.mark').textContent = e.change ? marks[e.change] : '';
  },

  // 左へ消す（その場に固定してから消えるので、残りの行は上へ詰まる）
  leave(li) {
    this.focusUnit(li._unit, false);
    li.style.top = `${li.offsetTop}px`;
    li.style.left = `${li.offsetLeft}px`;
    li.style.width = `${li.offsetWidth}px`;
    li.classList.add('leaving');
    sleep(ORDER_ANIM_MS).then(() => li.remove());
  },

  focusUnit(unit, on) {
    if (unit && unit.dom) unit.dom.card.classList.toggle('focus', on);
  },
};

// ---------------------------------------------------------------------
// ダンジョンの進行
// ---------------------------------------------------------------------
// 味方の残りHP（階をまたいで引き継ぐ。キャラID → HP。記録が無ければ満タンで出撃）
let allyHp = {};

// 出撃メンバーのユニットを作る（強化＋装備込みのステータス、HPは前の階から引き継ぎ）
function createAlly(id) {
  const u = createUnit(CHARACTERS[id], 'ally', CHARACTERS[id].name, charTotalStats(id), charLevel(id));
  u.charId = id;
  u.gear = itemEffects(id);
  if (allyHp[id] !== undefined) u.hp = Math.max(1, Math.min(u.base.hp, allyHp[id]));
  return u;
}

// 今の階の戦闘を始める
function startFloor() {
  const floor = gameState.floor;
  // ボス階に入る前は味方のHPを全回復
  const bossHeal = isBossFloor(floor) && Object.keys(allyHp).length > 0;
  if (isBossFloor(floor)) allyHp = {};
  const allies = gameState.sortie.map(createAlly);
  const enemies = createFloorEnemies(floor);

  // 画面リセット
  UI.el.log.innerHTML = '';
  UI.el.result.className = 'hidden';
  UI.clearCommands();
  UI.renderHeader();
  if (UnitDetail.unit) Overlay.closeAll(); // 前の階のキャラの詳細は閉じる

  showArea(floor);

  battle = new Battle(allies, enemies, floor);
  if (bossHeal) battle.log('強大な気配がする… 味方のHPが全回復した！', 'system');
  battle.start();
}

// エリアの背景と名前（エリアが変わったときは大きく表示）
let shownArea = null;
let shownBg = null;
function showArea(floor) {
  const area = areaOf(floor);
  const main = document.getElementById('battle-main');
  main.style.background = area.bg; // 画像を読み込むまでの下地
  main.style.setProperty('--area-text', area.text);

  // 背景画像：変わったときだけ、新しい背景を上に重ねて1秒でフェード（古いほうは後で消す）
  const image = backgroundOf(floor);
  const layers = document.getElementById('bg-layers');
  if (image !== shownBg) {
    shownBg = image;
    const layer = document.createElement('div');
    layer.className = 'bg-layer';
    if (image) layer.style.backgroundImage = `url("${image}")`;
    layers.appendChild(layer);
    void layer.offsetWidth;
    layer.classList.add('show');
    const old = [...layers.children].filter(l => l !== layer);
    setTimeout(() => old.forEach(l => l.remove()), 1100);
  }
  // ボス戦は背景を少し暗くして赤みを足す
  layers.classList.toggle('boss', isBossFloor(floor));

  // エリアが変わったら、エリア名を画面中央に大きく出してから消す
  if (shownArea === area.name) return;
  shownArea = area.name;
  const banner = document.createElement('div');
  banner.className = 'area-banner';
  banner.innerHTML = `<div class="area-name">${area.name}</div><div class="area-floor">${floor}階</div>`;
  main.appendChild(banner);
  setTimeout(() => banner.remove(), 2800);
}

// ---------------------------------------------------------------------
// エンディング（最終ボスを倒したとき）と無限モードの解放
// ---------------------------------------------------------------------
function showEnding() {
  const box = document.getElementById('ending');
  const sec = gameState.playSeconds || 0;
  const time = `${Math.floor(sec / 3600)}時間${Math.floor((sec % 3600) / 60)}分`;
  const seen = Object.keys(gameState.bestiary || {}).filter(id => ENEMIES[id]).length;
  box.querySelector('.ending-title').textContent = '― TRUE END ―';
  box.querySelector('.ending-text').innerHTML = `
    終焉の神オリジンは、静かに光の粒となって消えていった。<br>
    書き換えられた世界の理はもとに戻り、塔の頂から朝日が差しこむ。<br>
    森も、火山も、深海も、空も、冥府も、氷河も、星々も――<br>
    すべての場所に、穏やかな時間が流れはじめた。<br><br>
    長い旅をともにした仲間たちに、心からの感謝を。`;
  // スタッフロール：仲間・強敵・旅した場所を順に流す
  const bosses = [...new Set(Object.values(DUNGEON.bosses).flat())].map(id => ENEMIES[id].name);
  const places = AREAS.filter(a => a.image).map(a => a.name);
  const roll = [
    '<div class="cr-title">ゆーるぴーじー</div>',
    '<div class="cr-head">― 仲間たち ―</div>', ...gameState.party.map(id => `<div>${CHARACTERS[id].name}</div>`),
    '<div class="cr-head">― 旅した場所 ―</div>', ...places.map(n => `<div>${n}</div>`),
    '<div class="cr-head">― 立ちはだかった強敵たち ―</div>', ...bosses.map(n => `<div>${n}</div>`),
    '<div class="cr-head">― そして ―</div>', '<div>ここまで遊んでくれた、あなたへ</div>', '<div class="cr-title">ありがとう</div>',
  ];
  document.getElementById('ending-credits').innerHTML = `<div class="credits-roll">${roll.join('')}</div>`;
  document.getElementById('ending-stats').innerHTML = `

    <div>プレイ時間 <b>${time}</b></div>
    <div>全体レベル <b>${gameState.globalLevel}</b>　仲間 <b>${gameState.party.length}</b>人</div>
    <div>総撃破数 <b>${totalKills()}</b>体　図鑑 <b>${seen}</b> / ${Object.keys(ENEMIES).length}</div>
    <div>全滅した回数 <b>${gameState.totalWipes || 0}</b>回</div>`;
  document.getElementById('ending-endless').textContent = `無限モードへ（${DUNGEON.finalFloor + 1}階から）`;
  box.classList.remove('hidden');
}

// 「第○部クリア」（50階・70階など）：演出だけ出して、戦闘はそのまま続く
function showPartClear(floor) {
  const pc = DUNGEON.partClears[floor];
  if (!pc) return;
  const main = document.getElementById('battle-main');
  const banner = document.createElement('div');
  banner.className = 'area-banner part1-banner';
  banner.innerHTML = `<div class="area-name">${pc.title}</div><div class="area-floor">${pc.sub}</div>`;
  main.appendChild(banner);
  setTimeout(() => banner.remove(), 4000);
  UI.popup(`
    <p class="popup-title">🎉 ${pc.title}</p>
    <p>${pc.text}</p>
    <p class="popup-note">${pc.note}<br>${DUNGEON.finalFloor}階に待つ「終焉の神」を倒すと、真のエンディングです。</p>`);
}
// エンディングを閉じて、無限モード（101階）へ
function closeEnding() {
  document.getElementById('ending').classList.add('hidden');
  UI.renderHeader();
  startFloor();
  Cloud.save('ending');
  UI.popup(`
    <p class="popup-title">♾ 無限モードが解放されました！</p>
    <p>${DUNGEON.finalFloor + 1}階から先は、これまでのすべてのエリアの敵が現れる「無限回廊」。<br>
    10階ごとに、これまでのボスが強くなって順番に立ちはだかります。</p>
    <p class="popup-note">10階ごとにチェックポイント・ポイント+${ENDLESS.points}・上級アイテムの選択。<br>どこまで登れるか、記録に挑戦しよう！</p>`);
}
document.getElementById('ending-endless').addEventListener('click', () => closeEnding());

// 強化・装備を変えたとき、戦闘中の味方にもすぐ反映する（戦闘は止めない）
// ※ 出撃メンバーの入れ替えは次の階から
function syncBattleAllies() {
  if (!battle) return;
  for (const u of battle.allies) {
    const stats = charTotalStats(u.charId);
    // 闇の剣（悪魔騎士）で減った最大HPは、戦闘中は減ったまま
    if (u.maxHpRate) stats.hp = Math.max(1, Math.round(stats.hp * u.maxHpRate));
    const hpGain = stats.hp - u.base.hp;
    withSpeedRescale(u, () => { u.base = stats; }); // 速度が変わったら待ち時間も合わせる
    if (u.alive) u.hp = Math.max(1, Math.min(stats.hp, u.hp + Math.max(0, hpGain))); // 最大HPが増えた分は今のHPにも足す
    u.gear = itemEffects(u.charId);
    u.level = charLevel(u.charId);
  }
  UI.render(battle);
}

// 戦闘が終わったとき（Battle.finish から呼ばれる）
function onBattleEnd(b, win) {
  if (win) {
    // 経験値
    const exp = b.enemies.reduce((s, e) => s + e.exp, 0);
    const gained = gainExp(exp);
    b.log(`${b.floor}階クリア！ 経験値 ${exp} を獲得！`, 'system');
    let detail = `経験値 ${exp} を獲得！`;
    if (gained.levels > 0) {
      const msg = `全体レベルが ${gameState.globalLevel} に上がった！ ポイント +${gained.points}`;
      b.log(msg, 'system');
      detail += `<br>${msg}`;
    }

    // 盗賊の「盗む」が成功していたら、アイテム選択が1回増える
    if (b.stolen) {
      grantBonusReward(b.floor);
      b.log('盗んだお宝！ アイテムを1回多く選べる！', 'system');
      detail += '<br>盗んだお宝：アイテムを1回多く選べます！';
    }

    // 味方のHPを記録し、戦闘の合間の回復（倒れていた味方も回復して次へ）
    for (const u of b.allies) {
      allyHp[u.charId] = Math.min(u.base.hp, u.hp + Math.round(u.base.hp * DUNGEON.healBetweenFloors));
    }

    // 5階ごとのアイテム報酬（選ぶのはいつでもいい。選ばなければ貯まっていく）
    if (grantFloorReward(b.floor)) {
      b.log('アイテム報酬！ 「アイテム」タブで1個選べます。', 'system');
      detail += '<br>アイテム報酬を獲得！（アイテムタブで選べます）';
    }

    const wasBoss = isBossFloor(b.floor);
    if (isEndless(b.floor) && b.floor % ENDLESS.rewardEvery === 0) {
      // 無限モード：10階ごとにポイントと、上級アイテム（特級装備の素材）の選択
      gameState.points += ENDLESS.points;
      grantBossReward(ENDLESS.bossChoices);
      b.log(`無限モードの報酬！ ポイント +${ENDLESS.points}、上級アイテムを${ENDLESS.bossChoices}つから1つ選べます。`, 'system');
      detail += `<br>無限モード報酬：ポイント +${ENDLESS.points}、上級アイテムを1個選べます！`;
    } else if (wasBoss) {
      // ボス撃破：上級アイテムを1個確定で選べる
      grantBossReward();
      b.log('ボス撃破報酬！ 上級アイテムを1個選べます。', 'system');
      detail += '<br>ボス撃破報酬：上級アイテムを1個選べます！';
    }
    // 最終ボス撃破（初めて）→ エンディング
    const ending = b.floor === DUNGEON.finalFloor && !gameState.endingShown;
    // 第○部の最後のボス撃破（初めて）→「第○部クリア」の演出だけ出して、そのまま先へ
    const part = DUNGEON.partClears[b.floor] && !gameState.partsShown.includes(b.floor);
    advanceFloor();
    if (wasBoss) detail += `<br>チェックポイント更新：全滅しても ${gameState.checkpoint}階から再開`;
    if (part) {
      gameState.partsShown.push(b.floor);
      saveGame();
      showPartClear(b.floor);
    }
    // 特級合成の解放（50階のボスを初めて倒したとき。「第一部クリア」のお知らせのあとに出る）
    if (b.floor === LEGEND.unlockFloor && !gameState.legendUnlocked) {
      gameState.legendUnlocked = true;
      saveGame();
      b.log('特級合成が解放されました！', 'system');
      UI.popup(`
        <p class="popup-title">✨ 特級合成が解放されました！</p>
        <p>上級装備を3つ合成すると、強力な<b>特級装備</b>（★1〜★5）が作れるようになりました。</p>
        <p class="popup-note">「アイテム」タブの合成欄にある「特級合成」から作れます。<br>特級装備は1人${LEGEND.perChar}個まで装備できます。</p>`);
    }
    UI.announceRecruits(checkRecruits()); // 到達階・ボス撃破で加入条件を満たしたか
    if (ending) {
      gameState.endingShown = true;
      saveGame();
      UI.showResult(true, `${b.floor}階クリア！`, detail);
      UI.renderHeader();
      Panel.refresh();
      later(() => { if (battle === b) showEnding(); }, DUNGEON.floorInterval);
      return; // エンディングで選ぶまで次の階へは進まない
    }
    UI.showResult(true, `${b.floor}階クリア！`, `${detail}<br>${gameState.floor}階へ進みます…`);
  } else {
    // 神々の塔：全滅した回数を記録（次からその階のボスのHPが下がる救済措置）
    if (isTowerFloor(b.floor)) gameState.towerWipes[b.floor] = (gameState.towerWipes[b.floor] || 0) + 1;
    gameState.totalWipes = (gameState.totalWipes || 0) + 1;
    returnToCheckpoint();
    allyHp = {}; // 全員満タンでやり直し
    if (b.gaveUp) {
      UI.showResult(false, '撤退…', `${gameState.checkpoint}階からやり直します…`);
    } else {
      b.log('全滅してしまった…', 'system');
      UI.showResult(false, '全滅…', `${gameState.checkpoint}階からやり直します…`);
    }
  }
  UI.renderHeader();
  Panel.refresh(); // ポイントや報酬が増えたので、開いているパネルを更新

  // 少し待って次の戦闘へ
  later(() => {
    if (battle === b) startFloor();
  }, DUNGEON.floorInterval);
}

// データを初期化して1階からやり直す
function restartFromScratch() {
  const nickname = gameState.nickname; // ランキングの名前は残す（ランキングの記録も消えない）
  resetGame();
  gameState.nickname = nickname;
  saveGame();
  Cloud.save('reset');
  allyHp = {};
  UI.renderControls();
  battle = null; // 進行中の戦闘の予約処理を止める（battle !== this で中断される）
  startFloor();
  Panel.refresh();
}

// ---------------------------------------------------------------------
// 遊び方の説明
// ---------------------------------------------------------------------
const HOWTO_HTML = `
  <div class="howto">
    <div class="howto-logo">ゆーるぴーじー</div>
    <h3>⚔ 遊び方</h3>
    <ol>
      <li><b>ダンジョンを1階ずつ進もう。</b>敵を全滅させると次の階へ。10階ごとにボスがいて、全滅すると最後に倒したボスの階に戻ります。</li>
      <li><b>速いキャラほどたくさん行動。</b>キャラの下の「⏱ ○番目」と「行動順」タブで、これからの順番と敵の大技の予告「⚠」が見られます。<b>キャラをタップ</b>すると攻撃・防御・速さやバフの詳細が開きます。</li>
      <li><b>味方の番に技を選ぼう。</b>技のボタンを<b>長押し</b>（PCはマウスを乗せる）すると説明が出ます。「オート」をONにすると味方も自動で戦います。×2・×4で戦闘が速くなります。勝てないときは「🏳 諦める」でチェックポイントに戻れます。</li>
      <li><b>「強化」タブ</b>：レベルアップでもらえるポイントで、ステータスや出撃枠を増やせます。戦闘中でも操作できます。</li>
      <li><b>「アイテム」タブ</b>：5階ごとにアイテムを1つ選べます。下級アイテム2つを合成すると上級アイテムに。いらないアイテムは<b>🎒ボタン</b>で経験値に変換できます。</li>
      <li><b>閉じている間も成長。</b>次に開いたとき、離れていた時間に応じて経験値がもらえます（最大8時間）。進行は自動で保存されます。</li>
    </ol>
    <p class="popup-note">アイコンにマウスを乗せる（スマホはタップする）と説明が出ます。<br>この説明は右上の「？」でいつでも見られます。<br>「☁ アカウント」からGoogleアカウントと連携すると、別の端末でも続きから遊べます。</p>
  </div>`;

// ---------------------------------------------------------------------
// アップデートのお知らせ（版ごとに1回だけ）
// 移行処理をした人（51階より先にいた人）には、再スタートとお詫びのお知らせを出す
// ---------------------------------------------------------------------
function showUpdateNotice() {
  if ((gameState.noticeVersion || 0) >= SAVE_VERSION) return;
  const mg = gameState.migrationNotice;
  if (mg && mg.target) {
    UI.popup(`
      <p class="popup-title">📢 アップデートのお知らせ</p>
      <p>アップデートで51〜100階が新しくなりました！<br>
      2周目はなくなり、100階クリア後に『無限モード』が遊べるようになります。<br>
      新しいエリア・敵・ボスを楽しんでもらうため、${MIGRATION_V2.restartFloor}階からの再スタートになります。<br>
      レベル・アイテム・仲間はそのままです。</p>
      <p>お詫びとして、<b>ポイント${mg.points}</b>と<b>上級アイテム${mg.items}個</b>、称号<b>『${mg.title}』</b>をお贈りしました。</p>
      <p class="popup-note">以前の記録（${mg.cycle >= 2 ? `${mg.cycle}周目 ${mg.cycleFloor}階・` : ''}最高 ${mg.firstMax}階）は「旧記録」として残ります。<br>上級アイテムは「アイテム」タブで選べます。</p>`);
  } else {
    UI.popup(`
      <p class="popup-title">📢 アップデートのお知らせ</p>
      <p>ダンジョンが<b>100階</b>まで広がりました！</p>
      <ul class="howto-list">
        <li>51〜90階：冥府の墓地・魔界の城・凍てつく氷河・星の神殿</li>
        <li>91〜100階：ボスだけが待つ「神々の塔」と、真のエンディング</li>
        <li>100階クリア後は<b>無限モード</b>（2周目はなくなりました）</li>
        <li>上級装備3つから作る<b>特級装備</b>（★1〜★5）と、4つ目の装備枠</li>
        <li>スキルの説明（長押し）・「諦める」ボタン・アイテムのアイコン表示</li>
      </ul>`);
  }
  gameState.noticeVersion = SAVE_VERSION;
  delete gameState.migrationNotice;
  saveGame();
}
// 特殊能力・状態異常・アイテムのアイコンをタップしたとき、説明を下に出す（スマホ向け）
let toastTimer = null;
document.addEventListener('click', e => {
  const el = e.target.closest('.trait-icon, .sbadge, .item-icon, .kiwami');
  if (!el || !el.title) return;
  if (el.closest('.inv-grid, .equip-picker')) return; // 所持品・装備の選択は、その場に説明が出るので不要
  const toast = document.getElementById('toast');
  toast.textContent = el.title;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
});

document.getElementById('help-btn').addEventListener('click', () => UI.popup(HOWTO_HTML));

// ---------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------
loadGame();
const offline = applyOfflineProgress(); // 閉じていた間の経験値
// 前回までに加入条件を満たしていたキャラがいれば加入させる（古いセーブデータ向け）
// 最初の戦闘に間に合うよう、戦闘開始より前に判定する（お知らせは下で表示）
const recruitsOnLoad = checkRecruits();
saveGame();
UI.init();
Panel.init();
UI.renderControls();
startFloor();

// 初めて遊ぶ人には遊び方を表示（「？ 遊び方」ボタンでいつでも見られる）
if (!gameState.tutorialSeen) {
  UI.popup(HOWTO_HTML);
  gameState.tutorialSeen = true;
  saveGame();
}

if (offline) {
  const h = Math.floor(offline.minutes / 60);
  const m = offline.minutes % 60;
  let html = `<p>おかえりなさい！</p><p>${h > 0 ? `${h}時間` : ''}${m}分の間に<br>経験値 <strong>${offline.exp}</strong> を獲得しました。</p>`;
  if (offline.levels > 0) {
    html += `<p>全体レベルが ${gameState.globalLevel} に上がった！<br>ポイント +${offline.points}</p>`;
  }
  UI.popup(html);
  UI.renderHeader();
}

UI.announceRecruits(recruitsOnLoad);
showUpdateNotice();

// クラウド（Firebase）に接続：ログイン → クラウドのセーブの方が新しければそこから再開
// （Firebase 未設定・ファイルを直接開いたときは、ブラウザ内保存だけで遊べる）
Cloud.init();
