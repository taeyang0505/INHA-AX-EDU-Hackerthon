# 코드 구조

LOOKteracy는 번들러 없이 `dist/`의 파일을 브라우저가 그대로 읽는 정적 웹앱입니다. 앱 스크립트는 모두 일반 `<script>`로 읽혀 같은 전역 환경을 씁니다. 서버(`scripts/serve.mjs`)는 정적 파일과 채점 API만 맡고, 기록은 모두 브라우저에 남습니다. 폴더 구성은 `README.md` 7장에 있습니다.

판정 기준값(얼굴 일치 거리, 고정점 기준, 평균 비교값 등)은 이 문서에서 다루지 않습니다. `docs/NOTES.md` 2장을 보세요.

## 1. 파일 구성과 로딩 순서

### CSS (index.html 순서, 뒤 파일이 앞 규칙을 덮어씀)

| 순서 | 파일 | 역할 |
|---|---|---|
| 1 | `styles.css` | 처음 디자인의 토큰, 기본 요소, 공통 컴포넌트. Google Fonts(Noto Sans KR)를 불러온다. 인터넷이 없으면 시스템 글꼴로 보인다. 지금 쓰지 않는 규칙도 남아 있다 |
| 2 | `look.css` | 최신 UI 토큰(`--read-size` 등), 글자·버튼·카드 크기, 사이드바·가입·설정 화면 |
| 3 | `cooperation.css` | 그룹 관리 화면(`coop-`) |
| 4 | `landing.css` | 첫 화면, 로고(`.look-wordmark`), 읽기 경로 그림 |
| 5 | `auth.css` | 로그인 화면, 사이드바·상단바 로고, 공개 화면 공통 하단 문구. 가입 화면 배치는 look.css(`.signup-wrap`)에 있다 |
| 6 | `student-home.css` | 학생 홈 전용 배치(`body.student-home-page`), 교사 바로가기 아이콘 |
| 7 | `student-tests.css` | 나의 테스트 카드. 이전 학습 준비 화면 규칙도 남아 있다 |
| 8 | `prep-flow.css` | 학습 단계 표시 정렬, 학습 준비 카드(카메라 안내·보정 영역) |
| 9 | `test-flow.css` | 준비·읽기·응답·제출 네 단계와 나의 테스트 화면의 공통 여백, 카드 높이 |
| 10 | `feedback-flow.css` | 피드백·추천 학습 화면, 성장 그래프 카드 |
| 11 | `realtime.css` | 뒤에 붙인 모듈의 화면. 앞머리 `fp-` 페이스패스, `gz-` 시선, `in-` 대시보드·성장. 채점·리포트용 `fb-`(5개 영역 점수 `fb-radar` 포함)·`rp-` 클래스도 있다. 10~16장은 나중에 고친 화면이고, 15장에 포인트 주황색 변수(`--point` 등)가 있다. 파일 맨 위에 목차와 의미 색이 있다 |

### 스크립트 (index.html 순서)

| 순서 | 파일 | 역할 |
|---|---|---|
| 1 | `reset.js` | 주소가 `#reset`이면 다른 스크립트보다 먼저 기록을 지운다 |
| 2 | `icons.js` | SVG 아이콘 `icon()`, HTML 이스케이프 `escapeHTML()` |
| 3 | `look.js` | 공통 조각(`button`, `link`, `badge`, `head`, `field` 등), `toast()`·`modal()`, 지문 데이터, 예시 학급, `st`, 메뉴, `names`, `safePage()`, `route()`, `render()`, 로그인·가입·공통 틀 `shell()` |
| 4 | `views.js` | `views` 객체 생성, 학생 화면, 문항 `questions`, 설정 화면 |
| 5 | `teacher.js` | 교사 화면(대시보드, 테스트 구성, 응시 현황, 리포트, 피드백 편집, 모둠 운영, 자료실, 학급) |
| 6 | `cooperation.js` | 그룹 관리. 테스트 목록 `coopTests`, AI 분류 예시, 교사 최종 그룹 저장. `views['t-groups']`를 새로 쓴다 |
| 7 | `landing.js` | 첫 화면, 로고 `publicWordmark()`, 글자를 따라가는 예시 애니메이션(실제 시선 아님) |
| 8 | `calibration.js` | 보정 카드의 안내 그림 `calibrationSurface()`와 점 이동 애니메이션. 실제 9점 보정은 gaze.js가 맡는다 |
| 9 | `feedback.js` | 학생 피드백 화면, 기본 피드백 문구, 성장 그래프 예시, 추천 지문 |
| 10 | `interactions.js` | 기본 `action` 처리 함수, 문서 이벤트 위임, 필기 캔버스, 리포트 PNG 출력, 해시 이동. 파일 끝에서 그룹 관리 동작을 등록하고 첫 화면을 그린다 |
| 11 | `passage-rubric.js` | 지문별 정답·루브릭·개념 정의 `RUBRIC` |
| 12 | `facepass.js` | 페이스패스 등록·로그인. face-api.js 얼굴 특징값 비교와 MediaPipe 눈 깜빡임 확인. `render()`를 감싸 `afterRenderHooks`를 돌린다 |
| 13 | `gaze.js` | WebGazer 시선 추적. 카메라 점검, 9점 보정과 3초 정확도 확인, 읽기 중 수집, 고정점·단어별 지표, 히트맵·시선 경로 |
| 14 | `grading.js` | 채점(선택형 정답 비교, 서술형 루브릭 0~3점), 피드백 초안, 제출 저장, Claude 채점 요청, 리포트의 종합 결과와 5개 영역 점수(오각형 그래프) |
| 15 | `insight.js` | 개념 3분류, 회차별 변화율, 레벨·목표·칭찬, 교사 대시보드 카드, 나의 성장 화면, 진단·피드백 목록 화면 |

