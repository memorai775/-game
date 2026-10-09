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
const ROLE_LABELS = {
  attacker: '攻撃役', tank: '守り役', healer: '回復役', support: '補助役', all: 'バランス',
  speed: 'すばやさ・妨害', aoe: '全体攻撃', finisher: 'とどめ役', buffer: '味方の支援', combo: '連続攻撃', time: '行動順の操作',
};
const ENEMY_TYPE_LABELS = {
  normal: 'ふつう', fast: 'すばやい系', tough: 'かたい系', charge: 'ためる系',
  disrupt: '妨害系', heal: '回復系', special: '特殊', boss: 'ボス', treasure: 'お宝',
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
//   { type: 'steal', chance: 0.3 }                     盗む（成功するとこの階のクリア時にアイテム選択が1回増える）
//   { type: 'gaugeAfter', amount: 0.3 }                行動のあと、自分の行動ゲージを amount 進める
//   { type: 'sleep' }                                  眠らせる（行動ゲージ0＋1回休み。ボスは行動ゲージ-50%だけ）
//   { type: 'kiBurst', per: 0.8 }                      気を全部使い、気の数×per 倍のダメージ
//   { type: 'fillGauge' }                              行動ゲージを満タンに（すぐ行動）
//   { type: 'rewind', turns: 3 }                       HPを turns ターン前（その味方の行動で数える）の値に戻す
//   damage に sureCritBelow: 0.3 を付けると、HPがその割合以下の相手には必ず会心
//   damage に drain: 1 を付けると、与えたダメージ×drain だけ自分が回復（魂吸収）
//   damage に ignoreDef: true を付けると、相手の防御を無視（突進）
//   { type: 'execute', below: 0.25, power: 1.0 }      HPがbelow以下の相手を即死（ボスは除く）。それ以外は power 倍ダメージ
//   { type: 'swapOrder' }                              味方と敵を1人ずつ選び、行動順を入れ替える
//   { type: 'dispel' }                                 相手の強化効果を全部消す
//   { type: 'stackDebuff', stat, rate, tag, limit }    重ねがけできる能力ダウン（limit 倍で止まる）
//   { type: 'freeze', chance: 0.2 }                    凍結（行動ゲージ0）
//   { type: 'entomb', turns: 4 }                       氷漬け（行動不能。HPを持つ「氷塊」が出て、壊すと解ける）
//   { type: 'summonPool' }                             この階の敵を1体呼び出す（呼んだ本人が倒れると消える）
//   { type: 'devourBuffs' }                            相手の強化効果を全部奪って自分に付ける
//   damage に skipFrozen: true を付けると、凍結・氷漬けの相手には効かない（絶対零度）
//   { type: 'partStrikes', power: 0.45 }               残っている部位の数だけ、ランダムな相手を攻撃（クラーケンの足）
//   { type: 'drums', enemy: 'thunderDrum', count: 5 }  行動順リストにだけ出る「雷」を count 個仕込む（光った順に落ちる）
//   { type: 'openCore' }                               自分のコアを開く（次の自分の行動まで攻撃が通る）
//   { type: 'summonBoss', list: [...], hpRate: 0.25 }  過去のボスを1体呼び出す（HPは hpRate 倍）
//   { type: 'annihilate' }                             相手全員を倒す（終焉のカウントダウン）
// スキルに element: 'fire' / 'light' を付けると属性つきの技（ゾンビの起き上がりを防ぐ）
// スキルに magic: true を付けると魔法の技（霊体に軽減されない）
// 効果ごとに target: 'self' を書くと、その効果だけ自分にかかる（例：攻撃＋自分強化）
// 効果ごとに target: 'allAllies' を書くと、その効果だけ自分の仲間全員にかかる（例：全体攻撃＋仲間強化）
const SKILLS = {
  // --- 共通 ---
  attack:     { name: '攻撃', target: 'enemy', desc: '敵1体に通常攻撃', effects: [{ type: 'damage', power: 1.0 }] },
  defend:     { name: '防御', effect: 'fx_shield', target: 'self', desc: '次の行動まで受けるダメージ半減', effects: [{ type: 'guard' }] },

  // --- 主人公用 ---
  heavySlash: { name: '強斬り', effect: 'fx_slash', target: 'enemy', cooldown: 3, desc: '敵1体に1.8倍ダメージ（使用後3ターン使用不可）', effects: [{ type: 'damage', power: 1.8 }] },
  legSweep:   { name: '足払い', effect: 'fx_impact', target: 'enemy', cooldown: 3, desc: '敵1体に0.6倍ダメージ＋行動を大きく遅らせる', effects: [{ type: 'damage', power: 0.6 }, { type: 'delay', amount: 0.6 }] },
  firstAid:   { name: '応急手当', effect: 'fx_heal', target: 'self', cooldown: 4, desc: '自分の最大HPの35%回復', effects: [{ type: 'heal', ratio: 0.35 }] },
  quicken:    { name: '加速', effect: 'fx_buff', target: 'self', cooldown: 5, desc: '3ターンの間 速度1.5倍', effects: [{ type: 'buff', stat: 'spd', rate: 1.5, turns: 3 }] },

  // --- 騎士・僧侶用 ---
  cover:      { name: 'かばう', effect: 'fx_shield', target: 'ally', cooldown: 2, desc: '味方1体をかばう（次の自分の行動まで代わりに攻撃を受ける）＋自分は防御', effects: [{ type: 'cover' }, { type: 'guard', target: 'self' }] },
  heal:       { name: '回復', effect: 'fx_heal', target: 'ally', desc: '味方1体のHPを35%回復', effects: [{ type: 'heal', ratio: 0.35 }] },
  healAll:    { name: '全体回復', effect: 'fx_heal', target: 'allAllies', cooldown: 2, desc: '味方全員のHPを25%回復', effects: [{ type: 'heal', ratio: 0.25 }] },

  // --- 敵用 ---
  doubleBite: { name: '連続かみつき', effect: 'fx_impact', target: 'enemy', desc: '0.6倍ダメージ×2回', effects: [{ type: 'damage', power: 0.6, hits: 2 }] },
  harden:     { name: 'かたくなる', effect: 'fx_shield', target: 'self', cooldown: 3, desc: '防御2倍（3ターン）', effects: [{ type: 'buff', stat: 'def', rate: 2.0, turns: 3 }] },
  charge:     { name: '力をためる', effect: 'fx_buff', target: 'self', desc: '次の行動まで攻撃2倍', effects: [{ type: 'buff', stat: 'atk', rate: 2.0, turns: 1, tag: 'charge' }] },
  heavyBlow:  { name: '渾身の一撃', effect: 'fx_impact', target: 'enemy', danger: true, desc: '1.5倍ダメージ', effects: [{ type: 'damage', power: 1.5 }] },
  slowCurse:  { name: '鈍足の呪い', effect: 'fx_debuff', target: 'enemy', cooldown: 3, desc: '速度0.6倍（3ターン）', effects: [{ type: 'buff', stat: 'spd', rate: 0.6, turns: 3 }] },
  shadowBind: { name: '影しばり', effect: 'fx_dark', target: 'enemy', cooldown: 2, desc: '0.5倍ダメージ＋行動を遅らせる', effects: [{ type: 'damage', power: 0.5 }, { type: 'delay', amount: 0.4 }] },
  healAlly:   { name: 'いやしの花粉', effect: 'fx_heal', target: 'ally', cooldown: 1, desc: '仲間1体のHPを30%回復', effects: [{ type: 'heal', ratio: 0.3 }] },
  roar:       { name: '怒りの咆哮', effect: 'fx_buff', target: 'self', desc: '攻撃1.3倍・速度1.2倍（長時間）', effects: [{ type: 'buff', stat: 'atk', rate: 1.3, turns: 99 }, { type: 'buff', stat: 'spd', rate: 1.2, turns: 99 }] },
  quake:      { name: '大地震', effect: 'fx_explosion', target: 'allEnemies', cooldown: 3, shake: true, danger: true, desc: '相手全員に1.2倍ダメージ＋行動を遅らせる', effects: [{ type: 'damage', power: 1.2 }, { type: 'delay', amount: 0.3 }] },

  // --- 深淵の竜王 ---
  dragonBite:  { name: 'かみつき', effect: 'fx_impact',   target: 'enemy', desc: '1.1倍ダメージ', effects: [{ type: 'damage', power: 1.1 }] },
  fireBreath:  { name: '炎のブレス', effect: 'fx_fire', target: 'allEnemies', cooldown: 2, shake: true, desc: '相手全員に0.8倍ダメージ＋やけど（毎ターン3%、2ターン）', effects: [{ type: 'damage', power: 0.8 }, { type: 'status', status: 'burn', value: 0.03, turns: 2 }] },
  soar:        { name: '飛翔', effect: 'fx_buff',       target: 'self', cooldown: 3, desc: '2ターンの間 回避50%', effects: [{ type: 'status', status: 'flying', value: 0.5, turns: 2 }] },
  dive:        { name: '急降下', effect: 'fx_impact',     target: 'enemy', danger: true, desc: '2.5倍ダメージ', effects: [{ type: 'damage', power: 2.5 }] },
  abyssCharge: { name: '深淵の胎動', effect: 'fx_dark', target: 'self', cooldown: 6, desc: '3ターン後に「深淵の炎」を放つ', effects: [{ type: 'countdown', skill: 'abyssFlame', turns: 3 }] },
  abyssFlame:  { name: '深淵の炎', effect: 'fx_explosion',   target: 'allEnemies', shake: true, danger: true, desc: '相手全員に3倍ダメージ（防御で半減）', effects: [{ type: 'damage', power: 3.0 }] },

  // --- 15階以降に加入する仲間 ---
  // oncePerBattle: 1戦闘1回（ボタンに「使用済み」と出る） / needsKi: 気がないと使えない
  twinSlash:    { name: '二刀斬り', effect: 'fx_slash',     target: 'enemy', desc: '敵1体に0.7倍×2回', effects: [{ type: 'damage', power: 0.7, hits: 2 }] },
  shadowStitch: { name: '影縫い', effect: 'fx_dark',       target: 'enemy', cooldown: 2, desc: '敵1体の行動ゲージ-40%', effects: [{ type: 'delay', amount: 0.4 }] },
  steal:        { name: '盗む', effect: 'fx_slash',         target: 'enemy', oncePerBattle: true, desc: '攻撃＋30%で盗む（成功するとこの階のクリア時にアイテムを1回多く選べる）。1戦闘1回', effects: [{ type: 'damage', power: 1.0 }, { type: 'steal', chance: 0.3 }] },
  fireball:     { name: '火球', effect: 'fx_fire',         target: 'enemy', magic: true, desc: '敵1体に1.4倍ダメージ', effects: [{ type: 'damage', power: 1.4 }] },
  inferno:      { name: '爆炎', effect: 'fx_explosion',         target: 'allEnemies', cooldown: 2, magic: true, shake: true, desc: '敵全体に0.8倍ダメージ＋やけど（2ターン）', effects: [{ type: 'damage', power: 0.8 }, { type: 'status', status: 'burn', value: 0.03, turns: 2 }] },
  focus:        { name: '魔力集中', effect: 'fx_buff',     target: 'self', cooldown: 3, desc: '次のスキルの効果2倍＋行動ゲージ+30%', effects: [{ type: 'status', status: 'focus', turns: 99 }, { type: 'gaugeAfter', amount: 0.3 }] },
  aimedShot:    { name: '狙い撃ち', effect: 'fx_arrow',     target: 'weakestEnemy', desc: 'HPが一番低い敵に1.2倍ダメージ。HP30%以下の敵には必ず会心', effects: [{ type: 'damage', power: 1.2, sureCritBelow: 0.3 }] },
  pinningArrow: { name: '足止めの矢', effect: 'fx_arrow',   target: 'enemy', cooldown: 2, desc: '敵1体に0.9倍ダメージ＋速度-20%（3ターン）', effects: [{ type: 'damage', power: 0.9 }, { type: 'buff', stat: 'spd', rate: 0.8, turns: 3 }] },
  volley:       { name: '連射', effect: 'fx_arrow',         target: 'self', desc: 'ランダムな敵に0.5倍×4回', effects: [{ type: 'damageRandom', power: 0.5, count: 4 }] },
  windSong:     { name: '疾風の歌', effect: 'fx_music',     target: 'allAllies', cooldown: 2, desc: '味方全員の速度+20%（3ターン）', effects: [{ type: 'buff', stat: 'spd', rate: 1.2, turns: 3, tag: 'song_wind' }] },
  braveSong:    { name: '勇気の歌', effect: 'fx_music',     target: 'allAllies', cooldown: 2, desc: '味方全員の攻撃+20%（3ターン）', effects: [{ type: 'buff', stat: 'atk', rate: 1.2, turns: 3, tag: 'song_brave' }] },
  lullaby:      { name: '子守唄', effect: 'fx_music',       target: 'enemy', cooldown: 3, desc: '敵1体を眠らせる（行動ゲージ0＋1回休み。ボスには半分の効果）', effects: [{ type: 'sleep' }] },
  comboStrike:  { name: '連撃', effect: 'fx_impact',         target: 'enemy', desc: '敵1体に0.6倍×3回', effects: [{ type: 'damage', power: 0.6, hits: 3 }] },
  hyakuretsu:   { name: '奥義・百烈拳', effect: 'fx_impact', target: 'enemy', needsKi: true, danger: true, desc: '気を全部使い、気の数×0.8倍のダメージ', effects: [{ type: 'kiBurst', per: 0.8 }] },
  stance:       { name: '構え', effect: 'fx_shield',         target: 'self', cooldown: 2, desc: '次に受ける攻撃に反撃する', effects: [{ type: 'status', status: 'counterStance', turns: 1 }] },
  timeHaste:    { name: '加速', effect: 'fx_time',         target: 'ally', cooldown: 1, desc: '味方1人の行動ゲージを満タンにする（すぐ行動）', effects: [{ type: 'fillGauge' }] },
  timeStop:     { name: '時間停止', effect: 'fx_time',     target: 'allEnemies', cooldown: 3, desc: '敵全員の行動ゲージ-50%（4ターンに1回）', effects: [{ type: 'delay', amount: 0.5 }] },
  rewind:       { name: '巻き戻し', effect: 'fx_time',     target: 'ally', oncePerBattle: true, desc: '味方1人のHPを3ターン前の値に戻す（1戦闘1回）', effects: [{ type: 'rewind', turns: 3 }] },

  // --- 灼熱の火山（21〜30階） ---
  flameBreath:   { name: '炎の息', effect: 'fx_fire',     target: 'enemy', cooldown: 2, desc: '1.2倍ダメージ＋やけど', effects: [{ type: 'damage', power: 1.2 }, { type: 'status', status: 'burn', value: 0.03, turns: 2 }] },
  lavaBurst:     { name: '溶岩噴出', effect: 'fx_explosion',   target: 'allEnemies', shake: true, danger: true, desc: '相手全員に1.3倍ダメージ', effects: [{ type: 'damage', power: 1.3 }] },
  bombBlast:     { name: '大爆発', effect: 'fx_explosion',     target: 'allEnemies', shake: true, danger: true, desc: '相手全員に4倍ダメージ（自分も倒れる）', effects: [{ type: 'damage', power: 4.0 }, { type: 'selfKill', target: 'self' }] },
  ashStorm:      { name: '灰の嵐', effect: 'fx_fire',     target: 'allEnemies', cooldown: 2, desc: '相手全員に0.8倍ダメージ＋仲間の攻撃+20%（3ターン）', effects: [{ type: 'damage', power: 0.8 }, { type: 'buff', target: 'allAllies', stat: 'atk', rate: 1.2, turns: 3, tag: 'ash' }] },
  burrow:        { name: '地中に潜る', effect: 'fx_shield', target: 'self', cooldown: 3, desc: '1ターン攻撃無効、次の行動で飛び出して2倍ダメージ', effects: [{ type: 'status', status: 'burrowed', turns: 1 }, { type: 'queueSkill', skill: 'emerge' }] },
  emerge:        { name: '飛び出し', effect: 'fx_impact',   target: 'enemy', danger: true, desc: '2倍ダメージ', effects: [{ type: 'damage', power: 2.0 }] },
  flameFist:     { name: '炎の拳', effect: 'fx_fire',     target: 'enemy', desc: '1.3倍ダメージ', effects: [{ type: 'damage', power: 1.3 }] },
  fireCircle:    { name: '火炎陣', effect: 'fx_fire',     target: 'allEnemies', cooldown: 2, shake: true, desc: '相手全員に0.9倍ダメージ＋やけど', effects: [{ type: 'damage', power: 0.9 }, { type: 'status', status: 'burn', value: 0.03, turns: 2 }] },
  eruption:      { name: '大噴火', effect: 'fx_explosion',     target: 'allEnemies', shake: true, danger: true, desc: '相手全員に3倍ダメージ（防御で半減）', effects: [{ type: 'damage', power: 3.0 }] },

  // --- 深海の神殿（31〜40階） ---
  charmSong:     { name: '魅了の歌', effect: 'fx_music',   target: 'enemy', cooldown: 2, desc: '0.6倍ダメージ＋30%で魅了（1回だけ味方を攻撃）', effects: [{ type: 'damage', power: 0.6 }, { type: 'status', status: 'charm', turns: 1, chance: 0.3 }] },
  inkSpray:      { name: '墨', effect: 'fx_dark',         target: 'enemy', cooldown: 4, desc: '0.8倍ダメージ＋墨（3ターン行動順が見えない）', effects: [{ type: 'damage', power: 0.8 }, { type: 'status', status: 'ink', turns: 3 }] },
  bigMouth:      { name: '大口', effect: 'fx_impact',       target: 'enemy', cooldown: 2, danger: true, desc: '2.5倍ダメージ', effects: [{ type: 'damage', power: 2.5 }] },
  summonSkeleton:{ name: '亡者の号令', effect: 'fx_dark', target: 'self', cooldown: 4, desc: '骸骨剣士を1体呼ぶ', effects: [{ type: 'summon', enemy: 'skeleton', count: 1 }] },
  seaBite:       { name: 'かみつき', effect: 'fx_impact',   target: 'enemy', desc: '1.2倍ダメージ', effects: [{ type: 'damage', power: 1.2 }] },
  tsunami:       { name: '大津波', effect: 'fx_explosion',     target: 'allEnemies', cooldown: 3, shake: true, desc: '相手全員に1.0倍ダメージ＋行動ゲージ-30%', effects: [{ type: 'damage', power: 1.0 }, { type: 'delay', amount: 0.3 }] },
  submerge:      { name: '海に潜る', effect: 'fx_shield',   target: 'self', cooldown: 5, desc: '2ターン攻撃無効 → 浮上して全体攻撃', effects: [{ type: 'status', status: 'submerged', turns: 2 }, { type: 'queueSkill', skill: 'surge' }] },
  surge:         { name: '浮上の大渦', effect: 'fx_explosion', target: 'allEnemies', shake: true, danger: true, desc: '相手全員に2倍ダメージ', effects: [{ type: 'damage', power: 2.0 }] },

  // --- 天空の城（41〜50階） ---
  chainLightning:{ name: '連鎖雷', effect: 'fx_thunder',     target: 'self', cooldown: 2, desc: 'ランダムな相手に0.7倍ダメージ×3回', effects: [{ type: 'damageRandom', power: 0.7, count: 3 }] },
  resurrect:     { name: '蘇生の祈り', effect: 'fx_heal', target: 'deadAlly', cooldown: 999, desc: '倒れた仲間1体をHP50%で蘇生（1回だけ）', effects: [{ type: 'revive', ratio: 0.5 }] },
  griffonDive:   { name: '急降下', effect: 'fx_impact',     target: 'enemy', cooldown: 2, danger: true, desc: '2倍ダメージ＋相手の行動を一番後ろへ', effects: [{ type: 'damage', power: 2.0 }, { type: 'toBack' }] },
  poisonTail:    { name: '毒の尾', effect: 'fx_poison',     target: 'enemy', cooldown: 2, desc: '1.0倍ダメージ＋毒（毎ターン6%、3ターン）', effects: [{ type: 'damage', power: 1.0 }, { type: 'status', status: 'poison', value: 0.06, turns: 3 }] },
  timeMagic:     { name: '時の魔法', effect: 'fx_time',   target: 'allEnemies', cooldown: 4, desc: '相手全員の速度-20%、仲間全員の速度+20%（3ターン）', effects: [{ type: 'buff', stat: 'spd', rate: 0.8, turns: 3 }, { type: 'buff', target: 'allAllies', stat: 'spd', rate: 1.2, turns: 3 }] },
  lightSword:    { name: '光の剣', effect: 'fx_slash',     target: 'enemy', desc: '0.9倍ダメージ×2回', effects: [{ type: 'damage', power: 0.9, hits: 2 }] },
  skyBarrier:    { name: '天空結界', effect: 'fx_shield',   target: 'self', cooldown: 6, desc: '3ターン受けるダメージ半減', effects: [{ type: 'status', status: 'barrier', turns: 3 }] },
  lightRain:     { name: '光の雨', effect: 'fx_thunder',     target: 'allEnemies', cooldown: 2, shake: true, desc: '相手全員に1.2倍ダメージ', effects: [{ type: 'damage', power: 1.2 }] },
  endLight:      { name: '終焉の光', effect: 'fx_explosion',   target: 'allEnemies', shake: true, danger: true, desc: '相手全員に4倍ダメージ（防御で半減）', effects: [{ type: 'damage', power: 4.0 }] },

  // --- 冥府の墓地（51〜60階） ---
  deathScythe:   { name: '死の鎌', effect: 'fx_dark',     target: 'lowestRatioEnemy', cooldown: 2, danger: true, desc: 'HP25%以下の相手1人を即死させる（それ以外の相手には1.0倍ダメージ）', effects: [{ type: 'execute', below: 0.25, power: 1.0 }] },
  bandageBind:   { name: '包帯しばり', effect: 'fx_dark', target: 'enemy', cooldown: 3, desc: '相手1人を2ターン行動不能にする（攻撃されると解ける）', effects: [{ type: 'status', status: 'bound', turns: 3 }] },
  soulArrow:     { name: '魂の矢', effect: 'fx_dark',     target: 'enemy', desc: '1.3倍ダメージ', effects: [{ type: 'damage', power: 1.3 }] },
  raiseDead:     { name: '死者召喚', effect: 'fx_dark',   target: 'self', cooldown: 4, desc: 'ゾンビを2体呼ぶ', effects: [{ type: 'summon', enemy: 'zombie', count: 2 }] },
  soulDrain:     { name: '魂吸収', effect: 'fx_dark',     target: 'allEnemies', cooldown: 2, shake: true, desc: '相手全員に0.8倍ダメージ＋与えたダメージの合計だけ回復', effects: [{ type: 'damage', power: 0.8, drain: 1 }] },
  deathSentence: { name: '死の宣告', effect: 'fx_dark',   target: 'enemy', cooldown: 3, danger: true, desc: '相手1人に死の宣告（3回行動すると即死。リッチを倒すか回復で解除）', effects: [{ type: 'status', status: 'doom', turns: 3 }] },

  // --- 魔界の城（61〜70階） ---
  mischief:      { name: 'いたずら', effect: 'fx_time',   target: 'self', cooldown: 2, desc: '味方と敵の行動順を1組ランダムに入れ替える', effects: [{ type: 'swapOrder' }] },
  glare:         { name: '睨み', effect: 'fx_dark',       target: 'enemy', cooldown: 3, desc: '相手1人のスキルを2ターン封印（通常攻撃のみになる）', effects: [{ type: 'status', status: 'sealed', turns: 3 }] },
  tripleBite:    { name: '3連続かみつき', effect: 'fx_impact', target: 'enemy', desc: '0.5倍ダメージ×3回', effects: [{ type: 'damage', power: 0.5, hits: 3 }] },
  rush:          { name: '突進', effect: 'fx_impact',     target: 'enemy', cooldown: 2, danger: true, desc: '防御を無視して1.8倍ダメージ', effects: [{ type: 'damage', power: 1.8, ignoreDef: true }] },
  darkSpell:     { name: '闇の呪文', effect: 'fx_dark',   target: 'allEnemies', desc: '相手全員に0.9倍ダメージ', effects: [{ type: 'damage', power: 0.9 }] },
  mendPage:      { name: '癒しのページ', effect: 'fx_heal', target: 'allAllies', desc: '仲間全員のHPを20%回復', effects: [{ type: 'heal', ratio: 0.2 }] },
  slowPage:      { name: '鈍足のページ', effect: 'fx_debuff', target: 'allEnemies', desc: '相手全員の速度-20%（3ターン）', effects: [{ type: 'buff', stat: 'spd', rate: 0.8, turns: 3 }] },
  haggle:        { name: '品定め', target: 'self', desc: '何もせず、こちらの様子をうかがっている', effects: [] },
  demonSword:    { name: '魔剣', effect: 'fx_slash',      target: 'enemy', desc: '0.9倍ダメージ×2回', effects: [{ type: 'damage', power: 0.9, hits: 2 }] },
  darkWave:      { name: '闇の波動', effect: 'fx_dark',   target: 'allEnemies', cooldown: 2, shake: true, desc: '相手全員に1.0倍ダメージ＋強化効果を消す', effects: [{ type: 'damage', power: 1.0 }, { type: 'dispel' }] },
  endFlame:      { name: '終焉の魔焔', effect: 'fx_explosion', target: 'allEnemies', shake: true, danger: true, desc: '相手全員に5倍ダメージ（防御で半減）', effects: [{ type: 'damage', power: 5.0 }] },

  // --- 凍てつく氷河（71〜80階） ---
  blizzard:      { name: '吹雪', effect: 'fx_ice',         target: 'allEnemies', cooldown: 1, desc: '相手全員の速度-15%（重ねがけ）', effects: [{ type: 'stackDebuff', stat: 'spd', rate: 0.85, tag: 'blizzard', limit: 0.4 }] },
  freezingBreath:{ name: '凍える息', effect: 'fx_ice',     target: 'allEnemies', cooldown: 2, desc: '相手全員に0.9倍ダメージ＋20%で凍結（行動ゲージ0）', effects: [{ type: 'damage', power: 0.9 }, { type: 'freeze', chance: 0.2 }] },
  quakeStomp:    { name: '地響き', effect: 'fx_impact',    target: 'allEnemies', cooldown: 2, shake: true, desc: '相手全員に1.0倍ダメージ＋行動ゲージ-30%', effects: [{ type: 'damage', power: 1.0 }, { type: 'delay', amount: 0.3 }] },
  snowballThrow: { name: '雪玉投げ', effect: 'fx_ice',     target: 'self', desc: 'ランダムな相手に0.6倍ダメージ×3回', effects: [{ type: 'damageRandom', power: 0.6, count: 3 }] },
  iceClub:       { name: '氷の棍棒', effect: 'fx_impact',  target: 'enemy', desc: '1.4倍ダメージ', effects: [{ type: 'damage', power: 1.4 }] },
  glacierPress:  { name: '氷河の圧力', effect: 'fx_ice',   target: 'allEnemies', cooldown: 2, shake: true, desc: '相手全員に1.0倍ダメージ', effects: [{ type: 'damage', power: 1.0 }] },
  iceEntomb:     { name: '氷漬け', effect: 'fx_ice',       target: 'enemy', cooldown: 4, desc: '相手1人を氷漬けにする（3ターン行動不能。氷を攻撃して壊せば助けられる）', effects: [{ type: 'entomb', turns: 4 }] },
  absoluteZero:  { name: '絶対零度', effect: 'fx_ice',     target: 'allEnemies', shake: true, danger: true, desc: '凍結していない相手全員に4倍ダメージ（凍結・氷漬けの相手には効かない）', effects: [{ type: 'damage', power: 4.0, skipFrozen: true }] },
  idle:          { name: 'ようすを見る', target: 'self', desc: '何もしない', effects: [] },

  // --- 星の神殿（81〜90階） ---
  meteorFall:    { name: '落下', effect: 'fx_explosion',   target: 'allEnemies', shake: true, danger: true, desc: '相手全員に0.8倍ダメージ×2回', effects: [{ type: 'damage', power: 0.8, hits: 2 }] },
  mochi:         { name: '餅つき', effect: 'fx_heal',      target: 'allAllies', cooldown: 2, desc: '仲間全員のHPを15%回復＋攻撃+10%（3ターン）', effects: [{ type: 'heal', ratio: 0.15 }, { type: 'buff', stat: 'atk', rate: 1.1, turns: 3, tag: 'mochi' }] },
  starReading:   { name: '星占い', effect: 'fx_buff',      target: 'self', cooldown: 2, desc: '次に受ける単体攻撃を見切ってかわし、反撃する', effects: [{ type: 'status', status: 'foresight', turns: 99 }] },
  laser:         { name: 'レーザー', effect: 'fx_thunder', target: 'enemy', cooldown: 2, desc: '防御を無視して1.3倍ダメージ', effects: [{ type: 'damage', power: 1.3, ignoreDef: true }] },
  riftSummon:    { name: '次元の呼び声', effect: 'fx_dark', target: 'self', desc: 'この階の敵を1体呼び出す', effects: [{ type: 'summonPool' }] },
  reverseTime:   { name: '時間逆行', effect: 'fx_time',    target: 'self', oncePerBattle: true, desc: '自分のHPを2ターン前の値に戻す（1戦闘1回）', effects: [{ type: 'rewind', turns: 2 }] },
  voidTentacles: { name: '虚無の触手', effect: 'fx_dark',  target: 'self', desc: 'ランダムな相手に0.6倍ダメージ×4回', effects: [{ type: 'damageRandom', power: 0.6, count: 4 }] },
  starEater:     { name: '星喰い', effect: 'fx_dark',      target: 'enemy', cooldown: 2, desc: '相手1人の強化効果を全部奪って自分に付ける＋1.0倍ダメージ', effects: [{ type: 'devourBuffs' }, { type: 'damage', power: 1.0 }] },
  eyeBeam:       { name: '虚神の眼光', effect: 'fx_dark',  target: 'allEnemies', shake: true, desc: '相手全員に0.8倍ダメージ（目が残っている間、毎ターン）', effects: [{ type: 'damage', power: 0.8 }] },

  // --- 神々の塔（91〜100階） ---
  issen:         { name: '一閃', effect: 'fx_slash',        target: 'allEnemies', cooldown: 3, shake: true, danger: true, desc: '相手全員に1.2倍ダメージ。HP50%以下の相手は即死', effects: [{ type: 'execute', below: 0.5, power: 1.2 }] },
  hellfire:      { name: '獄炎', effect: 'fx_fire',          target: 'allEnemies', cooldown: 2, shake: true, desc: '相手全員に1.0倍ダメージ＋やけど（3%、3ターン）', effects: [{ type: 'damage', power: 1.0 }, { type: 'status', status: 'burn', value: 0.03, turns: 3 }] },
  dragonClaw:    { name: '竜の爪', effect: 'fx_slash',       target: 'enemy', desc: '1.3倍ダメージ', effects: [{ type: 'damage', power: 1.3 }] },
  tentacleBarrage:{ name: '触手乱打', effect: 'fx_impact',   target: 'self', desc: '残っている足の数だけ、ランダムな相手に0.45倍ダメージ', effects: [{ type: 'partStrikes', power: 0.45 }] },
  krakenSlam:    { name: 'たたきつけ', effect: 'fx_impact',  target: 'enemy', desc: '1.4倍ダメージ', effects: [{ type: 'damage', power: 1.4 }] },
  thunderDrums:  { name: '雷の太鼓', effect: 'fx_thunder',   target: 'self', cooldown: 5, danger: true, desc: '5つの太鼓が光り、光った順に雷が落ちる（行動順リストで予告）', effects: [{ type: 'drums', enemy: 'thunderDrum', count: 5 }] },
  drumStrike:    { name: '落雷', effect: 'fx_thunder',       target: 'enemy', danger: true, desc: '1.3倍ダメージ', effects: [{ type: 'damage', power: 1.3 }] },
  thunderSpear:  { name: '雷槍', effect: 'fx_thunder',       target: 'enemy', desc: '1.3倍ダメージ', effects: [{ type: 'damage', power: 1.3 }] },
  foxFire:       { name: '狐火', effect: 'fx_fire',          target: 'allEnemies', cooldown: 2, desc: '相手全員に0.9倍ダメージ', effects: [{ type: 'damage', power: 0.9 }] },
  foxBite:       { name: '噛みつき', effect: 'fx_impact',    target: 'enemy', desc: '1.3倍ダメージ', effects: [{ type: 'damage', power: 1.3 }] },
  mechPunch:     { name: '鉄拳', effect: 'fx_impact',        target: 'enemy', desc: '1.3倍ダメージ', effects: [{ type: 'damage', power: 1.3 }] },
  coreLaser:     { name: '全体レーザー', effect: 'fx_thunder', target: 'allEnemies', shake: true, danger: true, desc: '相手全員に1.3倍ダメージ。そのあとコアが開く（次の行動まで）', effects: [{ type: 'damage', power: 1.3 }, { type: 'openCore', target: 'self' }] },
  headBite:      { name: '首の噛みつき', effect: 'fx_impact', target: 'enemy', desc: '0.7倍ダメージ', effects: [{ type: 'damage', power: 0.7 }] },
  hydraBreath:   { name: '毒の息', effect: 'fx_poison',      target: 'allEnemies', cooldown: 3, desc: '相手全員に0.6倍ダメージ＋毒（4%、3ターン）', effects: [{ type: 'damage', power: 0.6 }, { type: 'status', status: 'poison', value: 0.04, turns: 3 }] },
  inversion:     { name: '反転', effect: 'fx_dark',          target: 'allEnemies', cooldown: 4, desc: '相手全員を反転状態にする（3ターン：回復がダメージに、受けたダメージは2ターン後に回復に）', effects: [{ type: 'status', status: 'inverted', turns: 4 }] },
  fallenSpear:   { name: '堕天の槍', effect: 'fx_dark',      target: 'enemy', desc: '1.4倍ダメージ', effects: [{ type: 'damage', power: 1.4 }] },
  darkFeathers:  { name: '黒い羽', effect: 'fx_dark',        target: 'allEnemies', cooldown: 2, desc: '相手全員に0.9倍ダメージ', effects: [{ type: 'damage', power: 0.9 }] },
  chronoBlade:   { name: '時の刃', effect: 'fx_time',        target: 'enemy', desc: '1.3倍ダメージ', effects: [{ type: 'damage', power: 1.3 }] },
  timeWave:      { name: '時の波', effect: 'fx_time',        target: 'allEnemies', cooldown: 2, desc: '相手全員に0.9倍ダメージ＋行動ゲージ-20%', effects: [{ type: 'damage', power: 0.9 }, { type: 'delay', amount: 0.2 }] },
  genesisLight:  { name: '創世の光', effect: 'fx_thunder',   target: 'allEnemies', cooldown: 1, shake: true, desc: '相手全員に1.0倍ダメージ', effects: [{ type: 'damage', power: 1.0 }] },
  summonPastBoss:{ name: '過去の召喚', effect: 'fx_dark',    target: 'self', cooldown: 4, desc: '過去のボスを1体呼び出す（HPは本来の25%）', effects: [{ type: 'summonBoss', list: ['golem', 'dragon', 'ignis', 'leviathan', 'zenith', 'lichKing', 'demonLord'], hpRate: 0.25 }] },
  originStrike:  { name: '終焉の一撃', effect: 'fx_explosion', target: 'enemy', desc: '1.5倍ダメージ', effects: [{ type: 'damage', power: 1.5 }] },
  oblivion:      { name: '終焉', effect: 'fx_explosion',     target: 'allEnemies', shake: true, danger: true, desc: '相手全員が倒れる', effects: [{ type: 'annihilate' }] },
};
// 属性（element）：'fire'（炎）/ 'light'（光）。ゾンビは炎・光の攻撃で倒すと起き上がらない
SKILLS.fireball.element = 'fire';
SKILLS.inferno.element = 'fire';

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
  // --- 51〜70階で追加 ---
  reanimate:      { icon: '🧟', name: '起き上がり', desc: t => `倒されても${t.turns}ターン後にHP${pct(t.ratio)}で起き上がる（1回）。炎・光の攻撃で倒すと起き上がらない` },
  stealBuff:      { icon: '🐦', name: '横取り',   desc: () => '攻撃した相手の強化効果を1つ奪って自分に付ける' },
  healDown:       { icon: '💙', name: '青い炎',   desc: t => `この敵がいる間、相手の回復量-${pct(t.value)}` },
  lifesteal:      { icon: '🩸', name: '吸収',     desc: t => `与えたダメージの${pct(t.value)}を回復` },
  splitAt:        { icon: '🦇', name: '変身',     desc: t => `HP${pct(t.below)}以下になると、${ENEMIES[t.into].name}${t.count}体に分裂する（それぞれHP${pct(t.ratio)}）` },
  phantom:        { icon: '🌫', name: '霊体',     desc: t => `通常攻撃のダメージ-${pct(t.value)}（スキルは通常どおり効く）` },
  tombShield:     { icon: '🪦', name: '墓石の盾', desc: t => `仲間全員の受けるダメージ-${pct(t.value)}（自分が倒れると解除）` },
  curseLink:      { icon: '🪡', name: '呪い返し', desc: t => `受けたダメージの${pct(t.value)}を、攻撃した相手とは別の相手1人にも与える` },
  packFury:       { icon: '🐺', name: '仲間の仇', desc: t => `仲間が倒れるたびに攻撃+${pct(t.rate - 1)}` },
  maxHpDown:      { icon: '🖤', name: '闇の剣',   desc: t => `攻撃した相手の最大HP-${pct(1 - t.rate)}（戦闘中ずっと。重ねがけ）` },
  splitOnHit:     { icon: '💧', name: '分裂',     desc: t => `単体攻撃を受けるたびに、HPを半分に分けて分裂（最大${t.max}体）。全体攻撃なら分裂しない` },
  merchant:       { icon: '💰', name: '商人',     desc: t => `攻撃してこない。${t.turns}回行動すると逃げる。逃げる前に倒すとポイント+${t.points}と上級アイテム1つ` },
  mirrorCopy:     { icon: '🎭', name: '写し身',   desc: () => '戦闘開始時、攻撃力が一番高い相手の姿・ステータス・スキルをコピーする' },
  // --- 71〜90階で追加 ---
  snowballSplit:  { icon: '⛄', name: '雪玉分裂', desc: t => `倒されると${ENEMIES[t.into].name}${t.count}つに分かれ、${t.turns}ターン後に1つでも残っていれば復活する（1回）` },
  packSpeed:      { icon: '🐺', name: '群れ',     desc: t => `同じ種類の仲間1体につき速度+${pct(t.rate)}` },
  iceSlide:       { icon: '⛸', name: '氷の滑走', desc: t => `行動のあと${pct(t.chance)}で行動ゲージ+${pct(t.amount)}（連続行動することがある）` },
  iceWall:        { icon: '🧊', name: '氷の壁',   desc: t => `${t.every}ターンごとに、仲間全員に「次の攻撃を1回無効」を付ける` },
  auroraBless:    { icon: '🌈', name: 'オーロラ', desc: t => `毎ターン、仲間1体の攻撃・防御・速度のどれかを+${pct(t.rate - 1)}（3ターン）` },
  starBless:      { icon: '🌟', name: '星の恵み', desc: () => '倒されると、相手側でHPの割合が一番低い1人のHPを全回復させる' },
  stars:          { icon: '✨', name: '星の点',   desc: t => `体の星${t.count}つ。星1つにつき受けるダメージ-${pct(t.cut)}。会心を受けると星が1つ消える` },
  hatch:          { icon: '🥚', name: '孵化',     desc: t => `攻撃しない。${t.turns}回行動すると「${ENEMIES[t.into].name}」になる` },
  riftLink:       { icon: '🌀', name: '裂け目',   desc: () => '毎ターン敵を呼び出す。倒すと呼び出された敵も消える' },
  noAct:          { icon: '⏸', name: '動かない', desc: () => '行動しない' },
  // --- 神々の塔（91〜100階）で追加 ---
  iaiCounter:     { icon: '⚔', name: '居合',     desc: t => `相手が行動するたび、その相手に必ず反撃する（${t.power}倍）` },
  rampUp:         { icon: '🔥', name: '昂り',     desc: t => `毎ターン${STAT_LABELS[t.stat]}+${pct(t.rate - 1)}（最大${t.limit}倍）` },
  startParts:     { icon: '🧩', name: '部位',     desc: t => `${ENEMIES[t.enemy].name}を${t.count}つ持つ` + (t.shield ? '（全部壊すまで本体は無敵）' : '') + (t.regrow ? `（壊れても${t.regrow}ターンで再生）` : '') },
  nineLives:      { icon: '🦊', name: '九つの命', desc: t => `命が${t.count}つ。HPが0になるたび尾が1本減ってHP全回復（尾1本ごとにHP上限-${pct(t.hpCut)}）` },
  coreBody:       { icon: '🛡', name: '機神の装甲', desc: () => 'コア以外への攻撃は効かない。コアは3ターンに1回、全体レーザーのあとに開く' },
  hydraHead:      { icon: '🐍', name: '再生する首', desc: t => `単体攻撃で倒されると2本に増える（最大${t.max}本）。全体攻撃で倒すと増えない` },
  chronoControl:  { icon: '⏳', name: '時の支配', desc: () => '毎ターン「相手1人の行動を飛ばす」か「自分が2回行動」のどちらかを使う' },
  chronoRewind:   { icon: '⏪', name: '巻き戻し', desc: t => `HP${pct(t.below)}以下になると1回だけ、戦闘開始時のHPに戻る` },
  oneShot:        { icon: '⚡', name: '一撃',     desc: () => '1回行動すると消える' },
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
  // --- 15階以降の仲間で追加 ---
  sleep:         { icon: '💤', name: '眠り',     skipTurn: true, applyText: 'は眠ってしまった！', desc: () => '次の行動を1回休む' },
  focus:         { icon: '✨', name: '魔力集中', applyText: 'は魔力を集中している！',             desc: () => '次のスキルの効果が2倍' },
  counterStance: { icon: '🥋', name: '構え',     applyText: 'は構えた！',                         desc: () => '次に受ける攻撃に反撃する' },
  // --- 51〜70階で追加 ---
  // deathOnExpire: 残りターンが0になると即死
  bound:  { icon: '🩹', name: '拘束', skipTurn: true, applyText: 'は包帯でしばられた！',     desc: () => '行動できない（攻撃されると解ける）' },
  doom:   { icon: '💀', name: '死の宣告', deathOnExpire: true, applyText: 'に死の宣告が刻まれた！', desc: s => `あと${s.turns}回行動すると即死（リッチを倒すか回復で解除）` },
  sealed: { icon: '🚫', name: '封印', applyText: 'はスキルを封じられた！',               desc: () => 'スキルが使えない（通常攻撃のみ）' },
  // --- 71〜90階で追加 ---
  iceWall:   { icon: '🧊', name: '氷の壁', applyText: 'は氷の壁に守られた！',      desc: () => '次に受ける攻撃を1回無効にする' },
  entombed:  { icon: '🧊', name: '氷漬け', skipTurn: true, frozen: true, applyText: 'は氷漬けにされた！', desc: () => '行動できない（氷を壊すと助けられる）。絶対零度は効かない' },
  foresight: { icon: '🔮', name: '星占い', applyText: 'は星の動きを読んでいる…',  desc: () => '次に受ける単体攻撃をかわして反撃する' },
  voidVeil:  { icon: '👁', name: '部位の守り', invulnerable: true, applyText: 'は部位の力に守られた！', desc: () => '目・光の球などの部位を全部壊すまで攻撃が効かない' },
};
// --- 神々の塔（91〜100階）で追加 ---
Object.assign(STATUS_INFO, {
  inverted:     { icon: '🔄', name: '反転', applyText: 'は反転の呪いを受けた！', desc: () => '回復がダメージに変わる。受けたダメージは2ターン後に回復に変わる' },
  armored:      { icon: '🛡', name: '機神の装甲', invulnerable: true, applyText: 'は装甲に包まれている。', desc: () => 'コア以外への攻撃は効かない' },
  shut:         { icon: '🔒', name: '閉じたコア', invulnerable: true, applyText: 'が閉じた！', desc: () => '閉じている間は攻撃が効かない（全体レーザーのあとに開く）' },
  rule_noHeal:  { icon: '🚫', name: '世界改変：回復禁止', applyText: 'が世界を書き換えた！ 回復が禁止された！', desc: () => 'だれもHPを回復できない' },
  rule_noSkill: { icon: '🤐', name: '世界改変：スキル禁止', applyText: 'が世界を書き換えた！ スキルが禁止された！', desc: () => 'だれも通常攻撃以外の技を使えない' },
  rule_reverse: { icon: '🔃', name: '世界改変：行動順逆転', applyText: 'が世界を書き換えた！ 行動順が逆転した！', desc: () => '遅いキャラほど先に行動する' },
});
STATUS_INFO.freeze.frozen = true; // 凍結中は絶対零度が効かない

