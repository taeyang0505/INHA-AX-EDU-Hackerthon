import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--port')){console.error('Usage: npm run dev -- --port 4187');process.exit(1)}
const port=Number(args[1]??4186);
if(!Number.isInteger(port)||port<1||port>65535){console.error('Port must be between 1 and 65535.');process.exit(1)}
const types={'.mjs':'text/javascript','.task':'application/octet-stream','.wasm':'application/wasm','.data':'application/octet-stream','.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json'};
// 문자 집합은 글자 파일에만 붙인다. wasm에 붙이면 브라우저가 빠른 로딩(streaming compile)을 거부한다.
const contentType=ext=>{const t=types[ext]??'application/octet-stream';return /^(text\/|application\/json|image\/svg)/.test(t)?t+'; charset=utf-8':t};
// Claude 채점(선택): 패키지 폴더의 .env에서 ANTHROPIC_API_KEY를 읽는다. SDK가 없거나(npm install 전) 키가 없으면 채점 API만 503으로 답한다.
try{process.loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)))}catch{}
const grader=import('./grade.mjs').catch(err=>{console.warn('Claude grading disabled:',err.code??err.message);return null});
const sendJson=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body))};
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/api/grade'||pathname==='/api/grader'){
   const g=await grader;
   if(!g){sendJson(res,503,{error:'unavailable',configured:false,message:'npm install 후 다시 실행하면 Claude 채점을 쓸 수 있어요.'});return}
   if(pathname==='/api/grader'&&req.method==='GET'){g.graderStatus(req,res);return}
   if(pathname==='/api/grade'&&req.method==='POST'){await g.handleGrade(req,res);return}
   res.writeHead(405);res.end();return
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return}
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  const relative=path.relative(root,file);
  if(relative.startsWith('..')||path.isAbsolute(relative)){res.writeHead(403);res.end('Forbidden');return}
  const info=await stat(file);
  if(!info.isFile()){res.writeHead(404);res.end('Not found');return}
  const data=await readFile(file);
  res.writeHead(200,{'Content-Type':contentType(path.extname(file)),'Content-Length':data.length,'Cache-Control':'no-store'});
  res.end(req.method==='HEAD'?undefined:data);
 }catch(err){res.writeHead(err.code==='ENOENT'?404:400);res.end(err.code==='ENOENT'?'Not found':'Bad request')}
});
server.on('error',err=>{console.error(err.code==='EADDRINUSE'?`Port ${port} is already in use. Try --port 4187.`:err.message);process.exit(1)});
server.listen(port,'127.0.0.1',()=>console.log(`LOOKteracy: http://127.0.0.1:${port}\nPress Ctrl+C to stop. Local preview server only.`));
