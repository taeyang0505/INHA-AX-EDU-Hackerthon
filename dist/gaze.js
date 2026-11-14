/* gaze.js — 웹캠 시선 추적.
   - 시선 예측: WebGazer.js 3.5.3 (brownhci/WebGazer, GPLv3; 기업 가치 100만 달러 미만 조직은 LGPLv3). MediaPipe FaceMesh 파일은 vendor 폴더에 있어 인터넷 없이 동작한다.
   - 실시간 단어 매핑: EyeLiveMetrics처럼 시선 좌표를 화면의 단어 요소에 바로 대응시킨다(시선 점 보기).
   - 단어별 지표: eyekit의 정의(initial fixation duration, gaze duration, total fixation duration, 건너뜀, 되돌아옴)를 자바스크립트로 옮겼다.
   - 시선 경로 표시: scanpath-studio처럼 고정점 크기는 머문 시간, 앞으로 가는 이동과 되돌아가는 이동을 다른 색으로 그린다.
   - 팀 규칙(어휘 지연 1.5초, 회귀 3분류, 2초 이상 이탈)은 글눈 SPEC 17.1과 같다.
   카메라 영상은 저장하지 않는다. 시선 좌표·단어 위치·분석 결과만 이 브라우저 localStorage에 저장한다. */

const GZ_STORE = 'lookteracy-gaze-sessions-v1';
const GZ = {
  fixDisp: 110,        // I-DT: 고정 하나의 최대 퍼짐(가로 범위 + 세로 범위, px). 웹캠 예측은 떨림이 커서 흔들림을 줄인 뒤 적용한다.
  fixMin: 200,         // I-DT: 고정 최소 시간(ms)
  fixGap: 150,         // 표본 사이가 이보다 벌어지면 고정을 끊는다(ms)
  regWords: 2,         // 같은 줄에서 이만큼 이상 앞 단어로 가면 되돌아옴
  vocabMs: 1500,       // 어휘 지연: 한 단어에 머문 총 시간
  lapseMs: 2000,       // 주의 이탈: 지문 밖이거나 얼굴을 놓친 시간
  clicksPerPoint: 5,
  validateMs: 3000,
  passAccuracy: 50,
  keepSessions: 8,
};
const GZ_POINTS = [[50, 50], [10, 12], [50, 12], [90, 12], [90, 50], [90, 88], [50, 88], [10, 88], [10, 50]];
// 머문 시간이 짧은 곳은 초록, 길수록 노랑·주황·빨강 (pos, r, g, b, alpha 0-255)
const GZ_STOPS = [[0, 60, 180, 120, 0], [0.14, 60, 180, 120, 0], [0.3, 60, 180, 120, 105], [0.48, 150, 205, 80, 160], [0.62, 245, 205, 60, 185], [0.8, 245, 140, 50, 205], [1, 220, 55, 45, 225]];
const GZ_GRADIENT = 'linear-gradient(90deg, rgb(60,180,120), rgb(150,205,80) 35%, rgb(245,205,60) 55%, rgb(245,140,50) 78%, rgb(220,55,45))';

const gz = { wg: null, running: false, starting: false, error: '', face: false, faceRef: null, faceSeen: 0, faceStable: 0, faceInfo: null, facePoll: 0, cal: null, overlay: null, quality: null, collect: null, liveTimer: 0, dot: false, dotEl: null, hitEl: null, preview: null };

/* ---------- 시작·종료 ---------- */
async function gzStart() {
  if (gz.running || gz.starting) return;
  gz.starting = true;
  gz.error = '';
  render();
  try {
    await loadScriptOnce('vendor/webgazer/webgazer.js');
    const wg = window.webgazer;
    Object.assign(wg.params, { faceMeshSolutionPath: 'vendor/webgazer/mediapipe/face_mesh', showVideoPreview: false, showVideo: false, showFaceOverlay: false, showFaceFeedbackBox: false, showGazeDot: false });
    wg.saveDataAcrossSessions(false);
    wg.setRegression('ridge');
    wg.setGazeListener(gzOnGaze);
    // WebGazer는 localhost가 아닌 http 주소에서 경고창을 띄운다. 127.0.0.1은 보안 컨텍스트라 실제로는 동작하므로 그 경고만 막는다.
    const alertFn = window.alert;
    if (window.isSecureContext) window.alert = () => {};
    let started;
    try { started = wg.begin(); } finally { window.alert = alertFn; }
    await started;
    wg.removeMouseEventListeners(); // 마우스 움직임을 학습 데이터로 쓰지 않는다. 보정은 점 클릭으로만 한다.
    wg.showVideoPreview(false).showPredictionPoints(false);
    gz.wg = wg;
    gz.running = true;
    gzWatchFace();
  } catch (err) {
    console.error(err);
    gz.error = fpCameraError(err).replace('얼굴 인식을', '시선 추적을');
  } finally {
    gz.starting = false;
    render();
  }
}

function gzStop() {
  gz.collect = null;
  gzCloseOverlay();
  clearInterval(gz.facePoll);
  clearInterval(gz.liveTimer);
  if (gz.wg && gz.running) {
    try {
      gz.wg.pause();
      document.getElementById('webgazerVideoFeed')?.srcObject?.getTracks().forEach(t => t.stop());
      gz.wg.end();
    } catch (err) { console.warn(err); }
  }
  if (gz.preview) gz.preview.srcObject = null;
  gzHideDot();
  Object.assign(gz, { running: false, face: false, faceRef: null, faceStable: 0, faceInfo: null, quality: null, dot: false });
  st.prep = 0;
  st.ready = false;
}

function gzOnGaze(data) {
  const now = performance.now();
  if (gz.cal?.validating && data) gz.cal.preds.push([data.x, data.y]);
  if (gz.collect) gzRecord(data, now);
  if (gz.dot) gzMoveDot(data);
}

/* ---------- 카메라 점검: 얼굴 위치 ---------- */
function gzWatchFace() {
  clearInterval(gz.facePoll);
  gz.facePoll = setInterval(() => {
    if (!gz.running) return;
    const pos = gz.wg.getTracker()?.positionsArray;
    const now = performance.now();
    if (pos && pos !== gz.faceRef) {
      gz.faceRef = pos;
      gz.faceSeen = now;
      gz.faceInfo = gzFaceInfo(pos);
    }
    const face = now - gz.faceSeen < 700;
    if (face && gz.faceInfo?.ok) { if (!gz.faceStable) gz.faceStable = now; } else gz.faceStable = 0;
    gz.face = face;
    gzPrepStatus();
  }, 200);
}

function gzFaceInfo(pos) {
  const v = document.getElementById('webgazerVideoFeed');
  const w = v?.videoWidth || 640, h = v?.videoHeight || 480;
  const span = Math.abs(pos[263][0] - pos[33][0]) / w;
  const cx = pos[1][0] / w, cy = pos[1][1] / h;
  if (span < 0.13) return { ok: false, hint: '조금 더 가까이 앉아 주세요.' };
  if (span > 0.42) return { ok: false, hint: '조금 뒤로 물러나 주세요.' };
  if (cx < 0.28 || cx > 0.72 || cy < 0.22 || cy > 0.78) return { ok: false, hint: '얼굴을 화면 가운데에 맞춰 주세요.' };
  return { ok: true, hint: '얼굴이 잘 보여요. 이 자세를 유지해 주세요.' };
}

