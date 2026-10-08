// =====================================================================
// data.js  ―  ゲームのデータ定義（ステータス・スキル・敵・編成）
// ここを書き換える／1行追加するだけでキャラや敵、スキルを増やせます。
// ロジックは main.js 側にあり、このファイルには「データだけ」を置きます。
// =====================================================================

// ---------------------------------------------------------------------
// バトル全体の設定値
// ---------------------------------------------------------------------
const BATTLE_CONFIG = {
  gaugeBase: 10000,     // 待ち時間 = gaugeBase ÷ 速度
  defenseConstant: 50,  // ダメージ = 攻撃力×威力 × 定数 ÷ (定数 + 防御力)
  variance: 0.1,        // ダメージの乱数幅（±10%）
  guardRate: 0.5,       // 防御中に受けるダメージの倍率
  orderPreview: 8,      // 行動順を何手先まで表示するか
  enemyDelay: 700,      // 自動行動（敵・オート中の味方）までの待ち時間（ミリ秒、×1のとき）
  turnInterval: 350,    // 行動と行動の間の待ち時間（ミリ秒、×1のとき）
  speedOptions: [1, 2, 4], // 戦闘速度の切り替え候補
};

// 表示用ラベル
const STAT_LABELS = { hp: 'HP', atk: '攻撃', def: '防御', spd: '速度' };
const ROLE_LABELS = { attacker: '攻撃役', tank: '守り役', healer: '回復役', support: '補助役', all: 'バランス' };
const ENEMY_TYPE_LABELS = {
  normal: 'ふつう', fast: 'すばやい系', tough: 'かたい系', charge: 'ためる系',
  disrupt: '妨害系', heal: '回復系', special: '特殊', boss: 'ボス',
};

