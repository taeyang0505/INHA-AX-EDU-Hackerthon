const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../dist/calibration.js'),'utf8');
function boot(reduced=false){
 let nextId=0,renders=0;const frames=new Map(),target={style:{},isConnected:true},line={points:'',setAttribute(k,v){this[k]=v}},next={disabled:false},status={textContent:''};
 const st={page:'s-prep',prep:1,cal:0,ready:false};
 const ctx={st,document:{querySelector:s=>s.includes('polyline')?line:s.includes('cal-target')?target:s.includes('cal-next')?next:status},requestAnimationFrame:fn=>{const id=++nextId;frames.set(id,fn);return id},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:reduced}),render:()=>{renders++}};
 vm.createContext(ctx);vm.runInContext(source+'\nthis.api={advanceCalibration,stopCalibrationMotion,calibrationTrail};',ctx);
 return {st,api:ctx.api,target,line,next,frames,get renders(){return renders},tick(t){const list=[...frames.values()];frames.clear();list.forEach(fn=>fn(t))}};
}
const a=boot();a.api.advanceCalibration();assert.equal(a.st.calMoving,true);assert.equal(a.next.disabled,true);a.api.advanceCalibration();assert.equal(a.frames.size,1,'double click must not start another animation');a.tick(0);a.tick(600);assert(Math.abs(parseFloat(a.target.style.left)-34)<.01,'halfway x follows interpolation');assert(Math.abs(parseFloat(a.target.style.top)-35)<.01);assert.equal(a.st.cal,0,'step must not complete early');assert.equal(a.line.points.split(' ').length,2);a.tick(1200);assert.equal(a.st.cal,1);assert.equal(a.st.calMoving,false);assert.equal(a.renders,1);assert.equal(a.api.calibrationTrail(1),'500,375 180,150');
a.api.advanceCalibration();a.tick(2000);a.tick(2300);a.api.stopCalibrationMotion();assert.equal(a.frames.size,0);assert.equal(a.st.cal,1,'cancel leaves last completed point');assert.equal(a.st.calMoving,false);a.st.cal=0;assert.equal(a.api.calibrationTrail(a.st.cal),'500,375','reset clears prior trail');
const b=boot(true);b.api.advanceCalibration();assert.equal(b.st.cal,1);assert.equal(b.frames.size,0,'reduced motion skips animation');b.st.cal=4;b.api.advanceCalibration();assert.equal(b.st.prep,2);assert.equal(b.st.ready,true);
console.log('PASS: smooth movement, progressive trail, double-click guard, cancellation/reset, reduced motion, completion.');
