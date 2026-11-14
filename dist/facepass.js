/* facepass.js — 페이스패스 등록·로그인.
   얼굴 인식: @vladmandic/face-api (TinyFaceDetector + 68점 랜드마크 + 128차원 얼굴 특징값, MIT).
   생체 확인: 눈 깜빡임(EAR, 68점 랜드마크). 사진 한 장으로는 통과할 수 없지만 영상 재생 공격까지 막지는 못한다.
   서버가 없으므로 등록 정보(이름·역할·특징값)는 이 브라우저 localStorage에만 저장한다. 얼굴 사진·영상은 저장하지 않는다.
   실제 운영에서는 특징값 비교를 서버에서 하고, 결과로 받은 사용자 ID·역할로 화면을 나눠야 한다. */

const FP_STORE = 'lookteracy-facepass-v1';
const FP_USER_KEY = 'lookteracy-demo-user';
const FP_MODELS = 'vendor/face-api/models';
const FP = {
  // 눈 깜빡임은 사람마다(안경, 눈 크기, 고개 각도) 뜬 눈 값이 달라서 고정값 대신 정면 수집 때 잰 그 사람의 뜬 눈 값(기준값)과 비교한다.
  lookMinEar: 0.17,     // 정면 수집 때 이보다 작으면 눈을 감은 프레임으로 보고 건너뜀
  closedRatio: 0.8,     // 기준값의 80% 아래로 내려가면 눈 감음
  openRatio: 0.9,       // 다시 기준값의 90% 위로 올라오면 눈 뜸
  closedFrames: 1,      // 감은 상태 프레임 수 (깜빡임 단계는 30fps 이상으로 돌아 한 번 깜빡임이 3~6프레임)
  redetectMs: 400,      // 깜빡임 단계에서 얼굴 위치를 다시 찾는 간격 (68점 대체 방식)
  blinkRise: 0.25,      // MediaPipe: 뜬 눈 점수보다 이만큼 높아지면 감음
  blinkCloseMin: 0.45,  // MediaPipe: 감음 기준의 하한
  blinkCloseMax: 0.75,  // MediaPipe: 감음 기준의 상한
  loginSamples: 4,      // 로그인 때 모을 정면 특징값 수
  enrollSamples: 6,     // 등록 때 모을 정면 특징값 수
  matchMax: 0.5,        // 이 거리보다 가까워야 같은 사람
  margin: 0.04,         // 1등과 2등 후보의 최소 거리 차
  duplicate: 0.4,       // 다른 이름으로 이미 등록된 얼굴로 볼 거리
  spreadMax: 0.55,      // 한 번의 확인에서 모은 특징값끼리의 최대 거리
  minFace: 0.16,        // 화면 너비 대비 최소 얼굴 너비
  blinkTimeout: 9000,
  minFrameMs: 33,
};

const fp = { mode: null, phase: 'idle', msg: '', user: null, stream: null, video: null, token: 0, run: null, api: null };
const afterRenderHooks = [];

/* ---------- 공통: 스크립트 지연 로딩, 렌더 후 훅 ---------- */
const loadedScripts = new Map();
function loadScriptOnce(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { loadedScripts.delete(src); reject(new Error('스크립트를 불러오지 못했어요: ' + src)); };
      document.head.appendChild(s);
    }));
  }
  return loadedScripts.get(src);
}

const fpOrigRender = render;
render = function () {
  fpOrigRender();
  for (const hook of afterRenderHooks) {
    try { hook(); } catch (err) { console.error(err); }
  }
};

/* ---------- 저장소 ---------- */
function fpUsers() {
  try {
    const data = JSON.parse(localStorage.getItem(FP_STORE) ?? 'null');
    return Array.isArray(data?.users) ? data.users : [];
  } catch { return []; }
}
function fpSaveUsers(users) {
  localStorage.setItem(FP_STORE, JSON.stringify({ schema: 1, users }));
}
try {
  const saved = JSON.parse(sessionStorage.getItem(FP_USER_KEY) ?? 'null');
  if (saved && saved.role === st.role) st.user = saved;
} catch {}

/* ---------- 얼굴 기하 (68점 랜드마크) ---------- */
const fpDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function fpEar(eye) {
  const [p1, p2, p3, p4, p5, p6] = eye;
  const w = fpDist(p1, p4);
  return w > 0 ? (fpDist(p2, p6) + fpDist(p3, p5)) / (2 * w) : 0;
}
const fpEarOf = (lm) => (fpEar(lm.slice(36, 42)) + fpEar(lm.slice(42, 48))) / 2;
function fpVecDist(a, b) {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}
function fpMean(list) {
  const out = new Array(list[0].length).fill(0);
  for (const v of list) for (let i = 0; i < out.length; i++) out[i] += v[i] / list.length;
  return out;
}
function fpSpread(list) {
  let max = 0;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) max = Math.max(max, fpVecDist(list[i], list[j]));
  return max;
}