// ---------------------------------------------------------------------
// スキル定義
// ---------------------------------------------------------------------
// target（スキルの対象）:
//   'enemy'      … 相手側の1体（味方が使えば敵1体、敵が使えば味方1体）
//   'allEnemies' … 相手側の全員
//   'self'       … 自分
//   'ally'       … 自分側の1体（AIはHP割合が一番低い仲間を選ぶ）
//   'allAllies'  … 自分側の全員
// cooldown: 使用後、何ターン使えなくなるか（省略で0 = いつでも使える）
// shake: true にすると、使ったときにバトル画面全体が揺れる
// danger: true にすると「大技」扱い。敵がこの技を予定していると行動順リストに ⚠ で予告される
// effects（効果の配列。上から順に発動。組み合わせ自由）:
//   { type: 'damage', power: 1.0, hits: 1 }        攻撃力×power のダメージを hits 回
//   { type: 'heal',   ratio: 0.3 }                 対象の最大HP×ratio 回復
//   { type: 'buff',   stat: 'spd', rate: 1.5, turns: 3 }
//                                                  能力を rate 倍（1未満ならデバフ）、対象の行動 turns 回分
//   { type: 'delay',  amount: 0.5 }                対象の待ち時間を「満タン時の amount 倍」ぶん増やす
//   { type: 'hasten', amount: 0.5 }                対象の待ち時間を「満タン時の amount 倍」ぶん減らす
//   { type: 'guard' }                              次の自分の行動まで受けるダメージを軽減
//   { type: 'cover' }                              次の自分の行動まで、対象への攻撃を代わりに受ける
//   buff に tag: 'charge' を付けると「力をためている」状態として扱われる（オートの判断に使う）
//   { type: 'status', status: 'burn', value: 0.03, turns: 2, chance: 0.3 }  状態異常（chance 省略で必ず）
//   { type: 'summon', enemy: 'skeleton', count: 1 }   仲間を呼ぶ
//   { type: 'countdown', skill: 'abyssFlame', turns: 3 } 大技を予告（turns ターン後に必ず使う）
//   { type: 'queueSkill', skill: 'emerge' }            次の自分の行動でこの技を使う
//   { type: 'damageRandom', power: 0.7, count: 3 }    ランダムな相手に count 回攻撃
//   { type: 'revive', ratio: 0.5 }                     倒れた仲間を蘇生（スキルの target は 'deadAlly'）
//   { type: 'toBack' }                                 相手の行動を一番後ろへ
//   { type: 'selfKill' }                               自分が倒れる（爆弾岩の大爆発）
// 効果ごとに target: 'self' を書くと、その効果だけ自分にかかる（例：攻撃＋自分強化）
// 効果ごとに target: 'allAllies' を書くと、その効果だけ自分の仲間全員にかかる（例：全体攻撃＋仲間強化）
const SKILLS = {
  // --- 共通 ---
  attack:     { name: '攻撃', target: 'enemy', desc: '敵1体に通常攻撃', effects: [{ type: 'damage', power: 1.0 }] },
  defend:     { name: '防御', target: 'self', desc: '次の行動まで受けるダメージ半減', effects: [{ type: 'guard' }] },

  // --- 主人公用 ---
  heavySlash: { name: '強斬り', target: 'enemy', cooldown: 3, desc: '敵1体に1.8倍ダメージ（使用後3ターン使用不可）', effects: [{ type: 'damage', power: 1.8 }] },
  legSweep:   { name: '足払い', target: 'enemy', cooldown: 3, desc: '敵1体に0.6倍ダメージ＋行動を大きく遅らせる', effects: [{ type: 'damage', power: 0.6 }, { type: 'delay', amount: 0.6 }] },
  firstAid:   { name: '応急手当', target: 'self', cooldown: 4, desc: '自分の最大HPの35%回復', effects: [{ type: 'heal', ratio: 0.35 }] },
  quicken:    { name: '加速', target: 'self', cooldown: 5, desc: '3ターンの間 速度1.5倍', effects: [{ type: 'buff', stat: 'spd', rate: 1.5, turns: 3 }] },

  // --- 騎士・僧侶用 ---
  cover:      { name: 'かばう', target: 'ally', cooldown: 2, desc: '味方1体をかばう（次の自分の行動まで代わりに攻撃を受ける）＋自分は防御', effects: [{ type: 'cover' }, { type: 'guard', target: 'self' }] },
  heal:       { name: '回復', target: 'ally', desc: '味方1体のHPを35%回復', effects: [{ type: 'heal', ratio: 0.35 }] },
  healAll:    { name: '全体回復', target: 'allAllies', cooldown: 2, desc: '味方全員のHPを25%回復', effects: [{ type: 'heal', ratio: 0.25 }] },

  // --- 敵用 ---
  doubleBite: { name: '連続かみつき', target: 'enemy', desc: '0.6倍ダメージ×2回', effects: [{ type: 'damage', power: 0.6, hits: 2 }] },
  harden:     { name: 'かたくなる', target: 'self', cooldown: 3, desc: '防御2倍（3ターン）', effects: [{ type: 'buff', stat: 'def', rate: 2.0, turns: 3 }] },
  charge:     { name: '力をためる', target: 'self', desc: '次の行動まで攻撃2倍', effects: [{ type: 'buff', stat: 'atk', rate: 2.0, turns: 1, tag: 'charge' }] },
  heavyBlow:  { name: '渾身の一撃', target: 'enemy', danger: true, desc: '1.5倍ダメージ', effects: [{ type: 'damage', power: 1.5 }] },
  slowCurse:  { name: '鈍足の呪い', target: 'enemy', cooldown: 3, desc: '速度0.6倍（3ターン）', effects: [{ type: 'buff', stat: 'spd', rate: 0.6, turns: 3 }] },
  shadowBind: { name: '影しばり', target: 'enemy', cooldown: 2, desc: '0.5倍ダメージ＋行動を遅らせる', effects: [{ type: 'damage', power: 0.5 }, { type: 'delay', amount: 0.4 }] },
  healAlly:   { name: 'いやしの花粉', target: 'ally', cooldown: 1, desc: '仲間1体のHPを30%回復', effects: [{ type: 'heal', ratio: 0.3 }] },
  roar:       { name: '怒りの咆哮', target: 'self', desc: '攻撃1.3倍・速度1.2倍（長時間）', effects: [{ type: 'buff', stat: 'atk', rate: 1.3, turns: 99 }, { type: 'buff', stat: 'spd', rate: 1.2, turns: 99 }] },
  quake:      { name: '大地震', target: 'allEnemies', cooldown: 3, shake: true, danger: true, desc: '相手全員に1.2倍ダメージ＋行動を遅らせる', effects: [{ type: 'damage', power: 1.2 }, { type: 'delay', amount: 0.3 }] },

  // --- 深淵の竜王 ---
  dragonBite:  { name: 'かみつき',   target: 'enemy', desc: '1.1倍ダメージ', effects: [{ type: 'damage', power: 1.1 }] },
  fireBreath:  { name: '炎のブレス', target: 'allEnemies', cooldown: 2, shake: true, desc: '相手全員に0.8倍ダメージ＋やけど（毎ターン3%、2ターン）', effects: [{ type: 'damage', power: 0.8 }, { type: 'status', status: 'burn', value: 0.03, turns: 2 }] },
  soar:        { name: '飛翔',       target: 'self', cooldown: 3, desc: '2ターンの間 回避50%', effects: [{ type: 'status', status: 'flying', value: 0.5, turns: 2 }] },
  dive:        { name: '急降下',     target: 'enemy', danger: true, desc: '2.5倍ダメージ', effects: [{ type: 'damage', power: 2.5 }] },
  abyssCharge: { name: '深淵の胎動', target: 'self', cooldown: 6, desc: '3ターン後に「深淵の炎」を放つ', effects: [{ type: 'countdown', skill: 'abyssFlame', turns: 3 }] },
  abyssFlame:  { name: '深淵の炎',   target: 'allEnemies', shake: true, danger: true, desc: '相手全員に3倍ダメージ（防御で半減）', effects: [{ type: 'damage', power: 3.0 }] },

  // --- 灼熱の火山（21〜30階） ---
  flameBreath:   { name: '炎の息',     target: 'enemy', cooldown: 2, desc: '1.2倍ダメージ＋やけど', effects: [{ type: 'damage', power: 1.2 }, { type: 'status', status: 'burn', value: 0.03, turns: 2 }] },
  lavaBurst:     { name: '溶岩噴出',   target: 'allEnemies', shake: true, danger: true, desc: '相手全員に1.3倍ダメージ', effects: [{ type: 'damage', power: 1.3 }] },
  bombBlast:     { name: '大爆発',     target: 'allEnemies', shake: true, danger: true, desc: '相手全員に4倍ダメージ（自分も倒れる）', effects: [{ type: 'damage', power: 4.0 }, { type: 'selfKill', target: 'self' }] },
  ashStorm:      { name: '灰の嵐',     target: 'allEnemies', cooldown: 2, desc: '相手全員に0.8倍ダメージ＋仲間の攻撃+20%（3ターン）', effects: [{ type: 'damage', power: 0.8 }, { type: 'buff', target: 'allAllies', stat: 'atk', rate: 1.2, turns: 3, tag: 'ash' }] },
  burrow:        { name: '地中に潜る', target: 'self', cooldown: 3, desc: '1ターン攻撃無効、次の行動で飛び出して2倍ダメージ', effects: [{ type: 'status', status: 'burrowed', turns: 1 }, { type: 'queueSkill', skill: 'emerge' }] },
  emerge:        { name: '飛び出し',   target: 'enemy', danger: true, desc: '2倍ダメージ', effects: [{ type: 'damage', power: 2.0 }] },
  flameFist:     { name: '炎の拳',     target: 'enemy', desc: '1.3倍ダメージ', effects: [{ type: 'damage', power: 1.3 }] },
  fireCircle:    { name: '火炎陣',     target: 'allEnemies', cooldown: 2, shake: true, desc: '相手全員に0.9倍ダメージ＋やけど', effects: [{ type: 'damage', power: 0.9 }, { type: 'status', status: 'burn', value: 0.03, turns: 2 }] },
  eruption:      { name: '大噴火',     target: 'allEnemies', shake: true, danger: true, desc: '相手全員に3倍ダメージ（防御で半減）', effects: [{ type: 'damage', power: 3.0 }] },

  // --- 深海の神殿（31〜40階） ---
  charmSong:     { name: '魅了の歌',   target: 'enemy', cooldown: 2, desc: '0.6倍ダメージ＋30%で魅了（1回だけ味方を攻撃）', effects: [{ type: 'damage', power: 0.6 }, { type: 'status', status: 'charm', turns: 1, chance: 0.3 }] },
  inkSpray:      { name: '墨',         target: 'enemy', cooldown: 4, desc: '0.8倍ダメージ＋墨（3ターン行動順が見えない）', effects: [{ type: 'damage', power: 0.8 }, { type: 'status', status: 'ink', turns: 3 }] },
  bigMouth:      { name: '大口',       target: 'enemy', cooldown: 2, danger: true, desc: '2.5倍ダメージ', effects: [{ type: 'damage', power: 2.5 }] },
  summonSkeleton:{ name: '亡者の号令', target: 'self', cooldown: 4, desc: '骸骨剣士を1体呼ぶ', effects: [{ type: 'summon', enemy: 'skeleton', count: 1 }] },
  seaBite:       { name: 'かみつき',   target: 'enemy', desc: '1.2倍ダメージ', effects: [{ type: 'damage', power: 1.2 }] },
  tsunami:       { name: '大津波',     target: 'allEnemies', cooldown: 3, shake: true, desc: '相手全員に1.0倍ダメージ＋行動ゲージ-30%', effects: [{ type: 'damage', power: 1.0 }, { type: 'delay', amount: 0.3 }] },
  submerge:      { name: '海に潜る',   target: 'self', cooldown: 5, desc: '2ターン攻撃無効 → 浮上して全体攻撃', effects: [{ type: 'status', status: 'submerged', turns: 2 }, { type: 'queueSkill', skill: 'surge' }] },
  surge:         { name: '浮上の大渦', target: 'allEnemies', shake: true, danger: true, desc: '相手全員に2倍ダメージ', effects: [{ type: 'damage', power: 2.0 }] },

  // --- 天空の城（41〜50階） ---
  chainLightning:{ name: '連鎖雷',     target: 'self', cooldown: 2, desc: 'ランダムな相手に0.7倍ダメージ×3回', effects: [{ type: 'damageRandom', power: 0.7, count: 3 }] },
  resurrect:     { name: '蘇生の祈り', target: 'deadAlly', cooldown: 999, desc: '倒れた仲間1体をHP50%で蘇生（1回だけ）', effects: [{ type: 'revive', ratio: 0.5 }] },
  griffonDive:   { name: '急降下',     target: 'enemy', cooldown: 2, danger: true, desc: '2倍ダメージ＋相手の行動を一番後ろへ', effects: [{ type: 'damage', power: 2.0 }, { type: 'toBack' }] },
  poisonTail:    { name: '毒の尾',     target: 'enemy', cooldown: 2, desc: '1.0倍ダメージ＋毒（毎ターン6%、3ターン）', effects: [{ type: 'damage', power: 1.0 }, { type: 'status', status: 'poison', value: 0.06, turns: 3 }] },
  timeMagic:     { name: '時の魔法',   target: 'allEnemies', cooldown: 4, desc: '相手全員の速度-20%、仲間全員の速度+20%（3ターン）', effects: [{ type: 'buff', stat: 'spd', rate: 0.8, turns: 3 }, { type: 'buff', target: 'allAllies', stat: 'spd', rate: 1.2, turns: 3 }] },
  lightSword:    { name: '光の剣',     target: 'enemy', desc: '0.9倍ダメージ×2回', effects: [{ type: 'damage', power: 0.9, hits: 2 }] },
  skyBarrier:    { name: '天空結界',   target: 'self', cooldown: 6, desc: '3ターン受けるダメージ半減', effects: [{ type: 'status', status: 'barrier', turns: 3 }] },
  lightRain:     { name: '光の雨',     target: 'allEnemies', cooldown: 2, shake: true, desc: '相手全員に1.2倍ダメージ', effects: [{ type: 'damage', power: 1.2 }] },
  endLight:      { name: '終焉の光',   target: 'allEnemies', shake: true, danger: true, desc: '相手全員に4倍ダメージ（防御で半減）', effects: [{ type: 'damage', power: 4.0 }] },
};

