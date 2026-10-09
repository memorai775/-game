// =====================================================================
// effects.js  ―  スキルのエフェクト（effects/ の画像を CSS アニメーションで動かす）
// ・対象のキャラの上に重ねて表示し、アニメーションが終わったら消す
// ・戦闘速度（×2・×4）に合わせて速くなる（CSS の --speed と scaledDelay）
// ・どのスキルにどのエフェクトを使うかは data.js のスキルの effect / キャラの attackEffect
// 見た目（動き方）は style.css の .fx-〇〇
// =====================================================================
'use strict';

// エフェクトの種類：表示時間（×1 のとき）と、攻撃者から飛んでいくもの（fly）か
const FX = {
  fx_slash:     { ms: 300 },
  fx_fire:      { ms: 500, fly: true },
  fx_explosion: { ms: 500, size: 1.4 },
  fx_thunder:   { ms: 550 },
  fx_ice:       { ms: 600 },
  fx_heal:      { ms: 800 },
  fx_buff:      { ms: 700 },
  fx_debuff:    { ms: 700 },
  fx_poison:    { ms: 700 },
  fx_impact:    { ms: 200, shake: true },
  fx_arrow:     { ms: 350, fly: true, angle: -24 }, // 画像の矢は右上（約-24度）を向いている
  fx_shield:    { ms: 800, size: 1.3 },
  fx_music:     { ms: 1000 },
  fx_time:      { ms: 700 },
  fx_dark:      { ms: 700 },
  fx_crit:      { ms: 650, size: 1.3 },
};

const FX_SIZE = 110; // エフェクトの基本の大きさ（ステージ上の px）

const Fx = {
  layer: document.getElementById('fx-layer'),

  // 通常攻撃・スキルに使うエフェクト名（無ければ null）
  forSkill(user, skillId) {
    if (skillId === 'attack') return user.attackEffect || (user.side === 'ally' ? 'fx_slash' : 'fx_impact');
    return (SKILLS[skillId] && SKILLS[skillId].effect) || null;
  },

  // 状態異常にかかったときのエフェクト
  forStatus(statusId) {
    return {
      burn: 'fx_fire', freeze: 'fx_ice', poison: 'fx_poison', sleep: 'fx_music', charm: 'fx_music',
      ink: 'fx_dark', vulnerable: 'fx_dark', focus: 'fx_buff', counterStance: 'fx_shield',
      barrier: 'fx_shield', burrowed: 'fx_shield', submerged: 'fx_shield', shelled: 'fx_shield', stone: 'fx_shield',
      flying: 'fx_buff', puffed: 'fx_shield',
    }[statusId] || 'fx_poison';
  },

  // キャラの立ち絵の中心（ステージ上の座標）
  centerOf(unit) {
    if (!unit || !unit.dom) return null;
    const box = unit.dom.card.querySelector('.sprite-box');
    if (!box || !box.offsetParent) return null; // 画面に出ていない
    const r = Overlay.stageRect(box);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },

  // エフェクトを出す。targets：対象（全員に同時）、from：攻撃者（飛んでいくエフェクト用）
  play(name, targets, from = null) {
    const def = FX[name];
    if (!def || !this.layer) return;
    const start = def.fly ? this.centerOf(from) : null;
    for (const t of targets) {
      const c = this.centerOf(t);
      if (!c) continue;
      const img = document.createElement('img');
      img.src = `effects/${name}.png`;
      img.alt = '';
      img.className = `fx fx-${name.slice(3)}`;
      const size = FX_SIZE * (def.size || 1);
      img.style.width = img.style.height = `${size}px`;
      img.style.left = `${c.x - size / 2}px`;
      img.style.top = `${c.y - size / 2}px`;
      if (def.fly) {
        // 攻撃者の位置から対象へ飛ぶ（CSS 側で --sx/--sy から 0 へ動かす）
        const s = start || { x: c.x, y: c.y + 120 };
        const dx = s.x - c.x;
        const dy = s.y - c.y;
        img.style.setProperty('--sx', `${dx}px`);
        img.style.setProperty('--sy', `${dy}px`);
        const travel = Math.atan2(-dy, -dx) * 180 / Math.PI; // 進む向き
        img.style.setProperty('--rot', `${travel - (def.angle || 0)}deg`);
      }
      this.layer.appendChild(img);
      setTimeout(() => img.remove(), scaledDelay(def.ms) + 50);
    }
    if (def.shake) this.shakeSmall();
  },

  // 会心：会心のエフェクト＋画面全体が一瞬白く光る
  crit(target) {
    this.play('fx_crit', [target]);
    const flash = document.getElementById('flash');
    if (!flash) return;
    flash.classList.remove('on');
    void flash.offsetWidth;
    flash.classList.add('on');
  },

  // 打撃：バトル画面を小さく揺らす
  shakeSmall() {
    const main = document.getElementById('battle-main');
    main.classList.remove('anim-shake-small');
    void main.offsetWidth;
    main.classList.add('anim-shake-small');
    setTimeout(() => main.classList.remove('anim-shake-small'), scaledDelay(200) + 30);
  },
};
