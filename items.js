// =====================================================================
// items.js  ―  アイテムと合成レシピのデータ
// アイテムは ITEMS に1行、レシピは RECIPES に1行足すだけで増やせます。
// =====================================================================

// ---------------------------------------------------------------------
// アイテム全体の設定
// ---------------------------------------------------------------------
const ITEM_CONFIG = {
  slotsPerChar: 4,       // 1人が装備できる数
  rewardEvery: 5,        // 何階ごとのクリアで報酬がもらえるか
  rewardChoices: 5,      // 報酬で並ぶアイテムの数（この中から1個選ぶ）
  highTierFrom: 20,      // この階以降のクリア報酬には上級アイテムが混ざることがある
  highTierChance: 0.3,   // 上級アイテムが1個混ざる確率
  baseCritMultiplier: 2, // 会心のダメージ倍率（critDamage で上乗せ）
  // 経験値に変換したときの1個あたりの経験値（次の全体レベルまでに必要な経験値に対する割合）
  // 例：下級 0.25 → 必要経験値の25%。上級は下級2つから作るので、それより多め
  expRate: { 1: 0.25, 2: 0.8, 3: 3 },
};

// ---------------------------------------------------------------------
// アイテム定義
// ---------------------------------------------------------------------
// tier: 1 = 下級（報酬で出る） / 2 = 上級（合成で作る。20階以降の報酬でもたまに出る）
// image: アイコン画像のパス（省略すると名前の1文字目を表示）
// desc: 画面に出す説明
// effects: 効果の部品（組み合わせ自由）
//   ステータス加算 { type: 'stat', stat: 'atk', value: 8 }      hp / atk / def / spd に加算
//   割合ボーナス   { type: 'bonus', key: 'critRate', value: 0.15 }  同じ key は合計される
//     skillPower   スキル（通常攻撃以外）のダメージ・回復量 +X
//     healPower    自分が使う回復の量 +X
//     critRate     会心率 +X（会心は通常攻撃のみ。skillCrit があればスキルも）
//     critDamage   会心ダメージ倍率 +X（基本 2 倍）
//     lifesteal    与えたダメージの X を HP として吸収
//     reflect      受けたダメージの X を攻撃してきた相手に反射
//     regen        自分の行動開始時に 自分の最大HPの X 回復
//     teamRegen    自分の行動開始時に 味方全員の最大HPの X 回復
//     openingGauge 戦闘開始時に行動ゲージを X 進める（合計は最大 100% = 最初に必ず行動）
//     executeBonus HP50%以下の敵へのダメージ +X
//   特殊効果       { type: 'special', key: 'counter', chance: 0.3 }
//     counter        攻撃を受けたとき chance の確率で通常攻撃で反撃
//     hasteOnAttack  ダメージを与えた行動のあと chance の確率で行動ゲージを amount 進める
//     lowHpDefense   HPが threshold 以下のとき防御 rate 倍
//     skillCrit      スキルでも会心が出る
//     slowOnHit      ダメージを与えた相手の速度を rate 倍にする（turns ターン。より強い速度低下がかかっていれば上書きしない）
//   --- 55種化で追加 ---
//   割合ボーナス
//     evasion        回避率 +X
//     aoeGuard       全体攻撃から受けるダメージ -X
//     damageHeal     受けたダメージの X だけHP回復
//     skillLifesteal スキルで与えたダメージの X を吸収（lifesteal に上乗せ）
//   特殊効果
//     defOnAttack    攻撃するたび自分の防御 rate 倍（max 回まで重なる）
//     fullHpAtk      HP満タンなら攻撃 rate 倍
//     healOnAttack   攻撃した行動のあと、最大HPの ratio 回復
//     armorBreak     攻撃した相手の防御 rate 倍（turns ターン）
//     firstStrike    戦闘で最初の攻撃が rate 倍
//     firstCrit      戦闘で最初の攻撃が必ず会心
//     guardHeal      防御を選ぶと最大HPの ratio 回復
//     critImmune     会心を受けない
//     openingTeamDef 戦闘開始時に味方全員の防御 rate 倍（turns ターン）
//     revive         戦闘不能時に1度だけ HP ratio で復活
//     skillHaste     スキル（通常攻撃以外）を使ったあと、行動ゲージを amount 進める
//     vulnerableOnHit 攻撃した相手の被ダメージ +value（turns ターン）
//     critHeal       会心を出すと最大HPの ratio 回復
//     critLifesteal  会心時に与ダメージの value を吸収
//     reflectCrit    反射ダメージにも会心判定がある
//   --- 特級装備で追加 ---
//     splash          攻撃するたび、ほかの敵全員にも与えたダメージの ratio
//     teamGuard       味方全員の被ダメージ -value（複数装備しても一番強いものだけ）
//     lastStand       1戦闘に1回、倒れるダメージを受けてもHP ratio で耐える
//     extraTurn       行動のあと chance の確率でもう一度行動
//     cooldownCut     スキルの使用制限ターン -value
//     teamCharm       味方それぞれの行動開始時に最大HPの value 回復（複数装備しても一番強いものだけ）
//     overhealBarrier 最大HPを超えた回復分を、最大HPの cap までバリアにする（ダメージを先に受け止める）
//     reflectDelay    反射するたび相手の行動ゲージ -amount（同じ相手には、その相手の1行動につき1回まで）