- 뒤 파일은 앞 파일의 전역을 바로 씁니다. gaze.js는 facepass.js의 `loadScriptOnce()`·`afterRenderHooks`·`fpCameraError()`를, grading.js는 gaze.js의 `gzLatest()`를, insight.js는 grading.js의 `fbRead()`·`fbSubmission()`을 씁니다. 순서를 바꾸지 마세요.
- 첫 화면은 interactions.js 끝의 `historyNavigation()`이 그립니다. gaze.js, grading.js, insight.js는 파일 끝에서 `render()`를 불러 자기가 덧붙인 내용까지 넣어 다시 그립니다.
- 외부 라이브러리는 index.html에 없고 필요할 때 읽습니다. face-api.js는 facepass.js가 `loadScriptOnce()`로, MediaPipe `vision_bundle.mjs`는 facepass.js가 `import()`로, `webgazer.js`는 gaze.js가 `loadScriptOnce()`로 불러옵니다.

## 2. 화면 그리기 구조

| 이름 | 위치 | 하는 일 |
|---|---|---|
| `st` | look.js | 화면 상태를 담는 전역 객체. 뒤 파일이 필드를 더한다(`st.user`, `st.reportView` 등). 카메라와 모델 상태는 facepass.js의 `fp`, gaze.js의 `gz`에 따로 있다. 저장소에서 읽어 오는 값을 빼면 새로고침할 때 처음 값으로 돌아간다 |
| `names` | look.js | 경로 → 화면 이름. 탭 제목과 상단 경로 표시에 쓰고, `safePage()`가 허용하는 경로 목록이기도 하다 |
| `views` | views.js | 경로 → HTML 문자열을 돌려주는 함수. views.js, teacher.js, cooperation.js, insight.js가 등록한다 |
| `action` | interactions.js | `data-action` 이름 → 처리 함수 `el => {}` |
| `safePage(p)` | look.js | 지금 역할과 학습 단계에서 갈 수 있는 경로로 바꾼다 |
| `route(p, replace)` | look.js | `safePage()`를 거쳐 `st.page`를 정하고 주소에 `#경로`를 남긴 뒤 `render()` |
| `render()` | look.js | `#app`의 HTML을 통째로 다시 쓴다 |