// 強化のうち、キャラの上にアイコンで出すもの（tag で判別。数字は残りターン）
const BUFF_BADGES = {
  song_wind:  { icon: '🎵', name: '疾風の歌' },
  song_brave: { icon: '🎶', name: '勇気の歌' },
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
//     enemyCount: 2              生きている敵が2体以上
//     enemyHpBelow: 0.3          HPがその割合以下の敵がいる
//     enemySpdAtLeast: 140       速度がその値以上の敵がいる
//     enemyDanger: true          大技を予告している敵がいる（行動順リストの ⚠）
//     nextEnemyDanger: true      次に動く敵が大技を予告している
//     allyMissingBuff: 'song_wind' その種類（tag）の強化がかかっていない味方がいる
//     kiAtLeast: 5               気がその数以上（拳闘家）
//     hasOtherAlly: true         自分以外の味方がいる
//   target（省略可）:
//     'charging'                 力をためている相手を狙う
//     'nextEnemy' / 'danger'     次に動く敵 ／ 大技を予告している敵
//     'fastest'                  一番速い敵
//     'weakestAlly' / 'strongestAlly' HP割合が一番低い味方 ／ 攻撃が一番高い自分以外の味方
//     省略時                     敵1体なら TARGET_PRIORITY の順、味方1体ならHP割合が一番低い仲間
//   どのルールにも当てはまらなければ「攻撃」
// join: 仲間になる条件（省略すると最初から仲間）。複数書くと全部満たしたとき加入
//   { reachFloor: 5 }    ダンジョン5階に到達
//   { defeatBoss: 10 }   10階のボスを倒す
//   加入しても出撃枠に空きが無ければ控え（強化画面で出撃メンバーを入れ替える）
const CHARACTERS = {
  hero: {
    name: '主人公', attackEffect: 'fx_slash', role: 'all', image: 'characters/hero.png', hp: 180, atk: 30, def: 15, spd: 100,
    skills: ['attack', 'defend', 'heavySlash', 'legSweep', 'firstAid', 'quicken'],
    autoRules: [
      { skill: 'quicken',    when: { firstTurn: true } },
      { skill: 'legSweep',   when: { enemyCharging: true }, target: 'charging' },
      { skill: 'firstAid',   when: { hpBelow: 0.3 } },
      { skill: 'heavySlash' },
    ],
  },
  knight: {
    name: '騎士', attackEffect: 'fx_slash', role: 'tank', image: 'characters/knight.png', hp: 240, atk: 22, def: 28, spd: 80,
    join: { reachFloor: 5 },
    skills: ['attack', 'defend', 'cover'],
    autoRules: [
      { skill: 'cover',  when: { allyHpBelow: 0.4 } },
      { skill: 'attack' },
    ],
  },
  priest: {
    name: '僧侶', attackEffect: 'fx_impact', attackElement: 'light', role: 'healer', image: 'characters/priest.png', hp: 140, atk: 16, def: 12, spd: 110,
    join: { defeatBoss: 10 },
    skills: ['attack', 'heal', 'healAll'],
    autoRules: [
      // 回復優先：少しでも減った味方がいれば回復（2人以上なら全体回復）。全員ほぼ満タンのときだけ攻撃
      { skill: 'healAll', when: { allyHpBelow: 0.85, allyCount: 2 } },
      { skill: 'heal',    when: { allyHpBelow: 0.85 } },
      { skill: 'attack' },
    ],
  },

  // ---- 15階以降に加入する仲間 ----
  thief: {
    name: '盗賊', attackEffect: 'fx_slash', role: 'speed', image: 'characters/thief.png', hp: 150, atk: 26, def: 12, spd: 140,
    join: { reachFloor: 15 },
    skills: ['attack', 'defend', 'twinSlash', 'shadowStitch', 'steal'],
    autoRules: [
      { skill: 'shadowStitch', when: { nextEnemyDanger: true }, target: 'nextEnemy' }, // 次に動く敵が大技予告中なら止める
      { skill: 'twinSlash' },
    ],
  },
  mage: {
    name: '魔法使い', attackEffect: 'fx_fire', attackElement: 'fire', role: 'aoe', image: 'characters/mage.png', hp: 120, atk: 34, def: 10, spd: 90,
    join: { defeatBoss: 20 },
    skills: ['attack', 'defend', 'fireball', 'inferno', 'focus'],
    autoRules: [
      { skill: 'inferno' }, // 爆炎を最優先（使えるときは敵が1体でも使う）
      { skill: 'fireball' },
    ],
  },
  archer: {
    name: '弓使い', attackEffect: 'fx_arrow', role: 'finisher', image: 'characters/archer.png', hp: 140, atk: 30, def: 12, spd: 115,
    join: { reachFloor: 25 },
    skills: ['attack', 'defend', 'aimedShot', 'pinningArrow', 'volley'],
    autoRules: [
      { skill: 'aimedShot',    when: { enemyHpBelow: 0.3 } },
      { skill: 'pinningArrow', when: { enemySpdAtLeast: 140 }, target: 'fastest' },
      { skill: 'volley' },
    ],
  },
  bard: {
    name: '吟遊詩人', attackEffect: 'fx_impact', role: 'buffer', image: 'characters/bard.png', hp: 130, atk: 14, def: 12, spd: 120,
    join: { defeatBoss: 30 },
    skills: ['attack', 'defend', 'windSong', 'braveSong', 'lullaby'],
    autoRules: [
      { skill: 'lullaby',   when: { enemyDanger: true }, target: 'danger' }, // 大技予告中の敵を眠らせる
      { skill: 'windSong',  when: { allyMissingBuff: 'song_wind' } },
      { skill: 'braveSong', when: { allyMissingBuff: 'song_brave' } },
      { skill: 'attack' },
    ],
  },
  monk: {
    name: '拳闘家', attackEffect: 'fx_impact', role: 'combo', image: 'characters/monk.png', hp: 190, atk: 28, def: 18, spd: 105,
    join: { reachFloor: 35 },
    ki: { max: 5, atkPer: 0.08 }, // 気：攻撃するたび1たまる（最大5）。気1つにつき攻撃+8%
    skills: ['attack', 'defend', 'comboStrike', 'hyakuretsu', 'stance'],
    autoRules: [
      { skill: 'hyakuretsu',  when: { kiAtLeast: 5 } },
      { skill: 'stance',      when: { hpBelow: 0.4 } },
      { skill: 'comboStrike' },
    ],
  },
  chronomancer: {
    name: '時の魔導士', attackEffect: 'fx_impact', role: 'time', image: 'characters/chronomancer.png', hp: 130, atk: 20, def: 14, spd: 125,
    join: { defeatBoss: 40 },
    skills: ['attack', 'defend', 'timeHaste', 'timeStop', 'rewind'],
    autoRules: [
      { skill: 'timeStop',  when: { enemyDanger: true } },
      { skill: 'rewind',    when: { allyHpBelow: 0.3 }, target: 'weakestAlly' },
      { skill: 'timeHaste', when: { hasOtherAlly: true }, target: 'strongestAlly' },
      { skill: 'attack' },
    ],
  },
};

// オートバトルで敵1体を狙うときの優先順（敵のタイプ）。どれもいなければ残りHPが一番少ない敵
const TARGET_PRIORITY = ['treasure', 'heal', 'charge'];

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
//   turnShuffle: true 自分の毎ターン開始時に、行動順をランダムに入れ替える
//   debuffAll: { stat, rate, turns } 相手全員の能力を下げる（1回）
//   eyes: { enemy, count } 目を呼び出し、全部壊すまで本体は無敵（場の上限を超えて出る）
//   parts: { enemy, count, shield } 部位を呼び出す（shield: true なら全部壊すまで本体は無敵）
//   worldRule: { every: 3 } 自分が every 回動くごとに、ルール（回復禁止／スキル禁止／行動順逆転）を変える
// pack: 2  この敵が出たら、同じ敵が最低この数そろって出る（群れ）
// hint: 図鑑の「出現場所」に出す説明（ほかの敵から出てくる敵など）
// ai:   行動の候補リスト。条件(when)を満たす候補の中から weight の比率でランダムに選ぶ
//   when に使える条件（すべて満たしたときのみ候補になる）:
//     hpBelow: 0.5      自分のHPが50%未満
//     hpAbove: 0.5      自分のHPが50%以上
//     hasBuff / notBuff: 'atk'        自分の攻撃が強化されている／いない
//     charging / notCharging: true    力をためている／いない
//     hasStatus / notStatus: 'flying' その状態異常がかかっている／いない
//     noCountdown: true               大技を予告中でない
//     allyHpBelow: 0.7  HP70%未満の仲間（自分含む）がいる（allyCount: 2 を添えると「2人以上」）
//     notBossBattle: true            ボス戦ではない
//     noOpponentStatus: 'doom'       その状態異常の相手が1人もいない
//     everyNth: 3                    3回に1回（自分の3回目・6回目…の行動）
//     hasParts: true                 自分の部位（足など）が残っている
//     noSummonAlive: true            自分が呼び出した敵が残っていない
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
  witch:   { name: '呪術師', attackEffect: 'fx_dark',       type: 'disrupt', image: 'enemies/sorcerer.svg',      idle: 'idle-float',  hp: 80,  atk: 15, def: 8,  spd: 115, exp: 14,
             traits: [{ type: 'curseOnDeath', stat: 'spd', rate: 0.85, turns: 3 }], ai: [{ skill: 'attack', weight: 1 }, { skill: 'slowCurse', weight: 2 }, { skill: 'shadowBind', weight: 2 }] },
  flower:  { name: '癒し草',       type: 'heal',    image: 'enemies/healing_plant.svg', idle: 'idle-sway',   face: '50% 80%', hp: 75,  atk: 10, def: 10, spd: 95,  exp: 12,
             traits: [{ type: 'regen', value: 0.05 }], ai: [{ skill: 'attack', weight: 1 }, { skill: 'healAlly', weight: 4, when: { allyHpBelow: 0.7 } }] },

  // --- 11階以降 ---
  mirrorSlime: { name: 'ミラースライム', type: 'tough',   image: 'enemies/mirror_slime.png',    idle: 'idle-puni',  face: '50% 75%', hp: 90,  atk: 18, def: 20, spd: 90,  exp: 20,
                 traits: [{ type: 'reflect', value: 0.3 }], ai: [{ skill: 'attack', weight: 1 }] },
  mushroom:    { name: '毒キノコ', attackEffect: 'fx_poison',       type: 'disrupt', image: 'enemies/poison_mushroom.png', idle: 'idle-sway',  face: '50% 80%',  hp: 85,  atk: 14, def: 10, spd: 80,  exp: 18,
                 traits: [{ type: 'poisonOnHit', value: 0.05, turns: 3 }], ai: [{ skill: 'attack', weight: 1 }] },
  skeleton:    { name: '骸骨剣士', attackEffect: 'fx_slash',       type: 'normal',  image: 'enemies/skeleton.png',        idle: 'idle-breath', hp: 100, atk: 24, def: 14, spd: 95,  exp: 24,
                 traits: [{ type: 'endure' }], ai: [{ skill: 'attack', weight: 1 }] },
  goblin:      { name: '甲冑ゴブリン', attackEffect: 'fx_slash',   type: 'tough',   image: 'enemies/goblin_guard.png',    idle: 'idle-heavy', face: '50% 20%', hp: 130, atk: 18, def: 30, spd: 70,  exp: 24,
                 traits: [{ type: 'guardian' }], ai: [{ skill: 'attack', weight: 2 }, { skill: 'harden', weight: 1, when: { notBuff: 'def' } }] },
  wisp:        { name: '炎の精霊', attackEffect: 'fx_fire',       type: 'fast',    image: 'enemies/flame_wisp.png',      idle: 'idle-float', face: '50% 80%', hp: 60,  atk: 26, def: 6,  spd: 150, exp: 20,
                 traits: [{ type: 'deathBlast', power: 1.5 }, { type: 'selfDestruct', after: 3 }], ai: [{ skill: 'attack', weight: 1 }] },
  mimic:       { name: 'ミミック',       type: 'special', image: 'enemies/mimic.png',           idle: 'idle-heavy', face: '50% 25%', noElite: true, hp: 160, atk: 34, def: 20, spd: 60, exp: 40,
                 traits: [{ type: 'dormant' }, { type: 'rewardOnDefeat' }], ai: [{ skill: 'attack', weight: 2 }, { skill: 'doubleBite', weight: 1 }] },
  iceFairy:    { name: '氷の妖精', attackEffect: 'fx_ice',       type: 'disrupt', image: 'enemies/ice_fairy.png',       idle: 'idle-float', face: '50% 15%', hp: 75,  atk: 16, def: 12, spd: 125, exp: 22,
                 traits: [{ type: 'freezeOnHit', chance: 0.3 }], ai: [{ skill: 'attack', weight: 1 }] },
  assassin:    { name: '影の暗殺者', attackEffect: 'fx_slash',     type: 'fast',    image: 'enemies/shadow_assassin.png', idle: 'idle-breath', hp: 90, atk: 30, def: 8,  spd: 160, exp: 28,
                 traits: [{ type: 'evasion', value: 0.3 }, { type: 'targetWeakest' }, { type: 'executeCrit' }], ai: [{ skill: 'attack', weight: 1 }] },

  // --- 灼熱の火山（21〜29階） ---
  magmaSlime:   { name: 'マグマスライム', attackEffect: 'fx_fire', type: 'normal',  image: 'enemies/magma_slime.png',   idle: 'idle-puni',   face: '50% 70%', hp: 110, atk: 22, def: 16, spd: 85,  exp: 30,
                  traits: [{ type: 'statusOnHit', status: 'burn', value: 0.03, turns: 2 }], ai: [{ skill: 'attack', weight: 1 }] },
  salamander:   { name: '火トカゲ',       type: 'fast',    image: 'enemies/salamander.png',    idle: 'idle-breath', face: '90% 55%', hp: 100, atk: 26, def: 12, spd: 110, exp: 32,
                  ai: [{ skill: 'attack', weight: 2 }, { skill: 'flameBreath', weight: 2 }] },
  lavaGolem:    { name: '溶岩ゴーレム',   type: 'tough',   image: 'enemies/lava_golem.png',    idle: 'idle-heavy',  face: '50% 20%', hp: 180, atk: 24, def: 32, spd: 60,  exp: 38,
                  traits: [{ type: 'triggerAt', below: 0.5, skill: 'lavaBurst' }], ai: [{ skill: 'attack', weight: 1 }] },
  fireBat:      { name: '火炎コウモリ', attackEffect: 'fx_fire',   type: 'fast',    image: 'enemies/fire_bat.png',      idle: 'idle-flap',   face: '50% 45%', hp: 70,  atk: 22, def: 8,  spd: 165, exp: 30,
                  traits: [{ type: 'statusOnHit', status: 'burn', value: 0.03, turns: 2 }, { type: 'evasion', value: 0.15 }], ai: [{ skill: 'attack', weight: 1 }] },
  bombRock:     { name: '爆弾岩',         type: 'charge',  image: 'enemies/bomb_rock.png',     idle: 'idle-heavy',  face: '50% 55%', hp: 120, atk: 10, def: 40, spd: 50,  exp: 34,
                  traits: [{ type: 'fuse', turns: 3, skill: 'bombBlast' }], ai: [{ skill: 'attack', weight: 1 }] },
  phoenixChick: { name: '不死鳥のヒナ',   type: 'heal',    image: 'enemies/phoenix_chick.png', idle: 'idle-float',  face: '50% 45%', hp: 80,  atk: 18, def: 10, spd: 120, exp: 34,
                  traits: [{ type: 'rebirth', ratio: 1 }], ai: [{ skill: 'attack', weight: 1 }] },
  flameSamurai: { name: '炎の鬼武者', attackEffect: 'fx_slash',     type: 'normal',  image: 'enemies/flame_samurai.png', idle: 'idle-breath', face: '50% 25%', hp: 130, atk: 32, def: 20, spd: 105, exp: 40,
                  traits: [{ type: 'iai', rate: 2 }], ai: [{ skill: 'attack', weight: 1 }] },
  ashMage:      { name: '灰の魔術師', attackEffect: 'fx_fire',     type: 'disrupt', image: 'enemies/ash_mage.png',      idle: 'idle-float',  face: '50% 25%', hp: 90,  atk: 28, def: 10, spd: 100, exp: 36,
                  ai: [{ skill: 'attack', weight: 1 }, { skill: 'ashStorm', weight: 2 }] },
  lavaWorm:     { name: '溶岩ワーム',     type: 'charge',  image: 'enemies/lava_worm.png',     idle: 'idle-sway',   face: '70% 15%', hp: 150, atk: 28, def: 18, spd: 80,  exp: 38,
                  ai: [{ skill: 'attack', weight: 1 }, { skill: 'burrow', weight: 2 }] },

  // --- 深海の神殿（31〜39階） ---
  jellyfish:    { name: 'クラゲ', attackEffect: 'fx_thunder',         type: 'disrupt', image: 'enemies/jellyfish.png',     idle: 'idle-float',  face: '50% 30%', hp: 85,  atk: 18, def: 12, spd: 95,  exp: 44,
                  traits: [{ type: 'delayOnHit', amount: 0.5, label: '麻痺' }], ai: [{ skill: 'attack', weight: 1 }] },
  crabKnight:   { name: 'カニ騎士',       type: 'tough',   image: 'enemies/crab_knight.png',   idle: 'idle-heavy',  face: '50% 45%', hp: 160, atk: 26, def: 40, spd: 70,  exp: 50,
                  traits: [{ type: 'counter', chance: 0.3 }], ai: [{ skill: 'attack', weight: 2 }, { skill: 'harden', weight: 1, when: { notBuff: 'def' } }] },
  siren:        { name: 'セイレーン',     type: 'disrupt', image: 'enemies/siren.png',         idle: 'idle-sway',   face: '50% 20%', hp: 95,  atk: 20, def: 14, spd: 115, exp: 46,
                  ai: [{ skill: 'attack', weight: 1 }, { skill: 'charmSong', weight: 2 }] },
  pufferfish:   { name: '毒フグ',         type: 'tough',   image: 'enemies/pufferfish.png',    idle: 'idle-float',  face: '50% 45%', hp: 110, atk: 20, def: 18, spd: 80,  exp: 44,
                  traits: [{ type: 'puffUp' }], ai: [{ skill: 'attack', weight: 1 }] },
  octoMage:     { name: 'タコ魔導士',     type: 'disrupt', image: 'enemies/octo_mage.png',     idle: 'idle-sway',   face: '50% 45%', hp: 100, atk: 30, def: 12, spd: 100, exp: 48,
                  ai: [{ skill: 'attack', weight: 2 }, { skill: 'inkSpray', weight: 2 }] },
  fishman:      { name: '半魚人戦士', attackEffect: 'fx_slash',     type: 'normal',  image: 'enemies/fishman.png',       idle: 'idle-breath', face: '50% 20%', hp: 130, atk: 30, def: 22, spd: 105, exp: 50,
                  traits: [{ type: 'pack', rate: 1.2 }], ai: [{ skill: 'attack', weight: 1 }] },
  clam:         { name: '大貝',           type: 'tough',   image: 'enemies/clam.png',          idle: 'idle-heavy',  face: '50% 55%', hp: 140, atk: 16, def: 50, spd: 60,  exp: 46,
                  traits: [{ type: 'guardCycle', every: 3, status: 'shelled' }, { type: 'pointsOnDefeat', value: 3 }], ai: [{ skill: 'attack', weight: 1 }] },
  anglerfish:   { name: '深海アンコウ',   type: 'charge',  image: 'enemies/anglerfish.png',    idle: 'idle-sway',   face: '60% 35%', hp: 170, atk: 36, def: 18, spd: 75,  exp: 56,
                  traits: [{ type: 'taunt' }], ai: [{ skill: 'attack', weight: 2 }, { skill: 'bigMouth', weight: 1 }] },
  ghostCaptain: { name: '幽霊船長', attackEffect: 'fx_slash',       type: 'disrupt', image: 'enemies/ghost_captain.png', idle: 'idle-float',  face: '50% 30%', hp: 120, atk: 30, def: 16, spd: 110, exp: 54,
                  traits: [{ type: 'ethereal', value: 0.5 }], ai: [{ skill: 'attack', weight: 2 }, { skill: 'summonSkeleton', weight: 1 }] },

  // --- 天空の城（41〜49階） ---
  cloudSpirit:  { name: '雲の精',         type: 'fast',    image: 'enemies/cloud_spirit.png',  idle: 'idle-float',  face: '45% 50%', hp: 90,  atk: 20, def: 10, spd: 120, exp: 58,
                  traits: [{ type: 'evasion', value: 0.4 }], ai: [{ skill: 'attack', weight: 1 }] },
  stormBird:    { name: '嵐の怪鳥',       type: 'fast',    image: 'enemies/storm_bird.png',    idle: 'idle-flap',   face: '50% 25%', hp: 110, atk: 30, def: 14, spd: 170, exp: 62,
                  traits: [{ type: 'delayOnHit', amount: 0.3, label: '突風' }], ai: [{ skill: 'attack', weight: 1 }] },
  thunderSprite:{ name: '雷の精霊', attackEffect: 'fx_thunder',       type: 'fast',    image: 'enemies/thunder_sprite.png', idle: 'idle-float', face: '50% 45%', hp: 80,  atk: 32, def: 8,  spd: 150, exp: 60,
                  ai: [{ skill: 'attack', weight: 1 }, { skill: 'chainLightning', weight: 2 }] },
  gargoyle:     { name: 'ガーゴイル',     type: 'tough',   image: 'enemies/gargoyle.png',      idle: 'idle-heavy',  face: '50% 20%', hp: 160, atk: 30, def: 36, spd: 70,  exp: 64,
                  traits: [{ type: 'guardCycle', every: 2, status: 'stone' }], ai: [{ skill: 'attack', weight: 1 }] },
  angelSoldier: { name: '天使兵', attackEffect: 'fx_slash',         type: 'heal',    image: 'enemies/angel_soldier.png', idle: 'idle-float',  face: '50% 20%', hp: 140, atk: 32, def: 28, spd: 100, exp: 66,
                  ai: [{ skill: 'resurrect', weight: 100, when: { allyDead: true } }, { skill: 'attack', weight: 1 }] },
  griffon:      { name: 'グリフォン',     type: 'fast',    image: 'enemies/griffon.png',       idle: 'idle-breath', face: '50% 20%', hp: 170, atk: 38, def: 22, spd: 140, exp: 70,
                  ai: [{ skill: 'attack', weight: 2 }, { skill: 'griffonDive', weight: 1 }] },
  clockwork:    { name: '機械兵',         type: 'tough',   image: 'enemies/clockwork_soldier.png', idle: 'idle-heavy', face: '50% 20%', hp: 180, atk: 30, def: 34, spd: 80, exp: 68,
                  traits: [{ type: 'accelerate', rate: 1.1, max: 2 }], ai: [{ skill: 'attack', weight: 1 }] },
  wyvern:       { name: 'ワイバーン',     type: 'charge',  image: 'enemies/wyvern.png',        idle: 'idle-breath', face: '80% 15%', hp: 190, atk: 36, def: 24, spd: 120, exp: 72,
                  ai: [{ skill: 'attack', weight: 2 }, { skill: 'poisonTail', weight: 1 }] },
  skyWitch:     { name: '天空の魔女',     type: 'disrupt', image: 'enemies/sky_witch.png',     idle: 'idle-float',  face: '50% 30%', hp: 120, atk: 34, def: 16, spd: 115, exp: 70,
                  ai: [{ skill: 'attack', weight: 1 }, { skill: 'timeMagic', weight: 2 }] },

  // --- 冥府の墓地（51〜59階） ---
  zombie:       { name: 'ゾンビ',         type: 'normal',  image: 'enemies/zombie.png',        idle: 'idle-sway',   face: '50% 20%', hp: 160, atk: 30, def: 18, spd: 60,  exp: 78,
                  traits: [{ type: 'reanimate', turns: 2, ratio: 0.3 }], ai: [{ skill: 'attack', weight: 1 }] },
  reaper:       { name: '死神', attackEffect: 'fx_slash', type: 'fast', image: 'enemies/reaper.png',     idle: 'idle-float',  face: '45% 30%', hp: 120, atk: 36, def: 14, spd: 110, exp: 86,
                  ai: [{ skill: 'deathScythe', weight: 100, when: { enemyHpBelow: 0.25, notBossBattle: true } }, { skill: 'attack', weight: 1 }] },
  graveCrow:    { name: '墓場のカラス',   type: 'fast',    image: 'enemies/grave_crow.png',    idle: 'idle-flap',   face: '60% 35%', hp: 80,  atk: 24, def: 10, spd: 170, exp: 76,
                  traits: [{ type: 'stealBuff' }], ai: [{ skill: 'attack', weight: 1 }] },
  lanternGhost: { name: 'ランタンゴースト', attackEffect: 'fx_fire', type: 'disrupt', image: 'enemies/lantern_ghost.png', idle: 'idle-float', face: '45% 30%', hp: 90, atk: 20, def: 12, spd: 100, exp: 78,
                  traits: [{ type: 'healDown', value: 0.5 }], ai: [{ skill: 'attack', weight: 1 }] },
  mummy:        { name: 'ミイラ',         type: 'disrupt', image: 'enemies/mummy.png',         idle: 'idle-sway',   face: '50% 20%', hp: 170, atk: 28, def: 22, spd: 75,  exp: 84,
                  ai: [{ skill: 'attack', weight: 2 }, { skill: 'bandageBind', weight: 1 }] },
  vampire:      { name: '吸血鬼',         type: 'normal',  image: 'enemies/vampire.png',       idle: 'idle-breath', face: '50% 20%', hp: 150, atk: 34, def: 20, spd: 120, exp: 92,
                  traits: [{ type: 'lifesteal', value: 0.5 }, { type: 'splitAt', below: 0.5, into: 'vampBat', count: 3, ratio: 0.3 }], ai: [{ skill: 'attack', weight: 1 }] },
  vampBat:      { name: 'コウモリ',       type: 'fast',    image: 'enemies/bat.svg',           idle: 'idle-flap',   face: '50% 45%', size: 'small', noElite: true, hp: 40, atk: 22, def: 8, spd: 160, exp: 6,
                  ai: [{ skill: 'attack', weight: 1 }] },
  ghost:        { name: 'ゴースト',       type: 'fast',    image: 'enemies/ghost.png',         idle: 'idle-float',  face: '50% 35%', hp: 100, atk: 28, def: 10, spd: 110, exp: 80,
                  traits: [{ type: 'phantom', value: 0.9 }], ai: [{ skill: 'attack', weight: 1 }] },
  tombGolem:    { name: '墓守ゴーレム',   type: 'tough',   image: 'enemies/tomb_golem.png',    idle: 'idle-heavy',  face: '50% 25%', hp: 240, atk: 26, def: 44, spd: 50,  exp: 90,
                  traits: [{ type: 'tombShield', value: 0.3 }], ai: [{ skill: 'attack', weight: 1 }] },
  cursedDoll:   { name: '呪いの人形',     type: 'disrupt', image: 'enemies/cursed_doll.png',   idle: 'idle-sway',   face: '50% 25%', hp: 110, atk: 22, def: 14, spd: 105, exp: 82,
                  traits: [{ type: 'curseLink', value: 0.5 }], ai: [{ skill: 'attack', weight: 1 }] },

  // --- 魔界の城（61〜69階） ---
  imp:          { name: 'インプ',         type: 'disrupt', image: 'enemies/imp.png',           idle: 'idle-flap',   face: '50% 30%', hp: 90,  atk: 30, def: 12, spd: 160, exp: 96,
                  ai: [{ skill: 'attack', weight: 2 }, { skill: 'mischief', weight: 2 }] },
  evilEye:      { name: '魔眼',           type: 'disrupt', image: 'enemies/evil_eye.png',      idle: 'idle-float',  face: '50% 40%', hp: 120, atk: 26, def: 16, spd: 110, exp: 98,
                  ai: [{ skill: 'attack', weight: 1 }, { skill: 'glare', weight: 2, when: { noOpponentStatus: 'sealed' } }] },
  hellhound:    { name: 'ヘルハウンド', attackEffect: 'fx_fire', type: 'fast', image: 'enemies/hellhound.png', idle: 'idle-breath', face: '80% 40%', hp: 150, atk: 38, def: 18, spd: 150, exp: 104,
                  traits: [{ type: 'packFury', rate: 1.3 }], ai: [{ skill: 'tripleBite', weight: 1 }] },
  demonKnight:  { name: '悪魔騎士', attackEffect: 'fx_slash', type: 'tough', image: 'enemies/demon_knight.png', idle: 'idle-heavy', face: '50% 20%', hp: 220, atk: 42, def: 36, spd: 90, exp: 112,
                  traits: [{ type: 'maxHpDown', rate: 0.9 }], ai: [{ skill: 'attack', weight: 1 }] },
  darkSlime:    { name: '闇スライム',     type: 'normal',  image: 'enemies/dark_slime.png',    idle: 'idle-puni',   face: '50% 60%', hp: 140, atk: 30, def: 20, spd: 80,  exp: 100,
                  traits: [{ type: 'splitOnHit', max: 4 }], ai: [{ skill: 'attack', weight: 1 }] },
  devilMerchant:{ name: '悪魔の商人',     type: 'treasure', image: 'enemies/devil_merchant.png', idle: 'idle-sway', face: '40% 30%', noElite: true, hp: 200, atk: 10, def: 30, spd: 100, exp: 60,
                  traits: [{ type: 'merchant', turns: 3, points: 10 }], ai: [{ skill: 'haggle', weight: 1 }] },
  minotaur:     { name: 'ミノタウロス', attackEffect: 'fx_slash', type: 'charge', image: 'enemies/minotaur.png', idle: 'idle-heavy', face: '45% 20%', hp: 280, atk: 46, def: 30, spd: 70, exp: 118,
                  ai: [{ skill: 'attack', weight: 2 }, { skill: 'rush', weight: 1 }] },
  grimoire:     { name: '魔導書',         type: 'disrupt', image: 'enemies/grimoire.png',      idle: 'idle-float',  face: '50% 30%', hp: 110, atk: 36, def: 12, spd: 120, exp: 104,
                  ai: [{ skill: 'darkSpell', weight: 1 }, { skill: 'mendPage', weight: 1 }, { skill: 'slowPage', weight: 1 }] },
  mirrorDemon:  { name: '鏡の悪魔',       type: 'special', image: 'enemies/mirror_demon.png',  idle: 'idle-float',  face: '50% 35%', noElite: true, hp: 160, atk: 30, def: 24, spd: 100, exp: 110,
                  traits: [{ type: 'mirrorCopy' }], ai: [{ skill: 'attack', weight: 1 }] },

  // --- 凍てつく氷河（71〜79階） ---
  snowmanSoldier: { name: '雪だるま兵', attackEffect: 'fx_slash', type: 'tough', image: 'enemies/snowman_soldier.png', idle: 'idle-heavy', face: '50% 30%', hp: 200, atk: 40, def: 30, spd: 80, exp: 132,
                    traits: [{ type: 'snowballSplit', into: 'snowball', count: 3, turns: 2, ratio: 0.5 }], ai: [{ skill: 'attack', weight: 1 }] },
  snowball:       { name: '雪玉', type: 'normal', image: 'enemies/snowman_soldier.png', idle: 'idle-puni', face: '50% 30%', size: 'small', noElite: true, hint: '雪だるま兵が倒れると出現',
                    hp: 50, atk: 16, def: 20, spd: 70, exp: 0, ai: [{ skill: 'attack', weight: 1 }] },
  frostWolf:      { name: '氷狼', attackEffect: 'fx_ice',   type: 'fast',  image: 'enemies/frost_wolf.png',   idle: 'idle-breath', face: '80% 35%', pack: 2, hp: 180, atk: 48, def: 22, spd: 160, exp: 136,
                    traits: [{ type: 'packSpeed', rate: 0.1 }], ai: [{ skill: 'attack', weight: 1 }] },
  penguinKnight:  { name: 'ペンギン騎士', attackEffect: 'fx_slash', type: 'normal', image: 'enemies/penguin_knight.png', idle: 'idle-sway', face: '50% 25%', hp: 220, atk: 44, def: 40, spd: 100, exp: 138,
                    traits: [{ type: 'iceSlide', chance: 0.3, amount: 0.5 }], ai: [{ skill: 'attack', weight: 1 }] },
  crystalGolem:   { name: '氷晶ゴーレム',   type: 'tough',   image: 'enemies/crystal_golem.png', idle: 'idle-heavy',  face: '50% 22%', hp: 320, atk: 40, def: 60, spd: 50,  exp: 146,
                    traits: [{ type: 'iceWall', every: 3 }], ai: [{ skill: 'attack', weight: 1 }] },
  snowSpirit:     { name: '雪の精',         type: 'disrupt', image: 'enemies/snow_spirit.png',   idle: 'idle-float',  face: '50% 25%', hp: 160, atk: 36, def: 20, spd: 120, exp: 134,
                    ai: [{ skill: 'attack', weight: 1 }, { skill: 'blizzard', weight: 2 }] },
  iceDrake:       { name: '氷竜の子', attackEffect: 'fx_ice', type: 'fast', image: 'enemies/ice_drake.png',    idle: 'idle-flap',   face: '50% 35%', hp: 200, atk: 50, def: 26, spd: 110, exp: 142,
                    ai: [{ skill: 'attack', weight: 2 }, { skill: 'freezingBreath', weight: 2 }] },
  mammoth:        { name: 'マンモス',       type: 'tough',   image: 'enemies/mammoth.png',       idle: 'idle-heavy',  face: '50% 40%', hp: 400, atk: 56, def: 44, spd: 60,  exp: 156,
                    ai: [{ skill: 'attack', weight: 2 }, { skill: 'quakeStomp', weight: 1 }] },
  yeti:           { name: 'イエティ',       type: 'charge',  image: 'enemies/yeti.png',          idle: 'idle-heavy',  face: '45% 30%', hp: 300, atk: 58, def: 30, spd: 90,  exp: 152,
                    traits: [{ type: 'enrageAt', below: 0.5, rate: 1.5 }], ai: [{ skill: 'attack', weight: 1 }, { skill: 'snowballThrow', weight: 2 }] },
  auroraWisp:     { name: 'オーロラの精',   type: 'heal',    image: 'enemies/aurora_wisp.png',   idle: 'idle-float',  face: '50% 50%', hp: 140, atk: 30, def: 16, spd: 140, exp: 140,
                    traits: [{ type: 'auroraBless', rate: 1.2 }], ai: [{ skill: 'attack', weight: 1 }] },
  iceBlock:       { name: '氷塊', type: 'tough', image: 'enemies/crystal_golem.png', idle: 'idle-heavy', face: '50% 22%', size: 'small', noElite: true, hint: '氷河の巨人の「氷漬け」で出現',
                    hp: 120, atk: 1, def: 30, spd: 60, exp: 0, traits: [{ type: 'noAct' }], ai: [{ skill: 'idle', weight: 1 }] },

  // --- 星の神殿（81〜89階） ---
  starShard:      { name: '星の欠片',       type: 'fast',    image: 'enemies/star_shard.png',    idle: 'idle-float',  face: '50% 45%', hp: 160, atk: 40, def: 20, spd: 150, exp: 160,
                    traits: [{ type: 'starBless' }], ai: [{ skill: 'attack', weight: 1 }] },
  meteorGolem:    { name: '隕石ゴーレム', attackEffect: 'fx_explosion', type: 'charge', image: 'enemies/meteor_golem.png', idle: 'idle-heavy', face: '50% 45%', hp: 360, atk: 60, def: 50, spd: 60, exp: 178,
                    ai: [{ skill: 'meteorFall', weight: 100, when: { everyNth: 3 } }, { skill: 'attack', weight: 1 }] },
  moonRabbit:     { name: '月兎兵',         type: 'heal',    image: 'enemies/moon_rabbit.png',   idle: 'idle-sway',   face: '50% 20%', hp: 240, atk: 52, def: 34, spd: 130, exp: 170,
                    ai: [{ skill: 'attack', weight: 2 }, { skill: 'mochi', weight: 2 }] },
  astrologer:     { name: '星読みの魔術師', attackEffect: 'fx_thunder', type: 'disrupt', image: 'enemies/astrologer.png', idle: 'idle-float', face: '50% 30%', hp: 200, atk: 56, def: 22, spd: 120, exp: 172,
                    ai: [{ skill: 'attack', weight: 2 }, { skill: 'starReading', weight: 2, when: { notStatus: 'foresight' } }] },
  mechaAngel:     { name: '機械天使', attackEffect: 'fx_thunder', type: 'normal', image: 'enemies/mecha_angel.png', idle: 'idle-float', face: '50% 22%', hp: 280, atk: 58, def: 44, spd: 110, exp: 180,
                    traits: [{ type: 'rebirth', ratio: 0.5, label: '再起動', text: 'は再起動した！' }], ai: [{ skill: 'attack', weight: 2 }, { skill: 'laser', weight: 1 }] },
  voidOrb:        { name: '虚無の卵',       type: 'charge',  image: 'enemies/void_orb.png',      idle: 'idle-float',  face: '50% 45%', hp: 260, atk: 0, def: 40, spd: 40, exp: 176,
                    traits: [{ type: 'hatch', turns: 5, into: 'voidSpawn' }], ai: [{ skill: 'idle', weight: 1 }] },
  voidSpawn:      { name: '虚神の眷属', attackEffect: 'fx_dark', type: 'charge', image: 'enemies/void_orb.png', idle: 'idle-float', face: '50% 45%', noElite: true, hint: '虚無の卵が孵化すると出現',
                    hp: 520, atk: 64, def: 80, spd: 80, exp: 0, ai: [{ skill: 'attack', weight: 2 }, { skill: 'voidTentacles', weight: 1 }] },
  rift:           { name: '次元の裂け目',   type: 'special', image: 'enemies/rift.png',          idle: 'idle-sway',   face: '50% 40%', hp: 300, atk: 0, def: 30, spd: 100, exp: 182,
                    traits: [{ type: 'riftLink' }], ai: [{ skill: 'riftSummon', weight: 1 }] },
  constellationBeast: { name: '星座の獣', type: 'tough',   image: 'enemies/constellation_beast.png', idle: 'idle-breath', face: '80% 35%', hp: 260, atk: 60, def: 26, spd: 140, exp: 184,
                    traits: [{ type: 'stars', count: 5, cut: 0.15 }], ai: [{ skill: 'attack', weight: 1 }] },
  timeWarden:     { name: '時空の番人',     type: 'tough',   image: 'enemies/time_warden.png',   idle: 'idle-heavy',  face: '50% 20%', hp: 340, atk: 54, def: 52, spd: 90,  exp: 186,
                    ai: [{ skill: 'reverseTime', weight: 100, when: { hpBelow: 0.5 } }, { skill: 'attack', weight: 1 }] },
  voidEye:        { name: '虚神の目', attackEffect: 'fx_dark', type: 'special', image: 'enemies/evil_eye.png', idle: 'idle-float', face: '50% 40%', size: 'small', noElite: true, hint: '星喰らいの虚神が呼び出す',
                    hp: 300, atk: 1, def: 30, spd: 60, exp: 0, traits: [{ type: 'noAct' }], ai: [{ skill: 'idle', weight: 1 }] },

  // --- 神々の塔の部位・呼び出し（part: true ＝ 小さいHPバーつきの別ターゲット。オートで優先して狙う）---
  // autoAvoid: true ならオートでは後回し（倒すと増えるヒュドラの首など）
  // coreLink: true ならダメージは本体に入る（機神のコア）
  krakenLeg:  { name: '足', type: 'special', image: 'enemies/kraken.png', idle: 'idle-sway', face: '50% 80%', size: 'small', part: true, noElite: true, hint: '深淵のクラーケンの部位',
                hp: 400, atk: 1, def: 40, spd: 60, exp: 0, traits: [{ type: 'noAct' }], ai: [{ skill: 'idle', weight: 1 }] },
  thunderDrum:{ name: '雷の太鼓', type: 'special', image: 'enemies/thunder_emperor.png', face: '50% 30%', hidden: true, noElite: true, hint: '雷帝の太鼓（行動順リストにだけ出る）',
                hp: 1, atk: 100, def: 1, spd: 100, exp: 0, traits: [{ type: 'oneShot' }], ai: [{ skill: 'drumStrike', weight: 1 }] },
  machineCore:{ name: 'コア', type: 'special', image: 'enemies/machine_god.png', idle: 'idle-breath', face: '50% 50%', size: 'small', part: true, coreLink: true, noElite: true, hint: '機神の部位',
                hp: 1, atk: 1, def: 1, spd: 60, exp: 0, traits: [{ type: 'noAct' }], ai: [{ skill: 'idle', weight: 1 }] },
  hydraHead:  { name: '首', attackEffect: 'fx_poison', type: 'special', image: 'enemies/hydra.png', idle: 'idle-sway', face: '50% 15%', size: 'small', part: true, autoAvoid: true, noElite: true, hint: '魔竜ヒュドラの部位',
                hp: 700, atk: 70, def: 40, spd: 110, exp: 0, traits: [{ type: 'hydraHead', max: 7 }], ai: [{ skill: 'headBite', weight: 1 }] },
  lightOrb:   { name: '光の球', type: 'special', image: 'enemies/origin.png', idle: 'idle-float', face: '50% 40%', size: 'small', part: true, noElite: true, hint: '終焉の神オリジンの部位',
                hp: 900, atk: 1, def: 50, spd: 60, exp: 0, traits: [{ type: 'noAct' }], ai: [{ skill: 'idle', weight: 1 }] },

  // --- ボス ---
  golem:   { name: 'ゴーレム王', attackEffect: 'fx_impact',   type: 'boss',    image: 'enemies/golem_king.svg',    idle: 'idle-heavy',  enrageBelow: 0.5, hp: 520, atk: 26, def: 22, spd: 85,  exp: 120, ai: [
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

  // 60階ボス
  lichKing: { name: '冥王リッチ', attackEffect: 'fx_dark', type: 'boss', image: 'enemies/lich_king.png', idle: 'idle-float', face: '45% 25%', hp: 2400, atk: 54, def: 42, spd: 115, exp: 2000,
    phases: [
      { below: 0.6, speech: 'その魂…いただくとしよう。', shake: true,
        message: '冥王リッチが「魂吸収」を使うようになった！' },
      { below: 0.3, speech: '死の宣告を受けよ…逃れられはせぬ。', shake: true, enrage: true,
        message: '冥王リッチが「死の宣告」を使うようになった！ 宣告されたら、3回行動する前にリッチを倒すか回復で解除しよう！' },
    ],
    ai: [
      { skill: 'soulArrow',     weight: 3 },
      { skill: 'raiseDead',     weight: 1 },
      { skill: 'soulDrain',     weight: 2, when: { hpBelow: 0.6 } },
      { skill: 'deathSentence', weight: 100, when: { hpBelow: 0.3, noOpponentStatus: 'doom' } },
    ] },

  // 70階 最終ボス
  demonLord: { name: '魔王ディアボロス', attackEffect: 'fx_slash', type: 'boss', image: 'enemies/demon_lord.png', idle: 'idle-heavy', face: '50% 25%', hp: 3200, atk: 62, def: 48, spd: 125, exp: 2800,
    phases: [
      { below: 0.7, speech: '映し身どもよ、我が前に立て！', shake: true, summon: { enemy: 'mirrorDemon', count: 2 } },
      { below: 0.4, speech: '時の流れなど、我が手の内よ…', shake: true, turnShuffle: true,
        message: '魔界の時が狂いはじめた！ 魔王が動くたびに行動順が入れ替わる！' },
      { below: 0.15, speech: '見るがいい…魔界の王の真の姿を！ すべてを終焉の炎で焼き尽くしてくれる！', shake: true, enrage: true,
        message: '魔王ディアボロスが最終形態になった！ 1ターンに2回行動し、攻撃が50%上がった！',
        buffs: [{ stat: 'atk', rate: 1.5 }], actionsPerTurn: 2, countdown: { skill: 'endFlame', turns: 3 } },
    ],
    ai: [
      { skill: 'demonSword', weight: 3 },
      { skill: 'darkWave',   weight: 2 },
    ] },

  // 80階ボス
  frostGiant: { name: '氷河の巨人', attackEffect: 'fx_ice', type: 'boss', image: 'enemies/frost_giant.png', idle: 'idle-heavy', face: '50% 25%', hp: 4200, atk: 70, def: 58, spd: 100, exp: 3800,
    phases: [
      { below: 0.6, speech: '凍りつけ…永遠にな。', shake: true,
        message: '氷河の巨人が「氷漬け」を使うようになった！ 氷塊を壊せば仲間を助けられる！' },
      { below: 0.25, speech: 'すべてを止めてやろう…絶対零度でな！', shake: true, enrage: true,
        message: '氷河の巨人が絶対零度の力をためはじめた！ 凍結・氷漬けの仲間には効かない！',
        countdown: { skill: 'absoluteZero', turns: 3 } },
    ],
    ai: [
      { skill: 'iceClub',      weight: 3 },
      { skill: 'glacierPress', weight: 2 },
      { skill: 'iceEntomb',    weight: 3, when: { hpBelow: 0.6, noOpponentStatus: 'entombed' } },
    ] },

  // 90階ボス
  voidGod: { name: '星喰らいの虚神', attackEffect: 'fx_dark', type: 'boss', image: 'enemies/void_god.png', idle: 'idle-float', face: '50% 45%', hp: 5500, atk: 78, def: 60, spd: 120, exp: 5000,
    phases: [
      { below: 0.6, speech: '星々よ、我がもとへ墜ちよ…重力崩壊！', shake: true,
        message: '重力崩壊！ 味方全員の速度が半分になった！（3ターン）',
        debuffAll: { stat: 'spd', rate: 0.5, turns: 3 } },
      { below: 0.3, speech: '見よ…七つの眼が開く。', shake: true, enrage: true,
        message: '虚神の目が7つ開いた！ 目を全部壊すまで本体には攻撃が効かない！ 目が残っていると毎ターン全体攻撃が来る！',
        eyes: { enemy: 'voidEye', count: 7 } },
    ],
    ai: [
      { skill: 'eyeBeam',       weight: 100, when: { hasStatus: 'voidVeil' } },
      { skill: 'voidTentacles', weight: 3, when: { notStatus: 'voidVeil' } },
      { skill: 'starEater',     weight: 2, when: { notStatus: 'voidVeil' } },
    ] },

  // ---- 神々の塔（91〜99階は1階に1体ずつボス、100階は終焉の神） ----
  swordSaint: { name: '剣聖の亡霊', attackEffect: 'fx_slash', type: 'boss', image: 'enemies/sword_saint.png', idle: 'idle-float', face: '50% 25%', hp: 6000, atk: 90, def: 50, spd: 170, exp: 6000,
    traits: [{ type: 'iaiCounter', power: 0.8 }],
    ai: [{ skill: 'attack', weight: 2 }, { skill: 'issen', weight: 1 }] },
  infernoDragon: { name: '炎獄竜', attackEffect: 'fx_fire', type: 'boss', image: 'enemies/inferno_dragon.png', idle: 'idle-heavy', face: '50% 25%', hp: 7000, atk: 96, def: 60, spd: 120, exp: 6200,
    traits: [{ type: 'rampUp', stat: 'atk', rate: 1.05, limit: 3 }],
    ai: [{ skill: 'dragonClaw', weight: 2 }, { skill: 'hellfire', weight: 2 }] },
  kraken: { name: '深淵のクラーケン', type: 'boss', image: 'enemies/kraken.png', idle: 'idle-sway', face: '50% 35%', hp: 7500, atk: 88, def: 56, spd: 100, exp: 6400,
    traits: [{ type: 'startParts', enemy: 'krakenLeg', count: 8, regrow: 3 }],
    ai: [{ skill: 'tentacleBarrage', weight: 3, when: { hasParts: true } }, { skill: 'krakenSlam', weight: 1 }] },
  thunderEmperor: { name: '雷帝', attackEffect: 'fx_thunder', type: 'boss', image: 'enemies/thunder_emperor.png', idle: 'idle-float', face: '50% 30%', hp: 7000, atk: 100, def: 56, spd: 150, exp: 6600,
    ai: [{ skill: 'thunderDrums', weight: 3 }, { skill: 'thunderSpear', weight: 2 }, { skill: 'attack', weight: 1 }] },
  nineTails: { name: '九尾の狐', attackEffect: 'fx_fire', type: 'boss', image: 'enemies/nine_tails.png', idle: 'idle-breath', face: '50% 25%', hp: 6500, atk: 92, def: 48, spd: 180, exp: 6800,
    traits: [{ type: 'nineLives', count: 9, hpCut: 0.1 }],
    ai: [{ skill: 'foxBite', weight: 2 }, { skill: 'foxFire', weight: 2 }] },
  machineGod: { name: '機神', type: 'boss', image: 'enemies/machine_god.png', idle: 'idle-heavy', face: '50% 25%', hp: 9000, atk: 100, def: 80, spd: 90, exp: 7200,
    traits: [{ type: 'coreBody' }, { type: 'startParts', enemy: 'machineCore', count: 1 }],
    ai: [{ skill: 'coreLaser', weight: 100, when: { everyNth: 3 } }, { skill: 'mechPunch', weight: 2 }, { skill: 'laser', weight: 1 }] },
  hydra: { name: '魔竜ヒュドラ', attackEffect: 'fx_poison', type: 'boss', image: 'enemies/hydra.png', idle: 'idle-heavy', face: '50% 15%', hp: 8000, atk: 96, def: 58, spd: 110, exp: 7400,
    traits: [{ type: 'startParts', enemy: 'hydraHead', count: 3 }],
    ai: [{ skill: 'dragonClaw', weight: 2 }, { skill: 'hydraBreath', weight: 1 }] },
  fallenAngel: { name: '堕天使', attackEffect: 'fx_dark', type: 'boss', image: 'enemies/fallen_angel.png', idle: 'idle-float', face: '50% 25%', hp: 8500, atk: 104, def: 62, spd: 160, exp: 7800,
    ai: [{ skill: 'inversion', weight: 3, when: { noOpponentStatus: 'inverted' } }, { skill: 'fallenSpear', weight: 3 }, { skill: 'darkFeathers', weight: 2 }] },
  chronos: { name: '時の神クロノス', attackEffect: 'fx_time', type: 'boss', image: 'enemies/chronos.png', idle: 'idle-float', face: '50% 30%', hp: 9500, atk: 100, def: 66, spd: 140, exp: 8400,
    traits: [{ type: 'chronoControl' }, { type: 'chronoRewind', below: 0.3 }],
    ai: [{ skill: 'chronoBlade', weight: 3 }, { skill: 'timeWave', weight: 2 }] },

  // 100階 真の最終ボス
  origin: { name: '終焉の神オリジン', attackEffect: 'fx_explosion', type: 'boss', image: 'enemies/origin.png', idle: 'idle-float', face: '50% 25%', hp: 15000, atk: 120, def: 80, spd: 160, exp: 20000,
    phases: [
      { below: 0.75, speech: 'この世界の理など、我が手でいくらでも書き換えられる。', shake: true,
        message: '世界改変がはじまった！ オリジンが3回動くごとにルールが変わる！', worldRule: { every: 3 } },
      { below: 0.5, speech: '四つの光よ、我を護れ。', shake: true,
        message: '4つの腕に光の球が宿った！ 球を全部壊すまで本体にダメージが通らない！',
        parts: { enemy: 'lightOrb', count: 4, shield: true } },
      { below: 0.25, speech: 'すべては無へ還る…終焉の時を数えよ。', shake: true, enrage: true,
        message: '終焉のカウントダウンが始まった！ 0になると全滅する！ 1ターンに2回行動し、攻撃が50%上がった！',
        buffs: [{ stat: 'atk', rate: 1.5 }], actionsPerTurn: 2, countdown: { skill: 'oblivion', turns: 10 } },
    ],
    ai: [
      { skill: 'genesisLight',   weight: 3 },
      { skill: 'summonPastBoss', weight: 2, when: { noSummonAlive: true } },
      { skill: 'originStrike',   weight: 2 },
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
    { from: 101, min: 3, max: 4 },   // 無限モード
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
    60: ['lichKing'],
    70: ['demonLord'],
    80: ['frostGiant'],
    90: ['voidGod'],
    // 神々の塔：91〜99階は1階に1体ずつボス
    91: ['swordSaint'], 92: ['infernoDragon'], 93: ['kraken'], 94: ['thunderEmperor'], 95: ['nineTails'],
    96: ['machineGod'], 97: ['hydra'], 98: ['fallenAngel'], 99: ['chronos'],
    100: ['origin'],
  },
  // 神々の塔：この範囲の階はすべてボス階（クリアでチェックポイント更新＋上級アイテム）
  // 全滅するたびに、次からその階のボスのHPが wipeHpCut ずつ下がる（最大 wipeHpCutMax まで。救済措置）
  tower: { from: 91, to: 100, wipeHpCut: 0.1, wipeHpCutMax: 0.5 },
  // 「第○部クリア」の演出だけ出して、そのまま先へ進む階
  partClears: {
    50: { title: '第一部 クリア！', sub: '― 物語は冥府の底へ ―', boss: '天空王ゼニス',
          text: '天空王ゼニスは光の中に消えた。<br>しかしその瞬間、地の底から冷たい風が吹き上げてきた…。',
          note: '51階からは「冥府の墓地」と「魔界の城」。' },
    70: { title: '第二部 クリア！', sub: '― 物語は氷と星の彼方へ ―', boss: '魔王ディアボロス',
          text: '魔王ディアボロスは終焉の炎とともに崩れ落ちた。<br>だが、空の彼方で、凍てつく風と星々がざわめいている…。',
          note: '71階からは「凍てつく氷河」「星の神殿」、そして「神々の塔」。' },
  },
  finalFloor: 100,                 // エンディングの階（終焉の神を倒すと真のエンディング。そのあとも冒険は続けられる）
  endlessFrom: 101,                // この階から無限モード（決まったエリアが終わった次の階）
  // 無限モードのボス階に、順番に登場するボス（階層補正で強くなって出る）
  endlessBosses: ['golem', 'dragon', 'ignis', 'leviathan', 'zenith', 'lichKing', 'demonLord', 'frostGiant', 'voidGod',
    'swordSaint', 'infernoDragon', 'kraken', 'thunderEmperor', 'nineTails', 'machineGod', 'hydra', 'fallenAngel', 'chronos', 'origin'],
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
    // 冥府の墓地
    { from: 51, to: 60, add: ['zombie', 'ghost', 'graveCrow', 'lanternGhost'] },
    { from: 53, to: 60, add: ['mummy', 'cursedDoll', 'reaper'] },
    { from: 56, to: 60, add: ['vampire', 'tombGolem'] },
    // 魔界の城
    { from: 61, to: 70, add: ['imp', 'evilEye', 'darkSlime', 'grimoire'] },
    { from: 61,         rare: { devilMerchant: 0.06 } },
    { from: 63, to: 70, add: ['hellhound', 'demonKnight'] },
    { from: 66, to: 70, add: ['minotaur', 'mirrorDemon'] },
    // 凍てつく氷河
    { from: 71, to: 80, add: ['snowmanSoldier', 'frostWolf', 'penguinKnight', 'snowSpirit'] },
    { from: 73, to: 80, add: ['crystalGolem', 'iceDrake', 'auroraWisp'] },
    { from: 76, to: 80, add: ['mammoth', 'yeti'] },
    // 星の神殿
    { from: 81, to: 90, add: ['starShard', 'moonRabbit', 'astrologer', 'meteorGolem'] },
    { from: 83, to: 90, add: ['mechaAngel', 'constellationBeast', 'timeWarden'] },
    { from: 86, to: 90, add: ['voidOrb', 'rift'] },
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
// image: バトル画面いっぱいに出す背景画像（1280×720）
// bg: 画像を読み込むまでの下地の色（CSS） / text: 背景の上の文字の色
// images: 無限モード用。10階ごとに順番に使う
// ---------------------------------------------------------------------
const AREAS = [
  { from: 1,  name: '始まりの森',     image: 'backgrounds/bg_forest.jpg',  bg: 'linear-gradient(180deg, #8ac8f0 0%, #6ab05a 100%)', text: '#1e3a20' },
  { from: 11, name: '古の地下迷宮',   image: 'backgrounds/bg_dungeon.jpg', bg: 'linear-gradient(180deg, #2e2446 0%, #19152a 100%)', text: '#b8a8e0' },
  { from: 21, name: '灼熱の火山',     image: 'backgrounds/bg_volcano.jpg', bg: 'linear-gradient(180deg, #6e1a10 0%, #b8441a 60%, #e07a2a 100%)', text: '#ffe2c4' },
  { from: 31, name: '深海の神殿',     image: 'backgrounds/bg_sea.jpg',     bg: 'linear-gradient(180deg, #0a2350 0%, #12477e 55%, #1f73a8 100%)', text: '#cfe8ff' },
  { from: 41, name: '天空の城',       image: 'backgrounds/bg_sky.jpg',     bg: 'linear-gradient(180deg, #f6fbff 0%, #d4ecfb 50%, #9fd4f2 100%)', text: '#24476a' },
  { from: 51, name: '冥府の墓地',     image: 'backgrounds/bg_graveyard.jpg', bg: 'linear-gradient(180deg, #1c1630 0%, #2c2442 60%, #3a3446 100%)', text: '#ddd6f5' },
  { from: 61, name: '魔界の城',       image: 'backgrounds/bg_demon.jpg',     bg: 'linear-gradient(180deg, #2a0c14 0%, #3e1020 60%, #24101a 100%)', text: '#ffd6d6' },
  { from: 71, name: '凍てつく氷河',   image: 'backgrounds/bg_glacier.jpg', bg: 'linear-gradient(180deg, #cfe6f5 0%, #9cc7e4 60%, #6f9fc4 100%)', text: '#16324a' },
  { from: 81, name: '星の神殿',       image: 'backgrounds/bg_cosmos.jpg',  bg: 'linear-gradient(180deg, #0b0a24 0%, #1d1650 60%, #2c1f6a 100%)', text: '#e0dcff' },
  { from: 91, name: '神々の塔',       image: 'backgrounds/bg_tower.jpg',   bg: 'linear-gradient(180deg, #fbe7c0 0%, #f4d79a 60%, #e8c477 100%)', text: '#4a3410' },
  { from: 101, name: '無限回廊',      bg: 'linear-gradient(180deg, #22113a 0%, #3c1a52 60%, #5a2470 100%)', text: '#e4ccff',
    images: ['backgrounds/bg_forest.jpg', 'backgrounds/bg_dungeon.jpg', 'backgrounds/bg_volcano.jpg', 'backgrounds/bg_sea.jpg', 'backgrounds/bg_sky.jpg',
      'backgrounds/bg_graveyard.jpg', 'backgrounds/bg_demon.jpg', 'backgrounds/bg_glacier.jpg', 'backgrounds/bg_cosmos.jpg', 'backgrounds/bg_tower.jpg'] },
];

// ---------------------------------------------------------------------
// 無限モード（100階の終焉の神を倒したあと、101階から）
// 敵は1〜90階の全エリアの敵からランダム。10階ごとにボス階（DUNGEON.endlessBosses を順番に）
// ---------------------------------------------------------------------
const ENDLESS = {
  rewardEvery: 10,   // 何階ごとに報酬か（ボス階と同じ）
  points: 30,        // 報酬のポイント
  bossChoices: 2,    // 報酬の上級アイテム選択：この数の上級アイテムから1つ選ぶ
};

// ---------------------------------------------------------------------
// 放置（ゲームを閉じていた時間）の設定
// ---------------------------------------------------------------------
const IDLE = {
  maxHours: 8,        // 経験値がたまる上限時間
  expPerMinute: 1,    // 1分あたりの経験値（最高到達階に応じて DUNGEON.expPerFloor の割合で増える）
  minMinutes: 1,      // これ未満の時間なら何も起きない
};