// 効果の部品を短く書くための関数
const addStat    = (stat, value)   => ({ type: 'stat', stat, value });
const addBonus   = (key, value)    => ({ type: 'bonus', key, value });
const addSpecial = (key, opts = {}) => ({ type: 'special', key, ...opts });

const ITEMS = {
  // --- 下級 ---
  ironSword:     { name: '鉄の剣',       tier: 1, image: 'items/iron_sword.png', desc: '攻撃+8',             effects: [{ type: 'stat', stat: 'atk', value: 8 }] },
  leatherShield: { name: '皮の盾',       tier: 1, image: 'items/leather_shield.png', desc: '防御+6',             effects: [{ type: 'stat', stat: 'def', value: 6 }] },
  lifeRing:      { name: '生命の指輪',   tier: 1, image: 'items/life_ring.png', desc: 'HP+40',              effects: [{ type: 'stat', stat: 'hp', value: 40 }] },
  galeFeather:   { name: '疾風の羽',     tier: 1, image: 'items/wind_feather.png', desc: '速度+8',             effects: [{ type: 'stat', stat: 'spd', value: 8 }] },
  manaOrb:       { name: '魔力の珠',     tier: 1, image: 'items/magic_orb.png', desc: 'スキル効果+15%',     effects: [{ type: 'bonus', key: 'skillPower', value: 0.15 }] },
  prayerCharm:   { name: '祈りのお守り', tier: 1, image: 'items/prayer_charm.png', desc: '毎ターンHP3%回復',   effects: [{ type: 'bonus', key: 'regen', value: 0.03 }] },
  critPierce:    { name: '会心のピアス', tier: 1, image: 'items/crit_earring.png', desc: '会心率+15%（会心はダメージ2倍）', effects: [{ type: 'bonus', key: 'critRate', value: 0.15 }] },
  sharpFang:     { name: '鋭い牙',       tier: 1, image: 'items/sharp_fang.png', desc: '与ダメージの10%をHP吸収', effects: [{ type: 'bonus', key: 'lifesteal', value: 0.1 }] },
  thornArmor:    { name: 'いばらの鎧',   tier: 1, image: 'items/thorn_armor.png', desc: '受けたダメージの20%を反射', effects: [{ type: 'bonus', key: 'reflect', value: 0.2 }] },
  swiftBoots:    { name: '先手のブーツ', tier: 1, image: 'items/swift_boots.png', desc: '戦闘開始時に行動ゲージ+30%', effects: [{ type: 'bonus', key: 'openingGauge', value: 0.3 }] },

  // --- 上級 ---
  galeBlade:     { name: '疾風剣',         tier: 2, image: 'items/gale_sword.png', desc: '攻撃+10・速度+10、攻撃時20%で行動ゲージ+50%', effects: [{ type: 'stat', stat: 'atk', value: 10 }, { type: 'stat', stat: 'spd', value: 10 }, { type: 'special', key: 'hasteOnAttack', chance: 0.2, amount: 0.5 }] },
  greatSword:    { name: '必殺の大剣',     tier: 2, image: 'items/deadly_greatsword.png', desc: '攻撃+12・会心率+25%、会心ダメージ2.5倍', effects: [{ type: 'stat', stat: 'atk', value: 12 }, { type: 'bonus', key: 'critRate', value: 0.25 }, { type: 'bonus', key: 'critDamage', value: 0.5 }] },
  giantShield:   { name: '巨人の盾',       tier: 2, image: 'items/giant_shield.png', desc: '防御+10・HP+60、HP50%以下で防御2倍', effects: [{ type: 'stat', stat: 'def', value: 10 }, { type: 'stat', stat: 'hp', value: 60 }, { type: 'special', key: 'lowHpDefense', threshold: 0.5, rate: 2 }] },
  counterArmor:  { name: '反撃の鎧',       tier: 2, image: 'items/counter_armor.png', desc: '防御+10、攻撃を受けると30%で反撃', effects: [{ type: 'stat', stat: 'def', value: 10 }, { type: 'special', key: 'counter', chance: 0.3 }] },
  holyRing:      { name: '聖なる指輪',     tier: 2, image: 'items/holy_ring.png', desc: 'HP+50、毎ターン味方全員HP3%回復', effects: [{ type: 'stat', stat: 'hp', value: 50 }, { type: 'bonus', key: 'teamRegen', value: 0.03 }] },
  godspeedBoots: { name: '神速の靴',       tier: 2, image: 'items/godspeed_boots.png', desc: '速度+15、戦闘開始時に行動ゲージ+60%', effects: [{ type: 'stat', stat: 'spd', value: 15 }, { type: 'bonus', key: 'openingGauge', value: 0.6 }] },
  healingStaff:  { name: '癒しの杖',       tier: 2, image: 'items/healing_staff.png', desc: '回復量+40%', effects: [{ type: 'bonus', key: 'healPower', value: 0.4 }] },
  sageOrb:       { name: '賢者の珠',       tier: 2, image: 'items/sage_orb.png', desc: 'スキル効果+25%、スキルも会心が出る', effects: [{ type: 'bonus', key: 'skillPower', value: 0.25 }, { type: 'special', key: 'skillCrit' }] },
  violetBlade:   { name: '紫電の魔剣',     tier: 2, image: 'items/shadow_blade.png', desc: '攻撃+10・スキル効果+20%、攻撃した敵の速度を10%下げる（3ターン）', effects: [{ type: 'stat', stat: 'atk', value: 10 }, { type: 'bonus', key: 'skillPower', value: 0.2 }, { type: 'special', key: 'slowOnHit', rate: 0.9, turns: 3 }] },
  vampireCloak:  { name: '吸血鬼のマント', tier: 2, image: 'items/vampire_cloak.png', desc: '与ダメージの20%を吸収・受けたダメージの15%を反射', effects: [{ type: 'bonus', key: 'lifesteal', value: 0.2 }, { type: 'bonus', key: 'reflect', value: 0.15 }] },
  assassinFang:  { name: '暗殺者の牙',     tier: 2, image: 'items/assassin_fang.png', desc: 'HP50%以下の敵へのダメージ+50%', effects: [{ type: 'bonus', key: 'executeBonus', value: 0.5 }] },

  // --- 上級（55種化で追加。ID は画像ファイル名と同じ） ---
  // 剣の系統
  sword_sword:     { name: '英雄の聖剣',   tier: 2, image: 'items/sword_sword.png',     desc: '攻撃+25', effects: [addStat('atk', 25)] },
  sword_shield:    { name: '騎士の剣',     tier: 2, image: 'items/sword_shield.png',    desc: '攻撃+10・防御+10、攻撃するたび自分の防御+5%（最大3回）', effects: [addStat('atk', 10), addStat('def', 10), addSpecial('defOnAttack', { rate: 1.05, max: 3 })] },
  sword_ring:      { name: '生命の剣',     tier: 2, image: 'items/sword_ring.png',      desc: '攻撃+10・HP+50、HP満タンなら攻撃+20%', effects: [addStat('atk', 10), addStat('hp', 50), addSpecial('fullHpAtk', { rate: 1.2 })] },
  sword_charm:     { name: '祝福の剣',     tier: 2, image: 'items/sword_charm.png',     desc: '攻撃+10、攻撃するたびHP2%回復', effects: [addStat('atk', 10), addSpecial('healOnAttack', { ratio: 0.02 })] },
  sword_fang:      { name: '血塗れの剣',   tier: 2, image: 'items/sword_fang.png',      desc: '攻撃+12、吸収15%', effects: [addStat('atk', 12), addBonus('lifesteal', 0.15)] },
  sword_thorn:     { name: '茨の剣',       tier: 2, image: 'items/sword_thorn.png',     desc: '攻撃+10、攻撃した相手の防御-15%（3ターン）', effects: [addStat('atk', 10), addSpecial('armorBreak', { rate: 0.85, turns: 3 })] },
  sword_boots:     { name: '先駆けの剣',   tier: 2, image: 'items/sword_boots.png',     desc: '攻撃+10、戦闘で最初の攻撃が2倍', effects: [addStat('atk', 10), addSpecial('firstStrike', { rate: 2 })] },
  // 盾の系統
  shield_shield:   { name: '城壁の盾',     tier: 2, image: 'items/shield_shield.png',   desc: '防御+25', effects: [addStat('def', 25)] },
  shield_feather:  { name: '風の盾',       tier: 2, image: 'items/shield_feather.png',  desc: '防御+10・速度+8、回避15%', effects: [addStat('def', 10), addStat('spd', 8), addBonus('evasion', 0.15)] },
  shield_orb:      { name: '魔法の盾',     tier: 2, image: 'items/shield_orb.png',      desc: '防御+10、全体攻撃から受けるダメージ-40%', effects: [addStat('def', 10), addBonus('aoeGuard', 0.4)] },
  shield_charm:    { name: '守護の盾',     tier: 2, image: 'items/shield_charm.png',    desc: '防御+10、防御を選ぶとHP10%回復', effects: [addStat('def', 10), addSpecial('guardHeal', { ratio: 0.1 })] },
  shield_earring:  { name: '鉄壁の盾',     tier: 2, image: 'items/shield_earring.png',  desc: '防御+10、会心を受けない', effects: [addStat('def', 10), addSpecial('critImmune')] },
  shield_fang:     { name: '狼の盾',       tier: 2, image: 'items/shield_fang.png',     desc: '防御+10、受けたダメージの10%だけHP回復', effects: [addStat('def', 10), addBonus('damageHeal', 0.1)] },
  shield_boots:    { name: '先陣の盾',     tier: 2, image: 'items/shield_boots.png',    desc: '防御+12、戦闘開始時に味方全員の防御+20%（2ターン）', effects: [addStat('def', 12), addSpecial('openingTeamDef', { rate: 1.2, turns: 2 })] },
  // 指輪の系統
  ring_ring:       { name: '大地の指輪',   tier: 2, image: 'items/ring_ring.png',       desc: 'HP+120', effects: [addStat('hp', 120)] },
  ring_feather:    { name: '旅人の指輪',   tier: 2, image: 'items/ring_feather.png',    desc: 'HP+40・速度+10', effects: [addStat('hp', 40), addStat('spd', 10)] },
  ring_orb:        { name: '魔力の指輪',   tier: 2, image: 'items/ring_orb.png',        desc: 'HP+40、スキル効果+20%', effects: [addStat('hp', 40), addBonus('skillPower', 0.2)] },
  ring_earring:    { name: '幸運の指輪',   tier: 2, image: 'items/ring_earring.png',    desc: 'HP+40、会心率+20%', effects: [addStat('hp', 40), addBonus('critRate', 0.2)] },
  ring_fang:       { name: '吸命の指輪',   tier: 2, image: 'items/ring_fang.png',       desc: 'HP+40、吸収15%', effects: [addStat('hp', 40), addBonus('lifesteal', 0.15)] },
  ring_thorn:      { name: '守りの茨輪',   tier: 2, image: 'items/ring_thorn.png',      desc: 'HP+50、反射20%', effects: [addStat('hp', 50), addBonus('reflect', 0.2)] },
  ring_boots:      { name: '帰還の指輪',   tier: 2, image: 'items/ring_boots.png',      desc: 'HP+50、戦闘不能時に1度だけHP30%で復活', effects: [addStat('hp', 50), addSpecial('revive', { ratio: 0.3 })] },
  // 羽の系統
  feather_feather: { name: '天翔の羽',     tier: 2, image: 'items/feather_feather.png', desc: '速度+20', effects: [addStat('spd', 20)] },
  feather_orb:     { name: '風読みの羽',   tier: 2, image: 'items/feather_orb.png',     desc: '速度+8・スキル効果+20%、スキル使用後に行動ゲージ+20%', effects: [addStat('spd', 8), addBonus('skillPower', 0.2), addSpecial('skillHaste', { amount: 0.2 })] },
  feather_charm:   { name: '春風の羽',     tier: 2, image: 'items/feather_charm.png',   desc: '速度+8、毎ターン味方全員のHP1.5%回復', effects: [addStat('spd', 8), addBonus('teamRegen', 0.015)] },
  feather_earring: { name: '隼の羽',       tier: 2, image: 'items/feather_earring.png', desc: '速度+10、会心率+20%', effects: [addStat('spd', 10), addBonus('critRate', 0.2)] },
  feather_fang:    { name: '疾風の牙羽',   tier: 2, image: 'items/feather_fang.png',    desc: '速度+10、吸収15%', effects: [addStat('spd', 10), addBonus('lifesteal', 0.15)] },
  feather_thorn:   { name: '風茨の羽',     tier: 2, image: 'items/feather_thorn.png',   desc: '速度+8、反射25%', effects: [addStat('spd', 8), addBonus('reflect', 0.25)] },
  // 珠の系統
  orb_orb:         { name: '大賢者の宝珠', tier: 2, image: 'items/orb_orb.png',         desc: 'スキル効果+50%', effects: [addBonus('skillPower', 0.5)] },
  orb_fang:        { name: '魂喰らいの珠', tier: 2, image: 'items/orb_fang.png',        desc: 'スキル効果+20%、スキルでも吸収20%', effects: [addBonus('skillPower', 0.2), addBonus('skillLifesteal', 0.2)] },
  orb_thorn:       { name: '呪いの珠',     tier: 2, image: 'items/orb_thorn.png',       desc: 'スキル効果+15%、攻撃した相手の被ダメージ+15%（3ターン）', effects: [addBonus('skillPower', 0.15), addSpecial('vulnerableOnHit', { value: 0.15, turns: 3 })] },
  orb_boots:       { name: '時の珠',       tier: 2, image: 'items/orb_boots.png',       desc: 'スキル効果+15%、戦闘開始時に行動ゲージ+50%', effects: [addBonus('skillPower', 0.15), addBonus('openingGauge', 0.5)] },
  // お守りの系統
  charm_charm:     { name: '大樹のお守り', tier: 2, image: 'items/charm_charm.png',     desc: '毎ターンHP6%回復', effects: [addBonus('regen', 0.06)] },
  charm_earring:   { name: '勝利のお守り', tier: 2, image: 'items/charm_earring.png',   desc: '会心率+15%、会心を出すとHP5%回復', effects: [addBonus('critRate', 0.15), addSpecial('critHeal', { ratio: 0.05 })] },
  charm_fang:      { name: '生命のお守り', tier: 2, image: 'items/charm_fang.png',      desc: '吸収10%、毎ターンHP3%回復', effects: [addBonus('lifesteal', 0.1), addBonus('regen', 0.03)] },
  charm_thorn:     { name: '茨のお守り',   tier: 2, image: 'items/charm_thorn.png',     desc: '毎ターンHP3%回復、反射20%', effects: [addBonus('regen', 0.03), addBonus('reflect', 0.2)] },
  charm_boots:     { name: '旅立ちのお守り', tier: 2, image: 'items/charm_boots.png',   desc: '戦闘開始時に行動ゲージ+30%、毎ターンHP3%回復', effects: [addBonus('openingGauge', 0.3), addBonus('regen', 0.03)] },
  // ピアスの系統
  earring_earring: { name: '王者のピアス', tier: 2, image: 'items/earring_earring.png', desc: '会心率+35%、会心ダメージ2.5倍', effects: [addBonus('critRate', 0.35), addBonus('critDamage', 0.5)] },
  earring_fang:    { name: '吸血のピアス', tier: 2, image: 'items/earring_fang.png',    desc: '会心率+20%、会心時に与ダメージの30%吸収', effects: [addBonus('critRate', 0.2), addSpecial('critLifesteal', { value: 0.3 })] },
  earring_thorn:   { name: '棘のピアス',   tier: 2, image: 'items/earring_thorn.png',   desc: '会心率+15%、反射20%（反射にも会心判定）', effects: [addBonus('critRate', 0.15), addBonus('reflect', 0.2), addSpecial('reflectCrit')] },
  earring_boots:   { name: '閃光のピアス', tier: 2, image: 'items/earring_boots.png',   desc: '会心率+15%、戦闘で最初の攻撃は必ず会心', effects: [addBonus('critRate', 0.15), addSpecial('firstCrit')] },
  // 牙・茨・靴の系統
  fang_fang:       { name: '魔獣の牙',     tier: 2, image: 'items/fang_fang.png',       desc: '吸収30%', effects: [addBonus('lifesteal', 0.3)] },
  thorn_thorn:     { name: '茨の要塞',     tier: 2, image: 'items/thorn_thorn.png',     desc: '防御+10、反射40%', effects: [addStat('def', 10), addBonus('reflect', 0.4)] },
  thorn_boots:     { name: '茨の具足',     tier: 2, image: 'items/thorn_boots.png',     desc: '反射20%、戦闘開始時に行動ゲージ+30%', effects: [addBonus('reflect', 0.2), addBonus('openingGauge', 0.3)] },
  boots_boots:     { name: '光速のブーツ', tier: 2, image: 'items/boots_boots.png',     desc: '速度+10、戦闘開始時に行動ゲージ+100%（最初に必ず行動）', effects: [addStat('spd', 10), addBonus('openingGauge', 1.0)] },
};