1. 클릭은 interactions.js가 `document`에 달아 둔 리스너 하나가 받습니다. `data-route`는 `route()`를, `data-action`은 `action[이름](el)`을 부릅니다. 처리 중 오류가 나면 콘솔에 남기고 안내 문구를 띄웁니다. `data-tab`, `data-q`, `data-mode`, `data-sentence`, `data-filter`는 `st`를 바꾼 뒤 다시 그립니다.
2. 입력 칸의 `data-bind="feedbackDraft.strength"`처럼 점으로 이은 경로는 `bindValue()`가 `st`에 바로 씁니다. 이때는 다시 그리지 않습니다.
3. `route()`는 `history.pushState`로 주소를 남깁니다. 뒤로 가기와 주소 직접 입력은 `popstate`·`hashchange` → `historyNavigation()` → `route(해시, true)`로 처리합니다.
4. `render()`는 공개 화면(`landing`, `signup`, `login-student`, `login-teacher`)을 바로 그리고, 나머지는 `shell(views[st.page]())`로 사이드바와 상단바 안에 넣습니다.
5. `#app`을 통째로 바꾸므로 카메라 영상, 캔버스, 포커스는 그린 뒤 다시 붙입니다. facepass.js가 감싼 `render()`는 그린 뒤 `afterRenderHooks`를 차례로 부릅니다. facepass.js(로그인·가입 화면의 카메라 영상, 화면을 벗어나면 카메라 끄기), gaze.js(카메라 미리보기, 읽기 수집 시작, 히트맵, 화면을 벗어나면 카메라 끄기), grading.js(응답 시작 시각)가 여기에 함수를 넣습니다.

`safePage()` 규칙은 다음과 같습니다. 화면 가드일 뿐 접근 제어가 아닙니다.

- `names`에 없는 경로는 역할별 홈으로 보냅니다. 교사는 `t-dashboard`, 학생은 `s-home`, 로그인 전에는 `landing`입니다.
- 로그인 전에 `s-*`·`t-*`를 열면 `login-student` 또는 `login-teacher`로 갑니다.
- 로그인 뒤 다른 역할의 화면이나 공개 화면을 열면 자기 홈으로 갑니다. 단, facepass.js의 `route()` 래퍼는 `login-*`·`signup`으로 갈 때 먼저 로그아웃시킵니다.
- `s-reading`은 `st.ready`, `s-answer`는 `st.readDone`이 참일 때만 열립니다. 아니면 앞 단계로 돌아갑니다.

### 뒤 모듈의 감싸기 방식

facepass.js, gaze.js, grading.js, insight.js는 앞 파일을 고치지 않습니다. 원래 함수를 변수에 받아 두고, 같은 자리에 새 함수를 넣습니다. 새 함수는 대개 원래 HTML을 `<template>`에 넣고 필요한 곳만 찾아 바꿉니다. 그래서 views.js와 teacher.js의 마크업과 디자인이 그대로 남습니다. gaze.js의 예입니다.

```js
const gzOrigReading = views['s-reading'];
views['s-reading'] = () => {
  const tpl = document.createElement('template');
  tpl.innerHTML = gzOrigReading();
  const tools = tpl.content.querySelector('.reader-tools');
  if (tools) {
    tools.insertAdjacentHTML('afterbegin', `<span class="gz-live-pill ...">...</span>`);
  }
  return tpl.innerHTML;
};
```

동작도 같은 방식입니다. `action['read-done']`은 gaze.js가 시선 세션을 저장한 뒤 원래 처리를 부르고, `action['confirm-submit']`은 grading.js(채점·저장)와 insight.js(회차 기록)가 차례로 감쌉니다. 화면 함수 말고도 `render`·`login`·`shell`·`faceFrame`(facepass.js), `route`(facepass.js, insight.js), `reportAnswers`(grading.js), `fbRefresh`(insight.js)를 이렇게 감쌉니다. `signup()`은 facepass.js가 통째로 새로 씁니다. `function`으로 선언한 전역은 다시 넣을 수 있고, `const` 객체(`views`, `action`, `names`)는 속성만 바꿉니다.

- 감싸는 쪽은 클래스나 `data-action` 같은 선택자로 자리를 찾고, 못 찾으면 조용히 넘어갑니다. 원래 마크업의 클래스(`.reader-tools`, `.report-layout > section.card` 등)를 바꾸면 덧붙이던 내용이 빠집니다. 바꾸기 전에 그 이름을 grep으로 찾아보세요. facepass.js의 `shell`·`s-home`, grading.js의 `s-complete`·`t-report`는 원래 문자열을 그대로 찾아 바꾸므로 그 문구를 고칠 때도 마찬가지입니다.
- 새 경로는 `names`에 있어야 `safePage()`를 통과합니다. insight.js의 `s-growth`는 첫 화면을 그린 뒤에 등록되므로 `#s-growth`에서 새로고침하면 학생 홈이 열립니다. 새 화면의 이름은 look.js의 `names`에 넣는 편이 안전합니다.
- 새 모듈은 index.html에서 insight.js 뒤에 두고, 파일 끝에서 `render()`를 한 번 부르세요.

## 3. 화면 목록

