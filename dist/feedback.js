/* Student feedback and growth are UI examples, not measured learner results.
   Recommendation source labels are user-approved display examples, not verified
   provenance for the two locally authored practice passages. */
const studentFeedbackSections={
 strength:[
  ['끝까지 읽어내는 높은 읽기 지속력',"발표 담화문 형식의 긴 지문과 낯선 전통 미술 용어('호작도')가 등장해도 시선이 화면 밖으로 이탈하지 않고, 도입부부터 마지막 문단까지 포기하지 않고 완독하려는 끈기와 집중력이 매우 뛰어납니다."],
  ['핵심 화제 및 화면 배치 포착 능력',"글의 도입부(1문단)에서 이 발표가 다루려는 중심 대상('호작도 속 호랑이와 까치의 상징적 의미')과 그림의 배치 구조(나무 아래 호랑이, 위에는 까치)를 정확하게 찾아냈습니다."],
  ['친숙한 속담 단서 활용',"3문단에서 익숙한 속담('까치가 울면 반가운 손님이 온다')을 단서로 삼아 까치가 긍정적인 의미를 지닌다는 기초 정보를 빠르게 파악했습니다."]
 ],
 concept:[
  ['특정 낯선 어휘 고착으로 인한 시야 좁아짐(Tunnel Vision)',"모르는 단어('의연하고', '길조')를 만났을 때 그 단어 한 곳에만 시선이 오래 멈춰, 정작 그 뜻을 친절하게 풀어주는 앞뒤 문장(문맥 단서)으로 시선이 뻗어 나가지 못했습니다."],
  ['어휘 해독 부담으로 인한 대조·전환 맥락 연결 지연',"개별 어휘 뜻을 해석하는 데 에너지를 많이 쓰다 보니, 호랑이가 처음엔 '공포의 대상'이었다가 '수호자'로, 다시 '익살스럽고 친근한 존재'로 인식이 전환되는 흐름('하지만', '그런데')을 유기적으로 연결하는 데 시간이 걸렸습니다."],
  ['본문 문장 그대로 옮겨 적기 습관',"서술형 평가에서 호작도 속 호랑이와 까치의 상징적 의미를 정리할 때, 핵심 개념어를 내 언어로 바꾸어 설명하지 못하고 본문에 적힌 문장을 그대로 옮겨 적는 경향이 나타났습니다."]
 ],
 strategy:[
  ['전략 1. [모르는 단어 앞뒤 1문장 스캔하기 (문맥 단서 탐색)]','실천 방법: 낯선 어휘나 표현이 나오면 그 단어만 3초 이상 뚫어져라 보지 말고, 시선을 바로 앞 문장과 뒷문장으로 옮겨 힌트를 찾아보세요.'],
  ['전략 2. [속담·사례 단서를 활용해 한자어 뜻 갈아끼우기 (대체 검증)]','실천 방법: 본문에 제시된 예시나 속담과 연결해 유추한 쉬운 말을 원래 단어 자리에 대신 넣어 읽었을 때 문장이 자연스러운지 확인해 보세요.'],
  ['전략 3. [핵심 상징어 내 말로 요약하기 (어휘 확장)]','실천 방법: 서술형 답안을 작성할 때 본문 단어를 그대로 베끼지 않고, 내가 찾아낸 쉬운 말로 바꾸어 한 문장으로 정리해 보세요.']
 ]
};
const studentFeedbackContent=Object.fromEntries(Object.entries(studentFeedbackSections).map(([key,rows])=>[key,rows.map(([title,body])=>title+': '+body).join('\n\n')]));
st.published={...studentFeedbackContent};st.publishedPassageTitle=studentHomeAssignment.title;
const growthExample=[{month:8,level:2},{month:9,level:3},{month:10,level:2},{month:11,level:4},{month:12,level:4}];
const studentRecommendations=[
 {title:'공공 도서관의 문턱',description:'시설의 양과 실제 이용 기회를 연결해 읽어요.',tag:'맥락·추론',sourceLabel:'2021 고1 3월 모의고사 23번',sourceIsExample:true},
 {title:'숫자는 무엇을 설명하는가',description:'지표가 보여주는 것과 놓치는 것을 살펴봐요.',tag:'비판적 읽기',sourceLabel:'[비상]공통국어1',sourceIsExample:true}
];
function studentFeedbackDetails(text){return String(text).split(/\n\s*\n/).filter(p=>p.trim()).map(part=>{const colon=part.indexOf(':');return colon>0&&colon<95?`<article class="feedback-detail"><h4>${esc(part.slice(0,colon))}</h4><p>${esc(part.slice(colon+1).trim())}</p></article>`:`<article class="feedback-detail"><p>${esc(part)}</p></article>`}).join('')}
function studentGrowthChart(){
 const x=i=>48+i*58,y=level=>202-(level-1)*56,points=growthExample.map((d,i)=>`${x(i)},${y(d.level)}`).join(' ');
 return `<section class="card student-growth-card"><div class="growth-heading"><h2>나의 성장</h2></div><p class="growth-subtitle">월별 학습 레벨</p><svg class="student-growth-chart" viewBox="0 0 320 260" role="img" aria-labelledby="growth-chart-title growth-chart-description"><title id="growth-chart-title">8월부터 12월까지의 학습 레벨 변화</title><desc id="growth-chart-description">8월 레벨 2, 9월 레벨 3, 10월 레벨 2, 11월 레벨 4, 12월 레벨 4. 세로축은 레벨 1부터 4입니다.</desc><defs><linearGradient id="student-growth-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d3e7f6" stop-opacity=".6"/><stop offset="100%" stop-color="#eaf3fa" stop-opacity=".1"/></linearGradient></defs><text class="growth-axis-title" x="15" y="16">레벨</text>${[4,3,2,1].map(level=>`<g><line class="growth-grid-line" x1="39" y1="${y(level)}" x2="292" y2="${y(level)}"/><text class="growth-y-tick" x="26" y="${y(level)+4}" text-anchor="end">${level}</text></g>`).join('')}<polygon points="48,202 ${points} 280,202" fill="url(#student-growth-fill)"/><polyline class="growth-data-line" points="${points}" fill="none"/>${growthExample.map((d,i)=>`<g class="growth-data-point"><title>${d.month}월 · 레벨 ${d.level}</title><circle cx="${x(i)}" cy="${y(d.level)}" r="5"/><text class="growth-point-value" x="${x(i)}" y="${y(d.level)-12}" text-anchor="middle">${d.level}</text><text class="growth-x-tick" x="${x(i)}" y="232" text-anchor="middle">${d.month}월</text></g>`).join('')}</svg><div class="growth-range">레벨 1–4 <span>8월–12월</span></div></section>`;
}
function reportGrowthChart(){return studentGrowthChart().replace('<h2>나의 성장</h2>','<h2>학습 성장 추이</h2>').replace('class="card student-growth-card"','class="card student-growth-card report-growth-card"')}
function renderStudentFeedbackPage(){return `<div class="student-feedback-page">${head('피드백에서 다음 배움으로','나의 학습 피드백을 확인하고 다음 학습 전략을 세워요')}<div class="feedback-page-grid"><div class="feedback-primary"><section class="card student-feedback-card"><header class="student-feedback-heading"><h2>김서윤 학생 학습 피드백</h2><p>${esc(st.publishedPassageTitle??studentHomeAssignment.title)}</p></header>${[['나의 강점','strength'],['보완할 점','concept'],['다음 읽기 전략','strategy']].map(([title,key],i)=>`<section class="feedback-section feedback-section-${key}"><div class="feedback-section-heading"><span aria-hidden="true">0${i+1}</span><h3>${title}</h3></div>${studentFeedbackDetails(st.published[key])}</section>`).join('')}<div class="feedback-read-action">${button(st.publishedRead?'확인한 피드백':'피드백 확인했어요','feedback-read','soft')}</div></section><section class="student-recommendations"><div class="section-head"><h2>나를 위한 추천 지문</h2></div><div class="recommendation-grid">${studentRecommendations.map((r,i)=>`<article class="card resource-card">${badge(r.tag)}<h3>${esc(r.title)}</h3><p>${esc(r.description)}</p><div class="recommendation-source"><span>출처</span>${esc(r.sourceLabel)}</div><div class="actions">${button('추가 학습 시작','optional-start','soft',`data-resource="${i}"`)}</div></article>`).join('')}</div></section></div><aside class="feedback-growth-rail">${studentGrowthChart()}</aside></div></div>`;}