// ---------------------------------------------------------------------
// 合成レシピ（下級2つ → 上級1つ。並び順は関係なし）
// 下級10種の全組み合わせ（同じもの2つを含む）= 55種。レシピにない組み合わせはない
// 同じ素材2つのレシピは図鑑で「極」マークが付く
// ---------------------------------------------------------------------
const RECIPES = [
  // 剣
  { items: ['ironSword', 'ironSword'],         result: 'sword_sword' },
  { items: ['ironSword', 'leatherShield'],     result: 'sword_shield' },
  { items: ['ironSword', 'lifeRing'],          result: 'sword_ring' },
  { items: ['ironSword', 'galeFeather'],       result: 'galeBlade' },
  { items: ['ironSword', 'manaOrb'],           result: 'violetBlade' },
  { items: ['ironSword', 'prayerCharm'],       result: 'sword_charm' },
  { items: ['ironSword', 'critPierce'],        result: 'greatSword' },
  { items: ['ironSword', 'sharpFang'],         result: 'sword_fang' },
  { items: ['ironSword', 'thornArmor'],        result: 'sword_thorn' },
  { items: ['ironSword', 'swiftBoots'],        result: 'sword_boots' },
  // 盾
  { items: ['leatherShield', 'leatherShield'], result: 'shield_shield' },
  { items: ['leatherShield', 'lifeRing'],      result: 'giantShield' },
  { items: ['leatherShield', 'galeFeather'],   result: 'shield_feather' },
  { items: ['leatherShield', 'manaOrb'],       result: 'shield_orb' },
  { items: ['leatherShield', 'prayerCharm'],   result: 'shield_charm' },
  { items: ['leatherShield', 'critPierce'],    result: 'shield_earring' },
  { items: ['leatherShield', 'sharpFang'],     result: 'shield_fang' },
  { items: ['leatherShield', 'thornArmor'],    result: 'counterArmor' },
  { items: ['leatherShield', 'swiftBoots'],    result: 'shield_boots' },
  // 指輪
  { items: ['lifeRing', 'lifeRing'],           result: 'ring_ring' },
  { items: ['lifeRing', 'galeFeather'],        result: 'ring_feather' },
  { items: ['lifeRing', 'manaOrb'],            result: 'ring_orb' },
  { items: ['lifeRing', 'prayerCharm'],        result: 'holyRing' },
  { items: ['lifeRing', 'critPierce'],         result: 'ring_earring' },
  { items: ['lifeRing', 'sharpFang'],          result: 'ring_fang' },
  { items: ['lifeRing', 'thornArmor'],         result: 'ring_thorn' },
  { items: ['lifeRing', 'swiftBoots'],         result: 'ring_boots' },
  // 羽
  { items: ['galeFeather', 'galeFeather'],     result: 'feather_feather' },
  { items: ['galeFeather', 'manaOrb'],         result: 'feather_orb' },
  { items: ['galeFeather', 'prayerCharm'],     result: 'feather_charm' },
  { items: ['galeFeather', 'critPierce'],      result: 'feather_earring' },
  { items: ['galeFeather', 'sharpFang'],       result: 'feather_fang' },
  { items: ['galeFeather', 'thornArmor'],      result: 'feather_thorn' },
  { items: ['galeFeather', 'swiftBoots'],      result: 'godspeedBoots' },
  // 珠
  { items: ['manaOrb', 'manaOrb'],             result: 'orb_orb' },
  { items: ['manaOrb', 'prayerCharm'],         result: 'healingStaff' },
  { items: ['manaOrb', 'critPierce'],          result: 'sageOrb' },
  { items: ['manaOrb', 'sharpFang'],           result: 'orb_fang' },
  { items: ['manaOrb', 'thornArmor'],          result: 'orb_thorn' },
  { items: ['manaOrb', 'swiftBoots'],          result: 'orb_boots' },
  // お守り
  { items: ['prayerCharm', 'prayerCharm'],     result: 'charm_charm' },
  { items: ['prayerCharm', 'critPierce'],      result: 'charm_earring' },
  { items: ['prayerCharm', 'sharpFang'],       result: 'charm_fang' },
  { items: ['prayerCharm', 'thornArmor'],      result: 'charm_thorn' },
  { items: ['prayerCharm', 'swiftBoots'],      result: 'charm_boots' },
  // ピアス
  { items: ['critPierce', 'critPierce'],       result: 'earring_earring' },
  { items: ['critPierce', 'sharpFang'],        result: 'earring_fang' },
  { items: ['critPierce', 'thornArmor'],       result: 'earring_thorn' },
  { items: ['critPierce', 'swiftBoots'],       result: 'earring_boots' },
  // 牙・茨・靴
  { items: ['sharpFang', 'sharpFang'],         result: 'fang_fang' },
  { items: ['sharpFang', 'thornArmor'],        result: 'vampireCloak' },
  { items: ['sharpFang', 'swiftBoots'],        result: 'assassinFang' },
  { items: ['thornArmor', 'thornArmor'],       result: 'thorn_thorn' },
  { items: ['thornArmor', 'swiftBoots'],       result: 'thorn_boots' },
  { items: ['swiftBoots', 'swiftBoots'],       result: 'boots_boots' },
];

