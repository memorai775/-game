// =====================================================================
// screen.js  ―  画面まわり（ステージの拡大縮小・縦横の切り替え・一時停止）
// ゲームは「ステージ」に描き、画面の大きさに合わせて拡大縮小する。
//   横長の画面 … 960×540（16:9）のレイアウト
//   縦長の画面 … 540×960（9:16）のレイアウト（スマホを縦に持ったとき）
// main.js より先に読み込む（Game.pause / whenRunning を main.js が使う）
// =====================================================================
'use strict';

const STAGE_LANDSCAPE = { w: 960, h: 540 };
const STAGE_PORTRAIT  = { w: 540, h: 960 };

// ---------------------------------------------------------------------
// 一時停止（理由ごとに止める。全部の理由が解除されたら再開）
// ---------------------------------------------------------------------
const Game = {
  pauseReasons: new Set(),
  waiters: [],

  get paused() { return this.pauseReasons.size > 0; },

  pause(reason) {
    this.pauseReasons.add(reason);
    document.getElementById('stage').classList.add('paused'); // CSSアニメーションも止める
  },

  resume(reason) {
    this.pauseReasons.delete(reason);
    if (this.paused) return;
    document.getElementById('stage').classList.remove('paused');
    const list = this.waiters;
    this.waiters = [];
    list.forEach(fn => fn());
  },
};

// 一時停止中なら再開まで待つ Promise（止まっていなければすぐ進む）
function whenRunning() {
  return Game.paused ? new Promise(resolve => Game.waiters.push(resolve)) : Promise.resolve();
}

// ---------------------------------------------------------------------
// ステージを画面いっぱい（縦横比はそのまま）に拡大縮小する
// 画面が縦長なら縦レイアウト、横長なら横レイアウトに切り替える
// ---------------------------------------------------------------------
let stageScale = 1;

function isPortraitLayout() {
  return document.getElementById('stage').classList.contains('portrait');
}

function fitStage() {
  const stage = document.getElementById('stage');
  const w = window.innerWidth;
  const h = window.innerHeight;
  const portrait = h > w;
  const size = portrait ? STAGE_PORTRAIT : STAGE_LANDSCAPE;
  const changed = stage.classList.contains('portrait') !== portrait;
  stage.classList.toggle('portrait', portrait);
  stage.classList.toggle('landscape', !portrait);
  stage.style.width = `${size.w}px`;
  stage.style.height = `${size.h}px`;
  stageScale = Math.min(w / size.w, h / size.h);
  stage.style.transform = `scale(${stageScale})`;
  stage.style.left = `${(w - size.w * stageScale) / 2}px`;
  stage.style.top = `${(h - size.h * stageScale) / 2}px`;
  // 縦横が切り替わったら、キャラの近くに出しているパネルは閉じる（位置がずれるため）
  if (changed && typeof Overlay !== 'undefined') Overlay.closeAll();
}

function initScreen() {
  fitStage();
  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', () => setTimeout(fitStage, 200));
}

initScreen();
