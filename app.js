'use strict';
/* Stop Motion Studio — runs entirely in the browser. Frames autosave to IndexedDB. */

const $ = id => document.getElementById(id);
const els = {
  video: $('video'), onion: $('onion'), review: $('review'), grid: $('grid'), flash: $('flash'),
  msg: $('msg'), status: $('status'), timeline: $('timeline'),
  fps: $('fps'), fpsVal: $('fpsVal'), onionSlider: $('onionSlider'), onionVal: $('onionVal'),
  chkGrid: $('chkGrid'), chkLoop: $('chkLoop'), camSel: $('cameraSelect'),
  overlay: $('overlay'), overlayText: $('overlayText'), overlayBar: $('overlayBar'),
};

const W = 1280, H = 720;                    // output resolution
const state = {
  frames: [],          // {id, blob, url}
  sel: -1,             // selected frame index; -1 = live camera
  playing: false,
  playTimer: null,
  stream: null,
};

/* ---------- storage (IndexedDB) ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('stopmotion', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('project');
      r.onsuccess = () => { DB.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  put(val) {
    return new Promise((res, rej) => {
      const tx = DB.db.transaction('project', 'readwrite');
      tx.objectStore('project').put(val, 'current');
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  },
  get() {
    return new Promise((res, rej) => {
      const q = DB.db.transaction('project').objectStore('project').get('current');
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  },
};
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!DB.db) return;
    DB.put({ fps: +els.fps.value, frames: state.frames.map(f => ({ id: f.id, blob: f.blob })) })
      .catch(e => setStatus('Could not autosave: ' + e));
  }, 300);
}

/* ---------- helpers ---------- */
let uid = 0;
const newId = () => Date.now().toString(36) + (uid++);
function setStatus(t) { els.status.textContent = t; }
function showMsg(t) { els.msg.hidden = !t; els.msg.textContent = t || ''; }
const inFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();
// Inside an embed (e.g. Google Sites) the camera is usually blocked: offer to open the app in its own tab.
function showOpenInTab() {
  els.msg.hidden = false;
  els.msg.innerHTML = '<div><p>The camera can\'t be used inside this embedded page.</p>' +
    '<button class="primary" id="btnOpenTab" style="font-size:18px;padding:14px 22px">Open Stop Motion Studio in a new tab</button></div>';
  $('btnOpenTab').onclick = () => window.open(location.href, '_blank', 'noopener');
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function makeFrame(blob) { return { id: newId(), blob, url: URL.createObjectURL(blob) }; }
function freeFrame(f) { URL.revokeObjectURL(f.url); }

/* ---------- camera ---------- */
async function startCamera(deviceId) {
  if (state.stream) state.stream.getTracks().forEach(t => t.stop());
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (inFrame) return showOpenInTab();
    showMsg('This browser cannot use the camera here. The app must be opened from an https:// address. You can still use "Add photos".');
    return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: W }, height: { ideal: H }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
      audio: false,
    });
    els.video.srcObject = state.stream;
    showMsg('');
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const current = state.stream.getVideoTracks()[0].getSettings().deviceId;
    els.camSel.innerHTML = '';
    devices.forEach((d, i) => {
      const o = new Option(d.label || 'Camera ' + (i + 1), d.deviceId);
      o.selected = d.deviceId === current;
      els.camSel.add(o);
    });
    setStatus('Camera ready. Press Space to capture.');
  } catch (e) {
    const denied = e.name === 'NotAllowedError';
    if (denied && inFrame) { setStatus('No camera'); return showOpenInTab(); }
    showMsg(denied
      ? 'Camera permission was blocked. Click the camera icon in the address bar to allow it, then reload. (Your school may need to allow it for this site.) You can still use "Add photos".'
      : 'No camera could be started (' + e.name + '). You can still use "Add photos".');
    setStatus('No camera');
  }
}

function grabFrame() {
  const v = els.video;
  if (!v.videoWidth) return Promise.resolve(null);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  drawContain(c.getContext('2d'), v, v.videoWidth, v.videoHeight);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
}
// Fit source into W×H canvas without stretching (black bars if needed)
function drawContain(ctx, src, sw, sh) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const s = Math.min(W / sw, H / sh), dw = sw * s, dh = sh * s;
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/* ---------- actions ---------- */
async function capture() {
  if (state.playing) stopPlay();
  if (state.sel !== -1) { select(-1); }
  const blob = await grabFrame();
  if (!blob) { setStatus('Camera is not ready yet.'); return; }
  state.frames.push(makeFrame(blob));
  els.flash.classList.add('on'); requestAnimationFrame(() => els.flash.classList.remove('on'));
  render(); save();
  setStatus(`Frame ${state.frames.length} captured`);
}

