/* grading.js — 실제 답안과 시선 기록으로 만드는 피드백. (최신 UI의 feedback.js는 피드백 화면, 이 파일은 채점)
   - 문항 1(선택형)은 정답과 비교하고, 고른 선택지가 왜 틀렸는지 지문의 문단을 근거로 설명한다.
   - 문항 2·3(서술형)은 루브릭 근거 낱말로 0~3점을 매긴다. 빈 답, 너무 짧은 답, 자모·영문 나열, 지문 베끼기는 따로 표시한다.
   - 시선 기록(gaze.js)이 있으면 읽기 시간·건너뛴 비율·오래 머문 낱말·되돌아 읽기를 근거로 덧붙인다.
   - 강점·보완할 점·다음 읽기 전략은 학생·교사 공간 모두 feedback.js의 기본 문구(수정사항)를 보여 주고, 교사가 고쳐 게시하면 그 내용으로 바뀐다.
   - 채점 결과는 학생 화면의 '04 문항별 확인'과 교사 리포트(응답·루브릭, 5개 영역, 종합 결과)에 쓴다.
   - 지문별 정답·근거·문장은 passage-rubric.js의 RUBRIC에 있다. 서버에 API 키가 있으면 Claude가 서술형을 다시 채점한다. */

const FB_SUBMIT = 'lookteracy-submissions-v1';
const FB_PUBLISH = 'lookteracy-feedback-v1';
const FB_UNSURE = /모르겠|모름|잘\s*모르/;

const fbStudentName = () => st.user?.name ?? '김서윤';
const fbIra = rbIra;
const fbObj = rbObj;
const fbRead = key => { try { return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}; } catch { return {}; } };
const fbWrite = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { console.warn(err); } };
const fbSubmission = name => fbRead(FB_SUBMIT)[name] ?? null;
const fbPublished = name => fbRead(FB_PUBLISH)[name] ?? null;
const fbPassageChars = () => sentences.join('').replace(/\s/g, '').length;
/** 피드백 화면(feedback.js의 studentFeedbackDetails)은 '제목: 내용'을 빈 줄로 나눈 목록을 카드로 그린다. */
const fbItems = items => items.map(([title, body]) => `${title}: ${body}`).join('\n\n');

/* 학생·교사 공간의 기본 피드백을 하나로 맞춘다(교사 편집 화면의 초안과 'AI 초안 예시 불러오기'도 같은 문구). */
Object.assign(initialFeedback, studentFeedbackContent);
st.feedbackDraft = { ...studentFeedbackContent };
// interactions.js가 먼저 저장해 둔 예전 초안도 같은 문구로 맞춘다(리포트의 '개인 피드백 편집'으로 열 때).
for (const k of Object.keys(st.feedbackStore ?? {})) st.feedbackStore[k] = { ...studentFeedbackContent };

/* ---------- 답안 상태 판별 ---------- */
function fbFlag(text) {
  const t = (text ?? '').trim();
  if (!t) return 'empty';
  const syl = (t.match(/[가-힣]/g) ?? []).length;
  const jamo = (t.match(/[ㄱ-ㅎㅏ-ㅣ]/g) ?? []).length;
  const latin = (t.match(/[a-zA-Z]/g) ?? []).length;
  if (jamo >= syl || latin > syl || /(.)\1{4,}/.test(t) || new Set(t.replace(/\s/g, '')).size <= 3) return 'noise';
  if (FB_UNSURE.test(t) && syl < 20) return 'unsure';
  if (syl < 8) return 'short';
  const flat = t.replace(/\s/g, '');
  let copied = 0;
  for (const s of sentences) {
    const src = s.replace(/\s/g, '');
    for (let i = 0; i + 14 <= src.length; i += 7) if (flat.includes(src.slice(i, i + 14))) copied += 7;
  }
  if (copied / flat.length > 0.6) return 'copied';
  return null;
}
const FB_FLAG_TEXT = {
  empty: '답을 쓰지 않았어요.',
  noise: '지문 내용과 관련 없는 글자로 보여 내용을 평가하지 못했어요.',
  unsure: '모르겠다고 적었어요.',
  short: '답이 너무 짧아 근거와 설명을 확인하기 어려워요.',
  copied: '지문 문장을 그대로 옮겨 적어 자신의 설명을 확인하기 어려워요.',
  off_topic: '문항과 관계없는 내용이라 점수를 주기 어려워요.',
};

