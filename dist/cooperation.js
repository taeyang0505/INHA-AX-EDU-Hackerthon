/* Teacher cooperation: per-test snapshots and teacher-authored groups.
   AI classifications are examples. Only this module's demo history is persisted locally. */
const coopCriteria=[
 {id:'A',title:'어휘·해독 집중형',subtitle:'기초 다지기반'},
 {id:'B',title:'구조·맥락 연결형',subtitle:'논리 엮기반'},
 {id:'C',title:'정독·주의 집중형',subtitle:'깊이 읽기반'},
 {id:'D',title:'심화·비판 확장형',subtitle:'생각 넓히기반'}
];
const coopTests=[
 {id:'test-03',date:'2026-11-13',title:passageTitle,round:'3회차',students:studentNames.filter((_,i)=>['분석 완료','제출 완료'].includes(baseStatus[i]))},
 {id:'test-02',date:'2026-11-11',title:'정보의 신뢰성을 판단하는 기준',round:'2회차',students:studentNames.slice(0,8)},
 {id:'test-01',date:'2026-11-06',title:'서로 다른 근거를 비교하며 읽기',round:'1회차',students:studentNames.slice(0,8)}
];
const COOP_KEY='lookteracy-cooperation-history-v1';
let coopStorageOK=true,coopTimer=null;
const cloneCoop=x=>JSON.parse(JSON.stringify(x));
function exampleClassification(testId){
 const variants={
  'test-03':{A:['김서윤','최도윤','윤지호'],B:['김서윤','이지우','박하린','오민재'],C:['박하린','최도윤','윤지호'],D:['정수아','한예린','오민재']},
  'test-02':{A:['이지우','최도윤'],B:['김서윤','이지우','박하린'],C:['박하린','윤지호'],D:['정수아','한예린','오민재']},
  'test-01':{A:['최도윤','윤지호'],B:['김서윤','이지우','오민재'],C:['박하린','최도윤'],D:['정수아','한예린','오민재']}
 };
 const eligible=coopTests.find(t=>t.id===testId).students;const result=cloneCoop(variants[testId]);for(const key of Object.keys(result))result[key]=result[key].filter(n=>eligible.includes(n));return result;
}
function initialCoopRecords(){
 const records={};
 for(const test of coopTests){
  const done=test.id!=='test-03';
  const groups=done?[
   {id:test.id+'-g1',name:'논리 엮기 그룹',members:['김서윤','이지우','박하린','최도윤']},
   {id:test.id+'-g2',name:'관점 탐색 모둠',members:['정수아','윤지호','한예린','오민재']}
  ]:[];
  records[test.id]={ai:done?exampleClassification(test.id):null,analyzedAt:done?test.date+'T10:00:00+09:00':null,finalGroups:cloneCoop(groups),draftGroups:cloneCoop(groups),savedAt:done?test.date+'T10:20:00+09:00':null,version:done?1:0,dirty:false};
 }
 return records;
}
function validCoopGroups(groups,eligible){return Array.isArray(groups)&&groups.every(g=>g&&typeof g.id==='string'&&typeof g.name==='string'&&g.name.trim()&&Array.isArray(g.members)&&g.members.length&&new Set(g.members).size===g.members.length&&g.members.every(n=>eligible.includes(n)))}
function loadCoopRecords(){
 const defaults=initialCoopRecords();
 try{
  const stored=JSON.parse(localStorage.getItem(COOP_KEY)||'null');
  if(stored?.schema!==1)return defaults;
  for(const test of coopTests){
   const r=stored.records?.[test.id];if(!r)continue;
   const validAI=r.ai===null||coopCriteria.every(c=>Array.isArray(r.ai?.[c.id])&&r.ai[c.id].every(n=>test.students.includes(n)));
   if(validAI&&validCoopGroups(r.finalGroups,test.students)&&validCoopGroups(r.draftGroups,test.students)&&Number.isInteger(r.version)&&r.version>=0){defaults[test.id]={...defaults[test.id],...r};}
  }
 }catch{coopStorageOK=false;}
 return defaults;
}
const coopRecords=loadCoopRecords();
st.coopTestId='test-03';try{const selected=sessionStorage.getItem('lookteracy-cooperation-selected');if(coopTests.some(t=>t.id===selected))st.coopTestId=selected}catch{}st.coopSearch='';st.coopListFilter='all';st.coopAnalysisStep=0;st.coopComposer=null;
function persistCoop(){try{localStorage.setItem(COOP_KEY,JSON.stringify({schema:1,records:coopRecords}));coopStorageOK=true;return true}catch{coopStorageOK=false;return false}}
function activeCoopTest(){return coopTests.find(t=>t.id===st.coopTestId)||coopTests[0]}
function activeCoopRecord(){return coopRecords[activeCoopTest().id]}
function coopStatus(r){return r.dirty?'편성 중':r.version?'최종 편성 저장됨':r.ai?'AI 분류 완료':'그루핑 전'}
function formatCoopTime(s){if(!s)return '—';const d=new Date(s);return Number.isNaN(d.valueOf())?'—':new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'}).format(d)}
function openCoopTest(id){
 const test=coopTests.find(t=>t.id===id);if(!test)return;
 st.coopTestId=id;try{sessionStorage.setItem('lookteracy-cooperation-selected',id)}catch{}st.coopComposer=null;route('t-group-detail');
 if(!coopRecords[id].ai)startCoopAnalysis(id);
}
function startCoopAnalysis(id){
 if(coopRecords[id].ai)return;
 clearTimeout(coopTimer);st.coopAnalysisStep=0;
 const progress=()=>{
  st.coopAnalysisStep++;
  if(st.coopAnalysisStep===3){coopRecords[id].ai=exampleClassification(id);coopRecords[id].analyzedAt=new Date().toISOString();coopTimer=null;persistCoop();}
  if(st.page==='t-group-detail'&&st.coopTestId===id)render();
  if(st.coopAnalysisStep<3)coopTimer=setTimeout(progress,420);
 };
 render();coopTimer=setTimeout(progress,420);
}
function addCoopGroup(testId,name,members,editingId=null){
 const test=coopTests.find(t=>t.id===testId),r=coopRecords[testId];
 if(!test||!r.ai)return {ok:false,error:'AI 분류가 끝난 뒤 그룹을 만들어 주세요.'};
 const cleanName=name.trim().slice(0,50),cleanMembers=[...new Set(members)].filter(n=>test.students.includes(n));
 if(!cleanName)return {ok:false,error:'그룹 이름을 입력해 주세요.'};
 if(!cleanMembers.length)return {ok:false,error:'학생을 한 명 이상 선택해 주세요.'};
 if(r.draftGroups.some(g=>g.id!==editingId&&g.name===cleanName))return {ok:false,error:'같은 이름의 그룹이 있어요. 다른 이름을 입력해 주세요.'};
 const row={id:editingId||testId+'-g-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),name:cleanName.slice(0,50),members:cleanMembers};
 if(editingId){const index=r.draftGroups.findIndex(g=>g.id===editingId);if(index<0)return {ok:false,error:'수정할 그룹을 찾지 못했어요.'};r.draftGroups[index]=row;}else r.draftGroups.push(row);
 r.dirty=true;persistCoop();return {ok:true,group:row};
}
function saveCoopFinal(testId){
 const r=coopRecords[testId];if(!r?.ai||!r.draftGroups.length)return {ok:false,error:'최종 저장할 그룹을 한 개 이상 만들어 주세요.'};
 r.finalGroups=cloneCoop(r.draftGroups);r.savedAt=new Date().toISOString();r.version++;r.dirty=false;
 const stored=persistCoop();return {ok:true,persisted:stored};
}
function coopRows(){
 const filtered=coopTests.filter(t=>t.title.includes(st.coopSearch)||t.date.includes(st.coopSearch)||t.date.replaceAll('-','.').includes(st.coopSearch)).filter(t=>st.coopListFilter!=='saved'||coopRecords[t.id].version>0);
 return filtered.length?filtered.map(test=>{const r=coopRecords[test.id];return `<button class="coop-test-row" data-action="coop-open" data-test="${test.id}"><span class="coop-date">${test.date.replaceAll('-','.')}<small>${test.round}</small></span><span class="coop-test-copy"><strong>${esc(test.title)}</strong><span>${st.className} · 결과 분석 대상 ${test.students.length}명</span></span><span class="coop-test-state">${badge(coopStatus(r),r.dirty?'amber':r.version?'green':'gray')}<small>${r.version?'최종 그룹 '+r.finalGroups.length+'개':'저장된 최종 그룹 없음'}</small></span>${icon('chevron')}</button>`}).join(''):'<div class="empty">날짜 또는 테스트 제목에 맞는 결과가 없습니다.</div>';
}
views['t-groups']=()=>`${head('그룹 관리','',badge(st.className,'gray'))}<section class="card coop-intro"><div class="label-line">${icon('group')}<h2>수준별 그룹 협력 학습</h2></div><p class="small">학생 수행 결과를 4가지 수준으로 분류하고, 각 수준에 맞는 협력 활동을 추천합니다.</p></section><div class="filter-row" style="margin-top:25px"><div class="segments" aria-label="편성 상태 필터">${[['all','전체 테스트'],['saved','저장된 편성']].map(([id,label])=>`<button class="${st.coopListFilter===id?'active':''}" data-action="coop-filter" data-filter-value="${id}" aria-pressed="${st.coopListFilter===id}">${label}</button>`).join('')}</div><label class="search coop-search">${icon('search')}<input class="input" id="coop-search" aria-label="그룹 관리 테스트 검색" placeholder="날짜·테스트 제목 검색" value="${esc(st.coopSearch)}"></label></div><section class="card coop-test-list" id="coop-test-list">${coopRows()}</section>`;
function coopAnalysisBoxes(r){return `<div class="coop-ai-grid">${coopCriteria.map(c=>`<section class="coop-ai-card criterion-${c.id}" aria-labelledby="criterion-${c.id}"><div class="coop-ai-heading"><span class="coop-letter">${c.id}</span><div><h3 id="criterion-${c.id}">${c.title}</h3><p>${c.subtitle}</p></div>${r.ai?`<span class="coop-count">${r.ai[c.id].length}명</span>`:''}</div>${r.ai?`<div class="coop-name-list">${r.ai[c.id].map(n=>`<span class="coop-name">${n}</span>`).join('')||'<span class="small">해당 학생 없음</span>'}</div>`:`<div class="coop-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>`}</section>`).join('')}</div>`}
function coopComposer(){
 const c=st.coopComposer;if(!c)return '';
 const test=activeCoopTest(),r=activeCoopRecord();
 return `<section class="coop-composer"><div class="section-head"><h3>${c.id?'그룹 수정':'새 그룹 만들기'}</h3><button class="icon-btn" data-action="coop-compose-close" aria-label="그룹 편집 닫기">${icon('close')}</button></div>${field('그룹 이름','coopComposer.name',c.name,'text','예: 근거를 잇는 모둠')}<div class="label-line" style="margin-bottom:12px"><span class="small">AI 분류에서 학생 선택</span><div class="coop-quick-picks">${coopCriteria.map(k=>`<button data-action="coop-select-category" data-criterion="${k.id}" title="${k.title} 학생 선택">${k.id}</button>`).join('')}</div></div><p class="micro">분류를 조합하거나 원하는 학생을 직접 선택하세요.</p><div class="coop-member-picker">${test.students.map(n=>`<label><input type="checkbox" data-coop-member="${n}" ${c.members.includes(n)?'checked':''}><span>${n}</span></label>`).join('')}</div><div class="spread"><span id="coop-member-count" class="small">${c.members.length}명 선택</span><button class="link-btn" data-action="coop-clear-members">선택 해제</button></div><div class="actions" style="margin-top:15px">${button(c.id?'수정 내용 반영':'그룹 만들기','coop-compose-save','full')}</div></section>`;
}
function coopTeacherPanel(r){
 const selected=new Set(r.draftGroups.flatMap(g=>g.members));const remaining=activeCoopTest().students.filter(n=>!selected.has(n));
 return `<aside class="card coop-teacher-panel"><div class="section-head"><h2>교사 최종 그룹</h2>${badge(r.dirty?'편집 중':r.version?'저장됨':'미생성',r.dirty?'amber':r.version?'green':'gray')}</div><p class="small">AI 분류를 참고해 그룹의 수와 구성을 자유롭게 정하세요.</p><div style="margin-top:18px">${button(icon('group')+' 그룹 생성','coop-compose-open','soft full',!r.ai?'disabled':'')}</div>${coopComposer()}<div class="coop-final-groups">${r.draftGroups.map(g=>`<article class="coop-final-card"><div class="section-head"><h3>${esc(g.name)}</h3><span class="micro">${g.members.length}명</span></div><div class="coop-final-names">${g.members.map(n=>`<span>${n}</span>`).join('')}</div><div class="coop-group-actions"><button data-action="coop-edit" data-group="${esc(g.id)}">구성 수정</button><button data-action="coop-delete" data-group="${esc(g.id)}">삭제</button></div></article>`).join('')||`<div class="coop-empty"><span class="tag-icon">${icon('group')}</span><h3>아직 만든 그룹이 없어요.</h3><p>분류 결과를 살펴보고<br>옆의 ‘그룹 생성’으로 시작하세요.</p></div>`}</div>${r.ai?`<div class="coop-remaining"><strong>아직 그룹에 넣지 않은 학생 ${remaining.length}명</strong><p>${remaining.length?remaining.join(' · '):'분석 대상 학생이 모두 하나 이상의 그룹에 포함되어 있어요.'}</p></div>`:''}<div class="coop-save-area">${button('최종 그룹 저장 '+icon('check'),'coop-final-save','full',!r.ai||!r.draftGroups.length||(!r.dirty&&r.version)?'disabled':'')}${r.dirty&&r.version?'<button class="link-btn" data-action="coop-revert">마지막 저장 결과로 되돌리기</button>':''}<p class="micro">${r.version?'최종 저장 · '+formatCoopTime(r.savedAt):'저장 후 이 테스트를 다시 열면 결과가 유지됩니다.'}</p></div></aside>`;
}
views['t-group-detail']=()=>{
 const t=activeCoopTest(),r=activeCoopRecord();
 return `${head(esc(t.title),'',badge(coopStatus(r),r.dirty?'amber':r.version?'green':'gray'))}<div class="coop-test-meta"><span>${t.date.replaceAll('-','.')} · ${t.round}</span><span>인하고등학교 ${st.className}</span><span>분석 대상 ${t.students.length}명</span></div><div class="coop-detail-layout"><section class="coop-ai-section"><div class="section-head"><div><span class="eyebrow">AI CLASSIFICATION</span><h2 style="margin-top:7px">4가지 기준으로 살펴본 학생</h2></div>${badge('학생 중복 포함','gray')}</div><p class="small coop-ai-description">한 학생이 여러 기준에 해당할 수 있습니다. 테스트를 완료한 학생만 분류하며, AI 분류와 교사가 확정하는 최종 그룹은 별도로 보관됩니다.</p>${!r.ai?`<div class="coop-analysis-progress" role="status" aria-live="polite"><span class="coop-spinner" aria-hidden="true"></span><span>${['학생 수행 결과 확인 중','4가지 기준으로 분류 중','분류 결과 정리 중'][Math.min(st.coopAnalysisStep,2)]}</span><span class="coop-progress-dots" aria-hidden="true">${[0,1,2].map(i=>`<i class="${st.coopAnalysisStep>=i?'active':''}"></i>`).join('')}</span></div>`:''}${coopAnalysisBoxes(r)}</section>${coopTeacherPanel(r)}</div>`;
};
function installCooperationActions(){
 action['coop-open']=el=>openCoopTest(el.dataset.test);
 action['coop-filter']=el=>{st.coopListFilter=el.dataset.filterValue;render()};
 action['coop-compose-open']=()=>{st.coopComposer={id:null,name:'',members:[]};render();$('[data-bind="coopComposer.name"]').focus({preventScroll:true})};
 action['coop-compose-close']=()=>{st.coopComposer=null;render()};
 action['coop-select-category']=el=>{const r=activeCoopRecord();st.coopComposer.members=[...new Set([...st.coopComposer.members,...r.ai[el.dataset.criterion]])];render()};
 action['coop-clear-members']=()=>{st.coopComposer.members=[];render()};
 action['coop-compose-save']=()=>{const c=st.coopComposer,res=addCoopGroup(st.coopTestId,c.name,c.members,c.id);if(!res.ok){toast(res.error);return}st.coopComposer=null;render();toast(coopStorageOK?'그룹 구성에 반영했어요. 마지막으로 최종 그룹을 저장하세요.':'그룹을 만들었지만 브라우저 저장을 사용할 수 없습니다.')};
 action['coop-edit']=el=>{st.coopComposer=cloneCoop(activeCoopRecord().draftGroups.find(g=>g.id===el.dataset.group));render();$('[data-bind="coopComposer.name"]').focus({preventScroll:true})};
 action['coop-delete']=el=>{const r=activeCoopRecord();r.draftGroups=r.draftGroups.filter(g=>g.id!==el.dataset.group);r.dirty=true;if(st.coopComposer?.id===el.dataset.group)st.coopComposer=null;persistCoop();render();toast('편집 중인 구성에서 삭제했어요. 최종 저장 전까지 기존 저장본은 유지됩니다.')};
 action['coop-final-save']=()=>{if(st.coopComposer){toast('작성 중인 그룹을 먼저 반영하거나 편집을 닫아 주세요.');return}const res=saveCoopFinal(st.coopTestId);if(!res.ok){toast(res.error);return}render();toast(res.persisted?'이 테스트의 최종 그룹을 저장했어요. 다시 열어도 유지됩니다.':'현재 화면에는 반영했지만 브라우저 저장에 실패했어요.')};
 action['coop-revert']=()=>{const r=activeCoopRecord();r.draftGroups=cloneCoop(r.finalGroups);r.dirty=false;st.coopComposer=null;persistCoop();render()};
 document.addEventListener('change',e=>{if(e.target.dataset.coopMember&&st.coopComposer){const name=e.target.dataset.coopMember;st.coopComposer.members=e.target.checked?[...new Set([...st.coopComposer.members,name])]:st.coopComposer.members.filter(n=>n!==name);$('#coop-member-count').textContent=st.coopComposer.members.length+'명 선택'}});
 document.addEventListener('input',e=>{if(e.target.id==='coop-search'){st.coopSearch=e.target.value;$('#coop-test-list').innerHTML=coopRows()}});
}