// ---------------------------------------------------------------------
// 特級装備（上級装備3つから作る。★1〜★5のランクつき）
// 数値の調整はここだけでOK
// ---------------------------------------------------------------------
// 作り方：上級3つに含まれる下級素材（上級1つ＝下級2つ、合計6つ）を数え、一番多い素材の系統の特級装備になる
//         その素材の数でランクが決まる（rankByCount）。効果は★5の値 × rankRates[★]
// effects の書き方は上の ITEMS と同じ。scale: false の部品・値は、ランクに関係なく固定
// byRank: { 1: 値, ... } を書いた値は、ランクごとに決まった値を使う（神眼のピアスの会心ダメージなど）
const LEGEND = {
  unlockFloor: 50,   // この階のボスを初めて倒すと、特級合成が解放される
  perChar: 2,        // 1人が装備できる特級装備の数（装備枠のうち、特級はここまで）
  // 素材の数 → ランク（1〜2個＝★1、3個＝★2、4個＝★3、5個＝★4、6個＝★5）
  rankByCount: { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 },
  // ランク → 効果の倍率（★5＝100%）
  rankRates: { 1: 0.55, 2: 0.65, 3: 0.75, 4: 0.9, 5: 1.0 },
  // 系統（下級素材のID）→ 特級装備
  families: {
    ironSword:     { key: 'sword',   kind: '剣',     name: '天剣',         image: 'items/legend_sword.png',
                     effects: [addStat('atk', 40), addSpecial('splash', { ratio: 0.3 })],
                     desc: v => `攻撃+${v.atk}、攻撃するたびに敵全員にも与えたダメージの${v.ratio}%` },
    leatherShield: { key: 'shield',  kind: '盾',     name: '神盾',         image: 'items/legend_shield.png',
                     effects: [addStat('def', 40), addSpecial('teamGuard', { value: 0.15, pct: true })],
                     desc: v => `防御+${v.def}、味方全員の被ダメージ-${v.teamGuard}%（複数装備しても重ならない）` },
    lifeRing:      { key: 'ring',    kind: '指輪',   name: '生命の神輪',   image: 'items/legend_ring.png',
                     effects: [addStat('hp', 200), addSpecial('lastStand', { ratio: 0.5, scale: false })],
                     desc: v => `HP+${v.hp}、1戦闘に1回、倒れるダメージを受けてもHP50%で耐える` },
    galeFeather:   { key: 'feather', kind: '羽',     name: '天翼',         image: 'items/legend_feather.png',
                     effects: [addStat('spd', 30), addSpecial('extraTurn', { chance: 0.3 })],
                     desc: v => `速度+${v.spd}、行動後${v.chance}%でもう一度行動` },
    manaOrb:       { key: 'orb',     kind: '珠',     name: '叡智の宝珠',   image: 'items/legend_orb.png',
                     effects: [addBonus('skillPower', 0.8), addSpecial('cooldownCut', { value: 1, scale: false })],
                     desc: v => `スキル効果+${v.skillPower}%、スキルの使用制限ターン-1` },
    prayerCharm:   { key: 'charm',   kind: 'お守り', name: '世界樹の護符', image: 'items/legend_charm.png',
                     effects: [addSpecial('teamCharm', { value: 0.05, pct: true })],
                     desc: v => `毎ターン味方全員のHPを${v.teamCharm}%回復（複数装備しても重ならない）` },
    critPierce:    { key: 'earring', kind: 'ピアス', name: '神眼のピアス', image: 'items/legend_earring.png',
                     effects: [addBonus('critRate', 0.5), { type: 'bonus', key: 'critDamage', byRank: { 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5, 5: 1.0 } }],
                     desc: v => `会心率+${v.critRate}%、会心ダメージ${2 + v.critDamage / 100}倍` },
    sharpFang:     { key: 'fang',    kind: '牙',     name: '魔王の牙',     image: 'items/legend_fang.png',
                     effects: [addBonus('lifesteal', 0.4), addSpecial('overhealBarrier', { cap: 0.3 })],
                     desc: v => `吸収${v.lifesteal}%、最大HPを超えた回復分は最大HPの${v.cap}%までバリアになる` },
    thornArmor:    { key: 'thorn',   kind: 'いばら', name: '茨の神鎧',     image: 'items/legend_thorn.png',
                     effects: [addBonus('reflect', 0.45), addSpecial('reflectDelay', { amount: 0.25 })],
                     desc: v => `反射${v.reflect}%、反射するたび相手の行動ゲージ-${v.amount}%（同じ敵には1ターンに1回まで）` },
    swiftBoots:    { key: 'boots',   kind: 'ブーツ', name: '時渡りの靴',   image: 'items/legend_boots.png',
                     effects: [addStat('spd', 50), addBonus('evasion', 0.2)],
                     desc: v => `速度+${v.spd}、回避率+${v.evasion}%` },
  },
};