/* ---------- 채점 ---------- */
function fbScoreChoice(answer) {
  if (answer === '' || answer == null) return { kind: 'choice', ok: false, picked: null, score: 0, max: 1, flag: 'empty', note: '선택하지 않았어요.' };
  const picked = Number(answer);
  const ok = picked === RUBRIC.q1.answer;
  return { kind: 'choice', ok, picked, score: ok ? 1 : 0, max: 1, flag: null, note: ok ? RUBRIC.q1.correctNote : RUBRIC.q1.why[picked] };
}

/** 서술형 0~3점(i = 1 또는 2). Claude 채점 결과도 같은 형식({score, found, missing, flag, note})으로 들어온다. */
function fbScoreWritten(i, text) {
  const flag = fbFlag(text);
  const base = { kind: 'written', max: 3, flag, found: [], missing: [] };
  if (flag && flag !== 'copied') return { ...base, score: 0, note: FB_FLAG_TEXT[flag] };
  const rule = i === 1 ? RUBRIC.q2 : RUBRIC.q3;
  const t = text.trim();
  const found = rule.evidence.filter(([, rx]) => rx.test(t)).map(([n]) => n);
  const extra = i === 1 ? rule.link.test(t) : rule.effect.test(t);
  let score = rule.score(found, extra);
  if (flag === 'copied') score = Math.min(score, 1);
  const missing = rule.evidence.map(([n]) => n).filter(n => !found.includes(n));
  const note = flag === 'copied' ? FB_FLAG_TEXT.copied : rule.notes[score](found);
  return { ...base, score, found, missing, note };
}

/* ---------- 시선 기록 요약 ---------- */
function fbGaze(ses) {
  if (!ses) return null;
  const m = ses.metrics, L = ses.layout;
  const chars = fbPassageChars();
  const cpm = m.durationMs ? Math.round(chars / (m.durationMs / 60000)) : 0;
  return {
    sec: Math.round(m.durationMs / 1000), cpm,
    pace: cpm > 1300 ? 'skim' : cpm < 300 ? 'slow' : 'normal',
    skip: m.skipPct, valid: m.validPct, meanFix: m.meanFixMs, fixations: m.fixations,
    regs: m.regressions, lapses: m.lapses,
    long: m.longWords.slice(0, 3).map(i => gzClean(L.words[i].t)),
    reliable: m.validPct >= 60 && (ses.calibration?.accuracy ?? 0) >= 40,
  };
}