주 파일 열의 괄호는 그 화면을 뒤에서 감싸는 파일입니다(로딩 순서대로).

| 경로 | 화면 이름 (`names`) | 구분 | 주 파일 |
|---|---|---|---|
| `#landing` | 서비스 안내 | 공통 | landing.js |
| `#login-student` | 페이스패스 로그인 | 공통 | look.js `login(true)` (facepass.js) |
| `#login-teacher` | 교사 로그인 | 공통 | look.js `login(false)` |
| `#signup` | 학생 가입·등록 (facepass.js가 '가입·등록'으로 바꿈) | 공통 | facepass.js가 `signup()`을 새로 씀 |
| `#s-home` | 학생 홈 | 학생 | views.js (facepass.js, grading.js) |
| `#s-tests` | 나의 테스트 | 학생 | views.js |
| `#s-prep` | 학습 준비 | 학생 | views.js, calibration.js (gaze.js) |
| `#s-reading` | 지문 읽기 | 학생 | views.js (gaze.js) |
| `#s-answer` | 문항 응답 | 학생 | views.js |
| `#s-complete` | 제출 완료 | 학생 | views.js (grading.js, insight.js) |
| `#s-feedback` | 피드백·추천 학습 | 학생 | feedback.js `renderStudentFeedbackPage()` (grading.js, insight.js) |
| `#s-growth` | 나의 성장 (insight.js가 `names`에 추가) | 학생 | insight.js |
| `#s-group` | 우리 모둠 | 학생 | views.js |
| `#s-history` | 학습 기록 | 학생 | views.js |
| `#s-settings` | 설정 | 학생 | views.js |
| `#t-dashboard` | 교사 대시보드 | 교사 | teacher.js (insight.js) |
| `#t-builder` | 테스트 구성·배정 | 교사 | teacher.js |
| `#t-monitor` | 응시 현황 | 교사 | teacher.js |
| `#t-report` | 학생 상세 리포트 (메뉴 이름 진단·피드백) | 교사 | teacher.js (gaze.js, grading.js, insight.js) |
| `#t-feedback` | 피드백 편집 | 교사 | teacher.js (grading.js) |
| `#t-groups` | 그룹 관리 | 교사 | cooperation.js가 teacher.js의 것을 덮어씀 |
| `#t-group-detail` | 테스트별 그룹 편성 | 교사 | cooperation.js |
| `#t-operation` | 모둠 운영 | 교사 | teacher.js |
| `#t-library` | 자료실 | 교사 | teacher.js |
| `#t-class` | 학급·학생 관리 | 교사 | teacher.js |
| `#t-settings` | 설정 | 교사 | views.js |
| `#reset` | 화면 없음. 기록 초기화 | 공통 | reset.js, facepass.js |

- 메뉴는 look.js의 `menuStudent`, `menuTeacher`입니다. insight.js가 학생 메뉴의 피드백 다음에 '나의 성장'을 넣습니다. 메뉴에 없는 화면에서는 `currentNav()`가 속한 메뉴를 켭니다. 학습 네 단계는 나의 테스트, `t-monitor`는 수업·테스트, `t-feedback`은 진단·피드백, `t-group-detail`·`t-operation`은 그룹 관리입니다.
- `t-operation`은 이전 모둠 운영 화면입니다. 그곳으로 가는 링크가 있던 teacher.js의 `t-groups`를 cooperation.js가 덮어써서, 지금은 주소로만 들어갑니다.
- `#login-teacher`의 로그인 버튼과 페이스패스 로그인 화면의 작은 체크 아이콘(`teacher-preview-access`)은 얼굴 확인 없이 교사로 들어가는 시연용 입구입니다.

**진단·피드백(`t-report`) 안의 화면.** insight.js가 `views['t-report']`를 감싸 `st.reportView` 값으로 나눕니다. `student-detail`과 `feedback-evidence`는 `st.reportDirect`를 켜서 목록을 건너뛰고 바로 리포트를 엽니다.

| `st.reportView` | 화면 | 들어오는 길 |
|---|---|---|
| `list` | 학생 목록 | 메뉴·대시보드 링크(insight.js의 `route()` 래퍼가 `list`로 맞춤), '학생 목록'으로 돌아가기(`rp-list`) |
| `tests` | 학생이 본 테스트 목록 | 학생 행(`rp-open`), '테스트 목록'으로 돌아가기(`rp-tests`) |
| `detail` | 이번 테스트(`test-03`) 리포트. 실제 기록이 있으면 그 답안·시선으로 그린다 | 테스트 행(`rp-test`), 응시 현황·학급 화면의 '리포트'(`student-detail`), 피드백 편집의 '리포트 근거 보기'(`feedback-evidence`) |
| `past` | 지난 회차 리포트(`test-01`, `test-02` 예시 결과) | 지난 테스트 행(`rp-test`) |

