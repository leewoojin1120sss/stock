import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './db.mjs';
import {advanceMarket,accountFor,placeOrder,snapshot} from '../lib/engine.ts';
import {session,nextTick,isOpen,STEP,DAY,economicCalendar,seedStocks,dividendDates} from '../lib/market-data.ts';
import {resetGameIfNeeded} from '../lib/game-reset.ts';
import {ensureInformation,subscribe,publishPost,subscriptionFor} from '../lib/information.ts';
import {recordTap,laborState} from '../lib/labor.ts';
const at=s=>Date.parse(s+'+09:00'),key=()=>crypto.randomUUID(),row=(db,sql,...args)=>db.sqlite.prepare(sql).get(...args),count=(db,table)=>row(db,'SELECT COUNT(*) AS n FROM '+table).n;
const opening=at('2026-10-19T20:00:00'),before=at('2026-10-19T19:50:00');
const order=(extra={})=>({stockId:'000001',side:'buy',kind:'market',qty:10,requestKey:key(),...extra});

test('only October 19 opens at 20:00 KST, including the transition from the previous close',()=>{
 assert.equal(session(before).open,opening);assert.equal(isOpen(opening-1),false);assert.equal(isOpen(opening),true);assert.equal(isOpen(session(opening).close),false);
 assert.equal(nextTick(at('2026-10-18T23:40:00')),opening);assert.equal(nextTick(at('2026-10-19T23:40:00')),at('2026-10-20T16:40:00'));
 assert.equal(session(at('2026-10-20T16:40:00')).special,false);assert.equal(nextTick(before),opening);
 assert.equal(nextTick(opening+12345),opening+STEP);
 const calendar=economicCalendar(before,seedStocks());assert.ok(calendar.every(e=>e.ts>=opening&&e.ts<=session(before).close));
 const reit=seedStocks().find(s=>s.id==='000015');assert.equal(dividendDates(reit,before).record,at('2026-10-19T23:20:00'));
});

test('the special pre-open market stays at its starting values and first orders fill at 20:10',async()=>{
 const db=new LocalD1();await advanceMarket(db,before);await accountFor(db,'alice',before);
 assert.equal(count(db,'ticks'),1);assert.equal(row(db,'SELECT COUNT(*) AS n FROM stocks WHERE price!=initial').n,0);
 const state=await snapshot(db,'alice','000001',before,false);assert.equal(state.open,false);assert.equal(state.nextTick,opening);assert.equal(state.marketSession.special,true);assert.equal(state.macroHistory.length,1);
 await assert.rejects(placeOrder(db,'alice',order(),opening-1),/20:00/);
 await advanceMarket(db,opening);await placeOrder(db,'alice',order(),opening+100);assert.equal(row(db,'SELECT status FROM orders').status,'open');
 await advanceMarket(db,opening+STEP);assert.equal(row(db,'SELECT status FROM orders').status,'filled');
 const after=await snapshot(db,'alice','000001',opening+STEP,false);assert.equal(after.macroHistory.length,3);assert.equal(after.macroHistory.at(-1).fx,after.index.at(-1).fx);assert.equal(after.holdings[0].qty,10);
});

async function legacy(){
 const db=new LocalD1(),old=at('2026-10-18T16:40:00');await advanceMarket(db,old);await accountFor(db,'alice',old);await accountFor(db,'bob',old);await ensureInformation(db,old);
 db.sqlite.prepare("INSERT INTO credentials(user_id,login,password_hash,created) VALUES('alice','retained_id','retained_password_hash',?)").run(old);
 db.sqlite.prepare("INSERT INTO sessions(token_hash,user_id,created,expires) VALUES('retained_session','alice',?,?)").run(old,old+7*DAY);
 await placeOrder(db,'alice',order(),old+1);await advanceMarket(db,old+STEP);await placeOrder(db,'alice',order({side:'sell',qty:3}),old+STEP+1);await advanceMarket(db,old+2*STEP);
 await placeOrder(db,'alice',order({qty:5}),old+2*STEP+1);await subscribe(db,'alice',key(),old+2*STEP+2);
 for(let i=0;i<100;i++)await recordTap(db,'alice',{expectedTaps:i,requestKey:key()},old+2*STEP+10000+i*60);
 await publishPost(db,'alice',{stockId:'000001',title:'초기화 전의 회원 게시글',body:'원문을 읽고 비교한 내용이 있어요. 같이 확인해볼까요?'},old+3*STEP);
 db.sqlite.exec("INSERT INTO watchlist(user_id,stock_id) VALUES('alice','000001');UPDATE accounts SET tutorial_done=1;UPDATE market SET reset_version=0");
 return db;
}

