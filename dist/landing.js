/* Landing illustration: a reading path aligned to the rendered words, never camera data. */
function publicWordmark(){return `<span class="look-wordmark" aria-label="LOOKteracy"><span aria-hidden="true">L<span class="look-o">O</span><span class="look-o look-o-second">O</span>K<span class="look-wordmark-tail">teracy</span></span></span>`}
function renderReadingVisual(){
 const copy=[
  '도시의 공원은 단지 풍경을 아름답게 만드는 공간일까. 나무가 만드는 그늘과 수분의 증발은 주변의 열을 낮춘다.',
  '그러나 녹지가 많다는 사실이 모든 시민이 그 혜택을 고르게 누린다는 뜻은 아니다.',
  '좋은 녹지는 얼마나 넓은가에 더해, 누가 이용할 수 있는가라는 질문으로 살펴야 한다.'
 ];
 return `<div class="tracking-stage landing-visual"><section class="glass-card" aria-label="글을 따라 이동하는 시각 추적 일러스트"><div class="glass-top"><span>READING IN SIGHT</span><span class="live"><i class="status-dot" aria-hidden="true"></i>시각 추적</span></div><h2>같은 문장, 서로 다른 시선</h2><div class="glass-passage"><p class="reading-copy">${copy.map(s=>s.split(/\s+/).map(w=>`<span class="reading-word">${esc(w)}</span>`).join(' ')).join('<br>')}</p><div class="reading-light-layer" aria-hidden="true"><svg class="reading-path"><polyline fill="none"/></svg>${Array.from({length:7},()=>'<i class="reading-bloom"></i>').join('')}<i class="reading-glow"></i></div></div><div class="tracking-stats"><div>응시 구간<strong>머무른 곳</strong></div><div>시선의 이동<strong>읽는 경로</strong></div><div>다시 읽기<strong>생각의 연결</strong></div></div></section></div>`;
}
function renderLanding(){return `<div class="public landing-shell">${publicHeader()}<main class="landing" id="main" tabindex="-1"><div class="landing-main">${tracking()}<div class="landing-copy"><span class="eyebrow">LOOK INTO READING, OPEN TO LEARNING</span><h1>읽는 과정에서<br>발견하는 <em>배움의 가능성.</em></h1><p>어디를 읽고, 어떻게 이해했는지.<br>시선과 응답으로 다음 배움을 연결합니다.</p><div class="landing-start"><button class="btn landing-start-button" data-action="landing-start">시작하기 ${icon('arrow')}</button></div><div class="landing-signup">처음 사용하시나요?<button data-route="signup">학급 연결·페이스패스 등록</button></div></div></div></main>${publicFooter()}</div>`}
let landingAnimation=null;
function stopLandingAnimation(){if(!landingAnimation)return;cancelAnimationFrame(landingAnimation.frame);landingAnimation.observer?.disconnect();landingAnimation.motionQuery?.removeEventListener('change',landingAnimation.motionChange);landingAnimation=null}
function setupLandingAnimation(){
 stopLandingAnimation();
 const root=document.querySelector('.landing-visual'),layer=root?.querySelector('.reading-light-layer');if(!layer)return;
 const words=[...root.querySelectorAll('.reading-word')],glow=layer.querySelector('.reading-glow'),path=layer.querySelector('polyline'),blooms=[...layer.querySelectorAll('.reading-bloom')];
 const motionQuery=matchMedia('(prefers-reduced-motion: reduce)');
 const run={frame:0,observer:null,motionQuery,motionChange:()=>setupLandingAnimation(),points:[],order:[],cursor:0,elapsed:0,last:0,history:[],furthest:0};
 landingAnimation=run;motionQuery.addEventListener('change',run.motionChange);
 function place(node,p,w,h){node.style.transform=`translate3d(${p.x-w/2}px,${p.y-h/2}px,0)`}
 function measure(){
  if(!root.isConnected)return;
  const bounds=layer.getBoundingClientRect();
  run.points=words.map(w=>{const r=w.getBoundingClientRect();return {x:r.left+r.width*.52-bounds.left,y:r.top+r.height*.55-bounds.top,length:w.textContent.length}});
  run.order=[];
  run.points.forEach((_,i)=>{run.order.push(i);if(i>3&&i%15===9)run.order.push(i-2,i)});
  run.history=[];run.cursor=0;run.elapsed=0;run.last=0;if(motionQuery.matches)run.furthest=run.order.length;redrawTrail();blooms.forEach(n=>n.style.opacity='0');
  if(run.points.length){place(glow,run.points[0],78,46);glow.style.opacity=motionQuery.matches?'.35':'.75'}
 }
 function redrawTrail(){
  const recent=run.history.slice(-8);const trail=run.order.slice(0,run.furthest).map(i=>run.points[i]);path.setAttribute('points',trail.map(p=>`${p.x},${p.y}`).join(' '));
  blooms.forEach((node,i)=>{const p=recent[recent.length-2-i];node.style.opacity=p?String(.38-i*.043):'0';if(p)place(node,p,64,38)});
 }
 function tick(now){
  if(landingAnimation!==run||!root.isConnected)return;
  if(document.hidden){run.last=0;run.frame=requestAnimationFrame(tick);return}
  const delta=run.last?Math.min(now-run.last,60):0;run.last=now;run.elapsed+=delta;
  const target=run.points[run.order[run.cursor]];
  if(!target){run.frame=requestAnimationFrame(tick);return}
  if(run.elapsed<0){glow.style.opacity='0';run.frame=requestAnimationFrame(tick);return}
  const previous=run.cursor?run.points[run.order[run.cursor-1]]:target;
  const flight=Math.abs(target.y-previous.y)>15?110:75;
  const progress=Math.min(1,run.elapsed/flight),ease=1-Math.pow(1-progress,3);
  place(glow,{x:previous.x+(target.x-previous.x)*ease,y:previous.y+(target.y-previous.y)*ease},78,46);
  glow.style.opacity=String(.75+Math.sin(Math.min(1,run.elapsed/330)*Math.PI)*.13);
  const dwell=240+Math.min(120,target.length*17);
  if(run.elapsed>flight+dwell){
   run.history.push(target);run.history=run.history.slice(-8);run.furthest=Math.max(run.furthest,run.cursor+1);redrawTrail();run.cursor++;run.elapsed=0;
   if(run.cursor===run.order.length){run.cursor=0;run.elapsed=-650;run.history=[];blooms.forEach(n=>n.style.opacity='0')}
  }
  run.frame=requestAnimationFrame(tick);
 }
 measure();run.observer=new ResizeObserver(measure);run.observer.observe(root.querySelector('.reading-copy'));
 document.fonts.ready.then(()=>{if(landingAnimation===run)measure()});
 if(!motionQuery.matches)run.frame=requestAnimationFrame(tick);
}