**리포트(`detail`)가 만들어지는 순서.** 안쪽부터 teacher.js → gaze.js → grading.js → insight.js가 차례로 감쌉니다.

1. teacher.js가 샘플 학생용 고정 리포트를 만듭니다. 탭 위의 시선 지표(`.report-gaze-top`), 히트맵, 응답·루브릭, 5개 영역 관찰, 오른쪽 열(종합 결과, 학습 성장 추이, '이 관찰을 다음 지도로')이 들어 있습니다.
2. gaze.js는 그 학생의 시선 기록이 있으면 `.report-gaze-top`을 실측 값으로 바꾸고, 히트맵과 시선 경로를 실측으로 그리고, '단어별 지표' 탭을 더합니다.
3. grading.js는 제출 답안이 있으면 응답·루브릭과 5개 영역 관찰을 채점 결과로 바꾸고, 종합 결과 문장을 `fbLiteracySummary()`로 다시 씁니다. 오른쪽 열 끝에는 `fbRadarCard()`로 5개 영역 점수를 붙입니다(실제 제출은 `fbDomainScores()`, 샘플 학생은 `fbExampleScores()`). 답안만 있고 시선 기록이 없으면 `.report-gaze-top`을 지웁니다.
4. insight.js는 오른쪽 열 맨 위에 CONCEPT · GROWTH 카드를 넣고, 맨 바깥에서 `st.reportView`에 따라 학생 목록, 테스트 목록, 리포트 중 하나를 그립니다.

**`#reset`.** `names`에 없는 특수 경로입니다. 처음 열 때는 reset.js가, 이미 열린 탭에서 주소를 바꾸면 facepass.js의 `route()` 래퍼가 처리합니다. `lookteracy-`로 시작하는 localStorage 키와 sessionStorage 전체를 지우고 `#landing`으로 보냅니다. 로그인 도움 창의 '모든 기록 초기화'(`fp-reset-all`)도 같은 일을 합니다.

## 4. 저장되는 데이터

서버에는 아무것도 저장하지 않습니다. 기록은 이 브라우저에만 남고, 학생은 이름으로 구분합니다. 이름은 `st.user.name`이고, 로그인 정보가 없으면 `김서윤`으로 저장됩니다.

**localStorage**

| 키 | 담는 내용 | 맡은 파일 |
|---|---|---|
| `lookteracy-facepass-v1` | `{schema:1, users:[{id, name, role, descriptors, createdAt}]}`. `descriptors`는 등록할 때 모은 얼굴 특징값(숫자 128개) 6개. 사진은 없다 | facepass.js |
| `lookteracy-gaze-sessions-v1` | 읽기 세션 배열(최근 8개). 시선 표본 `samples`, 단어 위치 `layout`, 고정점 `fixations`, 단어별 지표 `words`, 요약 `metrics`, 보정 결과 `calibration`. 저장 공간이 모자라면 오래된 세션부터 버린다 | gaze.js |
| `lookteracy-submissions-v1` | `{이름: {answers, submittedAt, answerMs, sessionId, analysis}}`. 학생마다 마지막 제출 하나. `analysis`에 문항별 채점 `q`, 피드백 초안 `feedback`, 5개 영역 관찰 `domains`, 채점 방식 `grader`(`rule`·`claude`)와 Claude 채점 상태 `grading`(`pending`·`off`·`done`) | grading.js |
| `lookteracy-feedback-v1` | `{이름: {published, version, auto, at}}`. 교사가 게시한 피드백. 학생 홈과 피드백 화면은 이전 버전이 남긴 `auto: true` 기록을 쓰지 않는다 | grading.js |
| `lookteracy-attempts-v1` | `{이름: [{at, answers, sessionId, analysis}]}`. 다시 도전을 포함한 회차 기록(최근 10개) | insight.js |
| `lookteracy-goals-v1` | `{이름: {current, history}}`. 학생이 고른 다음 목표와 달성 기록(최근 20개) | insight.js |
| `lookteracy-praise-v1` | `{이름: [{text, at, from}]}`. 교사가 보낸 칭찬(최근 20개) | insight.js |
| `lookteracy-cooperation-history-v1` | `{schema:1, records:{테스트 id: {ai, analyzedAt, draftGroups, finalGroups, savedAt, version, dirty}}}`. 그룹 관리의 AI 분류와 교사 그룹 | cooperation.js |