/* ---------- 눈 깜빡임 모델: MediaPipe Face Landmarker의 eyeBlink 점수 (Apache-2.0) ----------
   face-api의 68점 랜드마크는 눈을 감아도 눈꺼풀 점이 조금밖에 움직이지 않아(특히 안경, 아래를 보는 자세) 깜빡임을 자주 놓친다.
   MediaPipe는 눈 감김 정도를 0~1 점수로 직접 내주므로 이것을 쓰고, 불러오지 못하면 68점 EAR 방식으로 돌아간다. */
const FP_MP = 'vendor/mediapipe-tasks';
let fpMpPromise = null;
let fpMpTs = 0;
function fpBlinkModel() {
  if (!fpMpPromise) {
    fpMpPromise = (async () => {
      const vision = await import(new URL(FP_MP + '/vision_bundle.mjs', location.href).href);
      const fileset = await vision.FilesetResolver.forVisionTasks(new URL(FP_MP + '/wasm', location.href).href);
      const options = delegate => ({ baseOptions: { modelAssetPath: new URL(FP_MP + '/face_landmarker.task', location.href).href, delegate }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true });
      let model;
      try { model = await vision.FaceLandmarker.createFromOptions(fileset, options('GPU')); }
      catch (err) { console.warn('[facepass] GPU delegate failed, using CPU', err); model = await vision.FaceLandmarker.createFromOptions(fileset, options('CPU')); }
      // 첫 호출은 GPU 준비로 수 초가 걸리므로 카메라를 켜기 전에 한 번 돌려 둔다. 이후 한 프레임은 2~8ms.
      const warm = Object.assign(document.createElement('canvas'), { width: 640, height: 480 });
      warm.getContext('2d').fillRect(0, 0, 640, 480);
      fpBlinkScore(model, warm);
      return model;
    })().catch(err => {
      console.warn('[facepass] MediaPipe blink model unavailable, falling back to 68-point landmarks', err);
      fpMpPromise = null;
      return null;
    });
  }
  return fpMpPromise;
}

/** 두 눈의 감김 점수 평균(0 = 뜸, 1 = 감음). 얼굴이 없으면 null. */
function fpBlinkScore(model, source) {
  const ts = Math.max(performance.now(), fpMpTs + 1);
  fpMpTs = ts;
  const cats = model.detectForVideo(source, ts).faceBlendshapes?.[0]?.categories;
  if (!cats) return null;
  const get = name => cats.find(c => c.categoryName === name)?.score ?? 0;
  return (get('eyeBlinkLeft') + get('eyeBlinkRight')) / 2;
}

/* ---------- 모델·카메라 ---------- */
async function fpApi() {
  if (fp.api) return fp.api;
  await loadScriptOnce('vendor/face-api/face-api.js');
  const faceapi = window.faceapi;
  await faceapi.tf.setBackend('webgl').catch(() => faceapi.tf.setBackend('cpu'));
  await faceapi.tf.ready();
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(FP_MODELS),
    faceapi.nets.faceLandmark68Net.loadFromUri(FP_MODELS),
    faceapi.nets.faceRecognitionNet.loadFromUri(FP_MODELS),
  ]);
  fp.api = faceapi;
  return faceapi;
}

function fpCameraError(err) {
  if (err?.name === 'NotAllowedError') return '카메라 권한이 막혀 있어요. 주소창의 카메라 아이콘에서 허용으로 바꾼 뒤 다시 시도해 주세요.';
  if (err?.name === 'NotFoundError') return '사용할 수 있는 카메라를 찾지 못했어요.';
  if (err?.name === 'NotReadableError') return '다른 앱이 카메라를 쓰고 있어요. 그 앱을 닫고 다시 시도해 주세요.';
  return '얼굴 인식을 준비하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.';
}