test('launch reset keeps credentials and sessions but atomically restarts every account and game record once',async()=>{
 const db=await legacy();assert.ok(count(db,'fills'));assert.ok(count(db,'holdings'));assert.ok(count(db,'research_purchases'));
 assert.equal(await resetGameIfNeeded(db,before),true);
 for(const table of ['orders','fills','holdings','cash_events','watchlist','labor_state','subscriptions','research_purchases','community_posts','research_reports'])assert.equal(count(db,table),0,table);
 for(const account of db.sqlite.prepare('SELECT * FROM accounts').all()){assert.equal(account.cash,10000000);assert.equal(account.reserved,0);assert.equal(account.realized,0);assert.equal(account.tutorial_done,0);}
 assert.equal(row(db,'SELECT password_hash FROM credentials').password_hash,'retained_password_hash');assert.equal(row(db,'SELECT token_hash FROM sessions').token_hash,'retained_session');
 assert.equal(count(db,'stocks'),34);assert.equal(count(db,'candles'),34);assert.equal(count(db,'ticks'),1);assert.equal(row(db,'SELECT fx FROM ticks').fx,1340);assert.equal(row(db,'SELECT COUNT(*) AS n FROM stocks WHERE price!=initial').n,0);
 assert.equal(row(db,'SELECT reset_at FROM market').reset_at,before);assert.equal(nextTick(row(db,'SELECT last_tick FROM market').last_tick),opening);
 for(let i=0;i<100;i++)await recordTap(db,'alice',{expectedTaps:i,requestKey:key()},before+i*60);
 assert.equal(await resetGameIfNeeded(db,before+10000),false);assert.equal((await laborState(db,'alice',before+10000)).earned,1000);assert.equal(row(db,"SELECT cash FROM accounts WHERE id='alice'").cash,10001000);
 await ensureInformation(db,before+10000);assert.ok(count(db,'research_reports')>=6);assert.equal((await subscriptionFor(db,'alice',before)).active,false);
});

test('a failed reset rolls back all deletions, account changes and the completion marker',async()=>{
 const db=await legacy(),cash=row(db,"SELECT cash FROM accounts WHERE id='alice'").cash,orders=count(db,'orders');
 db.sqlite.exec("CREATE TRIGGER refuse_reset BEFORE DELETE ON ticks BEGIN SELECT RAISE(ABORT,'RESET_BLOCKED'); END;");
 await assert.rejects(resetGameIfNeeded(db,before),/RESET_BLOCKED/);assert.equal(count(db,'orders'),orders);assert.equal(row(db,"SELECT cash FROM accounts WHERE id='alice'").cash,cash);assert.equal(row(db,'SELECT reset_version FROM market').reset_version,0);
 db.sqlite.exec('DROP TRIGGER refuse_reset');assert.equal(await resetGameIfNeeded(db,before),true);
});

test('simultaneous reset readers cannot run a second reset after the first transaction commits',async()=>{
 const db=await legacy(),batch=db.batch.bind(db);let tail=Promise.resolve();
 db.batch=commands=>{const run=tail.then(()=>batch(commands));tail=run.catch(()=>{});return run;};
 const results=await Promise.all([resetGameIfNeeded(db,before),resetGameIfNeeded(db,before)]);assert.equal(results.filter(Boolean).length,1);assert.equal(count(db,'ticks'),1);assert.equal(count(db,'stocks'),34);
});

test('closed-market community/news/research publish at 20/30/60-minute boundaries without duplicates or future posts',async()=>{
 const db=new LocalD1(),start=at('2026-10-20T08:05:00');await advanceMarket(db,start);await ensureInformation(db,start);
 const initial={posts:count(db,'community_posts'),news:count(db,'news'),reports:count(db,'research_reports')};
 await ensureInformation(db,at('2026-10-20T08:19:59'));assert.equal(count(db,'community_posts'),initial.posts);
 await ensureInformation(db,at('2026-10-20T08:20:00'));assert.equal(count(db,'community_posts'),initial.posts+1);assert.equal(count(db,'news'),initial.news);
 await ensureInformation(db,at('2026-10-20T08:30:00'));assert.equal(count(db,'news'),initial.news+1);assert.equal(count(db,'research_reports'),initial.reports);
 const end=at('2026-10-20T09:00:00');await ensureInformation(db,end);assert.equal(count(db,'community_posts'),initial.posts+3);assert.ok(count(db,'news')>=initial.news+2);assert.equal(count(db,'research_reports'),initial.reports+1);assert.equal(count(db,'ticks'),1);
 const counts=[count(db,'community_posts'),count(db,'news'),count(db,'research_reports')];await ensureInformation(db,end+1);assert.deepEqual([count(db,'community_posts'),count(db,'news'),count(db,'research_reports')],counts);
 assert.equal(row(db,'SELECT MAX(created) AS ts FROM community_posts').ts,end);assert.ok(row(db,'SELECT MAX(created) AS ts FROM research_reports').ts<=end);
 const state=await snapshot(db,null,'000001',end,false);assert.equal(state.information.publication.nextCommunity,end+20*60000);assert.ok(state.information.reports.every(r=>!('body'in r)));assert.ok(state.news.every(n=>!('financialUpdate'in n.details)));
});

test('missed editorial intervals catch up in bounded batches and retain varied public sources for every hourly report',async()=>{
 const db=new LocalD1(),start=at('2026-10-20T08:05:00');await advanceMarket(db,start);await ensureInformation(db,start);const initial=count(db,'research_reports'),end=start+40*60*60000;
 let result=await ensureInformation(db,end),runs=1;assert.equal(result.syncing,true);while(result.syncing&&runs<12){result=await ensureInformation(db,end);runs++;}
 assert.equal(result.syncing,false);assert.equal(count(db,'research_reports'),initial+40);assert.equal(row(db,'SELECT COUNT(*) AS n FROM research_reports r LEFT JOIN news n ON n.id=r.news_id WHERE n.id IS NULL').n,0);
 assert.ok(row(db,'SELECT COUNT(DISTINCT title) AS n FROM community_posts').n>20);assert.ok(row(db,'SELECT COUNT(DISTINCT category) AS n FROM news').n>=18);assert.ok(row(db,'SELECT MAX(created) AS ts FROM research_reports').ts<=end);
});
