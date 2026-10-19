// Executes the real API handlers in the Workers runtime with an isolated D1 database.
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),workerRequire=createRequire(require.resolve('wrangler/package.json'));
const {build}=await import(pathToFileURL(workerRequire.resolve('esbuild')).href),{Miniflare}=await import(pathToFileURL(workerRequire.resolve('miniflare')).href);
const root=resolve(import.meta.dirname,'..'),runtime=resolve(root,'.sites-runtime/api-smoke');mkdirSync(runtime,{recursive:true});
const entry=resolve(runtime,'entry.ts'),output=resolve(runtime,'worker.mjs');
writeFileSync(entry,`import * as auth from '${root}/app/api/auth/route.ts';import * as game from '${root}/app/api/game/route.ts';const nativeNow=Date.now;let clock;Date.now=()=>clock??nativeNow();export default{async fetch(request){const t=request.headers.get('x-smoke-now');if(t)clock=Number(t);const route=new URL(request.url).pathname==='/api/auth'?auth:game;return request.method==='POST'?route.POST(request):route.GET(request)}};`);
await build({entryPoints:[entry],outfile:output,bundle:true,format:'esm',platform:'neutral',external:['node:*','cloudflare:*'],target:'es2022'});
const mf=new Miniflare({modules:true,scriptPath:output,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],cf:false});
try{
 const db=await mf.getD1Database('DB');for(const name of readdirSync(resolve(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())for(const sql of readFileSync(resolve(root,'drizzle',name),'utf8').split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
 const call=async(path,body,cookie='',clock)=>{const r=await mf.dispatchFetch('https://stock.test'+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{Origin:'https://stock.test','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(clock?{'x-smoke-now':String(clock)}:{})}});const json=await r.json();return{status:r.status,json,cookie:r.headers.get('Set-Cookie')?.split(';')[0]||''}};
 const anon=await call('/api/game');assert.equal(anon.status,200);assert.equal(anon.json.stocks.length,34);assert.equal(anon.json.account,null);
 const input={action:'register',login:'runtime_check',password:'runtime-test-password-4842',nickname:'런타임 검증'},registered=await call('/api/auth',input);assert.equal(registered.status,201,JSON.stringify(registered.json));assert.ok(registered.cookie.startsWith('__Host-bs_session='));
 const me=await call('/api/game',null,registered.cookie);assert.equal(me.json.account.nickname,input.nickname);assert.equal(me.json.account.cash,10000000);assert.equal(me.json.ranking.length,1);
 const changed=await call('/api/game',{action:'nickname',nickname:'수정한 투자자'},registered.cookie);assert.equal(changed.status,200);assert.equal((await call('/api/game',null,registered.cookie)).json.account.nickname,'수정한 투자자');
 const duplicate=await call('/api/auth',input);assert.equal(duplicate.status,400);
 const invalid=await call('/api/auth',{action:'login',login:input.login,password:'incorrect-pass'});assert.equal(invalid.status,401);
 const open=Date.parse('2026-10-19T16:40:00+09:00');
 const ordered=await call('/api/game',{action:'order',stockId:'000001',side:'buy',kind:'market',qty:10,requestKey:crypto.randomUUID()},registered.cookie,open);assert.equal(ordered.status,200,JSON.stringify(ordered.json));
 const filled=await call('/api/game',null,registered.cookie,open+600000);assert.equal(filled.status,200);assert.equal(filled.json.orders[0].status,'filled');assert.equal(filled.json.holdings[0].qty,10);assert.equal(filled.json.account.reserved,0);
 const loggedout=await call('/api/auth',{action:'logout'},registered.cookie);assert.equal(loggedout.status,200);assert.equal((await call('/api/game',null,registered.cookie)).json.account,null);
 const signedin=await call('/api/auth',{action:'login',login:input.login,password:input.password});assert.equal(signedin.status,200);assert.ok((await call('/api/game',null,signedin.cookie)).json.account);
 const forbidden=await call('/api/game',{action:'watch',stockId:'000001',enabled:true});assert.equal(forbidden.status,401);
 const payload=JSON.stringify(me.json);assert.ok(!payload.includes('password_hash'));assert.ok(!payload.includes('"impact"'));assert.ok(!payload.includes('"seed"'));
 console.log('Workers API smoke passed: signup, session cookie, nickname, duplicate ID, wrong password, logout, login, authorization, actual D1 trade settlement, catalog and newsroom.');
}finally{await mf.dispose();}