/* ---------- 피드백 문장 ---------- */
/** override: Claude 채점 결과 { q: [문항1, 문항2, 문항3], feedback } — 없으면 낱말 기준으로 채점한다. */
function fbAnalyze(answers, ses, answerMs, override = null) {
  const q = override?.q ?? [fbScoreChoice(answers[0]), fbScoreWritten(1, answers[1]), fbScoreWritten(2, answers[2])];
  const g = fbGaze(ses);
  const junk = q.slice(1).filter(x => ['empty', 'noise', 'short'].includes(x.flag)).length;

  const strengths = [];
  if (q[0].ok) strengths.push(['상징의 의미 파악', RUBRIC.q1.correctNote]);
  if (q[1].score === 3) strengths.push(['근거로 까닭 설명', RUBRIC.q2.strength3(q[1].found)]);
  else if (q[1].score === 2) strengths.push(['근거 떠올리기', RUBRIC.q2.strength2(q[1].found)]);
  if (q[2].score >= 2) strengths.push(['말하기 방법 분석', RUBRIC.q3.strength]);
  if (g?.reliable && g.pace === 'normal' && g.skip < 35) strengths.push(['끝까지 고르게 읽기', '지문을 처음부터 끝까지 고르게 읽었어요.']);
  if (g?.reliable && g.regs.between + g.regs.paragraph >= 2 && g.pace !== 'skim') strengths.push(['앞뒤 내용 연결하기', '읽는 중 앞 문장으로 돌아가 내용을 다시 확인하며 연결해 읽었어요.']);
  if (!strengths.length) strengths.push(['다시 시작하기', '이번 응답에서는 강점으로 짚을 근거를 찾지 못했어요. 세 문항을 끝까지 제출한 것에서 다시 시작해 봐요.']);

  const concepts = [];
  if (!q[0].ok) concepts.push(['상징의 의미 다시 보기', `${q[0].picked === null ? '문항 1을 고르지 않았어요. ' : q[0].note + ' '}${RUBRIC.q1.core}`]);
  if (q[1].score < 2) concepts.push(['익살스럽게 그린 까닭', `${RUBRIC.q2.concept}${q[1].found.length ? ` 답에는 ${rbList(q[1].found)}만 있었어요.` : ''}`]);
  if (q[2].score < 2) concepts.push(['말하기 방법과 효과', RUBRIC.q3.concept]);
  if (!concepts.length) concepts.push(['다음 글에서', RUBRIC.fallbackConcept]);

  const strategies = [];
  if (junk >= 1) strategies.push(['근거 문장 먼저 찾기', '서술형은 먼저 지문에서 답의 근거가 되는 문장을 찾아 표시하고, 그 문장을 자신의 말로 바꿔 이어 써 보세요.']);
  if (g?.reliable && g.pace === 'skim') strategies.push(['문단마다 한 줄 요약', `이번에는 지문을 ${g.sec}초 만에 읽었어요(1분에 약 ${g.cpm}자). 문단마다 읽고 한 줄로 요약한 뒤 다음 문단으로 넘어가 보세요.`]);
  if (g?.reliable && g.skip >= 45 && g.pace !== 'skim') strategies.push(['끝까지 시선 옮기기', `첫 읽기에서 지나친 낱말이 ${g.skip}%였어요. 문장 끝까지 시선을 옮기며 읽어 보세요.`]);
  if (g?.reliable && g.long.length) strategies.push(['막히는 낱말 앞뒤 읽기', `‘${g.long.join('’, ‘')}’에서 오래 머물렀어요. 막히는 낱말은 앞뒤 문장으로 뜻을 짐작해 보고, 그래도 어려우면 표시해 두세요.`]);
  if (!junk && q[1].score === 1) strategies.push(['믿음과 표현 이어 쓰기', RUBRIC.q2.strategy]);
  if (!strategies.length) strategies.push(['문단별로 정리하며 읽기', RUBRIC.fallbackStrategy]);

  const written = q[1].score + q[2].score;
  const G = RUBRIC.guides;
  const fluency = !g ? ['시선 기록이 없어요.', '카메라 점검과 보정을 거쳐 읽으면 읽기 과정을 함께 볼 수 있어요.', '다음 회차에서 시선 기록과 함께 확인합니다.']
    : [`읽기 ${g.sec}초(1분에 약 ${g.cpm}자) · 고정 ${g.fixations}회, 평균 ${g.meanFix}ms · 되돌아 읽기 ${g.regs.total}회 · 첫 읽기에서 지나친 낱말 ${g.skip}%${g.reliable ? '' : ' · 추적 품질이 낮아 참고만'}`,
      g.pace === 'skim' ? '지문을 끝까지 읽지 않고 훑었을 가능성이 있어요.' : g.pace === 'slow' ? '어려운 낱말이나 문장에서 오래 머물렀을 수 있어요.' : '읽기 속도는 보통 범위예요.',
      g.pace === 'skim' ? '문단별 한 줄 요약을 쓰게 한 뒤 문항으로 넘어가도록 안내합니다.' : g.long.length ? `‘${g.long.join('’, ‘')}’의 뜻을 문맥으로 설명하게 해 봅니다.` : G.fluency];
  const domains = [
    ['읽기 유창성', ...fluency],
    ['핵심 내용 파악', q[0].picked === null ? '문항 1을 고르지 않았어요.' : `문항 1에서 ${q[0].picked + 1}번을 골랐어요(${q[0].ok ? '정답' : `오답, 정답 ${RUBRIC.q1.answer + 1}번`}).`, q[0].ok ? '호랑이와 까치의 상징을 구분했을 수 있어요.' : '상징의 의미를 구분하는 데 확인이 필요해요.', G.main],
    ['맥락 파악', `문항 2 루브릭 ${q[1].score}/3 · ${q[1].flag ? FB_FLAG_TEXT[q[1].flag] : q[1].found.length ? '든 근거: ' + rbList(q[1].found) : '근거 언급 없음'}`, q[1].score >= 2 ? '두려움과 친근함이라는 서로 다른 인식을 연결했어요.' : '인식이 바뀌는 흐름을 연결하지 못했을 수 있어요.', G.context],
    ['추론 능력', q[1].score === 3 ? '믿음과 표현을 이어서 까닭을 설명했어요.' : q[1].score === 2 ? '근거는 들었지만 까닭을 끝까지 잇지 않았어요.' : '근거와 까닭을 잇는 설명이 없어요.', q[1].score >= 2 ? '근거를 연결하는 추론이 보여요.' : '표현과 의도를 연결하는 과정에 확인이 필요해요.', G.inference],
    ['비판적 읽기', `문항 3 루브릭 ${q[2].score}/3 · ${q[2].flag ? FB_FLAG_TEXT[q[2].flag] : q[2].note}`, q[2].score >= 2 ? '말하기 방법과 효과를 판단했어요.' : '방법을 찾는 것과 효과를 판단하는 것을 나눠 확인해야 해요.', G.critical],
  ];

  return {
    q, gaze: g, answerMs,
    summary: `선택형 ${q[0].score}/1 · 서술형 ${written}/6`,
    feedback: override?.feedback ?? { strength: fbItems(strengths.slice(0, 3)), concept: fbItems(concepts.slice(0, 3)), strategy: fbItems(strategies.slice(0, 3)) },
    grader: override ? 'claude' : 'rule',
    domains,
  };
}