// ---------------------------------------------------------------------
// 敵の特殊能力（部品）。敵の traits に { type: 'reflect', value: 0.3 } のように書くだけで使える
// icon: 名前の横に出るアイコン / name: 表示名 / desc: マウスを乗せたときの説明（t は書いた値）
// ---------------------------------------------------------------------
const pct = v => `${Math.round(v * 100)}%`;
const TRAIT_INFO = {
  reflect:        { icon: '🪞', name: '反射',     desc: t => `受けたダメージの${pct(t.value)}を攻撃者に反射` },
  poisonOnHit:    { icon: '☠',  name: '毒',       desc: t => `攻撃した相手を毒にする（毎ターン最大HPの${pct(t.value)}、${t.turns}ターン）` },
  endure:         { icon: '💀', name: '不屈',     desc: () => '1度だけ、倒れるダメージを受けてもHP1で耐える' },
  guardian:       { icon: '🛡', name: '護衛',     desc: () => 'HPが最も低い仲間への単体攻撃を代わりに受ける' },
  deathBlast:     { icon: '💥', name: '爆炎',     desc: t => `倒されると相手全員に攻撃力×${t.power}の炎ダメージ` },
  selfDestruct:   { icon: '🧨', name: '自爆',     desc: t => `${t.after}回行動すると自爆する（爆炎が発動）` },
  dormant:        { icon: '💤', name: '擬態',     desc: () => '最初は行動しない。攻撃されると目覚めて即行動＋次の攻撃2倍' },
  rewardOnDefeat: { icon: '🎁', name: 'お宝',     desc: () => '倒すとアイテムを1回選べる' },
  freezeOnHit:    { icon: '❄',  name: '凍結',     desc: t => `攻撃時${pct(t.chance)}で相手の行動ゲージを0に戻す` },
  evasion:        { icon: '💨', name: '回避',     desc: t => `${pct(t.value)}の確率で攻撃をかわす` },
  targetWeakest:  { icon: '🎯', name: '狙い撃ち', desc: () => 'HPの割合が最も低い相手を狙う' },
  executeCrit:    { icon: '🗡', name: '処刑',     desc: () => 'HP50%以下の相手には必ず会心' },
  splitOnDeath:   { icon: '🫧', name: '分裂',     desc: t => `倒れたとき${pct(t.chance)}で${ENEMIES[t.into].name}${t.count}体に分裂` },
  critImmune:     { icon: '🪨', name: '堅牢',     desc: () => '会心を受けない' },
  enrageAt:       { icon: '😡', name: '怒り',     desc: t => `HP${pct(t.below)}以下で攻撃+${pct(t.rate - 1)}` },
  curseOnDeath:   { icon: '🌀', name: '呪い',     desc: t => `倒れたとき、倒した相手の${STAT_LABELS[t.stat]}-${pct(1 - t.rate)}（${t.turns}ターン）` },
  regen:          { icon: '🌿', name: '再生',     desc: t => `毎ターンHPを${pct(t.value)}回復` },
  damageCut:      { icon: '🧱', name: '硬化',     desc: t => `受けるダメージ-${pct(t.value)}` },
  statBoost:      { icon: '⚡', name: '能力強化', desc: t => `${STAT_LABELS[t.stat]}×${t.rate}` },
  // --- 21〜50階で追加 ---
  statusOnHit:    { icon: '🔥', name: '追加効果', desc: t => `攻撃した相手を${STATUS_INFO[t.status].name}にする（毎ターン${pct(t.value)}、${t.turns}ターン）` },
  triggerAt:      { icon: '🌋', name: '噴出',     desc: t => `HP${pct(t.below)}以下になると「${SKILLS[t.skill].name}」を使う（1回だけ）` },
  fuse:           { icon: '💣', name: '導火線',   desc: t => `${t.turns}ターン後に「${SKILLS[t.skill].name}」` },
  rebirth:        { icon: '🪶', name: '復活',     desc: t => `1度だけ、倒れてもHP${pct(t.ratio)}でよみがえる` },
  iai:            { icon: '⚔', name: '居合',     desc: t => `自分より遅い相手への攻撃が${t.rate}倍` },
  delayOnHit:     { icon: '⚡', name: '麻痺',     desc: t => `攻撃した相手の行動ゲージ-${pct(t.amount)}` },
  counter:        { icon: '↩', name: '反撃',     desc: t => `攻撃を受けると${pct(t.chance)}で反撃` },
  puffUp:         { icon: '🐡', name: 'ふくらむ', desc: () => '攻撃を受けるとふくらむ（2ターン防御2倍＋受けたダメージの20%反射）' },
  pack:           { icon: '🐟', name: '群れ',     desc: t => `同じ種類の仲間がいると攻撃+${pct(t.rate - 1)}` },
  guardCycle:     { icon: '🛡', name: '無敵化',   desc: t => `${t.every}ターンに1回、${STATUS_INFO[t.status].name}で無敵になる（その間は行動しない）` },
  pointsOnDefeat: { icon: '💎', name: '真珠',     desc: t => `倒すとポイント+${t.value}` },
  taunt:          { icon: '🏮', name: '誘いの光', desc: () => '相手の単体攻撃を自分に集める' },
  ethereal:       { icon: '👻', name: '霊体',     desc: t => `物理ダメージ-${pct(t.value)}（魔法の技は通常どおり）` },
  accelerate:     { icon: '⚙', name: '加速',     desc: t => `行動するたびに速度×${t.rate}（最大${t.max}倍）` },
};