const gzFaceReady = () => gz.running && gz.face && gz.faceInfo?.ok && performance.now() - gz.faceStable > 1000;

function gzPrepMessage() {
  if (gz.error) return gz.error;
  if (gz.starting) return '카메라와 시선 추적 모델을 준비하고 있어요.';
  if (!gz.running) return '카메라를 켜면 얼굴이 보이는지 확인해요.';
  if (!gz.face) return '얼굴을 찾고 있어요. 카메라를 정면으로 바라봐 주세요.';
  return gz.faceInfo?.hint ?? '얼굴을 확인하고 있어요.';
}

function gzPrepStatus() {
  if (st.page !== 's-prep') return;
  const node = document.querySelector('[data-gz-status]');
  if (node) node.textContent = gzPrepMessage();
  const badgeNode = document.querySelector('[data-gz-face-badge]');
  if (badgeNode) {
    badgeNode.textContent = gz.face ? (gz.faceInfo?.ok ? '얼굴 인식됨' : '자세 조정 필요') : '얼굴 찾는 중';
    badgeNode.className = 'pill ' + (gz.face && gz.faceInfo?.ok ? 'green' : '');
  }
  const next = document.querySelector('[data-action="prep-check"]');
  if (next) next.disabled = !gzFaceReady();
}

/* ---------- 시선 보정 (9점 클릭 + 3초 정확도 확인) ---------- */
function gzCalibrate() {
  if (!gz.running) { st.prep = 0; render(); toast('카메라를 먼저 켜 주세요.'); return; }
  gzCloseOverlay();
  gz.wg.clearData();
  gz.quality = null;
  gz.cal = { i: 0, clicks: 0, validating: false, preds: [], readyAt: 0 };
  const o = document.createElement('div');
  o.className = 'gz-overlay';
  o.setAttribute('role', 'dialog');
  o.setAttribute('aria-modal', 'true');
  o.setAttribute('aria-label', '시선 보정');
  o.innerHTML = '<svg class="gz-trail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="" fill="none"/></svg><p class="gz-cal-msg" data-gz-cal-msg></p><p class="gz-cal-caption">화면의 점을 천천히 따라가주세요</p><button type="button" class="gz-point" data-gz-point aria-label="보정 지점"><i></i></button><div class="gz-check" data-gz-check hidden><i></i></div><button type="button" class="gz-cal-cancel" data-gz-cancel>보정 그만두기 (Esc)</button>';
  document.body.append(o);
  gz.overlay = o;
  o.querySelector('[data-gz-point]').addEventListener('click', gzPointClick);
  o.querySelector('[data-gz-cancel]').addEventListener('click', () => { gzCloseOverlay(); render(); });
  document.addEventListener('keydown', gzCalKey);
  gzPlacePoint();
}

function gzCalKey(e) {
  if (e.key === 'Escape' && gz.overlay) { gzCloseOverlay(); render(); }
}

function gzCloseOverlay() {
  document.removeEventListener('keydown', gzCalKey);
  gz.overlay?.remove();
  gz.overlay = null;
  gz.cal = null;
}

function gzPlacePoint() {
  const { i, clicks } = gz.cal;
  const [x, y] = GZ_POINTS[i];
  const point = gz.overlay.querySelector('[data-gz-point]');
  point.style.left = x + '%';
  point.style.top = y + '%';
  point.style.setProperty('--fill', String(clicks / GZ.clicksPerPoint));
  gz.overlay.querySelector('.gz-trail polyline')?.setAttribute('points', GZ_POINTS.slice(0, i + 1).map(([px, py]) => `${px},${py}`).join(' '));
  gz.overlay.querySelector('[data-gz-cal-msg]').textContent = `지점 ${i + 1} / ${GZ_POINTS.length} · 점을 바라보면서 ${GZ.clicksPerPoint - clicks}번 더 눌러 주세요.`;
}

function gzPointClick(e) {
  const cal = gz.cal;
  if (!cal || cal.validating || performance.now() < cal.readyAt) return; // 점이 이동하는 동안의 클릭은 받지 않는다
  const [px, py] = GZ_POINTS[cal.i];
  gz.wg.recordScreenPosition((px / 100) * innerWidth, (py / 100) * innerHeight, 'click');
  cal.clicks++;
  if (cal.clicks >= GZ.clicksPerPoint) { cal.i++; cal.clicks = 0; cal.readyAt = performance.now() + 450; }
  if (cal.i >= GZ_POINTS.length) gzValidate();
  else gzPlacePoint();
}

function gzValidate() {
  const o = gz.overlay;
  o.querySelector('[data-gz-point]').hidden = true;
  o.querySelector('[data-gz-check]').hidden = false;
  o.querySelector('[data-gz-cal-msg]').textContent = '가운데 점을 3초 동안 바라봐 주세요. 정확도를 확인하고 있어요.';
  const cal = gz.cal;
  setTimeout(() => { if (gz.cal === cal) { cal.validating = true; cal.preds = []; } }, 600);
  setTimeout(() => {
    if (gz.cal !== cal) return;
    const tx = innerWidth / 2, ty = innerHeight / 2, half = innerHeight / 2;
    const ds = cal.preds.map(([x, y]) => Math.hypot(x - tx, y - ty)).sort((a, b) => a - b);
    const accuracy = ds.length ? Math.round(ds.reduce((s, d) => s + Math.max(0, 100 - (d / half) * 100), 0) / ds.length) : 0;
    const errorPx = ds.length ? Math.round(ds[Math.floor(ds.length / 2)]) : null;
    gz.quality = { accuracy, errorPx, samples: ds.length, points: GZ_POINTS.length, viewport: [innerWidth, innerHeight], at: new Date().toISOString() };
    gzCloseOverlay();
    st.prep = 2;
    st.ready = true;
    render();
  }, 600 + GZ.validateMs);
}

/* ---------- 지문 읽기: 단어 위치와 시선 수집 ---------- */
function gzWrapWords(art) {
  if (art.querySelector('.gw')) return;
  let wi = 0, si = 0, para = -1;
  const blocks = [...art.querySelectorAll('h1, .passage p, .passage h3')];
  blocks.forEach((block, pi) => {
    const pp = block.tagName === 'P' ? ++para : -1;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('.pno')) nodes.push(walker.currentNode);
    let open = false;
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      for (const part of node.textContent.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.append(part); continue; }
        // ㉠·㉡ 같은 표시 기호는 단어로 세지 않는다(시선이 뒤 단어 대신 기호에 배정되지 않게).
        if (/^[\u3260-\u327F]+$/.test(part)) { frag.append(part); continue; }
        const span = document.createElement('span');
        span.className = 'gw';
        span.textContent = part;
        span.dataset.w = wi++;
        span.dataset.s = si;
        span.dataset.p = pi;
        span.dataset.pp = pp;
        frag.append(span);
        open = true;
        if (/[.?!]["'”’)]?$/.test(part)) { si++; open = false; }
      }
      node.replaceWith(frag);
    }
    if (open) si++;
  });
}

