// =====================================================================
// screen.js  ―  画面まわり（横長16:9の拡大縮小・縦向き時の一時停止）
// ゲームは 960×540 の「ステージ」に描き、画面の大きさに合わせて拡大縮小する。
// main.js より先に読み込む（Game.pause / whenRunning を main.js が使う）
// =====================================================================
'use strict';

const STAGE_W = 960;
const STAGE_H = 540;

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
// ステージを画面いっぱい（16:9のまま）に拡大縮小する
// ---------------------------------------------------------------------
function fitStage() {
  const stage = document.getElementById('stage');
  const w = window.innerWidth;
  const h = window.innerHeight;
  const scale = Math.min(w / STAGE_W, h / STAGE_H);
  stage.style.transform = `scale(${scale})`;
  stage.style.left = `${(w - STAGE_W * scale) / 2}px`;
  stage.style.top = `${(h - STAGE_H * scale) / 2}px`;
}

// ---------------------------------------------------------------------
// スマホが縦向きのときは「横向きにしてください」を出して一時停止
// （パソコンは縦長のウィンドウでも止めない。上下に余白が出るだけ）
// ---------------------------------------------------------------------
const isTouch = window.matchMedia('(pointer: coarse)');
const isPortrait = window.matchMedia('(orientation: portrait)');

function checkOrientation() {
  const needRotate = isTouch.matches && isPortrait.matches;
  document.getElementById('rotate-overlay').classList.toggle('hidden', !needRotate);
  if (needRotate) Game.pause('orientation');
  else Game.resume('orientation');
}

// 「全画面で遊ぶ」：全画面にして横向きに固定（Android の Chrome など。iPhone は非対応）
async function enterFullscreenLandscape() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch (e) {
    // 対応していない端末では何もしない（手で横向きにしてもらう）
  }
}

function initScreen() {
  fitStage();
  checkOrientation();
  window.addEventListener('resize', () => { fitStage(); checkOrientation(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { fitStage(); checkOrientation(); }, 200));
  isPortrait.addEventListener('change', checkOrientation);
  document.getElementById('fullscreen-btn').addEventListener('click', enterFullscreenLandscape);
}

initScreen();