// ---------------------------------------------------------------------
// 状態異常（キャラの上にアイコンと残りターンを表示。自分の行動開始時に残りターンが1減る）
// dot: 毎ターン最大HP×value のダメージ / evasion: 回避率に加算 / applyText: かかったときのログ
// ---------------------------------------------------------------------
const STATUS_INFO = {
  poison: { icon: '☠',  name: '毒',     dot: true, applyText: 'は毒におかされた！',           desc: s => `毎ターン最大HPの${pct(s.value)}ダメージ` },
  burn:   { icon: '🔥', name: 'やけど', dot: true, applyText: 'はやけどを負った！',           desc: s => `毎ターン最大HPの${pct(s.value)}ダメージ` },
  freeze: { icon: '❄',  name: '凍結',              applyText: 'は凍りつき、行動ゲージが0に戻った！', desc: () => '行動ゲージが0に戻された' },
  flying: { icon: '🪽', name: '飛翔',   evasion: 0.5, applyText: 'は空高く舞い上がった！',   desc: () => '回避率+50%' },
  // --- 21〜50階で追加 ---
  // invulnerable: 攻撃が効かない / skipTurn: その間は行動しない / defRate: 防御倍率 / reflect: 反射率 / damageCut: 被ダメージ軽減
  charm:     { icon: '💗', name: '魅了', applyText: 'は魅了されてしまった！',         desc: () => '次の行動で仲間を攻撃してしまう' },
  ink:       { icon: '🦑', name: '墨',   applyText: 'は墨をかぶった！ 行動順が見えない！', desc: () => '行動順リストが見えない' },
  puffed:    { icon: '🐡', name: 'ふくらみ', defRate: 2, reflect: 0.2, applyText: 'はぷくっとふくらんだ！', desc: () => '防御2倍＋受けたダメージの20%反射' },
  barrier:   { icon: '🔰', name: '結界', damageCut: 0.5, applyText: 'は天空結界に包まれた！',  desc: () => '受けるダメージ半減' },
  burrowed:  { icon: '🕳', name: '地中', invulnerable: true, applyText: 'は地中に潜った！',     desc: () => '攻撃が効かない' },
  submerged: { icon: '🌊', name: '海中', invulnerable: true, skipTurn: true, applyText: 'は海に潜った！', desc: () => '攻撃が効かない（行動もしない）' },
  shelled:   { icon: '🐚', name: '殻',   invulnerable: true, applyText: 'は殻にこもった！',     desc: () => '攻撃が効かない' },
  stone:     { icon: '🗿', name: '石化', invulnerable: true, applyText: 'は石になった！',       desc: () => '攻撃が効かない' },
  vulnerable:{ icon: '💔', name: '呪い', applyText: 'は呪われ、受けるダメージが増えた！',       desc: s => `受けるダメージ+${pct(s.value)}` },
};

// ---------------------------------------------------------------------
// 強化個体（11階以降、まれに出る★付きの敵）
// ---------------------------------------------------------------------
const ELITE = {
  from: 11,                       // この階から出る
  chance: 0.1,                    // 1体ごとに強化個体になる確率
  statRate: 1.5,                  // ステータス倍率
  stats: ['hp', 'atk', 'def'],    // 倍率をかけるステータス（速度も上げるなら 'spd' を足す）
  expRate: 2,                     // 経験値の倍率
  // ランダムで1つ追加される特殊能力
  traits: [
    { type: 'regen', value: 0.05, label: '再生' },
    { type: 'enrageAt', below: 0.5, rate: 1.3, label: '怒り' },
    { type: 'damageCut', value: 0.25, label: '硬化' },
    { type: 'statBoost', stat: 'spd', rate: 1.3, label: '俊足' },
  ],
};

// ---------------------------------------------------------------------
// 味方キャラ定義
// ---------------------------------------------------------------------
// hp/atk/def/spd: 初期ステータス（ここにポイントでの強化分が上乗せされる）
// image:  立ち絵の画像パス
// idle:   待機アニメーションのクラス名（省略すると 'idle-breath'。種類は敵定義の説明を参照）
// skills: コマンドに並ぶスキル（SKILLS のキー）
// autoRules: オートバトル時の行動ルール。上から順に調べ、条件(when)を満たし使用可能な最初のスキルを使う
//   when に使える条件（すべて満たしたとき成立）:
//     firstTurn: true            戦闘で最初の行動
//     hpBelow: 0.3 / hpAbove     自分のHP割合
//     allyHpBelow: 0.4           HPがその割合未満の味方（自分含む）がいる
//       allyCount: 2             … ↑と組み合わせて「2人以上いる」
//     enemyCharging: true        力をためている相手がいる
//     hasBuff / notBuff: 'atk'   自分にその強化がかかっている／いない
//   target（省略可）:
//     'charging'                 力をためている相手を狙う
//     省略時                     敵1体なら TARGET_PRIORITY の順、味方1体ならHP割合が一番低い仲間
//   どのルールにも当てはまらなければ「攻撃」
// join: 仲間になる条件（省略すると最初から仲間）。複数書くと全部満たしたとき加入
//   { reachFloor: 5 }    ダンジョン5階に到達
//   { defeatBoss: 10 }   10階のボスを倒す
//   加入しても出撃枠に空きが無ければ控え（強化画面で出撃メンバーを入れ替える）
const CHARACTERS = {
  hero: {
    name: '主人公', role: 'all', image: 'characters/hero.png', hp: 180, atk: 30, def: 15, spd: 100,
    skills: ['attack', 'defend', 'heavySlash', 'legSweep', 'firstAid', 'quicken'],
    autoRules: [
      { skill: 'quicken',    when: { firstTurn: true } },
      { skill: 'legSweep',   when: { enemyCharging: true }, target: 'charging' },
      { skill: 'firstAid',   when: { hpBelow: 0.3 } },
      { skill: 'heavySlash' },
    ],
  },
  knight: {
    name: '騎士', role: 'tank', image: 'characters/knight.png', hp: 240, atk: 22, def: 28, spd: 80,
    join: { reachFloor: 5 },
    skills: ['attack', 'defend', 'cover'],
    autoRules: [
      { skill: 'cover',  when: { allyHpBelow: 0.4 } },
      { skill: 'attack' },
    ],
  },
  priest: {
    name: '僧侶', role: 'healer', image: 'characters/priest.png', hp: 140, atk: 16, def: 12, spd: 110,
    join: { defeatBoss: 10 },
    skills: ['attack', 'heal', 'healAll'],
    autoRules: [
      { skill: 'healAll', when: { allyHpBelow: 0.6, allyCount: 2 } },
      { skill: 'heal',    when: { allyHpBelow: 0.6 } },
      { skill: 'attack' },
    ],
  },
};

// オートバトルで敵1体を狙うときの優先順（敵のタイプ）。どれもいなければ残りHPが一番少ない敵
const TARGET_PRIORITY = ['heal', 'charge'];

// ---------------------------------------------------------------------
// 成長・ポイントの設定
// ---------------------------------------------------------------------
const PROGRESSION = {
  // ※ 仲間の加入条件は CHARACTERS の各キャラの join に書く

  // 全体レベル n → n+1 に必要な経験値 = base + perLevel × (n - 1)
  expToNext: { base: 20, perLevel: 10 },

  // 全体レベルが1上がるごとにもらえるポイント
  pointsPerLevel: 5,

  // キャラに使ったポイント合計がこの値ごとに キャラLv +1（表示用）
  pointsPerCharLevel: 5,

  // ステータス強化：1回あたりの上昇量（gain）と必要ポイント（cost）
  statUpgrades: {
    hp:  { gain: 10, cost: 1 },
    atk: { gain: 2,  cost: 1 },
    def: { gain: 2,  cost: 1 },
    spd: { gain: 1,  cost: 2 },
  },
  // 同じステータスを costStepEvery 回強化するごとに、必要ポイントが costStepAmount 増える
  costStepEvery: 10,
  costStepAmount: 1,

  // 出撃枠：最初の枠数と、拡張の値段（順に 2枠目, 3枠目, 4枠目）。値を足せば上限も増える
  startSlots: 1,
  slotCosts: [10, 20, 35],
};