function gzMeasure(art) {
  const a = art.getBoundingClientRect();
  // 최신 UI는 지문 카드 안에서 본문이 스크롤된다. 좌표는 스크롤까지 더한 본문 기준으로 잰다.
  const sx = art.scrollLeft, sy = art.scrollTop;
  const words = [...art.querySelectorAll('.gw')].map(el => {
    const r = el.getClientRects()[0] ?? el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { t: el.textContent, x: Math.round(r.left - a.left + sx), y: Math.round(r.top - a.top + sy), w: Math.round(r.width), h: Math.round(r.height), fs: parseFloat(cs.fontSize), fw: cs.fontWeight, s: +el.dataset.s, p: +el.dataset.p, pp: +el.dataset.pp };
  });
  const lines = [];
  words.forEach((w, i) => {
    const cy = w.y + w.h / 2;
    const last = lines.at(-1);
    if (last && Math.abs(cy - (last.y + last.h / 2)) < Math.max(last.h, w.h) * 0.5) {
      last.to = i;
      const top = Math.min(last.y, w.y), bottom = Math.max(last.y + last.h, w.y + w.h);
      last.y = top; last.h = bottom - top;
    } else lines.push({ y: w.y, h: w.h, from: i, to: i });
    w.l = lines.length - 1;
  });
  const passage = art.querySelector('.passage p') ?? art;
  const pcs = getComputedStyle(passage);
  return {
    w: Math.round(Math.max(a.width, art.scrollWidth)), h: Math.round(Math.max(a.height, art.scrollHeight)), words, lines,
    lineH: parseFloat(pcs.lineHeight) || parseFloat(pcs.fontSize) * 2,
    font: pcs.fontFamily, color: pcs.color, fontSize: st.font,
  };
}

function gzReadingStart() {
  const art = document.querySelector('.reader .article');
  if (!art) return;
  gzWrapWords(art);
  gz.collect = { startedAt: new Date().toISOString(), t0: performance.now(), samples: [], art, layout: gzMeasure(art) };
  clearInterval(gz.liveTimer);
  gz.liveTimer = setInterval(gzLiveStatus, 500);
}

function gzRestart(reason) {
  const c = gz.collect;
  if (!c) return;
  c.layout = gzMeasure(c.art);
  c.samples = [];
  c.t0 = performance.now();
  if (reason) toast(reason);
}

function gzRecord(data, now) {
  const c = gz.collect;
  if (!c.art.isConnected) return;
  const t = Math.round(now - c.t0);
  if (!data || document.hidden) { c.samples.push([t]); return; }
  const r = c.art.getBoundingClientRect();
  c.samples.push([t, Math.round(data.x - r.left + c.art.scrollLeft), Math.round(data.y - r.top + c.art.scrollTop)]);
}

function gzLiveStatus() {
  const c = gz.collect;
  const node = document.querySelector('[data-gz-live]');
  if (!c || !node) return;
  const valid = c.samples.filter(s => s.length === 3).length;
  const pct = c.samples.length ? Math.round((valid / c.samples.length) * 100) : 0;
  node.textContent = `시선 수집 중 · ${Math.round((performance.now() - c.t0) / 1000)}초 · 유효 ${pct}%`;
}

/* 시선 점 보기: 예측 위치와 그 아래 단어를 바로 표시한다. */
function gzMoveDot(data) {
  if (!gz.dotEl) {
    gz.dotEl = document.createElement('div');
    gz.dotEl.className = 'gz-dot';
    gz.dotEl.setAttribute('aria-hidden', 'true');
    document.body.append(gz.dotEl);
  }
  if (!data) { gz.dotEl.style.opacity = '0'; return; }
  gz.dotEl.style.opacity = '1';
  gz.dotEl.style.transform = `translate(${data.x}px, ${data.y}px)`;
  const el = document.elementFromPoint(data.x, data.y)?.closest?.('.gw') ?? null;
  if (el !== gz.hitEl) {
    gz.hitEl?.classList.remove('gz-hit');
    el?.classList.add('gz-hit');
    gz.hitEl = el;
  }
}
function gzHideDot() {
  gz.dotEl?.remove();
  gz.dotEl = null;
  gz.hitEl?.classList.remove('gz-hit');
  gz.hitEl = null;
}

/* ---------- 분석 ---------- */
function gzFixations(samples) {
  const pts = samples.filter(s => s.length === 3);
  const out = [];
  let i = 0;
  while (i < pts.length) {
    let j = i, x0 = pts[i][1], x1 = x0, y0 = pts[i][2], y1 = y0;
    while (j + 1 < pts.length) {
      const p = pts[j + 1];
      if (p[0] - pts[j][0] > GZ.fixGap) break;
      const nx0 = Math.min(x0, p[1]), nx1 = Math.max(x1, p[1]), ny0 = Math.min(y0, p[2]), ny1 = Math.max(y1, p[2]);
      if (nx1 - nx0 + (ny1 - ny0) > GZ.fixDisp) break;
      x0 = nx0; x1 = nx1; y0 = ny0; y1 = ny1; j++;
    }
    const dur = pts[j][0] - pts[i][0];
    if (dur >= GZ.fixMin) {
      let sx = 0, sy = 0;
      for (let k = i; k <= j; k++) { sx += pts[k][1]; sy += pts[k][2]; }
      const n = j - i + 1;
      out.push({ start: pts[i][0], end: pts[j][0], dur, x: Math.round(sx / n), y: Math.round(sy / n) });
      i = j + 1;
    } else i++;
  }
  return out;
}

function gzTextBounds(L) {
  const top = L.lines[0]?.y ?? 0, last = L.lines.at(-1);
  return { top, bottom: last ? last.y + last.h : 0 };
}

/* eyekit처럼 고정점을 가장 가까운 줄에 맞춘 뒤, 그 줄에서 가장 가까운 단어에 배정한다. */
function gzAssign(fixes, L) {
  const { top, bottom } = gzTextBounds(L);
  for (const f of fixes) {
    f.w = -1; f.l = -1;
    if (!L.lines.length || f.x < -L.lineH * 2 || f.x > L.w + L.lineH * 2 || f.y < top - L.lineH || f.y > bottom + L.lineH) continue;
    let best = 0, bd = Infinity;
    L.lines.forEach((ln, k) => { const d = Math.abs(f.y - (ln.y + ln.h / 2)); if (d < bd) { bd = d; best = k; } });
    const ln = L.lines[best];
    let bw = -1, bx = Infinity;
    for (let w = ln.from; w <= ln.to; w++) {
      const b = L.words[w];
      const dx = f.x < b.x ? b.x - f.x : f.x > b.x + b.w ? f.x - (b.x + b.w) : 0;
      if (dx < bx) { bx = dx; bw = w; }
    }
    if (bx > L.lineH * 3) continue;
    f.l = best; f.w = bw; f.sy = Math.round(ln.y + ln.h / 2);
  }
  return fixes;
}