function select(i) {
  state.sel = i;
  render();
}
function deleteSel() {
  if (state.sel < 0) return;
  const [f] = state.frames.splice(state.sel, 1); freeFrame(f);
  state.sel = Math.min(state.sel, state.frames.length - 1);
  render(); save();
}
function dupSel() {
  if (state.sel < 0) return;
  const src = state.frames[state.sel];
  state.frames.splice(state.sel + 1, 0, makeFrame(src.blob));
  state.sel++; render(); save();
}
function moveSel(d) {
  const i = state.sel, j = i + d;
  if (i < 0 || j < 0 || j >= state.frames.length) return;
  [state.frames[i], state.frames[j]] = [state.frames[j], state.frames[i]];
  state.sel = j; render(); save();
}
function step(d) {
  const n = state.frames.length; if (!n) return;
  let i = state.sel === -1 ? (d < 0 ? n - 1 : -1) : state.sel + d;
  if (i >= n) i = -1;                         // past the end → live
  if (i < -1) i = -1;
  select(i);
}
async function newProject() {
  if (state.frames.length && !confirm('Start a new movie? This deletes all current frames.')) return;
  stopPlay(); state.frames.forEach(freeFrame); state.frames = []; state.sel = -1;
  render(); save();
}
async function importPhotos(files) {
  showOverlay('Adding photos…', 0);
  let k = 0;
  for (const file of files) {
    try {
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      drawContain(c.getContext('2d'), bmp, bmp.width, bmp.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
      state.frames.push(makeFrame(blob));
    } catch { /* skip unreadable file */ }
    showOverlay('Adding photos…', ++k / files.length);
  }
  hideOverlay(); render(); save();
}

/* ---------- playback ---------- */
function play() {
  if (!state.frames.length) return;
  if (state.playing) return stopPlay();
  state.playing = true;
  let i = state.sel >= 0 && state.sel < state.frames.length - 1 ? state.sel : 0;
  const tick = () => {
    if (!state.playing) return;
    state.sel = i; render();
    i++;
    if (i >= state.frames.length) {
      if (els.chkLoop.checked) i = 0;
      else { state.playTimer = setTimeout(stopPlay, 1000 / +els.fps.value); return; }
    }
    state.playTimer = setTimeout(tick, 1000 / +els.fps.value);
  };
  tick();
}
function stopPlay() {
  state.playing = false; clearTimeout(state.playTimer); render();
}

/* ---------- export ---------- */
async function exportVideo() {
  if (!state.frames.length) { alert('Capture some frames first!'); return; }
  if (typeof MediaRecorder === 'undefined') { alert('Video export is not supported in this browser.'); return; }
  stopPlay();
  // Prefer MP4 (H.264) so the movie opens in common video editors; fall back to WebM on older browsers.
  const mime = ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4',
    'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const fps = +els.fps.value, dt = 1000 / fps;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const rec = new MediaRecorder(c.captureStream(fps), { mimeType: mime, videoBitsPerSecond: 6e6 });
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  showOverlay('Making your movie…', 0);
  rec.start();
  for (let i = 0; i < state.frames.length; i++) {
    const bmp = await createImageBitmap(state.frames[i].blob);
    const t0 = performance.now();
    ctx.drawImage(bmp, 0, 0, W, H); bmp.close();
    showOverlay('Making your movie…', (i + 1) / state.frames.length);
    await wait(Math.max(0, dt - (performance.now() - t0)));
  }
  await wait(dt);
  rec.stop(); await done;
  hideOverlay();
  const url = URL.createObjectURL(new Blob(chunks, { type: mime.split(';')[0] }));
  const a = document.createElement('a');
  a.href = url; a.download = 'my-stop-motion.' + ext; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  setStatus(`Movie saved to your Downloads folder (my-stop-motion.${ext}).`);
}
function showOverlay(t, p) { els.overlay.hidden = false; els.overlayText.textContent = t; els.overlayBar.value = p; }
function hideOverlay() { els.overlay.hidden = true; }

/* ---------- rendering ---------- */
function render() {
  const n = state.frames.length, live = state.sel === -1;
  // stage
  if (live) {
    els.review.style.display = 'none';
    els.video.style.visibility = 'visible';
    const last = state.frames[n - 1];
    els.onion.style.display = last ? 'block' : 'none';
    if (last) els.onion.src = last.url;
  } else {
    els.review.style.display = 'block';
    els.review.src = state.frames[state.sel].url;
    els.onion.style.display = 'none';
  }
  // timeline
  els.timeline.innerHTML = '';
  state.frames.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'thumb' + (i === state.sel ? (state.playing ? ' playing' : ' sel') : '');
    d.innerHTML = `<img alt="Frame ${i + 1}" src="${f.url}"><span class="n">${i + 1}</span>`;
    d.onclick = () => { stopPlay(); select(i); };
    els.timeline.appendChild(d);
  });
  const lv = document.createElement('div');
  lv.className = 'thumb live' + (live ? ' sel' : '');
  lv.textContent = '● Live';
  lv.onclick = () => { stopPlay(); select(-1); };
  els.timeline.appendChild(lv);
  const target = els.timeline.children[live ? n : state.sel];
  if (target) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // buttons
  $('btnPlay').textContent = state.playing ? '⏸ Pause' : '▶ Play';
  $('btnPlay').disabled = !n;
  ['btnDel', 'btnDup'].forEach(b => $(b).disabled = live);
  $('btnLeft').disabled = live || state.sel === 0;
  $('btnRight').disabled = live || state.sel === n - 1;
  $('btnPrev').disabled = !n; $('btnNext').disabled = !n;
  $('btnExport').disabled = !n;
  if (!state.playing && n) setStatus(live ? `${n} frame${n > 1 ? 's' : ''} • ${(n / +els.fps.value).toFixed(1)}s movie` : `Viewing frame ${state.sel + 1} of ${n}`);
}