// ---------------------------------------------------------------------
// 敵定義
// ---------------------------------------------------------------------
// type: 敵のタイプ（ENEMY_TYPE_LABELS のキー）
// image: 立ち絵の画像パス（読み込めないときは名前の1文字目を表示）
// idle:  待機アニメーションのクラス名（style.css に定義。省略すると 'idle-breath'）
//        idle-breath（呼吸）/ idle-puni（ぷにぷに）/ idle-flap（速い上下）/ idle-float（ふわふわ）
//        idle-sway（左右に傾く）/ idle-heavy（重い上下）
// size:  'small' にすると小さく表示（ちびスライムなど）
// enrageBelow: HPがこの割合を切ると怒り状態の見た目（赤っぽくなり、揺れが大きくなる）
// face:  行動順リストの顔アイコンで切り抜く位置（CSS の background-position。省略すると '50% 0%' = 上半分）
//        顔が絵の下のほうにあるキャラは '50% 75%' のように下へずらす
// exp:  倒したときの経験値
// traits: 特殊能力の部品（種類と書き方は TRAIT_INFO を参照）。名前の横にアイコンが出る
// noElite: true なら強化個体にならない
// phases: ボスの段階（HPが below を下回ると発動。上から順に）
//   speech: セリフ / shake: 画面を揺らす / message: ログに出す説明 / enrage: 怒りの見た目にする
//   buffs: [{ stat, rate }] 戦闘中ずっと続く強化 / actionsPerTurn: 1ターンの行動回数 / summon: { enemy, count } 呼び出す敵
//   countdown: { skill, turns } 大技を予告 / timeStop: true 相手全員の行動ゲージを0に戻す
//   turnAura: { status, value, turns } 自分の毎ターン開始時に、相手全員を状態異常にする
//   turnDebuff: { stat, rate, limit, tag, label } 自分の毎ターン開始時に、相手全員の能力を下げる（重ねがけ。limit 倍まで）
// ai:   行動の候補リスト。条件(when)を満たす候補の中から weight の比率でランダムに選ぶ
//   when に使える条件（すべて満たしたときのみ候補になる）:
//     hpBelow: 0.5      自分のHPが50%未満
//     hpAbove: 0.5      自分のHPが50%以上
//     hasBuff / notBuff: 'atk'        自分の攻撃が強化されている／いない
//     charging / notCharging: true    力をためている／いない
//     hasStatus / notStatus: 'flying' その状態異常がかかっている／いない
//     noCountdown: true               大技を予告中でない
//     allyHpBelow: 0.7  HP70%未満の仲間（自分含む）がいる（allyCount: 2 を添えると「2人以上」）
//     ※ 条件の一覧は 味方の autoRules の説明も参照（同じ条件が使える）
//   候補が1つも無いときは「攻撃」をする
const ENEMIES = {
  // --- 1〜10階 ---
  slime:   { name: 'スライム',     type: 'normal',  image: 'enemies/slime.svg',         idle: 'idle-puni',   face: '50% 75%', hp: 70,  atk: 16, def: 6,  spd: 90,  exp: 8,
             traits: [{ type: 'splitOnDeath', chance: 0.5, into: 'miniSlime', count: 2 }], ai: [{ skill: 'attack', weight: 1 }] },
  miniSlime: { name: 'ちびスライム', type: 'normal',  image: 'enemies/slime.svg',         idle: 'idle-puni',   face: '50% 75%', size: 'small', noElite: true, hp: 35, atk: 8, def: 3, spd: 45, exp: 3,
             ai: [{ skill: 'attack', weight: 1 }] },
  bat:     { name: '疾風コウモリ', type: 'fast',    image: 'enemies/bat.svg',           idle: 'idle-flap',   face: '50% 45%', hp: 55,  atk: 14, def: 4,  spd: 170, exp: 12,
             traits: [{ type: 'evasion', value: 0.15 }], ai: [{ skill: 'attack', weight: 2 }, { skill: 'doubleBite', weight: 1 }] },
  turtle:  { name: '岩ガメ',       type: 'tough',   image: 'enemies/rock_turtle.svg',   idle: 'idle-heavy',  face: '100% 60%', hp: 120, atk: 18, def: 40, spd: 60,  exp: 15,
             traits: [{ type: 'critImmune' }], ai: [{ skill: 'attack', weight: 2 }, { skill: 'harden', weight: 3, when: { notBuff: 'def' } }] },
  ogre:    { name: '力ため鬼',     type: 'charge',  image: 'enemies/oni.svg',           idle: 'idle-breath', hp: 140, atk: 22, def: 12, spd: 75,  exp: 18,
             traits: [{ type: 'enrageAt', below: 0.5, rate: 1.3 }],
             ai: [{ skill: 'charge', weight: 2, when: { notCharging: true } }, { skill: 'attack', weight: 1, when: { notCharging: true } }, { skill: 'heavyBlow', weight: 1, when: { charging: true } }] },
  witch:   { name: '呪術師',       type: 'disrupt', image: 'enemies/sorcerer.svg',      idle: 'idle-float',  hp: 80,  atk: 15, def: 8,  spd: 115, exp: 14,
             traits: [{ type: 'curseOnDeath', stat: 'spd', rate: 0.85, turns: 3 }], ai: [{ skill: 'attack', weight: 1 }, { skill: 'slowCurse', weight: 2 }, { skill: 'shadowBind', weight: 2 }] },
  flower:  { name: '癒し草',       type: 'heal',    image: 'enemies/healing_plant.svg', idle: 'idle-sway',   face: '50% 80%', hp: 75,  atk: 10, def: 10, spd: 95,  exp: 12,
             traits: [{ type: 'regen', value: 0.05 }], ai: [{ skill: 'attack', weight: 1 }, { skill: 'healAlly', weight: 4, when: { allyHpBelow: 0.7 } }] },

  // --- 11階以降 ---
  mirrorSlime: { name: 'ミラースライム', type: 'tough',   image: 'enemies/mirror_slime.png',    idle: 'idle-puni',  face: '50% 75%', hp: 90,  atk: 18, def: 20, spd: 90,  exp: 20,
                 traits: [{ type: 'reflect', value: 0.3 }], ai: [{ skill: 'attack', weight: 1 }] },
  mushroom:    { name: '毒キノコ',       type: 'disrupt', image: 'enemies/poison_mushroom.png', idle: 'idle-sway',  face: '50% 80%',  hp: 85,  atk: 14, def: 10, spd: 80,  exp: 18,
                 traits: [{ type: 'poisonOnHit', value: 0.05, turns: 3 }], ai: [{ skill: 'attack', weight: 1 }] },
  skeleton:    { name: '骸骨剣士',       type: 'normal',  image: 'enemies/skeleton.png',        idle: 'idle-breath', hp: 100, atk: 24, def: 14, spd: 95,  exp: 24,
                 traits: [{ type: 'endure' }], ai: [{ skill: 'attack', weight: 1 }] },
  goblin:      { name: '甲冑ゴブリン',   type: 'tough',   image: 'enemies/goblin_guard.png',    idle: 'idle-heavy', face: '50% 20%', hp: 130, atk: 18, def: 30, spd: 70,  exp: 24,
                 traits: [{ type: 'guardian' }], ai: [{ skill: 'attack', weight: 2 }, { skill: 'harden', weight: 1, when: { notBuff: 'def' } }] },
  wisp:        { name: '炎の精霊',       type: 'fast',    image: 'enemies/flame_wisp.png',      idle: 'idle-float', face: '50% 80%', hp: 60,  atk: 26, def: 6,  spd: 150, exp: 20,
                 traits: [{ type: 'deathBlast', power: 1.5 }, { type: 'selfDestruct', after: 3 }], ai: [{ skill: 'attack', weight: 1 }] },
  mimic:       { name: 'ミミック',       type: 'special', image: 'enemies/mimic.png',           idle: 'idle-heavy', face: '50% 25%', noElite: true, hp: 160, atk: 34, def: 20, spd: 60, exp: 40,
                 traits: [{ type: 'dormant' }, { type: 'rewardOnDefeat' }], ai: [{ skill: 'attack', weight: 2 }, { skill: 'doubleBite', weight: 1 }] },
  iceFairy:    { name: '氷の妖精',       type: 'disrupt', image: 'enemies/ice_fairy.png',       idle: 'idle-float', face: '50% 15%', hp: 75,  atk: 16, def: 12, spd: 125, exp: 22,
                 traits: [{ type: 'freezeOnHit', chance: 0.3 }], ai: [{ skill: 'attack', weight: 1 }] },
  assassin:    { name: '影の暗殺者',     type: 'fast',    image: 'enemies/shadow_assassin.png', idle: 'idle-breath', hp: 90, atk: 30, def: 8,  spd: 160, exp: 28,
                 traits: [{ type: 'evasion', value: 0.3 }, { type: 'targetWeakest' }, { type: 'executeCrit' }], ai: [{ skill: 'attack', weight: 1 }] },

  // --- 灼熱の火山（21〜29階） ---
  magmaSlime:   { name: 'マグマスライム', type: 'normal',  image: 'enemies/magma_slime.png',   idle: 'idle-puni',   face: '50% 70%', hp: 110, atk: 22, def: 16, spd: 85,  exp: 30,
                  traits: [{ type: 'statusOnHit', status: 'burn', value: 0.03, turns: 2 }], ai: [{ skill: 'attack', weight: 1 }] },
  salamander:   { name: '火トカゲ',       type: 'fast',    image: 'enemies/salamander.png',    idle: 'idle-breath', face: '90% 55%', hp: 100, atk: 26, def: 12, spd: 110, exp: 32,
                  ai: [{ skill: 'attack', weight: 2 }, { skill: 'flameBreath', weight: 2 }] },
  lavaGolem:    { name: '溶岩ゴーレム',   type: 'tough',   image: 'enemies/lava_golem.png',    idle: 'idle-heavy',  face: '50% 20%', hp: 180, atk: 24, def: 32, spd: 60,  exp: 38,
                  traits: [{ type: 'triggerAt', below: 0.5, skill: 'lavaBurst' }], ai: [{ skill: 'attack', weight: 1 }] },
  fireBat:      { name: '火炎コウモリ',   type: 'fast',    image: 'enemies/fire_bat.png',      idle: 'idle-flap',   face: '50% 45%', hp: 70,  atk: 22, def: 8,  spd: 165, exp: 30,
                  traits: [{ type: 'statusOnHit', status: 'burn', value: 0.03, turns: 2 }, { type: 'evasion', value: 0.15 }], ai: [{ skill: 'attack', weight: 1 }] },
  bombRock:     { name: '爆弾岩',         type: 'charge',  image: 'enemies/bomb_rock.png',     idle: 'idle-heavy',  face: '50% 55%', hp: 120, atk: 10, def: 40, spd: 50,  exp: 34,
                  traits: [{ type: 'fuse', turns: 3, skill: 'bombBlast' }], ai: [{ skill: 'attack', weight: 1 }] },
  phoenixChick: { name: '不死鳥のヒナ',   type: 'heal',    image: 'enemies/phoenix_chick.png', idle: 'idle-float',  face: '50% 45%', hp: 80,  atk: 18, def: 10, spd: 120, exp: 34,
                  traits: [{ type: 'rebirth', ratio: 1 }], ai: [{ skill: 'attack', weight: 1 }] },
  flameSamurai: { name: '炎の鬼武者',     type: 'normal',  image: 'enemies/flame_samurai.png', idle: 'idle-breath', face: '50% 25%', hp: 130, atk: 32, def: 20, spd: 105, exp: 40,
                  traits: [{ type: 'iai', rate: 2 }], ai: [{ skill: 'attack', weight: 1 }] },
  ashMage:      { name: '灰の魔術師',     type: 'disrupt', image: 'enemies/ash_mage.png',      idle: 'idle-float',  face: '50% 25%', hp: 90,  atk: 28, def: 10, spd: 100, exp: 36,
                  ai: [{ skill: 'attack', weight: 1 }, { skill: 'ashStorm', weight: 2 }] },
  lavaWorm:     { name: '溶岩ワーム',     type: 'charge',  image: 'enemies/lava_worm.png',     idle: 'idle-sway',   face: '70% 15%', hp: 150, atk: 28, def: 18, spd: 80,  exp: 38,
                  ai: [{ skill: 'attack', weight: 1 }, { skill: 'burrow', weight: 2 }] },

  // --- 深海の神殿（31〜39階） ---
  jellyfish:    { name: 'クラゲ',         type: 'disrupt', image: 'enemies/jellyfish.png',     idle: 'idle-float',  face: '50% 30%', hp: 85,  atk: 18, def: 12, spd: 95,  exp: 44,
                  traits: [{ type: 'delayOnHit', amount: 0.5, label: '麻痺' }], ai: [{ skill: 'attack', weight: 1 }] },
  crabKnight:   { name: 'カニ騎士',       type: 'tough',   image: 'enemies/crab_knight.png',   idle: 'idle-heavy',  face: '50% 45%', hp: 160, atk: 26, def: 40, spd: 70,  exp: 50,
                  traits: [{ type: 'counter', chance: 0.3 }], ai: [{ skill: 'attack', weight: 2 }, { skill: 'harden', weight: 1, when: { notBuff: 'def' } }] },
  siren:        { name: 'セイレーン',     type: 'disrupt', image: 'enemies/siren.png',         idle: 'idle-sway',   face: '50% 20%', hp: 95,  atk: 20, def: 14, spd: 115, exp: 46,
                  ai: [{ skill: 'attack', weight: 1 }, { skill: 'charmSong', weight: 2 }] },
  pufferfish:   { name: '毒フグ',         type: 'tough',   image: 'enemies/pufferfish.png',    idle: 'idle-float',  face: '50% 45%', hp: 110, atk: 20, def: 18, spd: 80,  exp: 44,
                  traits: [{ type: 'puffUp' }], ai: [{ skill: 'attack', weight: 1 }] },
  octoMage:     { name: 'タコ魔導士',     type: 'disrupt', image: 'enemies/octo_mage.png',     idle: 'idle-sway',   face: '50% 45%', hp: 100, atk: 30, def: 12, spd: 100, exp: 48,
                  ai: [{ skill: 'attack', weight: 2 }, { skill: 'inkSpray', weight: 2 }] },
  fishman:      { name: '半魚人戦士',     type: 'normal',  image: 'enemies/fishman.png',       idle: 'idle-breath', face: '50% 20%', hp: 130, atk: 30, def: 22, spd: 105, exp: 50,
                  traits: [{ type: 'pack', rate: 1.2 }], ai: [{ skill: 'attack', weight: 1 }] },
  clam:         { name: '大貝',           type: 'tough',   image: 'enemies/clam.png',          idle: 'idle-heavy',  face: '50% 55%', hp: 140, atk: 16, def: 50, spd: 60,  exp: 46,
                  traits: [{ type: 'guardCycle', every: 3, status: 'shelled' }, { type: 'pointsOnDefeat', value: 3 }], ai: [{ skill: 'attack', weight: 1 }] },
  anglerfish:   { name: '深海アンコウ',   type: 'charge',  image: 'enemies/anglerfish.png',    idle: 'idle-sway',   face: '60% 35%', hp: 170, atk: 36, def: 18, spd: 75,  exp: 56,
                  traits: [{ type: 'taunt' }], ai: [{ skill: 'attack', weight: 2 }, { skill: 'bigMouth', weight: 1 }] },
  ghostCaptain: { name: '幽霊船長',       type: 'disrupt', image: 'enemies/ghost_captain.png', idle: 'idle-float',  face: '50% 30%', hp: 120, atk: 30, def: 16, spd: 110, exp: 54,
                  traits: [{ type: 'ethereal', value: 0.5 }], ai: [{ skill: 'attack', weight: 2 }, { skill: 'summonSkeleton', weight: 1 }] },

  // --- 天空の城（41〜49階） ---
  cloudSpirit:  { name: '雲の精',         type: 'fast',    image: 'enemies/cloud_spirit.png',  idle: 'idle-float',  face: '45% 50%', hp: 90,  atk: 20, def: 10, spd: 120, exp: 58,
                  traits: [{ type: 'evasion', value: 0.4 }], ai: [{ skill: 'attack', weight: 1 }] },
  stormBird:    { name: '嵐の怪鳥',       type: 'fast',    image: 'enemies/storm_bird.png',    idle: 'idle-flap',   face: '50% 25%', hp: 110, atk: 30, def: 14, spd: 170, exp: 62,
                  traits: [{ type: 'delayOnHit', amount: 0.3, label: '突風' }], ai: [{ skill: 'attack', weight: 1 }] },
  thunderSprite:{ name: '雷の精霊',       type: 'fast',    image: 'enemies/thunder_sprite.png', idle: 'idle-float', face: '50% 45%', hp: 80,  atk: 32, def: 8,  spd: 150, exp: 60,
                  ai: [{ skill: 'attack', weight: 1 }, { skill: 'chainLightning', weight: 2 }] },
  gargoyle:     { name: 'ガーゴイル',     type: 'tough',   image: 'enemies/gargoyle.png',      idle: 'idle-heavy',  face: '50% 20%', hp: 160, atk: 30, def: 36, spd: 70,  exp: 64,
                  traits: [{ type: 'guardCycle', every: 2, status: 'stone' }], ai: [{ skill: 'attack', weight: 1 }] },
  angelSoldier: { name: '天使兵',         type: 'heal',    image: 'enemies/angel_soldier.png', idle: 'idle-float',  face: '50% 20%', hp: 140, atk: 32, def: 28, spd: 100, exp: 66,
                  ai: [{ skill: 'resurrect', weight: 100, when: { allyDead: true } }, { skill: 'attack', weight: 1 }] },
  griffon:      { name: 'グリフォン',     type: 'fast',    image: 'enemies/griffon.png',       idle: 'idle-breath', face: '50% 20%', hp: 170, atk: 38, def: 22, spd: 140, exp: 70,
                  ai: [{ skill: 'attack', weight: 2 }, { skill: 'griffonDive', weight: 1 }] },
  clockwork:    { name: '機械兵',         type: 'tough',   image: 'enemies/clockwork_soldier.png', idle: 'idle-heavy', face: '50% 20%', hp: 180, atk: 30, def: 34, spd: 80, exp: 68,
                  traits: [{ type: 'accelerate', rate: 1.1, max: 2 }], ai: [{ skill: 'attack', weight: 1 }] },
  wyvern:       { name: 'ワイバーン',     type: 'charge',  image: 'enemies/wyvern.png',        idle: 'idle-breath', face: '80% 15%', hp: 190, atk: 36, def: 24, spd: 120, exp: 72,
                  ai: [{ skill: 'attack', weight: 2 }, { skill: 'poisonTail', weight: 1 }] },
  skyWitch:     { name: '天空の魔女',     type: 'disrupt', image: 'enemies/sky_witch.png',     idle: 'idle-float',  face: '50% 30%', hp: 120, atk: 34, def: 16, spd: 115, exp: 70,
                  ai: [{ skill: 'attack', weight: 1 }, { skill: 'timeMagic', weight: 2 }] },

  // --- ボス ---
  golem:   { name: 'ゴーレム王',   type: 'boss',    image: 'enemies/golem_king.svg',    idle: 'idle-heavy',  enrageBelow: 0.5, hp: 520, atk: 26, def: 22, spd: 85,  exp: 120, ai: [
    // HP50%以上：様子見の攻撃と防御強化
    { skill: 'attack', weight: 3, when: { hpAbove: 0.5 } },
    { skill: 'harden', weight: 1, when: { hpAbove: 0.5, notBuff: 'def' } },
    // HP50%未満：まず咆哮で強化 → 以降は大技を混ぜて攻める
    { skill: 'roar',   weight: 100, when: { hpBelow: 0.5, notBuff: 'atk' } },
    { skill: 'quake',  weight: 2, when: { hpBelow: 0.5, hasBuff: 'atk' } },
    { skill: 'attack', weight: 2, when: { hpBelow: 0.5, hasBuff: 'atk' } },
    { skill: 'shadowBind', weight: 1, when: { hpBelow: 0.5, hasBuff: 'atk' } },
  ] },
  dragon:  { name: '深淵の竜王',   type: 'boss',    image: 'enemies/abyss_dragon.png',  idle: 'idle-heavy',  hp: 900, atk: 34, def: 26, spd: 110, exp: 300,
    phases: [
      { below: 0.6, speech: '小賢しい…影よ、我が下僕となれ！', shake: true, summon: { enemy: 'assassin', count: 2 } },
      { below: 0.3, speech: 'ぐおおおお……深淵よ、我に力を！', shake: true, enrage: true,
        message: '深淵の竜王が覚醒した！ 1ターンに2回行動し、攻撃が30%上がった！',
        buffs: [{ stat: 'atk', rate: 1.3 }], actionsPerTurn: 2 },
    ],
    ai: [
      // 第1段階（HP60%以上）：かみつき・炎のブレス
      { skill: 'dragonBite', weight: 3, when: { hpAbove: 0.6 } },
      { skill: 'fireBreath', weight: 2, when: { hpAbove: 0.6 } },
      // 飛んでいるときは必ず急降下
      { skill: 'dive',       weight: 100, when: { hasStatus: 'flying' } },
      // 第2段階（HP60〜30%）：飛翔 → 急降下
      { skill: 'soar',       weight: 3, when: { hpBelow: 0.6, hpAbove: 0.3, notStatus: 'flying' } },
      { skill: 'dragonBite', weight: 2, when: { hpBelow: 0.6, notStatus: 'flying' } },
      // 第3段階（HP30%以下）：深淵の炎を予告（3ターン後に全体大ダメージ）
      { skill: 'abyssCharge', weight: 100, when: { hpBelow: 0.3, noCountdown: true, notStatus: 'flying' } },
      { skill: 'fireBreath', weight: 1, when: { hpBelow: 0.3, notStatus: 'flying' } },
    ] },

  // 30階ボス
  ignis:   { name: '炎魔神イグニス', type: 'boss', image: 'enemies/ignis.png', idle: 'idle-heavy', face: '50% 22%', hp: 1100, atk: 40, def: 30, spd: 105, exp: 600,
    phases: [
      { below: 0.5, speech: '燃え尽きよ…この地のすべてと共に！', shake: true, enrage: true,
        message: '炎魔神の熱気で、毎ターンやけどを負うようになった！',
        summon: { enemy: 'lavaGolem', count: 2 }, turnAura: { status: 'burn', value: 0.03, turns: 2 } },
      { below: 0.2, speech: '大地よ、裂けよ！ 全てを溶岩に沈めてくれる！', shake: true,
        countdown: { skill: 'eruption', turns: 2 } },
    ],
    ai: [
      { skill: 'flameFist',  weight: 3 },
      { skill: 'fireCircle', weight: 2 },
    ] },

  // 40階ボス
  leviathan: { name: '大海蛇リヴァイアサン', type: 'boss', image: 'enemies/leviathan.png', idle: 'idle-sway', face: '50% 15%', hp: 1500, atk: 44, def: 34, spd: 115, exp: 900,
    phases: [
      { below: 0.6, speech: '深き海の底へ…引きずり込んでくれる！', shake: true },
      { below: 0.3, speech: 'グオオオ…渦に呑まれて消えよ！', shake: true, enrage: true,
        message: 'リヴァイアサンが荒れ狂う！ 1ターンに2回行動し、毎ターン渦潮で速度が下がる！',
        actionsPerTurn: 2, turnDebuff: { stat: 'spd', rate: 0.9, limit: 0.3, tag: 'whirl', label: '渦潮' } },
    ],
    ai: [
      { skill: 'seaBite',  weight: 3, when: { notStatus: 'submerged' } },
      { skill: 'tsunami',  weight: 2, when: { notStatus: 'submerged' } },
      { skill: 'submerge', weight: 2, when: { hpBelow: 0.6, notStatus: 'submerged' } },
    ] },

  // 50階 最終ボス
  zenith:  { name: '天空王ゼニス', type: 'boss', image: 'enemies/zenith.png', idle: 'idle-float', face: '50% 22%', hp: 2000, atk: 50, def: 40, spd: 120, exp: 1500,
    phases: [
      { below: 0.7, speech: '天の兵よ、我がもとに集え！', shake: true, summon: { enemy: 'angelSoldier', count: 2 } },
      { below: 0.4, speech: '時よ…止まれ。', shake: true, timeStop: true,
        message: '時が止まった！ 味方全員の行動ゲージが0に戻された！' },
      { below: 0.15, speech: 'よかろう…真の姿を見せてやる。全ては光の中に終わる！', shake: true, enrage: true,
        message: '天空王ゼニスが最終形態になった！ 1ターンに2回行動し、攻撃が50%上がった！',
        buffs: [{ stat: 'atk', rate: 1.5 }], actionsPerTurn: 2, countdown: { skill: 'endLight', turns: 3 } },
    ],
    ai: [
      { skill: 'lightSword', weight: 3 },
      { skill: 'skyBarrier', weight: 1, when: { notStatus: 'barrier' } },
      { skill: 'lightRain',  weight: 2, when: { hpBelow: 0.7 } },
    ] },
};