/* ---------- 제출 시 분석·저장 ---------- */
const fbOrigSubmit = action['confirm-submit'];
action['confirm-submit'] = () => {
  const name = fbStudentName();
  const ses = gzLatest(name);
  const fresh = ses && Date.now() - new Date(ses.endedAt).getTime() < 3 * 3600 * 1000 ? ses : null;
  const answerMs = st.answerStartedAt ? Date.now() - st.answerStartedAt : null;
  const analysis = fbAnalyze(st.answers.slice(), fresh, answerMs);
  const subs = fbRead(FB_SUBMIT);
  subs[name] = { answers: st.answers.slice(), submittedAt: new Date().toISOString(), answerMs, sessionId: fresh?.id ?? null, analysis };
  fbWrite(FB_SUBMIT, subs);
  st.publishedRead = false;
  st.answerStartedAt = null;
  console.info('[feedback]', name, analysis.summary, analysis);
  fbOrigSubmit();
  fbClaudeGrade(name);
};

/* 학생 화면: 교사가 게시한 내용이 있으면 그것을, 없으면 기본 피드백을 보여 준다.
   이전 버전이 저장한 자동 분석 게시본(auto)은 쓰지 않는다. */
function fbSyncPublished() {
  const rec = fbPublished(fbStudentName());
  const pub = rec && !rec.auto ? rec : null;
  st.published = pub ? { ...pub.published } : { ...studentFeedbackContent };
  st.feedbackVersion = pub ? pub.version : 1;
  return pub;
}

function fbQuestionList(sub) {
  return sub.analysis.q.map((r, i) => {
    const label = r.kind === 'choice'
      ? (r.picked === null ? '선택 안 함' : r.ok ? `정답 · ${r.picked + 1}번` : `오답 · ${r.picked + 1}번 선택, 정답 ${RUBRIC.q1.answer + 1}번`)
      : `루브릭 ${r.score}/3`;
    const tone = r.kind === 'choice' ? (r.ok ? 'green' : 'amber') : r.score >= 2 ? 'green' : r.score === 1 ? '' : 'amber';
    const miss = r.kind === 'written' && !r.flag && r.missing.length && r.score < 3 ? `<p class="small" style="margin-top:6px">더 쓸 수 있는 근거: ${esc(r.missing.join(', '))}</p>` : '';
    return `<div class="rubric"><div class="label-line">${badge('문항 ' + (i + 1) + ' · ' + questions[i].type)}${badge(label, tone)}</div><p style="margin-top:10px">${esc(r.note || '')}</p>${miss}</div>`;
  }).join('');
}

const fbOrigHome = views['s-home'];
views['s-home'] = () => {
  const rec = fbSyncPublished();
  if (!rec && !fbSubmission(fbStudentName())) return fbOrigHome();
  const tpl = document.createElement('template');
  tpl.innerHTML = fbOrigHome();
  const source = tpl.content.querySelector('.home-feedback-source');
  if (source) source.textContent = `${rec ? '김하늘 선생님' : '학습 피드백'} · ${passageTitle}`;
  const summary = tpl.content.querySelector('.home-feedback-summary p');
  const first = String(st.published.strategy ?? '').split(/\n\s*\n/)[0] ?? '';
  if (summary && first) summary.textContent = first.includes(': ') ? first.slice(first.indexOf(': ') + 2) : first;
  return tpl.innerHTML;
};