async function fpStart(mode) {
  fpStop();
  const token = ++fp.token;
  Object.assign(fp, { mode, phase: 'loading', msg: '얼굴 인식 모델을 불러오고 있어요.', user: null });
  if (mode === 'login') st.faceScan = false;
  if (mode === 'enroll') st.registered = false;
  render();
  try {
    const [api, mp] = await Promise.all([fpApi(), fpBlinkModel()]);
    fpSetMsg('카메라를 켜고 있어요.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    if (token !== fp.token) { stream.getTracks().forEach(t => t.stop()); return; }
    if (!fp.video) {
      fp.video = document.createElement('video');
      fp.video.className = 'fp-video';
      fp.video.muted = true;
      fp.video.playsInline = true;
      fp.video.autoplay = true;
      fp.video.setAttribute('aria-hidden', 'true');
    }
    fp.stream = stream;
    fp.video.srcObject = stream;
    await fp.video.play().catch(() => {});
    fp.run = { mp, samples: [], ears: [], scores: [], base: 0, sBase: 0, closeTh: 0, openTh: 0, peak: 0, box: null, closedRun: 0, wasClosed: false, blinkAt: 0, lastDetect: 0, lost: 0, minEar: 1, frames: 0, hinted: false };
    fp.phase = 'look';
    fp.msg = '정면을 바라봐 주세요.';
    render();
    fpTick(token, api);
  } catch (err) {
    console.error(err);
    if (token !== fp.token) return;
    fpStop();
    Object.assign(fp, { phase: 'error', msg: fpCameraError(err) });
    render();
  }
}

function fpStop() {
  fp.token++;
  fp.stream?.getTracks().forEach(t => t.stop());
  fp.stream = null;
  if (fp.video) fp.video.srcObject = null;
}

/** 깜빡임 단계에서 눈이 얼마나 감겼는지 막대로 보여 준다(1 = 감음으로 인정). */
function fpMeter(level) {
  const bar = document.querySelector('[data-fp-meter]');
  if (!bar) return;
  const v = Math.min(1, Math.max(0, level));
  bar.style.width = Math.round(v * 100) + '%';
  bar.parentElement.classList.toggle('is-closed', v >= 1 || fp.run?.wasClosed);
}

function fpSetMsg(msg) {
  fp.msg = msg;
  const node = document.querySelector('[data-fp-status]');
  if (node) node.textContent = msg;
}

async function fpTick(token, api) {
  if (token !== fp.token) return;
  const t0 = performance.now();
  try { await fpStep(api); } catch (err) { console.error(err); }
  if (token !== fp.token) return;
  const minMs = fp.phase === 'blink' ? 10 : FP.minFrameMs; // 깜빡임은 짧아서 그 단계만 최대한 빠르게 본다
  setTimeout(() => fpTick(token, api), Math.max(0, minMs - (performance.now() - t0)));
}

const fpDetectOptions = api => new api.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });
const fpMedian = list => { const s = [...list].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

/* 마지막으로 찾은 얼굴 영역만 잘라 68점 랜드마크를 구한다. 얼굴 검출을 다시 하지 않으므로
   눈을 감는 순간 검출기가 얼굴을 놓쳐도 그 프레임을 잃지 않고, 한 프레임이 훨씬 빠르다. */
const fpCrop = document.createElement('canvas');
async function fpCropEar(api, source, box) {
  const s = 160 / Math.max(box.width, box.height);
  fpCrop.width = Math.max(1, Math.round(box.width * s));
  fpCrop.height = Math.max(1, Math.round(box.height * s));
  fpCrop.getContext('2d').drawImage(source, box.x, box.y, box.width, box.height, 0, 0, fpCrop.width, fpCrop.height);
  const lm = await api.detectFaceLandmarks(fpCrop);
  return fpEarOf((Array.isArray(lm) ? lm[0] : lm).positions);
}

async function fpStep(api) {
  const video = fp.video;
  if (!video || video.readyState < 2 || !video.videoWidth) return;
  const run = fp.run;

  if (fp.phase === 'look') {
    // 특징값 계산이 가장 느리므로 정면 수집 단계에서만 구한다.
    const res = await api.detectSingleFace(video, fpDetectOptions(api)).withFaceLandmarks().withFaceDescriptor();
    if (fp.phase !== 'look') return;
    if (!res) { fpSetMsg('얼굴이 보이지 않아요. 안내선 안으로 들어와 주세요.'); return; }
    if (res.detection.box.width / video.videoWidth < FP.minFace) { fpSetMsg('조금 더 가까이 와 주세요.'); return; }
    const ear = fpEarOf(res.landmarks.positions);
    run.box = res.detection.box;
    if (ear > FP.lookMinEar) {
      run.samples.push(Array.from(res.descriptor));
      run.ears.push(ear);
      const s = run.mp ? fpBlinkScore(run.mp, video) : null;
      if (s !== null) run.scores.push(s);
    }
    const need = fp.mode === 'enroll' ? FP.enrollSamples : FP.loginSamples;
    fpSetMsg(`정면을 바라봐 주세요. ${Math.min(run.samples.length, need)} / ${need}`);
    if (run.samples.length >= need) {
      run.base = fpMedian(run.ears);
      // 뜬 눈의 감김 점수(아래를 보면 0.3 안팎까지 오른다)보다 충분히 높아야 감은 것으로 본다.
      run.sBase = run.scores.length ? fpMedian(run.scores) : 0;
      run.closeTh = Math.min(FP.blinkCloseMax, Math.max(FP.blinkCloseMin, run.sBase + FP.blinkRise));
      run.openTh = Math.max(run.sBase + 0.1, run.closeTh - 0.25);
      run.blinkAt = Date.now();
      run.lastDetect = performance.now();
      fp.phase = 'blink';
      render();
      fpSetMsg('눈을 한 번 깜빡여 주세요.');
    }
    return;
  }

  if (fp.phase !== 'blink') return;
  const elapsed = Date.now() - run.blinkAt;
  if (elapsed > FP.blinkTimeout) {
    console.info('[facepass] blink not detected', run.mp
      ? { model: 'mediapipe', openScore: +run.sBase.toFixed(3), closeAt: +run.closeTh.toFixed(3), peak: +run.peak.toFixed(3), frames: run.frames }
      : { model: 'face-api', base: +run.base.toFixed(3), minEar: +run.minEar.toFixed(3), minRatio: +(run.minEar / run.base).toFixed(2), frames: run.frames });
    fpFail('눈 깜빡임을 확인하지 못했어요. 다시 시도해 주세요.');
    return;
  }
  if (elapsed > 4000 && !run.hinted) { run.hinted = true; fpSetMsg('눈을 한 번 감았다가 떠 주세요.'); }

  if (run.mp) {
    const s = fpBlinkScore(run.mp, video);
    if (s === null) { if (++run.lost >= 6) fpSetMsg('얼굴이 보이지 않아요. 안내선 안으로 들어와 주세요.'); return; }
    run.lost = 0;
    run.frames++;
    run.peak = Math.max(run.peak, s);
    fpMeter((s - run.sBase) / Math.max(0.05, run.closeTh - run.sBase));
    if (s >= run.closeTh) {
      run.closedRun++;
      if (run.closedRun >= FP.closedFrames) run.wasClosed = true;
    } else {
      run.closedRun = 0;
      if (run.wasClosed && s <= run.openTh) {
        console.info('[facepass] blink', { model: 'mediapipe', openScore: +run.sBase.toFixed(3), closeAt: +run.closeTh.toFixed(3), peak: +run.peak.toFixed(3), frames: run.frames });
        fpFinish();
      }
    }
    return;
  }

  if (performance.now() - run.lastDetect > FP.redetectMs) {
    run.lastDetect = performance.now();
    const det = await api.detectSingleFace(video, fpDetectOptions(api));
    if (fp.phase !== 'blink') return;
    if (det) { run.box = det.box; run.lost = 0; }
    else if (++run.lost >= 4) { fpSetMsg('얼굴이 보이지 않아요. 안내선 안으로 들어와 주세요.'); return; }
  }
  const ear = await fpCropEar(api, video, run.box);
  if (fp.phase !== 'blink') return;
  run.frames++;
  run.minEar = Math.min(run.minEar, ear);
  if (ear < run.base * FP.closedRatio) {
    run.closedRun++;
    if (run.closedRun >= FP.closedFrames) run.wasClosed = true;
  } else {
    run.closedRun = 0;
    if (run.wasClosed && ear > run.base * FP.openRatio) {
      console.info('[facepass] blink', { base: +run.base.toFixed(3), minEar: +run.minEar.toFixed(3), frames: run.frames });
      fpFinish();
    }
  }
}

function fpFail(msg) {
  fpStop();
  Object.assign(fp, { phase: 'fail', msg });
  render();
}

function fpFinish() {
  const samples = fp.run.samples;
  if (fpSpread(samples) > FP.spreadMax) { fpFail('얼굴이 많이 움직여서 확인하지 못했어요. 자세를 고정하고 다시 시도해 주세요.'); return; }
  const probe = fpMean(samples);
  const users = fpUsers();

  if (fp.mode === 'login') {
    if (!users.length) { fpFail('이 기기에 등록된 페이스패스가 없어요. 먼저 등록해 주세요.'); return; }
    const ranked = users
      .map(u => ({ u, d: Math.min(...u.descriptors.map(v => fpVecDist(probe, v))) }))
      .sort((a, b) => a.d - b.d);
    const best = ranked[0];
    // 한 사람이 학생·교사로 각각 등록할 수 있다(이름이 달라도 됨). 같은 역할 안에서 다른 이름이 비슷하게 맞으면 누구인지 알 수 없으므로 실패로 본다.
    const sameRoleRival = ranked.find(x => x.u.role === best.u.role && x.u.name !== best.u.name);
    console.info('[facepass] best distance', best.d.toFixed(3), sameRoleRival ? 'same-role other ' + sameRoleRival.d.toFixed(3) : '');
    if (best.d > FP.matchMax || (sameRoleRival && sameRoleRival.d - best.d < FP.margin)) { fpFail('등록된 얼굴과 일치하지 않아요. 밝은 곳에서 다시 시도해 주세요.'); return; }
    fpStop();
    // 역할마다 가장 잘 맞는 등록 하나씩. 같은 얼굴로 만든 등록은 거리가 비슷하므로 1등과 0.1 이내만 함께 보여 준다.
    const roles = ['student', 'teacher']
      .map(r => ranked.find(x => x.u.role === r))
      .filter(x => x && x.d <= FP.matchMax && x.d - best.d < 0.1)
      .map(x => x.u);
    if (roles.length > 1) {
      const names = [...new Set(roles.map(u => u.name))];
      Object.assign(fp, { phase: 'choose', user: best.u, choices: roles, msg: `${names.join(' · ')}님으로 확인했어요. 들어갈 공간을 골라 주세요.` });
      st.faceScan = true;
      render();
      return;
    }
    Object.assign(fp, { phase: 'success', user: best.u, msg: `${best.u.name}님으로 확인했어요.` });
    st.faceScan = true;
    render();
    setTimeout(() => { if (fp.phase === 'success' && fp.user === best.u && st.page === 'login-student') fpLogin(best.u); }, 900);
    return;
  }

  const name = st.signupName.trim();
  const role = st.signupRole === 'teacher' ? 'teacher' : 'student';
  // 같은 역할에 다른 이름으로 이미 등록된 얼굴만 막는다. 학생으로 등록한 사람이 교사로 등록하는 것은 허용.
  const other = users.find(u => u.role === role && u.name !== name && Math.min(...u.descriptors.map(v => fpVecDist(probe, v))) < FP.duplicate);
  if (other) { fpFail(`이미 ${other.name}(${role === 'teacher' ? '교사' : '학생'}) 이름으로 등록된 얼굴이에요. 같은 사람이면 이름을 똑같이 쓰거나, 로그인 도움에서 등록 정보를 지운 뒤 다시 등록해 주세요.`); return; }
  const user = {
    id: 'fp-' + Date.now().toString(36),
    name, role,
    descriptors: samples.map(v => v.map(x => Math.round(x * 1e4) / 1e4)),
    createdAt: new Date().toISOString(),
  };
  fpSaveUsers([...users.filter(u => !(u.name === name && u.role === role)), user]);
  fpStop();
  Object.assign(fp, { phase: 'success', user, msg: `${name}님의 ${role === 'teacher' ? '교사' : '학생'} 페이스패스를 등록했어요.` });
  st.registered = true;
  render();
}

function fpLogin(user) {
  st.user = { id: user.id, name: user.name, role: user.role };
  try { sessionStorage.setItem(FP_USER_KEY, JSON.stringify(st.user)); } catch {}
  Object.assign(fp, { mode: null, phase: 'idle', msg: '', user: null, choices: null });
  st.faceScan = false;
  st.reportAutoPicked = false;
  loginAs(user.role);
  toast(`${user.name}님, 반가워요.`);
}

/* ---------- 화면 ---------- */
const fpBusy = (mode) => fp.mode === mode && ['loading', 'look', 'blink'].includes(fp.phase);

const fpOrigFaceFrame = faceFrame;
faceFrame = function (success = false) {
  if (!fp.stream) return fpOrigFaceFrame(success);
  return `<div class="face-frame fp-live ${fp.phase === 'blink' ? 'is-blink' : ''}" data-fp-slot role="img" aria-label="카메라에 비친 얼굴">${['tl', 'tr', 'bl', 'br'].map(c => `<i class="face-corner ${c}"></i>`).join('')}<span class="face-label">${fp.phase === 'blink' ? '눈 깜빡임 확인' : '페이스패스'}</span>${fp.phase === 'blink' && fp.run?.mp ? '<span class="fp-meter" aria-hidden="true"><i data-fp-meter></i></span>' : ''}</div>`;
};

function fpStateClass(mode) {
  if (fp.mode !== mode) return '';
  return ['success', 'choose'].includes(fp.phase) ? 'is-ready' : ['fail', 'error'].includes(fp.phase) ? 'is-error' : '';
}

const fpOrigLogin = login;
/* 로그인 화면: 최신 UI 마크업을 그대로 쓰고(교사 바로가기 아이콘 포함), 상태 문구와 버튼만 실제 얼굴 확인 상태로 바꾼다. */
login = function (student) {
  if (!student) return fpOrigLogin(false);
  const tpl = document.createElement('template');
  tpl.innerHTML = fpOrigLogin(true);
  const mine = fp.mode === 'login';
  const done = mine && ['success', 'choose'].includes(fp.phase);
  const busy = fpBusy('login');
  const retry = mine && ['fail', 'error'].includes(fp.phase);
  const msg = mine && fp.msg ? fp.msg : fpUsers().length ? '밝은 곳에서 정면을 바라봐 주세요.' : '이 기기에 등록된 페이스패스가 없어요. 먼저 등록해 주세요.';
  const state = tpl.content.querySelector('.face-state');
  if (state) {
    state.className = `face-state ${fpStateClass('login')}`;
    state.setAttribute('data-fp-status', '');
    state.innerHTML = (done ? icon('check') : '') + esc(msg);
  }
  const previewBtn = tpl.content.querySelector('[data-action="face-preview"]');
  const loginBtn = tpl.content.querySelector('[data-action="login-student"]');
  if (mine && fp.phase === 'choose' && fp.choices?.length) {
    const named = new Set(fp.choices.map(u => u.name)).size > 1;
    const buttons = ['student', 'teacher'].filter(r => fp.choices.some(u => u.role === r)).map(r => button(`${r === 'teacher' ? '교사' : '학생'} 공간으로${named ? ` (${esc(fp.choices.find(u => u.role === r).name)})` : ''} ${icon('arrow')}`, 'fp-choose', `full ${r === 'student' ? 'auth-login-button' : 'secondary'}`, `data-role="${r}"`)).join('');
    previewBtn?.insertAdjacentHTML('beforebegin', `<div class="fp-choose">${buttons}</div>`);
    previewBtn?.remove();
    loginBtn?.remove();
  } else if (previewBtn) {
    previewBtn.textContent = busy ? '확인하는 중' : retry ? '다시 확인하기' : '얼굴 확인하기';
    if (busy) previewBtn.setAttribute('disabled', '');
  }
  return tpl.innerHTML;
};

signup = function () {
  const role = st.signupRole === 'teacher' || st.signupRole === 'student' ? st.signupRole : null;
  const roleName = role === 'teacher' ? '교사' : '학생';
  let body = '';
  if (st.signup === 0) {
    body = `<p class="small">어떤 공간을 쓸지 먼저 골라 주세요. 페이스패스로 로그인하면 여기서 고른 공간으로 들어가요.</p><div class="fp-role-cards" role="radiogroup" aria-label="가입 유형">${[['student', '학생', '배정된 테스트를 읽고 선생님의 피드백을 받아요.'], ['teacher', '교사', '테스트를 배정하고 학생별 읽기 리포트를 확인해요.']].map(([v, t, d]) => `<button type="button" class="fp-role-card ${role === v ? 'active' : ''}" role="radio" aria-checked="${role === v}" data-action="fp-role" data-role="${v}"><strong>${t}</strong><span>${d}</span></button>`).join('')}</div>${note('한 사람이 학생과 교사 공간을 모두 쓰려면 같은 이름으로 한 번씩 등록하세요. 로그인할 때 들어갈 공간을 고를 수 있어요.')}`;
  }
  if (st.signup === 1) {
    body = `${field('이름', 'signupName', st.signupName, 'text', '이름을 입력하세요')}${role === 'student' ? field('학급 연결 코드', 'signupCode', st.signupCode, 'text', '선생님에게 받은 코드를 입력하세요') : ''}<div class="source-box">${badge(role === 'student' ? '연결할 학급' : '담당 학급', 'blue')}<h3 style="margin-top:12px">인하고등학교 · 1학년 2반</h3><p class="small">${role === 'student' ? '김하늘 선생님 · 담당 학급' : '교사로 등록하면 로그인 후 교사 공간으로 들어가요.'}</p></div>`;
  }
  if (st.signup === 2) {
    body = `<div class="rubric"><h3>어떤 정보를, 왜 사용하나요?</h3><p>학급 연결 정보, 시선 좌표·읽기 시간, 문항 응답, 협력 활동 기록을 학습 지원과 교사의 지도에 활용해요.</p></div><div class="rubric"><h3>영상과 보관에 대해 알려드려요</h3><p>카메라 영상은 이 브라우저 안에서만 처리하고 저장하거나 전송하지 않아요. 시선 좌표와 읽기 시간만 기록해요.</p></div><div class="rubric"><h3>페이스패스 정보는 이렇게 저장해요</h3><p>얼굴 사진 대신 얼굴 특징값(숫자 128개)만 만들어 이 기기의 브라우저에 저장해요. 로그인 도움 화면에서 언제든 지울 수 있어요.</p></div><label class="check-row"><input type="checkbox"><span>수집·활용·보관 안내를 확인했어요</span></label>`;
  }
  if (st.signup === 3) {
    const mine = fp.mode === 'enroll';
    const busy = fpBusy('enroll');
    const msg = mine && fp.msg ? fp.msg : st.registered ? '등록을 마쳤어요.' : '밝은 곳에서 정면을 바라보고 얼굴을 맞춰 주세요.';
    body = `<p class="small">${esc(st.signupName.trim() || '이름 없음')} · ${roleName} 계정에 얼굴을 연결해요. 정면을 잠시 바라본 뒤 눈을 한 번 깜빡이면 등록돼요.</p>${faceFrame(st.registered)}<div class="face-state ${fpStateClass('enroll')}" role="status" data-fp-status>${st.registered ? icon('check') : ''}${esc(msg)}</div>${button(busy ? '등록하는 중' : st.registered ? '다시 등록하기' : '페이스패스 등록 시작', 'register-face', 'secondary full', busy ? 'disabled' : '')}${note('얼굴 사진은 저장하지 않아요. 얼굴 특징값만 이 브라우저에 저장하고 서버로 보내지 않아요.')}`;
  }
  const steps = ['가입 유형', role === 'teacher' ? '교사 정보' : '학급 연결', '수집·보관 안내', '페이스패스 등록'];
  return `<div class="public">${publicHeader()}<main class="signup-wrap" id="main" tabindex="-1"><section class="auth-card"><span class="eyebrow">WELCOME TO LOOKTERACY</span><h1 style="font-size:28px;margin:12px 0">나의 읽기 공간을 준비해요</h1>${stepper(steps, st.signup)}${body}<div class="signup-nav">${button(st.signup ? '이전' : '로그인으로', 'signup-back', 'secondary')}${button(st.signup === 3 ? '등록 완료 · 로그인으로' : '다음 단계 ' + icon('arrow'), 'signup-next')}</div></section></main>${publicFooter()}</div>`;
};
names.signup = '가입·등록';

/* 프로필 이름: 페이스패스로 로그인한 사용자를 표시한다. */
const fpOrigShell = shell;
shell = function (content) {
  const html = fpOrigShell(content);
  const name = st.user?.name;
  if (!name) return html;
  const fallback = st.role === 'teacher' ? '김하늘' : '김서윤';
  return html.replace(av(fallback), av(name)).replace(`<strong>${fallback}<small>`, `<strong>${esc(name)}<small>`);
};
const fpOrigHome = views['s-home'];
views['s-home'] = () => {
  const html = fpOrigHome();
  const name = st.user?.name;
  if (!name) return html;
  const given = name.length === 3 ? name.slice(1) : name;
  return html.replace('서윤님, 오늘의 읽기를 시작해요.', `${esc(given)}님, 오늘의 읽기를 시작해요.`);
};

/* ---------- 동작 ---------- */
action['face-preview'] = () => fpStart('login');
action['login-student'] = () => {
  if (fp.mode === 'login' && fp.phase === 'success' && fp.user) { fpLogin(fp.user); return; }
  if (fp.mode === 'login' && fp.phase === 'choose') { toast('들어갈 공간을 골라 주세요.'); return; }
  if (fpBusy('login')) { toast('얼굴 확인이 끝나면 로그인할 수 있어요.'); return; }
  fpStart('login');
};
action['fp-choose'] = el => {
  const user = fp.choices?.find(u => u.role === el.dataset.role);
  if (user) fpLogin(user);
};
action['fp-role'] = el => { st.signupRole = el.dataset.role; render(); };
action['register-face'] = () => {
  if (!st.signupName.trim()) { st.signup = 1; render(); toast('이름을 먼저 입력해 주세요.'); return; }
  fpStart('enroll');
};
action['signup-next'] = () => {
  if (st.signup === 0 && !['student', 'teacher'].includes(st.signupRole)) { toast('학생과 교사 중 하나를 골라 주세요.'); return; }
  if (st.signup === 1 && !st.signupName.trim()) { toast('이름을 입력해 주세요.'); $('[data-bind="signupName"]')?.focus(); return; }
  if (st.signup < 3) { st.signup++; render(); return; }
  if (!st.registered) { toast('페이스패스 등록을 먼저 마쳐 주세요.'); return; }
  fpStop();
  Object.assign(fp, { mode: null, phase: 'idle', msg: '', user: null });
  st.signup = 0;
  st.registered = false;
  st.signupName = '';
  st.signupCode = '';
  st.signupRole = null;
  route('login-student');
  toast('등록을 마쳤어요. 얼굴 확인으로 로그인해 주세요.');
};
const fpOrigSignupBack = action['signup-back'];
action['signup-back'] = () => {
  fpStop();
  Object.assign(fp, { mode: null, phase: 'idle', msg: '' });
  fpOrigSignupBack();
};
action['face-help'] = () => {
  const users = fpUsers();
  modal('페이스패스 로그인 도움', `<p>얼굴이 안내선 안에 들어오도록 화면을 바라봐 주세요. 정면을 잠시 바라본 뒤 눈을 한 번 깜빡이면 확인이 끝나요.</p><ul class="help-list"><li>밝은 곳에서 모자나 마스크로 얼굴을 가리지 않기</li><li>카메라 권한을 묻는 창이 뜨면 허용하기</li><li>계속 실패하면 페이스패스를 다시 등록하기</li></ul><div class="rubric"><h3>이 기기에 등록된 페이스패스 ${users.length}명</h3><p>${users.length ? users.map(u => `${esc(u.name)} (${u.role === 'teacher' ? '교사' : '학생'})`).join(', ') : '아직 등록된 얼굴이 없어요.'}</p></div><div class="actions">${users.length ? button('등록 정보 모두 지우기', 'fp-clear', 'secondary') : ''}${button('모든 기록 초기화', 'fp-reset-all', 'secondary')}${button('확인', 'close')}</div><p class="small" style="margin-top:12px">‘모든 기록 초기화’는 페이스패스 등록, 응시·시선 기록, 목표, 칭찬, 피드백을 이 브라우저에서 모두 지우고 처음 화면으로 돌아가요.</p>`);
};
action['fp-reset-all'] = () => {
  fpStop();
  if (typeof gzStop === 'function') gzStop();
  for (const key of Object.keys(localStorage)) if (key.startsWith('lookteracy-')) localStorage.removeItem(key);
  try { sessionStorage.clear(); } catch {}
  location.hash = '#landing';
  location.reload();
};
action['fp-clear'] = () => {
  localStorage.removeItem(FP_STORE);
  $('#modal').close();
  toast('이 기기에 저장된 페이스패스 등록 정보를 지웠어요.');
  render();
};
const fpOrigLogout = action.logout;
action.logout = () => {
  fpStop();
  Object.assign(fp, { mode: null, phase: 'idle', msg: '', user: null });
  st.user = null;
  try { sessionStorage.removeItem(FP_USER_KEY); } catch {}
  fpOrigLogout();
};

/* 로그인한 채로 로그인·가입 주소(#login-teacher 등)에 들어오면, 기존 로그인을 해제하고 그 화면을 보여 준다. */
function fpSignOut() {
  fpStop();
  Object.assign(fp, { mode: null, phase: 'idle', msg: '', user: null, choices: null });
  if (typeof gzStop === 'function') gzStop();
  st.user = null;
  st.role = null;
  st.reportAutoPicked = false;
  try { sessionStorage.removeItem('lookteracy-demo-role'); sessionStorage.removeItem(FP_USER_KEY); } catch {}
}
const fpOrigRoute = route;
route = function (p, replace = false) {
  // 이미 열린 탭에서 주소를 #reset 으로 바꾸면 기록을 모두 지우고 첫 화면으로 (처음 열 때는 reset.js가 처리)
  if (p === 'reset') {
    fpSignOut();
    for (const key of Object.keys(localStorage)) if (key.startsWith('lookteracy-')) localStorage.removeItem(key);
    try { sessionStorage.clear(); } catch {}
    fpOrigRoute('landing', true);
    toast('이 브라우저의 LOOKteracy 기록을 모두 지웠어요. 처음부터 시작하세요.');
    return;
  }
  if (st.role && ['login-student', 'login-teacher', 'signup'].includes(p)) fpSignOut();
  return fpOrigRoute(p, replace);
};
if (window.lookteracyWasReset) setTimeout(() => toast('이 브라우저의 LOOKteracy 기록을 모두 지웠어요. 처음부터 시작하세요.'), 50);

/* 카메라 영상을 화면에 붙이고, 페이스패스 화면을 벗어나면 카메라를 끈다. */
afterRenderHooks.push(() => {
  if (fp.stream && !['login-student', 'signup'].includes(st.page)) {
    fpStop();
    Object.assign(fp, { mode: null, phase: 'idle', msg: '' });
  }
  const slot = document.querySelector('[data-fp-slot]');
  if (slot && fp.video && fp.stream) {
    slot.prepend(fp.video);
    fp.video.play().catch(() => {});
  }
});