// ---------------------------------------------------------------------
// ダンジョン（階層）の設定
// ---------------------------------------------------------------------
const DUNGEON = {
  // 敵の数（from 階以降はこの範囲）
  enemyCount: [
    { from: 1,  min: 1, max: 3 },
    { from: 11, min: 2, max: 4 },
  ],
  maxEnemies: 6,                   // 分裂・召喚を含めて、場に出られる敵の最大数
  bossEvery: 10,                   // 何階ごとにボス階か
  // ボス階に出る敵（階: 敵の配列）。書いていないボス階では、それより前で一番深いボスが出る
  bosses: {
    10: ['golem'],
    20: ['dragon'],
    30: ['ignis'],
    40: ['leviathan'],
    50: ['zenith'],
  },
  finalFloor: 50,                  // 最終ボスの階（倒すとエンディング）。これより先は無限モード
  // 無限モード（finalFloor より先）のボス階に、順番に登場するボス（階層補正で強くなって出る）
  endlessBosses: ['golem', 'dragon', 'ignis', 'leviathan', 'zenith'],
  // 出現する敵（from〜to 階で、add の敵が出現候補に加わる。to を省略すると無限モードの手前まで）
  // rare は { 敵ID: 1体ごとの出現率 }
  // 無限モードでは、ここに書いた全ての敵からランダムに出る
  enemyPools: [
    { from: 1,  to: 20, add: ['slime', 'bat'] },
    { from: 5,  to: 20, add: ['turtle', 'flower'] },
    { from: 11, to: 20, add: ['ogre', 'witch', 'mirrorSlime', 'mushroom'] },
    { from: 13, to: 20, add: ['skeleton', 'goblin'] },
    { from: 15, to: 20, add: ['wisp'] },
    { from: 16,         rare: { mimic: 0.05 } },
    { from: 17, to: 20, add: ['iceFairy'] },
    { from: 18, to: 20, add: ['assassin'] },
    // 灼熱の火山
    { from: 21, to: 30, add: ['magmaSlime', 'salamander', 'fireBat', 'phoenixChick'] },
    { from: 23, to: 30, add: ['lavaGolem', 'bombRock', 'ashMage'] },
    { from: 26, to: 30, add: ['flameSamurai', 'lavaWorm'] },
    // 深海の神殿
    { from: 31, to: 40, add: ['jellyfish', 'pufferfish', 'fishman', 'clam'] },
    { from: 33, to: 40, add: ['crabKnight', 'siren', 'octoMage'] },
    { from: 36, to: 40, add: ['anglerfish', 'ghostCaptain'] },
    // 天空の城
    { from: 41, to: 50, add: ['cloudSpirit', 'stormBird', 'thunderSprite', 'gargoyle'] },
    { from: 43, to: 50, add: ['angelSoldier', 'clockwork', 'skyWitch'] },
    { from: 46, to: 50, add: ['griffon', 'wyvern'] },
  ],
  statPerFloor: 0.10,                  // 1階ごとの敵ステータス上昇率（1階が基準）
  scaledStats: ['hp', 'atk', 'def'],   // 階層で上がるステータス（速度も上げるなら 'spd' を足す）
  expPerFloor: 0.15,                   // 1階ごとの獲得経験値の上昇率
  healBetweenFloors: 0.1,              // 戦闘の合間の回復（最大HPに対する割合）。ボス階の前は全回復
  checkpointOffset: 0,                 // 全滅時の戻り先：0 = 最後に倒したボスの階、1 = その次の階
  floorInterval: 1500,                 // 次の階へ進むまでの待ち時間（ミリ秒）
};