const fbOrigFeedback = views['s-feedback'];
views['s-feedback'] = () => {
  const name = fbStudentName();
  const rec = fbSyncPublished();
  const sub = fbSubmission(name);
  if (rec || sub) st.publishedPassageTitle = passageTitle;
  const tpl = document.createElement('template');
  tpl.innerHTML = fbOrigFeedback();
  const heading = tpl.content.querySelector('.student-feedback-heading h2');
  if (heading) heading.textContent = `${name} 학생 학습 피드백`;
  if (sub) {
    tpl.content.querySelector('.feedback-read-action')?.insertAdjacentHTML('beforebegin', `<section class="feedback-section feedback-section-check"><div class="feedback-section-heading"><span aria-hidden="true">04</span><h3>문항별 확인 · ${esc(sub.analysis.summary)}</h3></div><div class="fb-check-list">${fbQuestionList(sub)}</div><p class="small fb-check-note">${fbGraderLine(sub.analysis, 'student')}</p></section>`);
  }
  return tpl.innerHTML;
};

const fbOrigComplete = views['s-complete'];
views['s-complete'] = () => {
  const html = fbOrigComplete();
  if (!st.submitted || !fbSubmission(fbStudentName())) return html;
  return html.replace(link('학생 홈으로', 's-home', 'btn'), link('피드백 확인 ' + icon('arrow'), 's-feedback', 'btn'));
};

/* ---------- Claude 채점 (로컬 서버 /api/grade) ---------- */
function fbGraderLine(a, who) {
  if (a.grading === 'pending') return 'Claude가 서술형을 채점하고 있어요. 잠시 뒤 결과가 바뀔 수 있어요.';
  if (a.grader === 'claude') return who === 'teacher' ? `서술형은 Claude(${a.model ?? 'claude'})가 루브릭으로 채점했어요.` : '서술형은 Claude가 루브릭으로 채점했어요. 선생님이 확인해요.';
  const why = who === 'teacher' && a.gradingNote ? ` (Claude 채점 안 됨: ${a.gradingNote})` : '';
  return who === 'teacher' ? `서술형은 낱말 기준 자동 채점이라 교사 확인이 필요해요.${why}` : '서술형은 글의 근거 낱말을 기준으로 자동 채점했어요. 표현이 달라 놓친 부분은 선생님이 확인해요.';
}

const fbFromClaude = x => ({ kind: 'written', max: 3, score: x.score, found: x.found ?? [], missing: x.missing ?? [], flag: x.flag === 'none' ? null : x.flag, note: x.note });

function fbUpdateSubmission(name, fn) {
  const subs = fbRead(FB_SUBMIT);
  if (!subs[name]) return null;
  fn(subs[name]);
  fbWrite(FB_SUBMIT, subs);
  return subs[name];
}

function fbRefresh() {
  if (['s-home', 's-feedback', 's-complete', 't-report', 't-feedback'].includes(st.page)) render();
}

async function fbClaudeGrade(name) {
  const sub = fbUpdateSubmission(name, s => { s.analysis.grading = 'pending'; });
  if (!sub) return;
  fbRefresh();
  const a = sub.analysis;
  const pick = sub.answers[0];
  const q1 = `${questions[0].text}\n${questions[0].choices.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n학생 선택: ${pick === '' ? '없음' : Number(pick) + 1 + '번'} · ${a.q[0].ok ? '정답' : '오답'} (정답 ${RUBRIC.q1.answer + 1}번)`;
  let status = 0, body = {};
  try {
    const res = await fetch('api/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: passageTitle, passage: passagePlain, passageChars: fbPassageChars(), q1, rubric: [RUBRIC.q2.claude, RUBRIC.q3.claude].join('\n\n'), questions: [questions[1].text, questions[2].text], answers: sub.answers, gaze: a.gaze, answerSec: sub.answerMs ? Math.round(sub.answerMs / 1000) : null }),
    });
    status = res.status;
    body = await res.json().catch(() => ({}));
  } catch {
    status = 0;
    body = { message: '채점 서버에 연결하지 못했어요' };
  }
  if (status !== 200) {
    fbUpdateSubmission(name, s => { s.analysis.grading = 'off'; s.analysis.gradingNote = body.message ?? `HTTP ${status}`; });
    console.info('[feedback] Claude grading unavailable:', status, body.message ?? '');
    fbRefresh();
    return;
  }
  const ses = sub.sessionId ? gzById(sub.sessionId) : null;
  const merged = fbAnalyze(sub.answers, ses, sub.answerMs, { q: [a.q[0], fbFromClaude(body.q2), fbFromClaude(body.q3)], feedback: Object.fromEntries(['strength', 'concept', 'strategy'].map(k => [k, fbItems((body.feedback?.[k] ?? []).map(x => [x.title, x.body]))])) });
  merged.model = body.model;
  merged.grading = 'done';
  fbUpdateSubmission(name, s => { s.analysis = merged; });
  console.info('[feedback] Claude grading', merged.summary, body.model);
  fbRefresh();
  toast(`Claude 채점을 반영했어요. ${merged.summary}`);
}

