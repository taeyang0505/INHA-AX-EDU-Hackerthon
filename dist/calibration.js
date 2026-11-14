/* Guided calibration animation only. No camera, gaze measurements or biometric data. */
const calibrationPoints=[{x:50,y:50},{x:18,y:20},{x:82,y:20},{x:18,y:80},{x:82,y:80}];
let calibrationMotion=null;
function calibrationTrail(index,extra=null){return [...calibrationPoints.slice(0,index+1),...(extra?[extra]:[])].map(p=>`${p.x*10},${p.y*7.5}`).join(' ')}
function calibrationSurface(){const p=calibrationPoints[st.cal];return `<div class="prep-surface calibration-stage" aria-label="시선 보정 화면"><svg class="calibration-trail" viewBox="0 0 1000 750" aria-hidden="true"><polyline points="${calibrationTrail(st.cal)}" fill="none"/></svg><div class="cal-target" style="left:${p.x}%;top:${p.y}%" aria-hidden="true"></div><div class="prep-surface-caption">화면의 점을 천천히 따라가주세요</div></div>`}
function stopCalibrationMotion(){if(calibrationMotion){cancelAnimationFrame(calibrationMotion.frame);calibrationMotion=null}st.calMoving=false}
function advanceCalibration(){
 if(st.calMoving||st.page!=='s-prep'||st.prep!==1)return;
 if(st.cal===calibrationPoints.length-1){st.prep=2;st.ready=true;render();return}
 const target=document.querySelector('.calibration-stage .cal-target'),line=document.querySelector('.calibration-trail polyline');if(!target||!line)return;
 const from=calibrationPoints[st.cal],to=calibrationPoints[st.cal+1],index=st.cal;
 const finish=()=>{calibrationMotion=null;st.calMoving=false;st.cal=index+1;render()};
 if(matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return}
 const run={frame:0,start:null};calibrationMotion=run;st.calMoving=true;
 const next=document.querySelector('[data-action="cal-next"]');if(next)next.disabled=true;
 const status=document.querySelector('.calibration-step-status');if(status)status.textContent='다음 지점으로 이동 중';
 function tick(now){
  if(calibrationMotion!==run||!target.isConnected)return;
  if(run.start===null)run.start=now;
  const t=Math.min(1,(now-run.start)/1200),ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
  const p={x:from.x+(to.x-from.x)*ease,y:from.y+(to.y-from.y)*ease};
  target.style.left=p.x+'%';target.style.top=p.y+'%';line.setAttribute('points',calibrationTrail(index,p));
  if(t<1)run.frame=requestAnimationFrame(tick);else finish();
 }
 run.frame=requestAnimationFrame(tick);
}