// ---------------------------------------------------------------------
// エリア（from 階から次のエリアの手前まで。ボス階は前のエリアに含まれる）
// bg: バトル画面の背景（CSS） / text: 背景の上の見出しの色
// ---------------------------------------------------------------------
const AREAS = [
  { from: 1,  name: 'はじまりの洞窟', bg: 'linear-gradient(180deg, #2c3248 0%, #1e2230 100%)', text: '#9aa3c0' },
  { from: 11, name: '闇の迷宮',       bg: 'linear-gradient(180deg, #2e2446 0%, #19152a 100%)', text: '#b8a8e0' },
  { from: 21, name: '灼熱の火山',     bg: 'linear-gradient(180deg, #6e1a10 0%, #b8441a 60%, #e07a2a 100%)', text: '#ffe2c4' },
  { from: 31, name: '深海の神殿',     bg: 'linear-gradient(180deg, #0a2350 0%, #12477e 55%, #1f73a8 100%)', text: '#cfe8ff' },
  { from: 41, name: '天空の城',       bg: 'linear-gradient(180deg, #f6fbff 0%, #d4ecfb 50%, #9fd4f2 100%)', text: '#24476a' },
  { from: 51, name: '無限回廊',       bg: 'linear-gradient(180deg, #22113a 0%, #3c1a52 60%, #5a2470 100%)', text: '#e4ccff' },
];

// ---------------------------------------------------------------------
// 周回（最終ボスを倒したあとの2周目以降）
// ---------------------------------------------------------------------
const NEW_GAME_PLUS = {
  statRatePerCycle: 1,   // 1周ごとに敵ステータスに足す倍率（2周目 ×2、3周目 ×3 …）
  expRatePerCycle: 1,    // 1周ごとに経験値に足す倍率
};

// ---------------------------------------------------------------------
// 放置（ゲームを閉じていた時間）の設定
// ---------------------------------------------------------------------
const IDLE = {
  maxHours: 8,        // 経験値がたまる上限時間
  expPerMinute: 1,    // 1分あたりの経験値（最高到達階に応じて DUNGEON.expPerFloor の割合で増える）
  minMinutes: 1,      // これ未満の時間なら何も起きない
};