action['fb-regrade'] = () => fbClaudeGrade(st.reportStudent);

/* ---------- 교사 화면 ---------- */
const fbOrigReportAnswers = reportAnswers;
reportAnswers = function () {
  const sub = fbSubmission(st.reportStudent);
  if (!sub) return fbOrigReportAnswers();
  return `<div class="stack">${questions.map((q, i) => {
    const r = sub.analysis.q[i];
    const answer = i === 0 ? (sub.answers[0] === '' ? '(선택 안 함)' : `${Number(sub.answers[0]) + 1}. ${q.choices[Number(sub.answers[0])]}`) : sub.answers[i] || '(빈 답)';
    const label = r.kind === 'choice' ? (r.ok ? '정답' : '오답') : `루브릭 ${r.score}/3`;
    const tone = r.kind === 'choice' ? (r.ok ? 'green' : 'amber') : r.score >= 2 ? 'green' : 'amber';
    return `<div class="rubric"><div class="label-line">${badge('문항 ' + (i + 1))}${badge(label, tone)}${r.flag ? badge('확인 필요', 'amber') : ''}</div><h3 style="margin-top:12px">${q.text}</h3><p>학생 응답: ${esc(answer)}</p><p style="margin-top:9px">${esc(r.note || '')}</p>${r.kind === 'written' && r.missing.length && r.score < 3 ? `<p class="small" style="margin-top:6px">빠진 근거: ${esc(r.missing.join(', '))}</p>` : ''}</div>`;
  }).join('')}<p class="small">제출 ${gzWhen(sub.submittedAt)}${sub.answerMs ? ` · 응답에 걸린 시간 ${gzSec(sub.answerMs)}` : ''} · ${esc(sub.analysis.summary)} · ${fbGraderLine(sub.analysis, 'teacher')}</p>${sub.analysis.grader !== 'claude' && sub.analysis.grading !== 'pending' ? `<div class="actions">${button('Claude로 다시 채점', 'fb-regrade', 'secondary sm')}</div>` : ''}</div>`;
};
/* 교사가 처음 리포트·피드백 화면을 열면, 실제로 제출(또는 시선 기록)한 가장 최근 학생을 고른다. */
function fbLatestRealStudent() {
  const subs = Object.entries(fbRead(FB_SUBMIT)).sort((a, b) => (b[1].submittedAt ?? '').localeCompare(a[1].submittedAt ?? ''));
  return subs[0]?.[0] ?? gzSessions().at(-1)?.student ?? null;
}
function fbAutoPick() {
  if (st.reportAutoPicked) return;
  st.reportAutoPicked = true;
  const name = fbLatestRealStudent();
  if (!name) return;
  if (!fbSubmission(st.reportStudent) && !gzLatest(st.reportStudent)) { st.reportStudent = name; st.reportFinal = false; }
  if (!fbSubmission(st.feedbackStudent)) setFeedbackStudent(name);
}
const fbOrigLogout = action.logout;
action.logout = () => { st.reportAutoPicked = false; fbOrigLogout(); };

const fbOrigReport = views['t-report'];
views['t-report'] = () => {
  fbAutoPick();
  const sub = fbSubmission(st.reportStudent);
  let html;
  if (sub) {
    const saved = observations.slice();
    observations.splice(0, observations.length, ...sub.analysis.domains);
    try { html = fbOrigReport(); } finally { observations.splice(0, observations.length, ...saved); }
    html = html.replace('<h2>5개 영역 · 관찰과 지도 제안</h2>', `<h2>5개 영역 · 관찰과 지도 제안</h2>${badge('답안·시선 분석', 'green')}`);
  } else html = fbOrigReport();
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  fbAddNames(tpl, '#report-select', st.reportStudent);
  // 5개 영역 점수: 오른쪽 열 맨 아래(5개 영역 관찰 바로 위의 빈 곳)
  tpl.content.querySelector('.report-layout > aside')?.insertAdjacentHTML('beforeend', fbRadarCard(sub ? fbDomainScores(sub.analysis) : fbExampleScores(st.reportStudent)));
  // 답안만 있고 시선 기록이 없으면 위쪽 시선 지표(예시 값)를 지운다
  if (sub && !gzLatest(st.reportStudent)) tpl.content.querySelector('.report-layout > section.card .report-gaze-top')?.remove();
  if (sub || gzLatest(st.reportStudent)) {
    const r = fbLiteracySummary(st.reportStudent);
    const lv = tpl.content.querySelector('[data-summary-level]'), rk = tpl.content.querySelector('[data-summary-rank]');
    if (lv) lv.textContent = r ? `현재 문해력 수준은 ${r.level}입니다.` : '답안을 제출하면 문해력 수준을 보여 줍니다.';
    if (rk) rk.textContent = r ? `학습자는 학년 상위 ${r.top}%입니다.` : '학년 내 위치는 답안을 제출한 뒤 계산합니다.';
  }
  // 실제 제출은 있는데 시선 기록이 없으면, 예시 히트맵 대신 기록이 없다고 보여 준다.
  if (sub && !gzLatest(st.reportStudent) && st.reportTab !== 'answer') {
    const card = tpl.content.querySelector('.report-layout > section.card');
    const tabsEl = card?.querySelector('.tabs');
    const pill = card?.querySelector('.section-head .pill');
    if (pill) pill.textContent = '시선 기록 없음';
    if (tabsEl) {
      while (tabsEl.nextSibling) tabsEl.nextSibling.remove();
      tabsEl.insertAdjacentHTML('afterend', `<div style="margin-top:18px">${note('이 학생은 카메라 점검과 시선 보정 없이 지문을 읽어 시선 기록이 없어요. 응답·루브릭 탭과 아래 5개 영역 분석은 실제 답안으로 만들었어요.')}</div>`);
    }
  }
  return tpl.innerHTML;
};

