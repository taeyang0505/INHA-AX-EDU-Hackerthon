/* insight.js — 개념 진단과 성장.
   1) 개념 3분류: 기존 지식(이미 앎) · 난개념(어려워함) · 오개념(다르게 이해함).
      답안(정답 여부, 고른 오답, 서술형 근거)으로 먼저 나누고, 시선 기록(TECH)으로 '맞혔지만 해당 문단에서 오래 머물거나
      여러 번 되돌아 읽은 개념'을 난개념으로 옮긴다. 학급에서 오개념이 많으면 수업 설명을, 난개념이 많으면 재수업을 권한다.
   2) 변화율: 회차(시도)마다 이해 점수·읽기 속도·알고 있는 개념 수를 남기고 지난번과 비교한다.
      모니터링 → 피드백 → 목표 재설정 → 성장의 순환을 학생 화면에 보여 준다.
   3) 레벨: 참여, 점수 상승, 새로 알게 된 개념, 목표 달성, 선생님 칭찬으로 경험치가 쌓인다.
   4) 모둠 추천: 멘토형(잘하는 학생이 모둠을 이끔) · 수준별.
   5) 칭찬 보내기, 보호자 소식 문안 만들기(발송은 연결하지 않음).
   학급의 다른 학생은 '예시' 데이터로 채우고, 실제로 제출한 학생은 실측 데이터로 표시한다. */

const IN_ATTEMPTS = 'lookteracy-attempts-v1';
const IN_GOALS = 'lookteracy-goals-v1';
const IN_PRAISE = 'lookteracy-praise-v1';
const IN_LEVELS = [0, 40, 100, 180];
const IN_LEVEL_NAMES = ['첫걸음 독자', '근거를 찾는 독자', '연결하는 독자', '깊이 읽는 독자'];
const IN_STATE = {
  known: { label: '기존 지식', student: '이미 알고 있는 개념', tone: 'green', teacher: '심화 활동이나 멘토 역할로 이어 가요.' },
  difficult: { label: '난개념', student: '어려워한 개념', tone: 'blue', teacher: '다음 수업에서 한 번 더 다뤄요.' },
  misconception: { label: '오개념', student: '다르게 이해한 개념', tone: 'amber', teacher: '수업 설명이 이렇게 전달됐는지 점검해요.' },
};
const IN_ORDER = ['known', 'difficult', 'misconception'];
const IN_CONCEPTS = RUBRIC.concepts;
const IN_EXAMPLE_WHY = { known: '답안에서 이 개념을 바르게 설명했어요', difficult: '답안에서 이 개념을 충분히 설명하지 못했어요', misconception: '답안에서 이 개념을 다르게 이해했어요' };
const IN_UNSURE = ['empty', 'noise', 'short', 'unsure'];

const inStore = key => fbRead(key);
const inSave = (key, value) => fbWrite(key, value);
const inPct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const inSigned = n => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/* ---------- 개념 진단 ---------- */
function inParaStrain(ses) {
  if (!ses?.layout || !Array.isArray(ses.words)) return null;
  const g = fbGaze(ses);
  if (!g?.reliable) return null;
  const byWord = new Map(ses.words.map(w => [w[0], w]));
  const blocks = {};
  let total = 0;
  ses.layout.words.forEach((w, i) => {
    const m = byWord.get(i);
    const key = w.pp ?? w.p;
    const b = (blocks[key] ??= { t: 0, n: 0, reg: 0 });
    b.t += m ? m[3] : 0;
    b.n++;
    b.reg += m ? m[5] : 0;
    total += m ? m[3] : 0;
  });
  const mean = total / Math.max(1, ses.layout.words.length);
  // 문단 번호(0부터). gaze.js가 남긴 pp가 없으면(예전 기록) 화면 블록 번호로 대신한다.
  const hasPp = ses.layout.words.some(w => w.pp !== undefined);
  return para => {
    const b = blocks[hasPp ? para : 1 + 2 * para];
    return b && mean ? { ratio: b.t / b.n / mean, reg: b.reg } : null;
  };
}

function inConcepts(answers, a, ses) {
  const ans = answers.map(x => x ?? '');
  const ctx = { q: a.q, answers: ans, found2: a.q[1].found ?? [], found3: a.q[2].found ?? [] };
  const res = {};
  for (const c of IN_CONCEPTS) res[c.id] = { ...c.check(ctx) };

  // 시선 기록(TECH): 맞혔더라도 해당 문단에서 오래 머물거나 여러 번 되돌아 읽었다면 어려워한 개념으로 본다.
  const strain = inParaStrain(ses);
  if (strain) for (const c of IN_CONCEPTS) {
    const s = strain(c.para);
    if (!s) continue;
    const r = res[c.id];
    r.gaze = `${c.para + 1}문단에서 평균의 ${s.ratio.toFixed(1)}배 머묾 · 되돌아옴 ${s.reg}회`;
    if (r.state === 'known' && (s.ratio >= 1.6 || s.reg >= 3)) {
      r.state = 'difficult';
      r.why += '. 하지만 해당 문단에서 오래 머물거나 여러 번 되돌아 읽었어요';
    }
  }
  return res;
}

const inScore = a => Math.round(((a.q[0].score + a.q[1].score / 3 + a.q[2].score / 3) / 3) * 100);

/* ---------- 회차 기록 ---------- */
function inAttempts(name) { return inStore(IN_ATTEMPTS)[name] ?? []; }

function inRow(name, att, k, list) {
  const sub = fbSubmission(name);
  const a = sub && sub.submittedAt === att.at ? sub.analysis : att.analysis; // 최신 시도는 Claude 채점이 반영된 결과를 쓴다
  const ses = att.sessionId ? gzById(att.sessionId) : null;
  const g = fbGaze(ses);
  const concepts = inConcepts(att.answers, a, ses);
  const counts = Object.fromEntries(IN_ORDER.map(s => [s, Object.values(concepts).filter(c => c.state === s).length]));
  return { label: list.length > 1 ? `${k + 1}차` : '1차', at: att.at, score: inScore(a), summary: a.summary, gaze: g, concepts, counts, analysis: a, answers: att.answers };
}

