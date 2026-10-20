import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './db.mjs';
import {advanceMarket,accountFor,placeOrder,snapshot} from '../lib/engine.ts';
import {nextTick,session,marketInterval,auctionSlot,auctionsInSession,MARKET_CADENCE_SWITCH} from '../lib/market-data.ts';
const at=t=>Date.parse('2026-10-20T'+t+'+09:00'),switchAt=at('21:00:00');
test('KST 21:00 switches permanently to five-minute auctions without inserting earlier extra ticks',()=>{
 assert.equal(MARKET_CADENCE_SWITCH,switchAt);assert.equal(marketInterval(switchAt-1),600000);assert.equal(marketInterval(switchAt),300000);
 for(const [from,to] of [['20:49:59','20:50:00'],['20:50:00','21:00:00'],['20:59:59','21:00:00'],['21:00:00','21:05:00'],['21:05:00','21:10:00'],['23:39:59','23:40:00']])assert.equal(nextTick(at(from)),at(to));
 const nextDay=Date.parse('2026-10-21T16:40:00+09:00');assert.equal(nextTick(session(switchAt).close),nextDay);assert.equal(nextTick(nextDay),nextDay+300000);
 assert.equal(auctionSlot(switchAt),26);assert.equal(auctionsInSession(switchAt),59);assert.equal(auctionsInSession(nextDay),85);
});
test('orders cross the switch once, fill at 21:05 and editorial articles keep their own cadence',async()=>{
 const db=new LocalD1();await advanceMarket(db,at('20:50:00'),100);await accountFor(db,'alice',switchAt-1);
 const order=()=>({stockId:'000001',side:'buy',kind:'market',qty:1,requestKey:crypto.randomUUID()});
 await placeOrder(db,'alice',order(),at('20:59:00'));await advanceMarket(db,switchAt,4);
 assert.equal(db.sqlite.prepare("SELECT filled_at FROM orders").get().filled_at,switchAt);
 await placeOrder(db,'alice',order(),switchAt+1);await advanceMarket(db,at('21:04:59'));assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='open'").get().n,1);
 const newsBefore=db.sqlite.prepare('SELECT COUNT(*) AS n FROM news').get().n;await advanceMarket(db,at('21:05:00'));assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='filled'").get().n,2);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM news').get().n,newsBefore);
 await advanceMarket(db,at('21:15:00'));const rows=db.sqlite.prepare('SELECT ts FROM ticks WHERE ts>=? ORDER BY ts').all(switchAt);assert.deepEqual(rows.map(r=>r.ts),['21:00:00','21:05:00','21:10:00','21:15:00'].map(at));
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM news').get().n,newsBefore+1);await advanceMarket(db,at('21:15:00'));assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM ticks WHERE ts>=?').get(switchAt).n,4);
 assert.equal((await snapshot(db,'alice','000001',at('21:15:00'),false)).intervalMinutes,5);
});