function gzMeasures(fixes, L) {
  const m = L.words.map(() => ({ ifd: 0, gd: 0, tfd: 0, nf: 0, regIn: 0, skip: false, seen: false }));
  const regs = { sentence: 0, between: 0, paragraph: 0 };
  let furthest = -1, run = -1, prev = null;
  for (const f of fixes) {
    if (f.w < 0) { run = -1; prev = null; continue; }
    const w = f.w, mw = m[w];
    mw.tfd += f.dur; mw.nf++;
    if (!mw.seen) {
      mw.seen = true;
      mw.ifd = f.dur;
      if (w > furthest) {
        for (let k = furthest + 1; k < w; k++) if (!m[k].seen) m[k].skip = true;
        mw.gd = f.dur; run = w; furthest = w;
      } else run = -1;
    } else if (run === w && prev?.w === w) mw.gd += f.dur;
    else run = -1;
    if (prev && w < prev.w && (prev.w - w >= GZ.regWords || f.l < prev.l)) {
      mw.regIn++;
      const a = L.words[prev.w], b = L.words[w];
      regs[a.s === b.s ? 'sentence' : a.p === b.p ? 'between' : 'paragraph']++;
    }
    prev = f;
  }
  return { m, regs };
}

function gzLapses(samples, L) {
  const { top, bottom } = gzTextBounds(L);
  const list = [];
  let start = null, prevT = null;
  const off = s => s.length < 3 || s[1] < -60 || s[1] > L.w + 60 || s[2] < top - 80 || s[2] > bottom + 80;
  for (const s of samples) {
    // 탭이 가려지면 예측 자체가 멈추므로, 표본 사이의 긴 공백도 이탈로 센다.
    if (start === null && prevT !== null && s[0] - prevT >= GZ.lapseMs) list.push({ start: prevT, end: s[0], dur: s[0] - prevT });
    prevT = s[0];
    if (off(s)) { if (start === null) start = s[0]; }
    else if (start !== null) { if (s[0] - start >= GZ.lapseMs) list.push({ start, end: s[0], dur: s[0] - start }); start = null; }
  }
  const end = samples.at(-1)?.[0];
  if (start !== null && end - start >= GZ.lapseMs) list.push({ start, end, dur: end - start });
  return { list, onText: samples.filter(s => !off(s)).length };
}

const GZ_ANALYSIS_V = 2;
const gzQuantile = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))] : 0; };
const gzClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* 웹캠 예측의 프레임별 떨림을 줄인다: 200ms 안의 이웃 5개 표본의 중앙값. */
function gzSmooth(samples) {
  const idx = [];
  samples.forEach((s, i) => { if (s.length === 3) idx.push(i); });
  const out = samples.map(s => s.slice());
  idx.forEach((i, k) => {
    const t = samples[i][0];
    const near = idx.slice(Math.max(0, k - 2), k + 3).map(j => samples[j]).filter(s => Math.abs(s[0] - t) <= 200);
    out[i] = [t, Math.round(gzQuantile(near.map(s => s[1]), 0.5)), Math.round(gzQuantile(near.map(s => s[2]), 0.5))];
  });
  return out;
}

const gzApply = (samples, f) => samples.map(s => (s.length === 3 ? [s[0], Math.round(s[1] * f.sx + f.dx), Math.round(s[2] * f.sy + f.dy)] : s));

/* 위치 자동 정렬 후보. 보정이 틀어지면 시선 전체가 위아래·좌우로 밀리므로, 학생이 지문 전체를 읽었다고 보고
   시선 분포의 중앙(과 폭)을 글자 영역에 맞춘다. 단어에 배정되는 고정이 가장 많은 후보를 고른다. */
function gzDriftCandidates(samples, L) {
  const id = { dx: 0, dy: 0, sx: 1, sy: 1, kind: 'none' };
  const v = samples.filter(s => s.length === 3);
  if (v.length < 30 || L.words.length < 10) return [id];
  const xs = v.map(s => s[1]), ys = v.map(s => s[2]);
  const wx = L.words.map(w => w.x + w.w / 2), wy = L.words.map(w => w.y + w.h / 2);
  const mx = gzQuantile(wx, 0.5), my = gzQuantile(wy, 0.5), gx = gzQuantile(xs, 0.5), gy = gzQuantile(ys, 0.5);
  const sx = gzClamp((gzQuantile(wx, 0.9) - gzQuantile(wx, 0.1)) / Math.max(1, gzQuantile(xs, 0.9) - gzQuantile(xs, 0.1)), 0.6, 1.6);
  const sy = gzClamp((gzQuantile(wy, 0.9) - gzQuantile(wy, 0.1)) / Math.max(1, gzQuantile(ys, 0.9) - gzQuantile(ys, 0.1)), 0.6, 1.6);
  return [
    id,
    { dx: Math.round(mx - gx), dy: Math.round(my - gy), sx: 1, sy: 1, kind: 'shift' },
    { dx: Math.round(mx - gx * sx), dy: Math.round(my - gy * sy), sx: +sx.toFixed(3), sy: +sy.toFixed(3), kind: 'fit' },
  ];
}

function gzAnalyze(c) {
  const L = c.layout;
  const smooth = gzSmooth(c.samples);
  // 후보마다 고정점을 구해 단어에 배정되는 수를 비교한다. 원래 위치가 기본이고, 다른 후보는 20% 이상 나을 때만 쓴다.
  let best = null;
  for (const f of gzDriftCandidates(smooth, L)) {
    const samples = f.kind === 'none' ? smooth : gzApply(smooth, f);
    const fixes = gzAssign(gzFixations(samples), L);
    const onCount = fixes.filter(x => x.w >= 0).length;
    if (!best || onCount > best.onCount * 1.2 + 1) best = { f, samples, fixes, onCount };
  }
  const { f: correction, samples, fixes } = best;
  const { m, regs } = gzMeasures(fixes, L);
  const { list: lapses, onText } = gzLapses(samples, L);
  const on = fixes.filter(f => f.w >= 0);
  const valid = samples.filter(s => s.length === 3).length;
  const total = regs.sentence + regs.between + regs.paragraph;
  const words = [];
  m.forEach((x, i) => { if (x.seen || x.skip) words.push([i, x.ifd, x.gd, x.tfd, x.nf, x.regIn, x.skip ? 1 : 0]); });
  const passed = m.filter((x, i) => i <= Math.max(...on.map(f => f.w), -1));
  return {
    analysisV: GZ_ANALYSIS_V,
    correction,
    fixations: fixes,
    words,
    metrics: {
      durationMs: samples.at(-1)?.[0] ?? 0,
      samples: samples.length,
      validPct: Math.round((valid / Math.max(1, samples.length)) * 100),
      onTextPct: Math.round((onText / Math.max(1, valid)) * 100),
      allFixations: fixes.length,
      fixations: on.length,
      meanFixMs: on.length ? Math.round(on.reduce((s, f) => s + f.dur, 0) / on.length) : 0,
      regressions: { ...regs, total },
      regressionRate: on.length ? Math.round((total / on.length) * 100) : 0,
      lapses: lapses.length,
      lapseMs: lapses.reduce((s, x) => s + x.dur, 0),
      longWords: m.map((x, i) => [i, x.tfd]).filter(([, t]) => t >= GZ.vocabMs).sort((a, b) => b[1] - a[1]).map(([i]) => i),
      skipPct: passed.length ? Math.round((passed.filter(x => x.skip).length / passed.length) * 100) : 0,
    },
  };
}