**sessionStorage** (탭을 닫으면 사라짐)

| 키 | 담는 내용 | 맡은 파일 |
|---|---|---|
| `lookteracy-demo-role` | `student` 또는 `teacher`. 새로고침해도 역할을 유지한다 | look.js(읽기), interactions.js(쓰기·지우기), facepass.js(지우기) |
| `lookteracy-demo-user` | `{id, name, role}`. 페이스패스로 로그인한 사용자 | facepass.js |
| `lookteracy-cooperation-selected` | 그룹 관리에서 연 테스트 id | cooperation.js |

- 카메라 영상과 얼굴 사진은 저장하지 않습니다. WebGazer 보정 데이터도 `saveDataAcrossSessions(false)`로 남기지 않습니다. 테스트 배정, 모둠 토론, 자료실 추가 같은 나머지 상태는 메모리에만 있습니다.
- grading.js와 insight.js의 키는 grading.js의 `fbRead()`·`fbWrite()`로 읽고 씁니다. facepass.js, gaze.js, cooperation.js는 자기 키를 직접 읽고 씁니다. 읽기에 실패하면 빈 값으로 시작하고, 그룹 관리만 기본 예시 기록으로 시작합니다.
- 초기화는 3장의 `#reset`을 보세요. 로그인 도움 창의 '등록 정보 모두 지우기'(`fp-clear`)는 `lookteracy-facepass-v1`만 지웁니다. 새 키는 `lookteracy-`로 시작해야 초기화할 때 함께 지워집니다.

## 5. 로컬 서버와 API

`scripts/serve.mjs`의 동작입니다.

- `dist/`를 정적 파일로 내보냅니다. `/`는 `index.html`입니다. `dist` 밖을 가리키면 403, 없는 파일은 404입니다. GET·HEAD만 받고 나머지는 405입니다. 파일 응답과 API의 JSON 응답에만 `Cache-Control: no-store`를 붙입니다. 403·404·405 같은 짧은 오류 응답에는 없습니다.
- `127.0.0.1`에서만 열립니다. 기본 포트는 4186이고, 인자는 `--port N` 하나만 받습니다(`npm run dev -- --port 4187`). 다른 인자를 주면 사용법을 출력하고 끝납니다. 포트가 이미 쓰이면 안내를 남기고 끝납니다. `start-mac.command`와 `start-windows.bat`는 `PORT` 환경 변수(기본 4186)로 서버를 켜고 브라우저를 엽니다.
- MIME 형식을 정해 둔 확장자는 `.html`, `.js`, `.mjs`, `.css`, `.svg`, `.json`, `.png`, `.jpg`, `.wasm`, `.task`, `.data`입니다. 나머지(`.bin` 등)는 `application/octet-stream`입니다. `.mjs`는 `text/javascript`여야 MediaPipe 모듈을 `import()`로 읽을 수 있고, `.wasm`은 `application/wasm`이어야 브라우저가 빠른 컴파일을 씁니다. `.task`와 `.data`는 기본값과 같은 `application/octet-stream`으로 적어 두었습니다. `charset=utf-8`은 글자 파일에만 붙입니다. wasm에 붙이면 브라우저가 빠른 컴파일을 거부합니다.
- 시작할 때 패키지 루트의 `.env`를 `process.loadEnvFile()`로 읽습니다(Node 20.12 이상). `.env`가 없거나 Node가 더 낮으면 조용히 넘어갑니다. `grade.mjs`는 `import()`로 불러오고, 실패하면 경고만 남깁니다.

API는 `scripts/grade.mjs`에 있습니다.

| 경로 | 방식 | 응답 |
|---|---|---|
| `/api/grader` | GET | `{configured, model}`. `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_PROFILE` 중 하나가 있으면 `configured: true`. 키가 맞는지는 확인하지 않는다. 화면은 부르지 않는 상태 확인용 |
| `/api/grade` | POST | 문항 2·3 채점과 학생 피드백 |

화면(grading.js `fbClaudeGrade()`)이 보내는 요청 본문입니다.