/* 종합 결과: 이해 점수로 4단계 수준(매우잘함·잘함·보통·노력요함)을 정하고,
   학급 명단(실제 응시 학생 + 예시 학생) 안에서 상위 몇 %인지 계산한다. 학년 단위 자료가 연결되면 그 명단으로 바꾼다. */
function fbLiteracySummary(name) {
  if (typeof inRows !== 'function') return null;
  const mine = inRows(name).at(-1)?.score;
  if (mine == null) return null;
  const scores = inRoster().map(s => s.last?.score).filter(n => n != null);
  const level = mine >= 85 ? '매우잘함' : mine >= 70 ? '잘함' : mine >= 50 ? '보통' : '노력요함';
  const top = Math.max(1, Math.round(((scores.filter(n => n > mine).length + 1) / Math.max(1, scores.length)) * 100));
  return { level, top };
}

/* ---------- 5개 영역 점수 (오각형) ----------
   실제 응시: 답안 채점과 시선 기록으로 0~100점. 읽기 유창성(읽기 속도·건너뛴 단어·추적 품질), 핵심 내용 파악(문항 1),
   맥락 파악(문항 2에서 든 근거의 비율), 추론 능력(문항 2 루브릭), 비판적 읽기(문항 3 루브릭).
   학급 예시 학생: 이해 점수를 중심으로 이름마다 고정된 차이를 둔 점수. */