function inRecordAttempt(name) {
  const sub = fbSubmission(name);
  if (!sub) return;
  const all = inStore(IN_ATTEMPTS);
  const list = all[name] ?? [];
  if (list.some(x => x.at === sub.submittedAt)) return;
  list.push({ at: sub.submittedAt, answers: sub.answers, sessionId: sub.sessionId, analysis: sub.analysis });
  all[name] = list.slice(-10);
  inSave(IN_ATTEMPTS, all);
  inCheckGoal(name);
}

/* ---------- 목표 ---------- */
function inGoals(name) { return inStore(IN_GOALS)[name] ?? { current: null, history: [] }; }
function inGoalMet(goal, row, prev) {
  if (!goal || !row) return false;
  if (goal.id.startsWith('concept:')) return row.concepts[goal.id.slice(8)]?.state === 'known';
  if (goal.id === 'pace') return !!row.gaze && row.gaze.pace !== 'skim' && row.gaze.skip < 35;
  if (goal.id === 'evidence') return row.analysis.q[1].score >= 3 || row.analysis.q[2].score >= 3;
  if (goal.id === 'gaze') return !!row.gaze;
  if (goal.id === 'score') return !!prev && row.score > prev.score;
  return false;
}
function inCheckGoal(name) {
  const all = inStore(IN_GOALS);
  const g = all[name];
  if (!g?.current) return;
  const rows = inRows(name);
  const met = inGoalMet(g.current, rows.at(-1), rows.at(-2));
  g.history = [...(g.history ?? []), { ...g.current, met, at: new Date().toISOString() }].slice(-20);
  g.current = null; // 목표 재설정 단계로
  inSave(IN_GOALS, all);
  if (met) setTimeout(() => toast(`목표 “${g.history.at(-1).text}”를 이뤘어요. 경험치 +15`), 600);
}
function inGoalOptions(row) {
  if (!row) return [];
  const opts = [];
  for (const c of IN_CONCEPTS) {
    const s = row.concepts[c.id]?.state;
    if (s === 'misconception') opts.push({ id: `concept:${c.id}`, text: `‘${c.name}’ 바로잡기`, detail: c.desc });
  }
  for (const c of IN_CONCEPTS) {
    const s = row.concepts[c.id]?.state;
    if (s === 'difficult') opts.push({ id: `concept:${c.id}`, text: `‘${c.name}’ 다시 정리하기`, detail: c.desc });
  }
  if (!row.gaze) opts.push({ id: 'gaze', text: '보정한 뒤 읽기 기록 남기기', detail: '카메라 점검과 시선 보정을 마치고 읽으면 내 읽기 과정을 함께 볼 수 있어요.' });
  else if (row.gaze.pace === 'skim' || row.gaze.skip >= 45) opts.push({ id: 'pace', text: '지문을 끝까지 천천히 읽기', detail: '문단마다 읽고 한 줄로 요약한 뒤 다음 문단으로 넘어가요.' });
  if (row.analysis.q[1].score < 3 && row.analysis.q[2].score < 3) opts.push({ id: 'evidence', text: '서술형에 글의 근거 두 개 쓰기', detail: '“~ 때문에 ~하기 어렵다”처럼 근거와 결과를 이어 써요.' });
  opts.push({ id: 'score', text: '이해 점수 지난번보다 올리기', detail: '틀린 문항의 근거 문단을 다시 읽고 도전해요.' });
  return opts.filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i).slice(0, 4);
}

/* ---------- 칭찬 ---------- */
function inPraises(name) { return inStore(IN_PRAISE)[name] ?? []; }

/* ---------- 레벨 ---------- */
function inXp(rows, name) {
  let xp = 0;
  rows.forEach((r, i) => {
    xp += 10 + Math.round(r.score / 10) + r.counts.known * 3;
    if (i > 0) xp += Math.max(0, r.score - rows[i - 1].score) + Math.max(0, r.counts.known - rows[i - 1].counts.known) * 10;
  });
  xp += inPraises(name).length * 10;
  xp += (inGoals(name).history ?? []).filter(h => h.met).length * 15;
  return xp;
}
function inLevel(xp) {
  let lv = 0;
  while (lv + 1 < IN_LEVELS.length && xp >= IN_LEVELS[lv + 1]) lv++;
  const next = IN_LEVELS[lv + 1] ?? null;
  return { lv: lv + 1, name: IN_LEVEL_NAMES[lv], xp, base: IN_LEVELS[lv], next, progress: next ? inPct(xp - IN_LEVELS[lv], next - IN_LEVELS[lv]) : 100 };
}

function inRows(name) {
  const list = inAttempts(name);
  return list.map((att, k) => inRow(name, att, k, list));
}

