import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './db.mjs';
import {accountFor} from '../lib/engine.ts';
import {recordTaps,recordTap,laborState,LABOR_INTERVAL} from '../lib/labor.ts';
const now=Date.parse('2026-10-20T20:20:00+09:00'),key=()=>crypto.randomUUID(),batch=(expectedTaps,count=20)=>({expectedTaps,count,requestKey:key()});
async function setup(){const db=new LocalD1();await accountFor(db,'alice',now);return db;}
test('one hundred physical taps can save in five requests and credit a single wage',async()=>{
 const db=await setup();for(let i=0;i<100;i+=20){const input=batch(i),result=await recordTaps(db,'alice',input,now+i*60);assert.equal(result.accepted,20);assert.equal(result.work.totalTaps,i+20);const duplicate=await recordTaps(db,'alice',input,now+i*60+1);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.accepted,20);}
 assert.equal((await laborState(db,'alice',now+10000)).earned,1000);assert.equal(db.sqlite.prepare('SELECT cash FROM accounts').get().cash,10001000);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM cash_events').get().n,1);
});
test('batching preserves the server pacing limit and returns the accepted prefix',async()=>{
 const db=await setup();await recordTap(db,'alice',{expectedTaps:0,requestKey:key()},now);
 let result=await recordTaps(db,'alice',batch(1),now+10);assert.equal(result.accepted,0);assert.equal(result.retryAfter,50);
 result=await recordTaps(db,'alice',batch(1),now+3*60);assert.equal(result.accepted,3);assert.equal(result.work.totalTaps,4);
 await assert.rejects(recordTaps(db,'alice',batch(4,21),now+10000),/진행/);await assert.rejects(recordTaps(db,'alice',batch(4,0),now+10000),/진행/);
 const stale=await recordTaps(db,'alice',batch(0),now+10000);assert.equal(stale.conflict,true);assert.equal((await laborState(db,'alice')).totalTaps,4);
});
test('a lost response after partially committed taps can retry without paying twice',async()=>{
 const db=await setup(),input=batch(0),original=db.prepare.bind(db);let writes=0;
 db.prepare=sql=>{const statement=original(sql);if(sql.startsWith('UPDATE labor_state')){const run=statement.run.bind(statement);statement.run=async()=>{if(++writes===4)throw Error('TEMPORARY_WRITE_FAILURE');return run()};}return statement;};
 await assert.rejects(recordTaps(db,'alice',input,now),/TEMPORARY/);db.prepare=original;
 const result=await recordTaps(db,'alice',input,now+1000);assert.equal(result.duplicate,true);assert.equal(result.accepted,3);assert.equal(result.work.totalTaps,3);assert.equal(result.credited,0);
});
test('concurrent batches cannot double-credit the 100th tap or exceed the daily wage cap',async()=>{
 const db=await setup();db.sqlite.prepare("INSERT INTO labor_state(user_id,taps,last_key,updated) VALUES('alice',90,'old',?)").run(now-10000);
 const request=batch(90,10),results=await Promise.all([recordTaps(db,'alice',request,now),recordTaps(db,'alice',request,now)]);
 assert.equal((await laborState(db,'alice',now)).totalTaps,100);assert.equal(results.reduce((n,r)=>n+r.credited,0),1000);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM cash_events').get().n,1);
 db.sqlite.prepare("INSERT INTO cash_events(id,user_id,kind,amount,due_at,settled,created) VALUES('earlier','alice','노동 수당',49000,?,1,?)").run(now,now);
 const capped=await recordTaps(db,'alice',batch(100),now+10000);assert.equal(capped.limitReached,true);assert.equal(capped.accepted,0);assert.equal(capped.work.dailyEarned,50000);assert.equal(capped.work.totalTaps,100);
});