```js
{
  title, passage, passageChars, // passageTitle, passagePlain, 공백을 뺀 글자 수
  q1,                           // 문항 1 원문, 선택지, 학생 선택, 정답 여부를 이은 글
  rubric,                       // RUBRIC.q2.claude + RUBRIC.q3.claude
  questions: [문항2, 문항3], answers: [문항1 선택지 순번(0부터, 문자열), 문항2 답, 문항3 답],
  gaze,                         // fbGaze() 요약(읽기 시간, 속도, 고정, 건너뜀, 되돌아 읽기, 오래 머문 낱말, 추적 품질). 제출 전 3시간 안의 읽기 기록이 없으면 null
  answerSec                     // 응답에 걸린 시간(초)
}
```

성공하면 200으로 이렇게 답합니다.

```js
{
  grader: 'claude', model,
  q2: { score /* 0~3 */, found: [], missing: [], flag /* none, empty, noise, short, copied, off_topic, unsure */, note },
  q3: { /* q2와 같은 모양 */ },
  feedback: { strength: [{ title, body }], concept: [/* 같은 모양 */], strategy: [/* 같은 모양 */] }
}
```

- 모델은 `LOOKTERACY_GRADER_MODEL`이고, 없으면 `claude-opus-5-5`입니다. 결과는 JSON 스키마(`SCHEMA`)로 받습니다. 지문별 루브릭은 요청에 담겨 오고, 서버의 `SYSTEM` 프롬프트에는 지문과 무관한 채점 원칙만 있습니다.
- 본문이 64KB를 넘으면 읽기를 멈추고 연결을 끊습니다. 코드는 413을 보내려 하지만 `req.destroy()`가 먼저 소켓을 닫아 응답이 가지 않고, 화면은 연결 실패로 처리합니다. JSON이 아니거나 `answers`가 배열이 아니면 400입니다. 다른 실패는 `{error, message}`로 답합니다. 401 키 오류, 429 요청 과다, 422 채점 거절, 502 호출 실패(연결 오류 포함)·결과 잘림·해석 실패, 503 사용 불가입니다.
- SDK가 없으면(npm install 전) `grade.mjs`를 불러오지 못해 `/api/grade`와 `/api/grader` 모두 503 `{error: 'unavailable', configured: false, message}`로 답합니다.
- SDK는 있고 키가 없으면 `/api/grader`는 `configured: false`를 돌려주고, `/api/grade`는 호출이 실패해 503으로 답합니다.
- 화면은 제출할 때 규칙 채점 결과를 먼저 저장하고 `/api/grade`를 부릅니다. 200이 아니거나 연결에 실패하면 `analysis.grading`을 `off`로 바꾸고 이유를 `gradingNote`에 남긴 뒤 규칙 채점 결과를 그대로 씁니다. 교사 리포트에 이유가 보이고, 'Claude로 다시 채점'(`fb-regrade`)으로 다시 요청할 수 있습니다.
- 키는 서버에만 있습니다. 채점할 때 지문, 문항, 답안, 시선 요약이 Anthropic API로 갑니다.

## 6. 내용을 바꾸는 곳

| 바꿀 것 | 위치 | 메모 |
|---|---|---|
| 지문 본문 | look.js `paras` | 문단마다 문장 배열. `[[ ]]`는 밑줄(㉠~㉢). `sentences`와 `passagePlain`은 여기서 만든다 |
| 지문 제목 | look.js `passageTitle` | 학생 홈·나의 테스트 카드의 제목은 views.js `studentHomeAssignment`에 따로 있다 |
| 문항 | views.js `questions` | 문항 1 선택형(`choices`), 문항 2·3 서술형. 채점 코드가 이 세 문항 구성을 전제로 한다 |
| 정답·루브릭·개념 정의 | passage-rubric.js `RUBRIC` | `q1.answer`(0부터 센 정답), `why`·`misread`(오답별 설명. `misread`는 지금 어느 코드도 읽지 않는다), `q2`·`q3`의 `evidence`(근거 낱말 정규식)·`score()`·`notes`·`claude`(Claude용 루브릭), `fallbackConcept`·`fallbackStrategy`·`parentTip`(공통 문장), `guides`(5개 영역 지도 제안), `concepts`(개념 5개와 판정 `check()`), `exampleMisconception`·`exampleDifficult`(학급 예시에서 몰리는 개념) |
| 기본 피드백 | feedback.js `studentFeedbackSections` | `strength`·`concept`·`strategy` 각 `[제목, 내용]`. grading.js가 학생 화면과 교사 편집 초안에 같은 문구를 쓴다 |
| 5개 영역 점수 | grading.js `FB_DOMAINS`, `fbDomainScores()`, `fbExampleScores()` | 영역 이름과 점수 식. 식은 `docs/NOTES.md` 2장 |
| 성장 그래프 예시 | feedback.js `growthExample` | `{month, level}`. 학생 피드백 화면과 교사 리포트의 학습 성장 추이가 함께 쓴다 |
| 학급 예시 학생 | look.js `studentNames`, `baseStatus` | 10명의 이름과 응시 상태 |
| 예시 학생 결과 | insight.js `inExample(name, i)` | 이름과 명단 순번으로 시드를 정해 회차별 점수와 개념 진단을 만든다. 같은 학생이면 늘 같은 값. 실제 기록이 있는 학생은 실측으로 바뀐다 |
| 테스트 목록 | cooperation.js `coopTests` | `id`, `date`, `title`, `round`, `students`. 그룹 관리와 진단·피드백의 테스트 목록이 쓴다 |