/* ---------- 학급(예시 + 실측) ---------- */
function inRand(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
function inExample(name, i) {
  const rnd = inRand(name + i);
  const base = 34 + rnd() * 44, trend = (rnd() - 0.32) * 16;
  const rounds = baseStatus[i] === '시작 전' || baseStatus[i] === '준비 실패' ? 2 : 3;
  const rows = Array.from({ length: rounds }, (_, k) => {
    const score = Math.round(Math.min(100, Math.max(8, base + trend * k + (rnd() - 0.5) * 10)));
    const concepts = {};
    for (const c of IN_CONCEPTS) {
      const r = rnd(), p = score / 100;
      // 학급 시나리오: RUBRIC.exampleMisconception 개념은 오개념이, exampleDifficult 개념은 난개념이 상대적으로 많다.
      const mis = c.id === RUBRIC.exampleMisconception ? 0.3 : 0.1, hard = c.id === RUBRIC.exampleDifficult ? 0.2 : 0;
      const state = r < p * 0.9 - hard ? 'known' : r < p * 0.9 - hard + mis ? 'misconception' : 'difficult';
      concepts[c.id] = { state, why: IN_EXAMPLE_WHY[state] };
    }
    const counts = Object.fromEntries(IN_ORDER.map(s => [s, Object.values(concepts).filter(c => c.state === s).length]));
    return { label: `${k + 1}회차`, score, concepts, counts, gaze: { cpm: Math.round(520 + rnd() * 520), skip: Math.round(15 + rnd() * 35) } };
  });
  const xp = rows.reduce((s, r, k) => s + 10 + Math.round(r.score / 10) + r.counts.known * 3 + (k ? Math.max(0, r.score - rows[k - 1].score) : 0), 0) + inPraises(name).length * 10;
  return { name, example: true, rows, level: inLevel(xp) };
}
function inRoster() {
  const real = Object.keys(inStore(IN_ATTEMPTS)).filter(n => inAttempts(n).length);
  const list = studentNames.map((n, i) => (real.includes(n) ? null : inExample(n, i))).filter(Boolean);
  const reals = real.map(n => { const rows = inRows(n); return { name: n, example: false, rows, level: inLevel(inXp(rows, n)) }; });
  return [...reals, ...list].map(s => {
    const last = s.rows.at(-1), prev = s.rows.at(-2);
    return { ...s, last, prev, change: last && prev ? last.score - prev.score : null };
  });
}

/* ---------- 공통 화면 조각 ---------- */
function inBar(counts, total) {
  return `<div class="in-bar" role="img" aria-label="${IN_ORDER.map(s => `${IN_STATE[s].label} ${counts[s] ?? 0}명`).join(', ')}">${IN_ORDER.map(s => (counts[s] ? `<span class="${s}" style="width:${inPct(counts[s], total)}%"></span>` : '')).join('')}</div>`;
}
const inLegend = () => `<div class="in-legend">${IN_ORDER.map(s => `<span><i class="${s}"></i>${IN_STATE[s].label}</span>`).join('')}</div>`;
const inChange = n => (n === null ? '<span class="in-change">첫 기록</span>' : `<span class="in-change ${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${inSigned(n)}점</span>`);

function inChart(rows) {
  const W = 720, H = 200, P = { l: 34, r: 20, t: 28, b: 30 };
  const n = rows.length;
  const x = k => (n === 1 ? (P.l + W - P.r) / 2 : P.l + (k * (W - P.l - P.r)) / (n - 1));
  const y = v => P.t + (1 - v / 100) * (H - P.t - P.b);
  const grid = [0, 50, 100].map(v => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="in-grid"/><text x="${P.l - 8}" y="${y(v)}" class="in-axis" text-anchor="end">${v}</text>`).join('');
  const line = n > 1 ? `<polyline class="in-line" points="${rows.map((r, k) => `${x(k)},${y(r.score)}`).join(' ')}"/>` : '';
  const dots = rows.map((r, k) => `<circle cx="${x(k)}" cy="${y(r.score)}" r="5" class="in-dot"/><text x="${x(k)}" y="${y(r.score) - 11}" class="in-val" text-anchor="middle">${r.score}</text><text x="${x(k)}" y="${H - 8}" class="in-axis" text-anchor="middle">${esc(r.label)}</text>`).join('');
  return `<svg class="in-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="이해 점수 변화: ${rows.map(r => `${r.label} ${r.score}점`).join(', ')}">${grid}${line}${dots}</svg>`;
}

function inCycleStep(no, title, body, state) {
  return `<li class="in-step ${state}"><span class="in-step-no">${no}</span><div><strong>${title}</strong><p>${body}</p></div></li>`;
}

/* ---------- 학생: 나의 성장 ---------- */
names['s-growth'] = '나의 성장';
if (!menuStudent.some(m => m[0] === 's-growth')) menuStudent.splice(menuStudent.findIndex(m => m[0] === 's-feedback') + 1, 0, ['s-growth', 'chart', '나의 성장']);

views['s-growth'] = () => {
  const name = fbStudentName();
  const rows = inRows(name);
  const lv = inLevel(inXp(rows, name));
  const goals = inGoals(name);
  const last = rows.at(-1), prev = rows.at(-2);
  const praises = inPraises(name);
  const pub = fbPublished(name);
  if (!last) {
    return `${head('나의 성장', '읽기 기록과 답안으로 나의 변화를 살펴보고 다음 목표를 정해요.')}<section class="card completed-panel"><div class="complete-icon">${icon('chart')}</div><h1>아직 기록이 없어요.</h1><p>배정 테스트를 마치면 이해 점수, 개념별 이해, 읽기 기록이 여기에 쌓여요.</p><div class="actions">${link('배정 테스트 시작 ' + icon('arrow'), 's-prep', 'btn')}</div></section>`;
  }
  const change = prev ? last.score - prev.score : null;
  const cycle = `<ol class="in-cycle">${[
    inCycleStep(1, '모니터링', last.gaze ? `시선 기록 ${last.gaze.sec}초 · 유효 ${last.gaze.valid}% · ${esc(last.summary)}` : `${esc(last.summary)} · 시선 기록 없음`, 'done'),
    inCycleStep(2, '피드백', pub ? (pub.auto ? '자동 분석 피드백을 받았어요' : `선생님 피드백 v${pub.version}을 받았어요`) : '피드백을 기다리고 있어요', pub ? 'done' : 'active'),
    inCycleStep(3, '목표 재설정', goals.current ? `“${esc(goals.current.text)}”` : '다음 목표를 골라 주세요', goals.current ? 'done' : 'active'),
    inCycleStep(4, '성장', change === null ? '다음 시도부터 변화가 보여요' : `지난번보다 ${inSigned(change)}점 · 알고 있는 개념 ${inSigned(last.counts.known - prev.counts.known)}개`, change === null ? '' : change >= 0 ? 'done' : 'active'),
  ].join('')}</ol>`;
  const conceptCols = IN_ORDER.map(s => {
    const items = IN_CONCEPTS.filter(c => last.concepts[c.id]?.state === s);
    return `<div class="in-col"><div class="label-line">${badge(IN_STATE[s].student, IN_STATE[s].tone)}<span class="micro">${items.length}개</span></div>${items.length ? items.map(c => `<div class="in-concept"><h3>${c.name}</h3><p>${s === 'known' ? esc(last.concepts[c.id].why) : c.desc}</p>${s !== 'known' ? `<p class="micro">${esc(last.concepts[c.id].why)}</p>` : ''}</div>`).join('') : '<p class="small">없어요.</p>'}</div>`;
  }).join('');
  const table = `<div class="in-table-wrap"><table class="in-table"><thead><tr><th>시도</th><th>이해 점수</th><th>변화</th><th>알고 있는 개념</th><th>읽기 속도</th></tr></thead><tbody>${rows.map((r, k) => `<tr><td>${esc(r.label)}</td><td>${r.score}점</td><td>${inChange(k ? r.score - rows[k - 1].score : null)}</td><td>${r.counts.known} / ${IN_CONCEPTS.length}</td><td>${r.gaze ? `1분에 ${r.gaze.cpm}자` : '기록 없음'}</td></tr>`).join('')}</tbody></table></div>`;
  const options = inGoalOptions(last);
  const goalCard = goals.current
    ? `<div class="rubric"><span class="micro">지금 목표</span><h3 style="margin-top:6px">${esc(goals.current.text)}</h3><p>${esc(goals.current.detail ?? '')}</p></div><p class="small">다음 시도를 마치면 목표를 이뤘는지 자동으로 확인해요.</p><div class="actions">${button('목표 바꾸기', 'in-goal-clear', 'secondary sm')}</div>`
    : `<p class="small">이번 결과를 바탕으로 고른 목표예요. 하나를 정해 다음 시도에 도전해 보세요.</p>${options.map(o => `<button class="in-goal-option" data-action="in-goal" data-goal="${esc(o.id)}"><strong>${esc(o.text)}</strong><span>${esc(o.detail)}</span></button>`).join('')}`;
  const history = (goals.history ?? []).slice(-3).reverse();
  return `${head('나의 성장', '읽기 기록과 답안으로 나의 변화를 살펴보고 다음 목표를 정해요.', badge(`Lv.${lv.lv} · ${lv.name}`, 'blue'))}
<section class="card in-cycle-card"><div class="section-head spread"><h2>배움의 순환</h2><span class="micro">모니터링 → 피드백 → 목표 재설정 → 성장</span></div>${cycle}</section>
<div class="grid-main" style="margin-top:23px"><div class="stack">
<section class="card"><div class="section-head spread"><h2>변화율</h2>${inChange(change)}</div><p class="small">이해 점수는 선택형 정답과 서술형 루브릭 점수를 100점으로 환산한 값이에요.</p>${inChart(rows)}${table}</section>
<section class="card"><div class="section-head"><h2>개념별 이해</h2></div><p class="small">답안과 읽기 기록을 함께 보고 세 가지로 나눴어요. 정답이어도 해당 문단을 오래 다시 읽었다면 어려워한 개념으로 표시해요.</p><div class="in-cols">${conceptCols}</div></section>
</div><aside class="stack">
<section class="card in-level"><span class="eyebrow">MY LEVEL</span><div class="in-level-head"><strong>Lv.${lv.lv}</strong><span>${lv.name}</span></div><div class="in-xp" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${lv.progress}"><i style="width:${lv.progress}%"></i></div><p class="small">경험치 ${lv.xp}${lv.next ? ` · 다음 레벨까지 ${lv.next - lv.xp}` : ' · 최고 레벨'}</p><ul class="in-earn"><li>테스트 참여 +10</li><li>지난번보다 오른 점수만큼</li><li>새로 알게 된 개념 1개당 +10</li><li>목표 달성 +15 · 선생님 칭찬 +10</li></ul></section>
<section class="card"><h3>다음 목표</h3><div style="margin-top:14px">${goalCard}</div>${history.length ? `<div class="divider"></div><span class="micro">지난 목표</span>${history.map(h => `<p class="small in-goal-past">${badge(h.met ? '이룸' : '다시 도전', h.met ? 'green' : 'gray')} ${esc(h.text)}</p>`).join('')}` : ''}</section>
<section class="card"><h3>선생님의 칭찬</h3>${praises.length ? praises.slice(-3).reverse().map(p => `<div class="in-praise"><p>${esc(p.text)}</p><span class="micro">${gzWhen(p.at)}</span></div>`).join('') : '<p class="small" style="margin-top:12px">아직 받은 칭찬이 없어요.</p>'}</section>
<section class="card"><h3>다시 도전하기</h3><p class="small" style="margin-top:12px">같은 지문으로 다시 응시하면 이번 결과와 비교해 변화율을 보여 줘요.</p>${button('다시 도전하기 ' + icon('arrow'), 'in-retake', 'soft')}</section>
</aside></div>`;
};

/* 학생 홈은 최신 UI 디자인을 그대로 둔다. 레벨·목표·칭찬은 '나의 성장'과 피드백 화면 오른쪽에 보인다. */

/* 제출 완료: 나의 성장 · 다시 도전 */
const inOrigComplete = views['s-complete'];
views['s-complete'] = () => {
  const html = inOrigComplete();
  if (!st.submitted || !inAttempts(fbStudentName()).length) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelector('.test-complete-card .actions, .completed-panel .actions')?.insertAdjacentHTML('beforeend', `${link('나의 성장', 's-growth', 'btn soft')}${button('다시 도전하기', 'in-retake', 'secondary')}`);
  return tpl.innerHTML;
};

/* ---------- 교사: 대시보드 ---------- */
function inGroups(roster, mode) {
  const pool = roster.filter(s => s.last).map(s => ({ ...s, score: s.last.score }));
  pool.sort((a, b) => b.score - a.score);
  if (!pool.length) return [];
  const g = Math.max(1, Math.round(pool.length / 4));
  let groups;
  if (mode === 'mentor') {
    groups = Array.from({ length: g }, () => []);
    pool.forEach((s, i) => {
      const round = Math.floor(i / g), pos = i % g;
      groups[round % 2 ? g - 1 - pos : pos].push({ ...s, mentor: i < g });
    });
  } else {
    groups = Array.from({ length: g }, (_, k) => pool.slice(Math.round((k * pool.length) / g), Math.round(((k + 1) * pool.length) / g)));
  }
  return groups.map((members, k) => {
    const avg = Math.round(members.reduce((s, m) => s + m.score, 0) / members.length);
    const weak = IN_CONCEPTS.map(c => ({ c, n: members.filter(m => m.last.concepts[c.id]?.state !== 'known').length })).sort((a, b) => b.n - a.n)[0];
    // 수준별 모둠 이름은 순위로 정한다: 맨 위 심화, 맨 아래 기초 다지기, 그 사이 연결(여럿이면 번호).
    const band = g === 1 ? '연결' : k === 0 ? '심화' : k === g - 1 ? '기초 다지기' : '연결';
    const middle = g > 3 && band === '연결' ? ` ${k}` : '';
    const title = mode === 'mentor' ? `${k + 1}모둠 · 멘토 ${members.find(m => m.mentor)?.name ?? ''}` : `${band} 모둠${middle}`;
    const plan = mode === 'mentor'
      ? `멘토가 ‘${weak.c.name}’의 근거를 찾는 과정을 먼저 보여 주고, 모둠원이 자기 말로 이어 설명해요.`
      : band === '심화' ? '비교 지문과 함께 주장을 검토하고 반론을 써 봐요.' : band === '연결' ? `‘${weak.c.name}’${rbHas(weak.c.name) ? '을' : '를'} 조건과 결과로 이어 설명해요.` : `‘${weak.c.name}’${rbHas(weak.c.name) ? '이' : '가'} 나온 문단에서 핵심 문장을 함께 찾아요.`;
    return { title, members, avg, plan, focus: weak.c.name };
  });
}

const inOrigDash = views['t-dashboard'];
views['t-dashboard'] = () => {
  const tpl = document.createElement('template');
  tpl.innerHTML = inOrigDash();
  const roster = inRoster();
  const withLast = roster.filter(s => s.last);
  const total = withLast.length;
  const conceptRows = IN_CONCEPTS.map(c => {
    const counts = Object.fromEntries(IN_ORDER.map(s => [s, withLast.filter(m => m.last.concepts[c.id]?.state === s).length]));
    const mis = inPct(counts.misconception, total), hard = inPct(counts.difficult, total);
    const advice = mis >= 25 ? { tone: 'amber', text: `오개념 ${counts.misconception}명 · 수업 설명 점검` } : hard >= 35 ? { tone: 'blue', text: `난개념 ${counts.difficult}명 · 다시 다루기` } : { tone: 'green', text: '대부분 이해' };
    return `<div class="in-concept-row"><div class="spread"><h3>${c.name}</h3>${badge(advice.text, advice.tone)}</div>${inBar(counts, total)}<p class="micro">${IN_ORDER.map(s => `${IN_STATE[s].label} ${counts[s]}명`).join(' · ')}</p></div>`;
  }).join('');
  const reals = roster.filter(s => !s.example).length;
  const growth = [...roster].filter(s => s.last).sort((a, b) => (a.example - b.example) || ((b.change ?? -999) - (a.change ?? -999)));
  const growthRows = growth.slice(0, 8).map(s => `<tr><td><div class="in-person">${av(s.name)}<span>${esc(s.name)}</span></div></td><td>Lv.${s.level.lv}</td><td>${s.last.score}점</td><td>${inChange(s.change)}</td><td><span class="in-mini">${IN_ORDER.map(st2 => `<i class="${st2}" title="${IN_STATE[st2].label}">${s.last.counts[st2]}</i>`).join('')}</span></td><td class="in-act">${button('칭찬', 'in-praise', 'secondary sm', `data-person="${esc(s.name)}"`)}</td></tr>`).join('');
  const mode = st.inGroupMode === 'level' ? 'level' : 'mentor';
  const groups = inGroups(roster, mode);
  const groupHtml = groups.map(gp => `<article class="in-group"><div class="spread"><h3${mode === 'level' ? ' class="in-band"' : ''}>${esc(gp.title)}</h3>${badge(`평균 ${gp.avg}점`, 'gray')}</div><ul>${gp.members.map(m => `<li><div class="in-person">${av(m.name)}<span>${esc(m.name)}</span></div><span class="micro">${m.mentor ? '<span class="pill in-mentor">멘토</span>' : ''} ${m.score}점 · Lv.${m.level.lv}</span></li>`).join('')}</ul></article>`).join('');

  const sections = `<div class="grid2 in-dash">
<section class="card"><div class="section-head spread"><h2>개념 진단 · 3회차</h2>${badge(reals ? `실측 ${reals}명 포함` : '학급 전체', reals ? 'green' : 'gray')}</div><p class="small">답안과 시선 기록으로 학생마다 개념을 기존 지식·난개념·오개념으로 나눴어요. 오개념이 많으면 수업 설명을, 난개념이 많으면 다음 수업의 재설명을 권해요.</p>${inLegend()}${conceptRows}</section>
<section class="card"><div class="section-head spread"><h2>변화율 · 성장</h2>${link('리포트', 't-report')}</div><p class="small">지난 회차(또는 지난 시도)와 비교한 이해 점수 변화예요. 성장한 학생에게 칭찬을 보내면 학생 레벨에 반영돼요.</p><div class="in-table-wrap"><table class="in-table"><thead><tr><th>학생</th><th>레벨</th><th>점수</th><th>변화</th><th>개념</th><th></th></tr></thead><tbody>${growthRows}</tbody></table></div></section>
</div>
<section class="card in-dash"><div class="section-head spread"><div><h2>모둠 추천</h2><p class="small" style="margin:8px 0 0">${mode === 'mentor' ? '이해 점수가 높은 학생을 모둠마다 한 명씩 멘토로 두고, 나머지를 고르게 섞었어요.' : '이해 점수가 비슷한 학생끼리 묶고, 수준에 맞는 활동을 제안해요.'}</p></div><div class="segments" role="group" aria-label="모둠 구성 방식">${[['mentor', '멘토형'], ['level', '수준별']].map(([v, t]) => `<button data-action="in-group-mode" data-mode-value="${v}" class="${mode === v ? 'active' : ''}" aria-pressed="${mode === v}">${t}</button>`).join('')}</div></div><div class="in-groups">${groupHtml}</div><div class="actions">${link('그룹 관리에서 모둠 편성하기 ' + icon('arrow'), 't-groups', 'btn soft')}</div></section>`;
  const metrics = tpl.content.querySelector('.metric-grid');
  if (metrics) metrics.insertAdjacentHTML('afterend', sections);
  return tpl.innerHTML;
};

/* ---------- 교사: 학생 리포트 옆 카드 ---------- */
const inOrigReport = views['t-report'];
views['t-report'] = () => {
  const tpl = document.createElement('template');
  tpl.innerHTML = inOrigReport();
  const name = st.reportStudent;
  const s = inRoster().find(x => x.name === name);
  const aside = tpl.content.querySelector('.report-layout > aside.stack');
  if (aside && s?.last) {
    const groups = IN_ORDER.map(state => {
      const items = IN_CONCEPTS.filter(c => s.last.concepts[c.id]?.state === state);
      return items.length ? `<div class="in-report-group"><div class="label-line">${badge(IN_STATE[state].label, IN_STATE[state].tone)}<span class="micro">${IN_STATE[state].teacher}</span></div>${items.map(c => `<p class="small"><strong>${c.name}</strong> · ${esc(s.last.concepts[c.id].why)}${s.last.concepts[c.id].gaze ? `<br><span class="micro">시선: ${esc(s.last.concepts[c.id].gaze)}</span>` : ''}</p>`).join('')}</div>` : '';
    }).join('');
    aside.insertAdjacentHTML('afterbegin', `<section class="card"><span class="eyebrow">CONCEPT · GROWTH</span><div class="spread" style="margin-top:12px"><h3>${esc(name)} · Lv.${s.level.lv}</h3>${inChange(s.change)}</div><p class="small" style="margin:8px 0 14px">이해 점수 ${s.last.score}점</p>${groups}<div class="actions">${button('칭찬 보내기', 'in-praise', 'soft sm', `data-person="${esc(name)}"`)}</div></section>`);
  }
  return tpl.innerHTML;
};

/* 학생 피드백 화면: 오른쪽 '나의 성장' 그래프 아래에 실제 레벨과 선생님 칭찬 */
const inOrigFeedback = views['s-feedback'];
views['s-feedback'] = () => {
  const tpl = document.createElement('template');
  tpl.innerHTML = inOrigFeedback();
  const name = fbStudentName();
  const rows = inRows(name);
  const rail = tpl.content.querySelector('.feedback-growth-rail') ?? tpl.content.querySelector('.grid-main > aside.stack');
  if (rail && rows.length) {
    const lv = inLevel(inXp(rows, name));
    const goal = inGoals(name).current;
    const praise = inPraises(name).at(-1);
    rail.insertAdjacentHTML('beforeend', `<section class="card in-level in-rail-card"><span class="eyebrow">MY LEVEL</span><div class="in-level-head"><strong>Lv.${lv.lv}</strong><span>${lv.name}</span></div><div class="in-xp"><i style="width:${lv.progress}%"></i></div><p class="small">${goal ? `지금 목표 · ${esc(goal.text)}` : '나의 성장에서 다음 목표를 정해 보세요.'}</p>${praise ? `<div class="in-rail-praise"><span class="micro">선생님의 칭찬</span><p>${esc(praise.text)}</p></div>` : ''}${link('나의 성장 보기 ' + icon('arrow'), 's-growth')}</section>`);
  }
  return tpl.innerHTML;
};

/* ---------- 동작 ---------- */
const inOrigSubmit = action['confirm-submit'];
action['confirm-submit'] = () => {
  const name = fbStudentName();
  inOrigSubmit();
  inRecordAttempt(name);
  render();
};

action['in-retake'] = () => {
  Object.assign(st, { submitted: false, readDone: false, ready: false, prep: 0, cal: 0, q: 0, mode: 'typing', answers: ['', '', ''], ocr: '', ocrConfirmed: false, answerStartedAt: null });
  route('s-prep');
  toast('같은 지문으로 다시 도전해요. 이번 결과와 비교해 변화율을 보여 줄게요.');
};

action['in-goal'] = el => {
  const name = fbStudentName();
  const row = inRows(name).at(-1);
  const opt = inGoalOptions(row).find(o => o.id === el.dataset.goal);
  if (!opt) return;
  const all = inStore(IN_GOALS);
  all[name] = { ...(all[name] ?? { history: [] }), current: { ...opt, setAt: new Date().toISOString() } };
  inSave(IN_GOALS, all);
  render();
  toast('다음 목표를 정했어요. 다음 시도에서 확인할게요.');
};
action['in-goal-clear'] = () => {
  const name = fbStudentName();
  const all = inStore(IN_GOALS);
  if (all[name]) { all[name].current = null; inSave(IN_GOALS, all); }
  render();
};

action['in-group-mode'] = el => { st.inGroupMode = el.dataset.modeValue; render(); };

const IN_PRAISE_PRESETS = ['지난번보다 근거를 더 잘 찾았어요.', '끝까지 집중해서 지문을 읽었어요.', '어려운 문단을 다시 읽으며 확인한 점이 좋아요.', '스스로 정한 목표를 이뤄 냈어요.'];
action['in-praise'] = el => {
  const name = el.dataset.person;
  st.inPraiseTo = name;
  st.inPraiseText = '';
  modal(`${esc(name)} 학생에게 칭찬 보내기`, `<p class="small">학생 홈과 나의 성장 화면에 표시되고, 학생 레벨 경험치에 +10이 더해져요.</p><div class="in-chips">${IN_PRAISE_PRESETS.map((t, i) => `<button class="pill blue" data-action="in-praise-pick" data-i="${i}">${t}</button>`).join('')}</div><label class="sr-only" for="in-praise-text">칭찬 문장</label><textarea id="in-praise-text" data-bind="inPraiseText" placeholder="학생에게 전할 칭찬을 적어 주세요."></textarea><div class="actions">${button('취소', 'close', 'secondary')}${button('칭찬 보내기', 'in-praise-send')}</div>`);
};
action['in-praise-pick'] = el => {
  const text = IN_PRAISE_PRESETS[+el.dataset.i];
  st.inPraiseText = text;
  const box = document.getElementById('in-praise-text');
  if (box) box.value = text;
};
action['in-praise-send'] = () => {
  const text = (st.inPraiseText ?? '').trim();
  if (!text) { toast('칭찬 문장을 고르거나 적어 주세요.'); return; }
  const all = inStore(IN_PRAISE);
  all[st.inPraiseTo] = [...(all[st.inPraiseTo] ?? []), { text, at: new Date().toISOString(), from: st.user?.name ?? '김하늘' }].slice(-20);
  inSave(IN_PRAISE, all);
  $('#modal').close();
  render();
  toast(`${st.inPraiseTo} 학생에게 칭찬을 보냈어요.`);
};

action['in-parent'] = el => {
  const name = el.dataset.person;
  const s = inRoster().find(x => x.name === name);
  if (!s?.last) return;
  const known = IN_CONCEPTS.filter(c => s.last.concepts[c.id]?.state === 'known').map(c => c.name);
  const review = IN_CONCEPTS.filter(c => s.last.concepts[c.id]?.state !== 'known').map(c => c.name);
  const goal = inGoals(name).current?.text;
  const praise = inPraises(name).at(-1)?.text;
  const text = `[LOOKteracy 읽기 성장 소식]
${name} 학생의 3회차 읽기 결과를 알려 드립니다.

· 이해 점수: ${s.last.score}점${s.change !== null ? ` (지난번보다 ${inSigned(s.change)}점)` : ''}
· 레벨: Lv.${s.level.lv} ${s.level.name}
· 잘 이해한 개념: ${known.join(', ') || '이번에는 없음'}
· 다시 살펴볼 개념: ${review.join(', ') || '없음'}${goal ? `\n· 스스로 정한 다음 목표: ${goal}` : ''}${praise ? `\n· 선생님 한마디: ${praise}` : ''}

${RUBRIC.parentTip}
인하고등학교 ${st.className} ${st.user?.name ?? '김하늘'} 드림`;
  st.inParentText = text;
  modal(`${esc(name)} 학생 보호자 소식`, `<p class="small">문안을 다듬은 뒤 복사해 학교 알림 앱에 붙여 넣으세요.</p><label class="sr-only" for="in-parent-text">보호자 소식 문안</label><textarea id="in-parent-text" class="in-parent-text" data-bind="inParentText">${esc(text)}</textarea>${note('이 화면은 문자·알림을 직접 보내지 않아요.')}<div class="actions">${button('닫기', 'close', 'secondary')}${button('문안 복사', 'in-parent-copy')}</div>`);
};
action['in-parent-copy'] = async () => {
  try {
    await navigator.clipboard.writeText(st.inParentText ?? '');
    toast('보호자 소식 문안을 복사했어요.');
  } catch {
    document.getElementById('in-parent-text')?.select();
    toast('복사하지 못했어요. 문안을 선택해 직접 복사해 주세요.');
  }
};

/* Claude 채점이 끝나면 화면을 새로 그린다(점수·개념 진단이 바뀜). */
const inOrigRefresh = fbRefresh;
fbRefresh = function () {
  if (['s-growth', 't-dashboard'].includes(st.page)) render();
  else inOrigRefresh();
};

/* ---------- 진단·피드백: 학생 목록 → 학생이 본 테스트 목록 → 리포트 ----------
   메뉴·대시보드에서 들어오면 학생 목록을, 다른 화면에서 특정 학생을 골라 들어오면(응시 현황의 '리포트', '리포트 근거 보기') 바로 리포트를 연다.
   이번 테스트(test-03)는 실제 답안·시선 기록으로 만든 리포트, 지난 테스트는 회차별 결과 리포트를 보여 준다. */
const rpOrigRoute = route;
route = function (p, replace) {
  if (p === 't-report') st.reportView = st.reportDirect ? 'detail' : 'list';
  st.reportDirect = false;
  return rpOrigRoute(p, replace);
};
for (const key of ['student-detail', 'feedback-evidence']) {
  const orig = action[key];
  if (orig) action[key] = (...args) => { st.reportDirect = true; try { return orig(...args); } finally { st.reportDirect = false; } };
}
const rpTone = s => (s === '준비 실패' ? 'amber' : ['분석 완료', '제출 완료'].includes(s) ? 'green' : '');
const rpDate = (d, time = false) => {
  const t = new Date(d.length === 10 ? d + 'T09:00:00+09:00' : d);
  const pad = n => String(n).padStart(2, '0');
  return `${t.getFullYear()}.${pad(t.getMonth() + 1)}.${pad(t.getDate())}${time ? ` ${pad(t.getHours())}:${pad(t.getMinutes())}` : ''}`;
};
const rpLevel = score => (score >= 85 ? '매우잘함' : score >= 70 ? '잘함' : score >= 50 ? '보통' : '노력요함');
const rpBack = (text, act) => `<div class="coop-back"><a class="link-btn" href="#t-report" data-action="${act}">${icon('back')} ${text}</a></div>`;
const rpRealNames = () => [...new Set([...inRoster().filter(s => !s.example).map(s => s.name), ...Object.keys(fbRead(FB_SUBMIT)), ...gzSessions().map(s => s.student)])];

function rpRows() {
  const roster = inRoster(), realNames = rpRealNames();
  const real = realNames.map(name => {
    const sub = fbSubmission(name), r = roster.find(s => s.name === name);
    return { name, real: true, status: sub ? (sub.analysis?.grading === 'pending' ? '채점 중' : '분석 완료') : '읽기 완료', score: r?.last?.score ?? null, level: r?.level ?? null, tests: rpTests(name).length };
  });
  const examples = people().filter(p => !realNames.includes(p.name)).map(p => {
    const r = roster.find(s => s.name === p.name), done = p.status === '분석 완료';
    return { name: p.name, real: false, status: p.status, score: done ? r?.last?.score ?? null : null, level: r?.level ?? null, tests: rpTests(p.name).length };
  });
  return [...real, ...examples];
}
function rpListView() {
  const rows = rpRows();
  const body = rows.map((r, k) => `<tr data-action="rp-open" data-person="${esc(r.name)}"><td><span class="student">${av(r.name, k % 2 ? 'mint' : '')} ${esc(r.name)}</span></td><td>${badge(r.status, rpTone(r.status))}</td><td>${r.score == null ? '—' : r.score + '점'}</td><td>${r.level ? `Lv.${r.level.lv} · ${r.level.name}` : '—'}</td><td>${r.tests}개</td><td>${button('테스트 보기', 'rp-open', 'secondary sm', `data-person="${esc(r.name)}"`)}</td></tr>`).join('');
  return `${head('학생 상세 리포트', '')}<div class="report-meta"><span>인하고등학교 ${esc(st.className)}</span><span>${esc(st.round)}</span></div><section class="card table-card rp-list"><div class="section-head"><h2>학생 목록</h2>${badge(`${rows.length}명`, 'gray')}</div><div class="table-scroll"><table><thead><tr><th>학생</th><th>이번 테스트</th><th>이해 점수</th><th>성장 레벨</th><th>응시한 테스트</th><th>상세</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

/* 학생이 본 테스트: 이번 테스트(실제 기록 또는 학급 기록)와 지난 회차들 */
function rpTests(name) {
  const r = inRoster().find(s => s.name === name);
  const i = studentNames.indexOf(name), member = i >= 0;
  const past = member ? inExample(name, i).rows : [];
  const sub = fbSubmission(name), ses = gzLatest(name);
  const real = !!(sub || ses || (r && !r.example));
  const list = [];
  for (const t of coopTests) {
    const k = Number(t.round[0]) - 1;
    if (t.id === 'test-03') {
      if (real) list.push({ id: t.id, date: rpDate(sub?.submittedAt ?? ses?.endedAt ?? t.date, true), round: t.round, title: t.title, score: r?.last?.score ?? null, tries: r && !r.example ? r.rows.length : 1, gaze: !!ses, status: sub ? '분석 완료' : '읽기 완료', open: true });
      else if (member) {
        const status = statusFor(i), done = status === '분석 완료';
        list.push({ id: t.id, date: rpDate(t.date), round: t.round, title: t.title, score: done ? past[k]?.score ?? null : null, tries: 1, gaze: done, status, open: done });
      }
    } else if (member && t.students.includes(name) && past[k]) {
      list.push({ id: t.id, date: rpDate(t.date), round: t.round, title: t.title, score: past[k].score, tries: 1, gaze: true, status: '분석 완료', open: true });
    }
  }
  return list;
}
function rpTestsView() {
  const name = st.reportStudent, rows = rpTests(name);
  const r = inRoster().find(s => s.name === name);
  const body = rows.map(t => `<tr ${t.open ? `data-action="rp-test" data-test="${t.id}"` : ''}><td>${t.date}</td><td>${t.round}</td><td>${esc(t.title)}</td><td>${t.score == null ? '—' : t.score + '점'}${t.tries > 1 ? ` <span class="micro">(${t.tries}회 응시)</span>` : ''}</td><td>${t.gaze ? '있음' : '—'}</td><td>${badge(t.status, rpTone(t.status))}</td><td>${t.open ? button('리포트', 'rp-test', 'secondary sm', `data-test="${t.id}"`) : button('상태 보기', 'student-detail', 'secondary sm', `data-person="${esc(name)}"`)}</td></tr>`).join('');
  return `${rpBack('학생 목록', 'rp-list')}${head(`${esc(name)} 학생`, '')}<div class="report-meta"><span>인하고등학교 ${esc(st.className)}</span>${r?.level ? `<span>Lv.${r.level.lv} · ${r.level.name}</span>` : ''}</div><section class="card table-card rp-list"><div class="section-head"><h2>응시한 테스트</h2>${badge(`${rows.length}개`, 'gray')}</div><div class="table-scroll"><table><thead><tr><th>날짜</th><th>회차</th><th>테스트</th><th>이해 점수</th><th>시선 기록</th><th>상태</th><th>리포트</th></tr></thead><tbody>${body || '<tr><td colspan="7" class="empty">아직 응시한 테스트가 없습니다.</td></tr>'}</tbody></table></div></section>`;
}

/* 지난 회차 리포트: 회차별 결과(이해 점수·읽기 지표·개념 진단) */
function rpPastView() {
  const name = st.reportStudent, t = coopTests.find(x => x.id === st.reportTest);
  const i = studentNames.indexOf(name), k = Number(t?.round[0]) - 1;
  const row = i >= 0 && t ? inExample(name, i).rows[k] : null;
  if (!row) { st.reportView = 'tests'; return rpTestsView(); }
  const cpm = row.gaze.cpm, fix = Math.round(330 - ((cpm - 520) / 520) * 90), span = Math.round((6 + ((cpm - 520) / 520) * 5) * 10) / 10;
  const scores = inRoster().filter(s => s.example).map(s => s.rows[k]?.score).filter(n => n != null);
  const top = Math.max(1, Math.round(((scores.filter(n => n > row.score).length + 1) / Math.max(1, scores.length)) * 100));
  const concept = s => IN_CONCEPTS.filter(c => row.concepts[c.id]?.state === s).map(c => c.name);
  const conceptRows = IN_ORDER.map(s => `<p class="small" style="margin-top:10px"><strong>${IN_STATE[s].label}</strong> · ${concept(s).join(', ') || '없음'}</p>`).join('');
  return `${rpBack('테스트 목록', 'rp-tests')}${head('학생 상세 리포트', '')}<div class="report-meta"><span>${esc(name)} · 인하고등학교 ${esc(st.className)}</span><span>${t.round} · ${esc(t.title)}</span><span>${rpDate(t.date)}</span>${badge('교사 검토 완료', 'green')}</div><div class="report-layout"><section class="card"><div class="section-head"><h2>지문과 읽기 과정</h2>${badge('시선 기록', 'gray')}</div><h3>${esc(t.title)}</h3>${gzStatHtml(cpm, fix, span)}<div class="divider"></div><h3>개념 진단</h3>${conceptRows}</section><aside class="stack"><section class="card report-summary-card"><h3>종합 결과</h3><p class="small" style="margin-top:14px">현재 문해력 수준은 ${rpLevel(row.score)}입니다.</p><div class="divider"></div><p class="small">학습자는 학년 상위 ${top}%입니다.</p></section><section class="card"><h3>이해 점수</h3><p class="small" style="margin-top:14px">${row.score}점</p></section></aside></div>`;
}

const rpOrigReport = views['t-report'];
views['t-report'] = () => {
  if (st.reportView === 'detail') return `${rpBack('테스트 목록', 'rp-tests')}${rpOrigReport()}`;
  if (st.reportView === 'tests') return rpTestsView();
  if (st.reportView === 'past') return rpPastView();
  return rpListView();
};
action['rp-open'] = el => { st.reportStudent = el.dataset.person; st.reportView = 'tests'; render(); scrollTo(0, 0); };
action['rp-list'] = () => { st.reportView = 'list'; render(); scrollTo(0, 0); };
action['rp-tests'] = () => { st.reportView = 'tests'; render(); scrollTo(0, 0); };
action['rp-test'] = el => {
  const id = el.dataset.test;
  st.reportTest = id;
  st.reportFinal = false;
  st.reportAutoPicked = true;
  if (id === 'test-03') { st.reportView = 'detail'; st.reportTab = 'heat'; }
  else st.reportView = 'past';
  render();
  scrollTo(0, 0);
};

render();