const FB_DOMAINS = ['읽기 유창성', '핵심 내용 파악', '맥락 파악', '추론 능력', '비판적 읽기'];
const fbClamp = n => Math.max(0, Math.min(100, Math.round(n)));
function fbDomainScores(a) {
  const q = a.q, g = a.gaze;
  const fluency = !g ? 50 : fbClamp((g.pace === 'normal' ? 88 : g.pace === 'slow' ? 62 : 38) - Math.max(0, g.skip - 35) * 0.6 - (g.reliable ? 0 : 10));
  const main = q[0].ok ? 100 : q[0].picked === null ? 0 : 30;
  const context = ['empty', 'noise', 'short'].includes(q[1].flag) ? 0 : fbClamp((q[1].found.length / Math.max(1, RUBRIC.q2.evidence.length)) * 100);
  return [fluency, main, context, fbClamp((q[1].score / 3) * 100), fbClamp((q[2].score / 3) * 100)];
}
function fbExampleScores(name) {
  const r = typeof inRoster === 'function' ? inRoster().find(s => s.name === name) : null;
  const base = r?.last?.score ?? 60;
  return FB_DOMAINS.map((d, i) => {
    let h = 0;
    for (const ch of name + d) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return fbClamp(base + (h % 41) - 20 + (i === 1 ? 8 : 0));
  });
}
function fbRadarCard(scores) {
  const cx = 190, cy = 154, R = 94;
  const pt = (i, r) => { const a = ((-90 + i * 72) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const fmt = p => p.map(n => n.toFixed(1)).join(',');
  const poly = r => FB_DOMAINS.map((_, i) => fmt(pt(i, r))).join(' ');
  const grid = [0.2, 0.4, 0.6, 0.8, 1].map(f => `<polygon class="fb-radar-grid" points="${poly(R * f)}"/>`).join('');
  const axes = FB_DOMAINS.map((_, i) => { const [x, y] = pt(i, R); return `<line class="fb-radar-axis" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('');
  const data = scores.map((s, i) => pt(i, R * Math.max(0.04, s / 100)));
  const labels = FB_DOMAINS.map((t, i) => {
    const [x, y] = pt(i, R + 12);
    const anchor = Math.abs(x - cx) < 4 ? 'middle' : x > cx ? 'start' : 'end';
    const dy = i === 0 ? -16 : i === 2 || i === 3 ? 10 : -2;
    return `<text class="fb-radar-label" x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}">${t}</text><text class="fb-radar-value" x="${x.toFixed(1)}" y="${(y + dy + 17).toFixed(1)}" text-anchor="${anchor}">${scores[i]}</text>`;
  }).join('');
  const avg = Math.round(scores.reduce((s, n) => s + n, 0) / scores.length);
  return `<section class="card report-radar-card"><div class="spread"><h3>5개 영역 점수</h3><span class="pill in-mentor">평균 ${avg}점</span></div><p class="small" style="margin-top:6px">100점 기준</p>`
    + `<svg class="fb-radar" viewBox="0 0 380 300" role="img" aria-label="${FB_DOMAINS.map((t, i) => `${t} ${scores[i]}점`).join(', ')}">${grid}${axes}<polygon class="fb-radar-area" points="${data.map(fmt).join(' ')}"/>${data.map(([x, y]) => `<circle class="fb-radar-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`).join('')}${labels}</svg></section>`;
}

function fbAddNames(tpl, selector, current) {
  const sel = tpl.content.querySelector(selector);
  if (!sel) return;
  const names = [...new Set([...Object.keys(fbRead(FB_SUBMIT)), ...gzSessions().map(s => s.student)])];
  for (const n of names) {
    if ([...sel.options].some(o => o.textContent === n)) continue;
    const o = document.createElement('option');
    o.textContent = n;
    sel.append(o);
  }
  for (const o of sel.options) o.toggleAttribute('selected', o.textContent === current);
}

const fbOrigTeacherFeedback = views['t-feedback'];
views['t-feedback'] = () => {
  fbAutoPick();
  const tpl = document.createElement('template');
  tpl.innerHTML = fbOrigTeacherFeedback();
  fbAddNames(tpl, '#feedback-select', st.feedbackStudent);
  const sub = fbSubmission(st.feedbackStudent);
  if (sub) {
    const btn = tpl.content.querySelector('[data-action="feedback-generate"]');
    if (btn) btn.textContent = '분석 초안 불러오기';
    const noteEl = [...tpl.content.querySelectorAll('.note span')].find(n => n.textContent.includes('게시 버튼을 누른'));
    if (noteEl) noteEl.textContent = `분석 초안은 ${sub.analysis.summary} 채점 결과와 시선 기록으로 만들었어요. ${fbGraderLine(sub.analysis, 'teacher')} 검토 후 게시해 주세요.`;
    const evidence = tpl.content.querySelector('aside .card p.small');
    if (evidence) evidence.innerHTML = sub.analysis.q.map((r, i) => `문항 ${i + 1}: ${esc(r.kind === 'choice' ? (r.ok ? '정답' : '오답') : '루브릭 ' + r.score + '/3')} · ${esc(r.note || '')}`).join('<br>');
  }
  return tpl.innerHTML;
};

const fbOrigGenerate = action['feedback-generate'];
action['feedback-generate'] = () => {
  const sub = fbSubmission(st.feedbackStudent);
  if (!sub) { fbOrigGenerate(); return; }
  st.feedbackDraft = { ...sub.analysis.feedback };
  render();
  toast('답안과 시선 기록으로 만든 초안을 불러왔어요. 검토 후 게시해 주세요.');
};

const fbOrigPublish = action['feedback-publish'];
action['feedback-publish'] = () => {
  const name = st.feedbackStudent;
  fbOrigPublish();
  const pubs = fbRead(FB_PUBLISH);
  pubs[name] = { published: { ...st.feedbackDraft }, version: (pubs[name]?.version ?? 0) + 1, auto: false, at: new Date().toISOString() };
  fbWrite(FB_PUBLISH, pubs);
};

/* 문항 응답을 시작한 시각(응답 시간 계산용) */
afterRenderHooks.push(() => {
  if (st.page === 's-answer' && !st.answerStartedAt && !st.submitted) st.answerStartedAt = Date.now();
});

render();