- `test-03`이 '이번 테스트'로 코드에 정해져 있습니다(cooperation.js `initialCoopRecords()`, insight.js `rpTests()`·`rp-test`). `round`는 '3회차'처럼 한 자리 숫자로 시작해야 합니다. insight.js가 첫 글자를 숫자로 읽어 예시 회차를 고릅니다. 테스트를 더하면 cooperation.js `exampleClassification()`의 `variants`에도 같은 id를 넣으세요.
- 지문을 바꾸면 아래 예시 문구도 함께 고쳐야 합니다. views.js `studentHomeAssignment`·`articleMeta()`·`markedSentences`·`talkContent()`와 `s-home` 화면의 안내 문구, teacher.js `teacherSelectors()`·`heatSnippet`·`observations`·`reportAnswers()`·`resources`와 `t-dashboard`·`t-builder`·`t-report`·`t-feedback`·`t-operation` 화면의 예시 문장, interactions.js `question-info`·`ocr-example`·`exportReport()`, look.js `st.round`·`st.groupGoal`·`st.groupTask`, grading.js `fbAnalyze()`의 항목 제목과 5개 영역 관찰 문장입니다. 빠진 곳이 없는지 `호랑이`, `호작도` 같은 낱말로 grep해 보세요.

## 7. 검사

| 명령 | 스크립트 | 확인하는 것 |
|---|---|---|
| `npm run check` | scripts/check.mjs | `dist` 바로 아래 `.js` 파일마다 `node --check`로 문법 검사. `index.html`의 `src`·`href`가 가리키는 로컬 파일이 있는지 확인 |
| `npm test` | scripts/test.mjs | `tests/*.test.cjs`를 이름 순으로 실행. 하나라도 실패하면 멈춘다 |

- `calibration.test.cjs`는 calibration.js를 `vm`과 가짜 DOM으로 돌립니다. 점 이동 보간, 지나온 지점까지 그려지는 점선 경로, 두 번 누르기 막기, 취소와 처음으로 되돌리기, 움직임 줄이기 설정, 마지막 지점 뒤 준비 완료를 확인합니다.
- `cooperation.test.cjs`는 cooperation.js를 가짜 저장소로 돌립니다. 끝낸 학생만 AI 분류에 들어가는지, 한 학생이 여러 분류에 들어갈 수 있는지, 같은 학생을 두 번 넣으면 하나로 줄이는지, 그룹 이름 중복과 명단 밖 학생을 거절하는지, 최종 저장 뒤에도 AI 결과가 그대로인지, 테스트끼리 섞이지 않는지, 다시 불러와도 남는지를 확인합니다.
- 두 명령 모두 `npm install` 없이 돌아갑니다. vendor 폴더, `scripts/*.mjs`, CSS 내용은 검사하지 않습니다.
- 자동 테스트는 calibration.js와 cooperation.js만 다룹니다. 나머지 스크립트(facepass.js, gaze.js, grading.js, insight.js 포함)와 서버는 테스트가 없습니다. 카메라가 필요한 흐름은 브라우저에서 직접 확인하세요. 페이스패스 등록·로그인, 학습 준비와 보정, 읽기, 제출, 교사 진단·피드백 순서로 보면 됩니다. 채점 API 상태는 `curl http://127.0.0.1:4186/api/grader`로 봅니다.