/* ---------- wiring ---------- */
$('btnCapture').onclick = capture;
$('btnPlay').onclick = play;
$('btnLive').onclick = () => { stopPlay(); select(-1); };
$('btnPrev').onclick = () => { stopPlay(); step(-1); };
$('btnNext').onclick = () => { stopPlay(); step(1); };
$('btnDel').onclick = deleteSel;
$('btnDup').onclick = dupSel;
$('btnLeft').onclick = () => moveSel(-1);
$('btnRight').onclick = () => moveSel(1);
$('btnNew').onclick = newProject;
$('btnExport').onclick = exportVideo;
$('btnImport').onclick = () => $('fileInput').click();
$('fileInput').onchange = e => { importPhotos([...e.target.files]); e.target.value = ''; };
els.fps.oninput = () => { els.fpsVal.textContent = els.fps.value; render(); save(); };
els.onionSlider.oninput = () => { els.onionVal.textContent = els.onionSlider.value; els.onion.style.opacity = els.onionSlider.value / 100; };
els.chkGrid.onchange = () => els.grid.hidden = !els.chkGrid.checked;
els.camSel.onchange = () => startCamera(els.camSel.value);

document.addEventListener('keydown', e => {
  if (e.target.matches('input[type=range], select, input[type=checkbox]') && e.key !== ' ') { /* let arrows adjust controls */ if (e.key.startsWith('Arrow')) return; }
  if (e.target.tagName === 'BUTTON' && e.key === ' ') return; // keep native button behaviour
  switch (e.key) {
    case ' ': e.preventDefault(); capture(); break;
    case 'ArrowLeft': e.preventDefault(); stopPlay(); step(-1); break;
    case 'ArrowRight': e.preventDefault(); stopPlay(); step(1); break;
    case 'Delete': case 'Backspace': deleteSel(); break;
    case 'p': case 'P': play(); break;
    case 'l': case 'L': stopPlay(); select(-1); break;
  }
});

window.addEventListener('beforeunload', () => state.stream && state.stream.getTracks().forEach(t => t.stop()));

(async function init() {
  els.onion.style.opacity = els.onionSlider.value / 100;
  try {
    await DB.open();
    const p = await DB.get();
    if (p) {
      els.fps.value = p.fps || 8; els.fpsVal.textContent = els.fps.value;
      state.frames = p.frames.map(f => ({ id: f.id, blob: f.blob, url: URL.createObjectURL(f.blob) }));
    }
  } catch (e) { setStatus('Autosave unavailable: ' + e); }
  render();
  startCamera();
})();