// 値をランクの倍率で縮める（小数第1位で四捨五入。割合は「%の数字」で小数第1位）
function legendScale(value, rate, isRatio) {
  if (isRatio) return Math.round(value * rate * 1000) / 1000;   // 例：0.3 × 0.55 = 0.165（16.5%）
  return Math.round(value * rate * 10) / 10;                     // 例：30 × 0.55 = 16.5
}

// 特級装備の ID（例：legend_sword_3）
function legendId(familyBase, rank) {
  return `legend_${LEGEND.families[familyBase].key}_${rank}`;
}

// 特級装備（10系統 × ★1〜★5）を ITEMS に登録する
(function registerLegendItems() {
  for (const base in LEGEND.families) {
    const f = LEGEND.families[base];
    for (let rank = 1; rank <= 5; rank++) {
      const rate = LEGEND.rankRates[rank];
      const shown = {}; // 説明文に出す数字（割合は%で）
      const effects = f.effects.map(e => {
        const out = { ...e };
        delete out.scale;
        delete out.byRank;
        delete out.pct;
        if (e.byRank) {
          out.value = e.byRank[rank];
          shown[e.key] = Math.round(out.value * 1000) / 10;
          return out;
        }
        const scale = e.scale !== false;
        for (const k of Object.keys(e)) {
          if (['type', 'stat', 'key', 'scale', 'pct'].includes(k) || typeof e[k] !== 'number') continue;
          const isRatio = e.type === 'bonus' || e.pct || k === 'ratio' || k === 'chance' || k === 'cap' || k === 'amount';
          out[k] = scale ? legendScale(e[k], rate, isRatio) : e[k];
          const label = k === 'value' ? (e.stat || e.key) : k;
          shown[label] = isRatio ? Math.round(out[k] * 1000) / 10 : out[k];
        }
        return out;
      });
      ITEMS[legendId(base, rank)] = {
        name: `${f.name}★${rank}`, baseName: f.name, tier: 3, rank, family: base, kind: f.kind,
        image: f.image, desc: f.desc(shown), effects,
      };
    }
  }
})();

// 上級装備の素材（下級2つ）。レシピから逆引き
function itemMaterials(itemId) {
  const r = RECIPES.find(x => x.result === itemId);
  return r ? r.items : [];
}

// 上級装備3つから、できあがる特級装備を調べる
// 戻り値：{ counts: {下級ID: 数}, top: 一番多い数, candidates: [同数で並んだ下級ID], rank }
function legendPreview(highIds) {
  const counts = {};
  for (const id of highIds) for (const m of itemMaterials(id)) counts[m] = (counts[m] || 0) + 1;
  const top = Math.max(0, ...Object.values(counts));
  const candidates = Object.keys(counts).filter(k => counts[k] === top && LEGEND.families[k]);
  return { counts, top, candidates, rank: LEGEND.rankByCount[Math.min(6, top)] || 1 };
}