/** 예전 방식으로 분석된 기록은 원본 표본으로 다시 분석해 저장한다. */
function gzEnsureAnalysis(ses) {
  if (!ses || ses.analysisV === GZ_ANALYSIS_V || !Array.isArray(ses.samples)) return ses;
  Object.assign(ses, gzAnalyze({ samples: ses.samples, layout: ses.layout }));
  const list = gzSessions().map(x => (x.id === ses.id ? ses : x));
  try { localStorage.setItem(GZ_STORE, JSON.stringify(list)); } catch {}
  console.info('[gaze] re-analysed', ses.id, ses.metrics, ses.correction);
  return ses;
}

/* ---------- 저장 ---------- */
function gzSessions() {
  try { const v = JSON.parse(localStorage.getItem(GZ_STORE) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function gzSaveSession(ses) {
  let list = [...gzSessions(), ses].slice(-GZ.keepSessions);
  while (list.length) {
    try { localStorage.setItem(GZ_STORE, JSON.stringify(list)); return true; } catch { list = list.slice(1); }
  }
  return false;
}
const gzLatest = name => gzEnsureAnalysis(gzSessions().filter(s => s.student === name).at(-1) ?? null);
const gzById = id => gzEnsureAnalysis(gzSessions().find(s => s.id === id) ?? null);
/** 그릴 고정점: 단어에 배정된 것. 3개 미만이면(보정 오차가 커서 거의 배정되지 못함) 배정 전 위치를 그대로 쓴다. */
const gzDrawFixes = ses => { const on = ses.fixations.filter(f => f.w >= 0); return on.length >= 3 ? on : ses.fixations; };

function gzFinishReading() {
  const c = gz.collect;
  if (!c) return null;
  gz.collect = null;
  clearInterval(gz.liveTimer);
  const result = gzAnalyze(c);
  const { art, t0, ...rest } = c;
  const ses = {
    v: 1, id: 'gz-' + Date.now().toString(36),
    student: st.user?.name ?? '김서윤', studentId: st.user?.id ?? null,
    title: st.assignment?.title ?? passageTitle,
    ...rest, endedAt: new Date().toISOString(),
    calibration: gz.quality,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    ...result,
  };
  const ok = gzSaveSession(ses);
  console.info('[gaze] session', ses.id, ses.metrics, ok ? 'saved' : 'not saved (storage full)');
  return ses;
}

/* ---------- 리포트 그리기 ---------- */
let gzLutCache = null;
function gzLut() {
  if (gzLutCache) return gzLutCache;
  const lut = new Uint8ClampedArray(256 * 4);
  for (let k = 0; k < 256; k++) {
    const v = k / 255;
    let s = 0;
    while (s < GZ_STOPS.length - 2 && v > GZ_STOPS[s + 1][0]) s++;
    const a = GZ_STOPS[s], b = GZ_STOPS[s + 1];
    const f = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (v - a[0]) / (b[0] - a[0])));
    for (let c = 0; c < 4; c++) lut[k * 4 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f;
  }
  return (gzLutCache = lut);
}

function gzDrawHeat(canvas, ses) {
  const L = ses.layout, sc = 2;
  canvas.width = L.w * sc;
  canvas.height = L.h * sc;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const fx = gzDrawFixes(ses);
  if (!fx.length) return;
  const max = Math.max(...fx.map(f => f.dur));
  const r = Math.max(26, L.lineH * 1.1) * sc;
  for (const f of fx) {
    const x = f.x * sc, y = (f.sy ?? f.y) * sc;
    const a = 0.12 + 0.5 * (f.dur / max);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data, lut = gzLut();
  let peak = 1;
  for (let i = 3; i < d.length; i += 4) if (d[i] > peak) peak = d[i];
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i + 3];
    if (!v) continue;
    const k = Math.min(255, Math.round((v / peak) * 255)) * 4;
    d[i] = lut[k]; d[i + 1] = lut[k + 1]; d[i + 2] = lut[k + 2]; d[i + 3] = lut[k + 3];
  }
  ctx.putImageData(img, 0, 0);
}

function gzReplicaSvg(L, marks = new Set()) {
  return `<svg class="gz-text" viewBox="0 0 ${L.w} ${L.h}" aria-hidden="true">${L.words.map((w, i) => `<text x="${w.x}" y="${(w.y + w.h * 0.78).toFixed(1)}" font-size="${w.fs}" font-weight="${w.fw}" class="${marks.has(i) ? 'is-long' : ''}">${esc(w.t)}</text>`).join('')}</svg>`;
}

/* 시선 경로: 고정점 사이를 화살표로 잇는다(앞으로 읽기 파랑, 되돌아 읽기 주황).
   mode 'full' = 시선 경로 탭(원 크기 = 머문 시간, 번호 = 순서), 'overlay' = 히트맵 위(작은 점, 시작·끝 표시). */
function gzPathSvg(ses, mode = 'full') {
  const L = ses.layout;
  const fx = gzDrawFixes(ses);
  const max = Math.max(1, ...fx.map(f => f.dur));
  const y = f => f.sy ?? f.y;
  const R = f => (mode === 'full' ? 6 + 10 * Math.sqrt(f.dur / max) : 4);
  const isBack = (a, b) => (a.w >= 0 && b.w >= 0 ? b.w < a.w : b.x < a.x - 20 && Math.abs(y(b) - y(a)) < L.lineH / 2);
  const id = String(ses.id).replace(/[^\w-]/g, '');
  const aw = mode === 'full' ? 11 : 9;
  const marker = (name, cls) => `<marker id="gz-ah-${name}-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${aw}" markerHeight="${aw}" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,1 L10,5 L0,9 z" class="gz-ah ${cls}"/></marker>`;
  let s = `<svg class="gz-path ${mode === 'overlay' ? 'is-overlay' : ''}" viewBox="0 0 ${L.w} ${L.h}" aria-hidden="true"><defs>${marker('f', 'fwd')}${marker('b', 'back')}</defs>`;
  for (let k = 1; k < fx.length; k++) {
    const a = fx[k - 1], b = fx[k];
    const dx = b.x - a.x, dy = y(b) - y(a), len = Math.hypot(dx, dy);
    if (len < R(a) + R(b) + 6) continue; // 같은 자리에 머문 경우는 화살표를 그리지 않는다
    const ux = dx / len, uy = dy / len, back = isBack(a, b);
    s += `<line x1="${(a.x + ux * R(a)).toFixed(1)}" y1="${(y(a) + uy * R(a)).toFixed(1)}" x2="${(b.x - ux * (R(b) + 2)).toFixed(1)}" y2="${(y(b) - uy * (R(b) + 2)).toFixed(1)}" class="gz-sac ${back ? 'back' : ''}" data-k="${k}" marker-end="url(#gz-ah-${back ? 'b' : 'f'}-${id})"/>`;
  }
  fx.forEach((f, k) => {
    s += `<circle cx="${f.x}" cy="${y(f)}" r="${R(f).toFixed(1)}" class="gz-fix" data-k="${k}"/>`;
    if (mode === 'full') s += `<text x="${f.x}" y="${y(f)}" class="gz-num" data-k="${k}">${k + 1}</text>`;
  });
  if (mode === 'overlay' && fx.length) {
    const first = fx[0], last = fx.at(-1);
    s += `<text x="${first.x}" y="${y(first) - 12}" class="gz-tag" data-k="0">시작</text>`;
    if (fx.length > 1) s += `<text x="${last.x}" y="${y(last) - 12}" class="gz-tag" data-k="${fx.length - 1}">끝</text>`;
  }
  return s + '<circle class="gz-cursor" r="9" cx="-50" cy="-50"/></svg>';
}

const gzSec = ms => (ms >= 60000 ? `${Math.floor(ms / 60000)}분 ${Math.round((ms % 60000) / 1000)}초` : `${(ms / 1000).toFixed(1)}초`);
const gzClean = t => t.replace(/[.,?!"“”'‘’()·]/g, '');
const gzWhen = iso => { const d = new Date(iso); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function gzObservations(ses) {
  const m = ses.metrics, L = ses.layout, r = m.regressions;
  const long = m.longWords.slice(0, 6).map(i => gzClean(L.words[i].t));
  const rows = [
    ['오래 머문 단어', long.length ? `${long.join(', ')} · 한 단어에 1.5초 이상` : '한 단어에 1.5초 이상 머문 곳은 없어요.'],
    ['되돌아 읽기', `문장 안 ${r.sentence}회 · 문장 사이 ${r.between}회 · 문단 사이 ${r.paragraph}회 (고정 대비 ${m.regressionRate}%)`],
    ['주의 이탈', m.lapses ? `${m.lapses}회 · 합계 ${gzSec(m.lapseMs)} (2초 이상 지문 밖이거나 얼굴을 놓침)` : '2초 이상 지문을 벗어난 구간은 없어요.'],
    ['건너뛴 단어', `첫 읽기에서 지나친 단어 ${m.skipPct}%`],
  ];
  return `<div class="gz-obs">${rows.map(([h, p]) => `<div><label>${h}</label><p>${esc(p)}</p></div>`).join('')}</div>`;
}

function gzWordTable(ses) {
  const L = ses.layout;
  const rows = [...ses.words].sort((a, b) => b[3] - a[3]).slice(0, 14);
  if (!rows.length) return '<p class="small">단어에 배정된 고정이 없어요. 보정 정확도를 확인해 주세요.</p>';
  return `<div class="gz-table-wrap"><table class="gz-table"><thead><tr><th>단어</th><th>첫 고정</th><th>첫 통과 응시</th><th>총 응시</th><th>고정 수</th><th>되돌아옴</th></tr></thead><tbody>${rows.map(([i, ifd, gd, tfd, nf, reg, skip]) => `<tr class="${tfd >= GZ.vocabMs ? 'is-long' : ''}"><td>${esc(gzClean(L.words[i].t))}${skip ? ' <small>첫 읽기 건너뜀</small>' : ''}</td><td>${ifd}ms</td><td>${gd ? gd + 'ms' : '-'}</td><td>${tfd}ms</td><td>${nf}</td><td>${reg}</td></tr>`).join('')}</tbody></table></div><p class="small gz-caption">단어 지표는 eyekit의 정의를 따라요. 첫 통과 응시는 처음 그 단어에 들어와 다른 단어로 옮기기 전까지 머문 시간, 되돌아옴은 뒤쪽을 읽다가 이 단어로 돌아온 횟수예요.</p>`;
}

function gzReportBody(ses, tab) {
  const L = ses.layout, m = ses.metrics, q = ses.calibration;
  const long = new Set(m.longWords);
  const visual = tab === 'words' ? gzWordTable(ses)
    : `<div class="gz-tools">${tab === 'heat' ? button(st.gzHeatPath === false ? '이동 경로 보기' : '이동 경로 숨기기', 'gz-heatpath', 'secondary sm') : ''}${tab === 'path' || st.gzHeatPath !== false ? button('경로 재생', 'gz-replay', 'secondary sm') : ''}</div>`
      + `<div class="gz-replica" data-gz-replica="${ses.id}" style="aspect-ratio:${L.w}/${L.h}">${tab === 'heat' ? '<canvas data-gz-heat></canvas>' : ''}${gzReplicaSvg(L, tab === 'heat' ? new Set() : long)}${tab === 'path' ? gzPathSvg(ses, 'full') : st.gzHeatPath !== false ? gzPathSvg(ses, 'overlay') : ''}</div>`
      + (tab === 'heat'
        ? `<div class="gz-legend"><span>시선 집중도</span><span class="muted">낮음</span><i style="background:${GZ_GRADIENT}"></i><span class="muted">높음</span></div>${st.gzHeatPath !== false ? `<div class="gz-legend"><i class="gz-key fwd"></i><span>앞으로 읽기</span><i class="gz-key back"></i><span>되돌아 읽기</span><span class="muted">화살표 = 시선이 옮겨 간 방향</span></div>` : ''}<p class="small gz-caption">머문 시간이 길수록 붉게 표시돼요.</p>`
        : `<div class="gz-legend"><i class="gz-key fwd"></i><span>앞으로 읽기</span><i class="gz-key back"></i><span>되돌아 읽기</span><span class="muted">원 크기 = 머문 시간, 번호 = 순서, 화살표 = 이동 방향</span></div>`);
  const unplaced = m.fixations < 3;
  const warn = !m.samples ? note('시선 표본이 없어요. 읽는 동안 얼굴이 카메라에 보이지 않았거나 시선 예측을 받지 못했어요.')
    : unplaced ? note('시선이 대부분 글자 밖으로 잡혀 단어에 배정하지 못했어요. 머리를 고정하고 다시 보정한 뒤 읽어 주세요.') : '';
  return `<h3>${esc(ses.title)}</h3>${warn}${visual}`;
}

/* ---------- 화면 ---------- */
/* 학습 준비: 최신 UI의 카드 디자인을 그대로 두고, 안의 내용만 실제 카메라·보정 상태로 바꾼다. */
const gzOrigPrep = views['s-prep'];
views['s-prep'] = () => {
  const tpl = document.createElement('template');
  tpl.innerHTML = gzOrigPrep();
  const root = tpl.content;
  if (st.prep === 0) {
    const surface = root.querySelector('.prep-camera-surface');
    if (surface) {
      surface.setAttribute('data-gz-preview', '');
      if (gz.running) { surface.classList.add('is-live'); surface.querySelector('.prep-camera-guide')?.remove(); }
      const cap = surface.querySelector('.prep-surface-caption');
      if (cap) { cap.textContent = gzPrepMessage(); cap.setAttribute('data-gz-status', ''); }
    }
    const btn = root.querySelector('[data-action="prep-check"]');
    if (btn && gz.starting) { btn.textContent = '카메라 준비 중'; btn.setAttribute('disabled', ''); }
    else if (btn && gz.running) { btn.innerHTML = '점검 완료 · 시선 보정으로 ' + icon('arrow'); if (!gzFaceReady()) btn.setAttribute('disabled', ''); }
  } else if (st.prep === 1) {
    const status = root.querySelector('.calibration-step-status');
    if (status) status.textContent = `보정 지점 ${GZ_POINTS.length}곳`;
    const tip = root.querySelector('.calibration-side .prep-tip');
    if (tip) tip.innerHTML = `<h3>점을 보며 눌러요.</h3><p>보정을 시작하면 화면 전체에 점이 하나씩 나타나요.<br>점을 바라보면서 ${GZ.clicksPerPoint}번씩 눌러 주세요.</p>`;
    const next = root.querySelector('[data-action="cal-next"]');
    if (next) next.innerHTML = '보정 시작 ' + icon('arrow');
  } else {
    const done = root.querySelector('.prep-completed');
    const q = gz.quality;
    if (done && q) {
      const good = q.accuracy >= GZ.passAccuracy;
      done.querySelector('p')?.insertAdjacentHTML('afterend', `<p class="gz-quality ${good ? '' : 'is-low'}">보정 정확도 ${q.accuracy}%${q.errorPx !== null ? ` · 평균 오차 약 ${q.errorPx}px` : ''}${good ? '' : '<br>조명을 밝게 하고 자세를 고정한 뒤 다시 보정하면 더 정확해져요.'}</p>`);
      done.querySelector('.btn')?.insertAdjacentHTML('afterend', button('다시 보정하기', 'cal-reset', 'secondary'));
    } else if (done && !gz.running) {
      done.querySelector('p')?.insertAdjacentHTML('afterend', '<p class="gz-quality is-low">카메라 없이 진행해 이번 읽기는 시선을 기록하지 않아요.</p>');
    }
  }
  return tpl.innerHTML;
};

const gzOrigReading = views['s-reading'];
views['s-reading'] = () => {
  const tpl = document.createElement('template');
  tpl.innerHTML = gzOrigReading();
  const tools = tpl.content.querySelector('.reader-tools');
  if (tools) {
    tools.insertAdjacentHTML('afterbegin', `<span class="gz-live-pill ${gz.running ? 'is-live' : ''}" title="${gz.running ? '카메라 영상은 저장하지 않고 시선 좌표만 기록해요.' : '학습 준비에서 카메라 점검과 보정을 하면 시선을 기록해요.'}"><span class="status-dot"></span><span data-gz-live>${gz.running ? '시선 수집 준비 중' : '시선 미수집'}</span></span>${gz.running ? `<button class="gz-dot-toggle" data-action="gz-dot" aria-pressed="${gz.dot}">${gz.dot ? '시선 점 숨기기' : '시선 점 보기'}</button>` : ''}`);
  }
  return tpl.innerHTML;
};

const gzOrigReport = views['t-report'];
views['t-report'] = () => {
  const tpl = document.createElement('template');
  tpl.innerHTML = gzOrigReport();
  const sel = tpl.content.querySelector('#report-select');
  if (sel) {
    const names = [...new Set(gzSessions().map(s => s.student))];
    for (const n of names) {
      if ([...sel.options].some(o => o.textContent === n)) continue;
      const o = document.createElement('option');
      o.textContent = n;
      sel.append(o);
    }
    for (const o of sel.options) o.toggleAttribute('selected', o.textContent === st.reportStudent);
  }
  const ses = gzLatest(st.reportStudent);
  if (!ses) return tpl.innerHTML;
  const card = tpl.content.querySelector('.report-layout > section.card');
  const pill = card?.querySelector('.section-head .pill');
  if (pill) { pill.textContent = '실측 시선 기록'; pill.className = 'pill green'; }
  const tabsEl = card?.querySelector('.tabs');
  // 시선 지표(독해 속도·고정 시간·시폭, 오래 머문 단어 등)는 탭 위, 카드 맨 위에 둔다.
  card?.querySelector('.report-gaze-top')?.remove();
  tabsEl?.insertAdjacentHTML('beforebegin', `<div class="report-gaze-top">${gzStatRow(ses)}${gzObservations(ses)}</div>`);
  if (tabsEl) {
    if (!tabsEl.querySelector('[data-value="words"]')) {
      tabsEl.querySelector('[data-value="answer"]')?.insertAdjacentHTML('beforebegin', `<button role="tab" aria-selected="${st.reportTab === 'words'}" class="${st.reportTab === 'words' ? 'active' : ''}" data-tab="report" data-value="words">단어별 지표</button>`);
    }
    if (st.reportTab !== 'answer') {
      while (tabsEl.nextSibling) tabsEl.nextSibling.remove();
      tabsEl.insertAdjacentHTML('afterend', gzReportBody(ses, st.reportTab));
    }
  }
  return tpl.innerHTML;
};

/* ---------- 동작 ---------- */
action['gz-camera'] = () => gzStart();
/* '카메라·환경 점검하기': 카메라를 켜고, 얼굴이 안정적으로 보이면 시선 보정으로 넘어간다. */
action['prep-check'] = () => {
  if (gz.starting) return;
  if (!gz.running) { gzStart(); return; }
  if (!gzFaceReady()) { toast('얼굴이 안정적으로 보일 때까지 잠시 기다려 주세요.'); return; }
  st.prep = 1;
  st.cal = 0;
  render();
};
action['prep-error'] = () => modal('점검이 어려울 때', `<p>카메라 권한, 조명, 얼굴 가림, 브라우저 환경을 차례로 확인해 보세요.</p><ul class="help-list"><li>주소창 왼쪽의 카메라 아이콘에서 권한을 허용으로 바꾸기</li><li>다른 앱(화상회의 등)이 카메라를 쓰고 있다면 닫기</li><li>역광을 피하고 얼굴이 화면 가운데 오도록 자세 조정하기</li><li>Chrome 최신 버전에서 다시 시도하기</li></ul>${gz.error ? note(esc(gz.error)) : ''}<div class="actions">${button('카메라 없이 계속', 'gz-skip', 'secondary')}${button('확인', 'close')}</div>`);
/* 카메라를 쓸 수 없을 때도 테스트는 이어서 볼 수 있게 한다(시선 기록 없음). */
action['gz-skip'] = () => { $('#modal').close(); gzStop(); st.prep = 2; st.ready = true; render(); };
action['cal-next'] = () => (gz.running ? gzCalibrate() : (st.prep = 0, render(), toast('카메라를 먼저 켜 주세요.')));
action['cal-reset'] = () => { if (!gz.running) { st.prep = 0; render(); return; } st.prep = 1; render(); gzCalibrate(); };
action['gz-heatpath'] = () => { st.gzHeatPath = st.gzHeatPath === false; render(); };

/* 경로 재생: 실제 읽은 순서·시간 간격대로(최대 약 15초로 압축) 점과 화살표를 하나씩 보여 준다. */
let gzReplayRaf = 0;
action['gz-replay'] = el => {
  const svg = document.querySelector('.gz-replica .gz-path');
  if (!svg) return;
  if (gzReplayRaf) { cancelAnimationFrame(gzReplayRaf); gzReplayRaf = 0; svg.classList.remove('is-replaying'); svg.querySelectorAll('[data-k]').forEach(n => n.classList.remove('is-shown')); el.textContent = '경로 재생'; return; }
  const ses = gzById(svg.closest('[data-gz-replica]').dataset.gzReplica);
  const fx = gzDrawFixes(ses);
  if (!fx.length) return;
  const t0 = fx[0].start, span = Math.max(1, fx.at(-1).end - t0);
  const speed = Math.max(1, span / 15000);
  const nodes = [...svg.querySelectorAll('[data-k]')];
  const cursor = svg.querySelector('.gz-cursor');
  const y = f => f.sy ?? f.y;
  svg.classList.add('is-replaying');
  el.textContent = '재생 멈춤';
  let shown = -1;
  const startedAt = performance.now();
  const step = now => {
    if (!svg.isConnected) { gzReplayRaf = 0; return; }
    const t = t0 + (now - startedAt) * speed;
    while (shown + 1 < fx.length && fx[shown + 1].start <= t) {
      shown++;
      nodes.forEach(n => { if (+n.dataset.k === shown) n.classList.add('is-shown'); });
      cursor.setAttribute('cx', fx[shown].x);
      cursor.setAttribute('cy', y(fx[shown]));
    }
    if (shown + 1 < fx.length) { gzReplayRaf = requestAnimationFrame(step); return; }
    gzReplayRaf = 0;
    setTimeout(() => { svg.classList.remove('is-replaying'); nodes.forEach(n => n.classList.remove('is-shown')); el.textContent = '경로 재생'; }, 1200);
  };
  gzReplayRaf = requestAnimationFrame(step);
};

action['gz-dot'] = el => {
  gz.dot = !gz.dot;
  if (!gz.dot) gzHideDot();
  el.textContent = gz.dot ? '시선 점 숨기기' : '시선 점 보기';
};
const gzOrigReadDone = action['read-done'];
action['read-done'] = () => {
  const ses = gzFinishReading();
  gzOrigReadDone();
  if (ses) toast(`시선 기록을 저장했어요. 고정 ${ses.metrics.fixations}회 · 유효 추적 ${ses.metrics.validPct}%`);
};
for (const key of ['font-plus', 'font-minus']) {
  const orig = action[key];
  action[key] = el => {
    const before = st.font;
    orig(el);
    if (gz.collect && st.font !== before) gzRestart('글자 크기가 바뀌어 시선 기록을 처음부터 다시 시작해요.');
  };
}
const gzOrigLogout = action.logout;
action.logout = () => { gzStop(); gzOrigLogout(); };

let gzResizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(gzResizeTimer);
  gzResizeTimer = setTimeout(() => { if (gz.collect) gzRestart('창 크기가 바뀌어 시선 기록을 처음부터 다시 시작해요.'); }, 300);
});

afterRenderHooks.push(() => {
  const page = st.page;
  if (gz.collect && page !== 's-reading') { gz.collect = null; clearInterval(gz.liveTimer); }
  if ((gz.running || gz.starting) && !['s-prep', 's-reading'].includes(page)) gzStop();
  if (page !== 's-reading') gzHideDot();

  const slot = document.querySelector('[data-gz-preview]');
  if (slot && gz.running) {
    if (!gz.preview) {
      gz.preview = document.createElement('video');
      gz.preview.className = 'gz-preview-video';
      gz.preview.muted = true;
      gz.preview.playsInline = true;
      gz.preview.autoplay = true;
    }
    const src = document.getElementById('webgazerVideoFeed')?.srcObject;
    if (src && gz.preview.srcObject !== src) gz.preview.srcObject = src;
    slot.prepend(gz.preview);
    gz.preview.play().catch(() => {});
  }

  if (page === 's-reading' && gz.running) {
    if (!gz.collect) gzReadingStart();
    else if (!gz.collect.art.isConnected) {
      const art = document.querySelector('.reader .article');
      if (art) { gzWrapWords(art); gz.collect.art = art; gz.collect.layout = gzMeasure(art); }
    }
  }

  document.querySelectorAll('[data-gz-replica]').forEach(el => {
    const canvas = el.querySelector('canvas[data-gz-heat]');
    const ses = gzById(el.dataset.gzReplica);
    if (canvas && ses) gzDrawHeat(canvas, ses);
  });
});

/* 리포트 수치(수정사항 형식): 독해 속도 · 시선 고정 시간 · 시폭.
   시폭은 고정 한 번에 읽은 글자 수(본문 글자 수 ÷ 단어에 배정된 고정 수)로 계산한다.
   비교 기준은 임시 기준값이며, 학년 자료가 쌓이면 그 평균으로 바꾼다. */
const GZ_NORM = { cpm: 650, fixMs: 250, span: 9 };
const GZ_CMP = {
  cpm: ['독해 속도가 평균 대비 빠른 편입니다.', '독해 속도가 평균 대비 느린 편입니다.', '독해 속도가 평균과 비슷합니다.'],
  fixMs: ['시선 고정 시간은 평균 대비 깁니다.', '시선 고정 시간은 평균 대비 짧습니다.', '시선 고정 시간은 평균과 비슷합니다.'],
  span: ['시폭은 평균 대비 깁니다.', '시폭은 평균 대비 짧습니다.', '시폭은 평균과 비슷합니다.'],
};
const gzCompare = (kind, v) => { const avg = GZ_NORM[kind], [hi, lo, same] = GZ_CMP[kind]; return v > avg * 1.1 ? hi : v < avg * 0.9 ? lo : same; };
function gzStatRow(ses) {
  const m = ses.metrics;
  const chars = typeof fbPassageChars === 'function' ? fbPassageChars() : ses.layout.words.reduce((s, w) => s + w.t.replace(/\s/g, '').length, 0);
  const cpm = m.durationMs ? Math.round(chars / (m.durationMs / 60000)) : 0;
  const span = m.fixations ? Math.round((chars / m.fixations) * 10) / 10 : 0;
  return gzStatHtml(cpm, m.meanFixMs, span);
}
function gzStatHtml(cpm, fixMs, span) {
  return `<div class="report-stat-row"><div><strong>독해 속도 ${cpm}&nbsp;글자/분</strong>${gzCompare('cpm', cpm)}</div><div><strong>시선 고정 시간 ${fixMs}ms</strong>${gzCompare('fixMs', fixMs)}</div><div><strong>시폭 ${span}글자</strong>${gzCompare('span', span)}</div></div>`;
}

render();
