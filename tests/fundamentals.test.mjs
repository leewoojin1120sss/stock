import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './db.mjs';
import {seedStocks,DAY,session,auctionsInSession,dividendDates} from '../lib/market-data.ts';
import {financialMetrics,financeProfile,earningsUpdate,accrueBalance,rateSensitivity,fundamentalSignal} from '../lib/fundamentals.ts';
import {bootstrap,ensureFundamentals,advanceMarket,calculateTick,accountFor,placeOrder} from '../lib/engine.ts';
import {makeNews} from '../lib/news.ts';
const at=Date.parse('2026-10-22T17:10:00+09:00'),macro={rate:3,fx:1340,oil:78,gold:2700};
const equities=seedStocks().filter(s=>s.kind==='stock'),stock=equities.find(s=>s.id==='000008');
test('sector financials reconcile equity, liabilities, profit and per-share figures',()=>{
 for(const s of equities){const m=financialMetrics(s);assert.equal(s.eps,Math.round(m.net/s.shares));assert.equal(m.assets,m.equity+m.liabilities);assert.ok(s.margin>=-45&&s.margin<=70);assert.ok(s.bps>0&&s.shares>0);assert.ok(s.payout<=Math.max(0,s.eps));}
 assert.ok(equities.some(s=>s.eps<0));assert.ok(equities.some(s=>s.eps>0));
 const bank=equities.find(s=>s.company_type==='은행 금융지주');assert.ok(financeProfile(bank).interestShare<financeProfile(stock).interestShare);
});
test('interest burden responds to debt and rates without charging all bank deposits as corporate borrowing',()=>{
 const high={...stock,debt_ratio:stock.debt_ratio*2};
 assert.ok(financialMetrics(stock,5).eps<financialMetrics(stock,3).eps);
 assert.ok(financialMetrics(high,3).eps<financialMetrics(stock,3).eps);
 assert.ok(rateSensitivity(high)<rateSensitivity(stock));
 const bank=equities.find(s=>s.company_type==='은행 금융지주');assert.ok(financialMetrics(bank).interestDebt<financialMetrics(bank).liabilities*.1);
});
test('report growth, export exposure, input costs and earnings share one coherent statement',()=>{
 const s={...stock,financial_at:at-7*DAY,financial_fx:1340,financial_oil:78};
 const base=earningsUpdate(s,at,macro,.1),higherFX=earningsUpdate(s,at,{...macro,fx:1474},.1);
 assert.ok(higherFX.revenue>base.revenue);assert.equal(base.eps,financialMetrics({...s,...base},macro.rate).eps);
 const airline={...equities.find(s=>s.id==='000016'),financial_at:at-7*DAY};
 assert.ok(earningsUpdate(airline,at,{...macro,oil:100},0).margin<earningsUpdate(airline,at,macro,0).margin);
 assert.ok(earningsUpdate(s,at,macro,0,.03).revenue>earningsUpdate(s,at,macro,0,-.03).revenue);
 assert.equal(earningsUpdate({...s,...base},at+DAY-1,macro,.4),null);
 assert.ok(earningsUpdate({...s,...base},at+DAY,macro,.4));
});
test('balance accrual preserves the income-minus-dividends identity and never changes share count',()=>{
 const auctions=auctionsInSession(at),dividend=100,after=accrueBalance(stock,auctions,dividend),expected=stock.bps+stock.eps/(30*auctions)-dividend;
 assert.ok(Math.abs(after.bps-expected)<1e-8);assert.ok(after.debt_ratio>=0);
 const loser={...stock,eps:-5000};assert.ok(accrueBalance(loser,auctions,0).bps<loser.bps);
 const next=calculateTick([stock],[],[],at,macro,macro,'balance');assert.equal(next[0].shares,stock.shares);
 const d=dividendDates(stock,at);assert.equal(d.dps,dividendDates({...stock,price:stock.price*3},at).dps);
});
test('low valuation is bounded and loss makers do not receive an automatic rebound signal',()=>{
 assert.ok(fundamentalSignal({...stock,eps:5000,debt_ratio:30})>fundamentalSignal({...stock,eps:-5000,debt_ratio:300}));
 const loss={...stock,eps:-5000};assert.equal(fundamentalSignal(loss),fundamentalSignal({...loss,price:100}));
 for(const s of equities)assert.ok(Math.abs(fundamentalSignal(s))<.0022);
});
test('a live earnings article applies exactly the financial figures it reports, once per day',()=>{
 const s={...stock,financial_at:at-2*DAY},article=makeNews(at,[s],false,macro,0,'financial-report'),details=JSON.parse(article.details),update=details.financialUpdate;
 assert.ok(update);const next=calculateTick([s],[],[article],at,macro,macro,'test')[0];
 for(const k of ['revenue','eps','margin','export_ratio','financial_at'])assert.equal(next[k],update[k]);
 const repeated=makeNews(at+600000,[next],false,macro,0,'repeat');assert.equal(JSON.parse(repeated.details).financialUpdate,undefined);assert.equal(repeated.impact,0);
 assert.ok(!article.body.includes('전년 동기'));assert.ok(details.metrics.some(([k])=>k==='연간 이자 부담'));
});
test('one-time calibration is atomic, retry safe and preserves accounts, holdings, prices and pending orders',async()=>{
 const db=new LocalD1();await bootstrap(db,at);await accountFor(db,'alice',at);
 db.sqlite.exec("UPDATE market SET fundamentals_version=0; INSERT INTO holdings(user_id,stock_id,qty,reserved,cost) VALUES('alice','000008',10,0,500000)");
 await placeOrder(db,'alice',{stockId:'000008',side:'buy',kind:'market',qty:2,requestKey:crypto.randomUUID()},at+1);
 const orders=db.sqlite.prepare('SELECT * FROM orders').all();
 const original=db.sqlite.prepare('SELECT id,price,previous,initial,shares FROM stocks ORDER BY id').all(),account=db.sqlite.prepare('SELECT * FROM accounts').get();
 db.sqlite.exec("CREATE TRIGGER block_finance BEFORE UPDATE OF margin ON stocks BEGIN SELECT RAISE(ABORT,'BLOCK_FINANCE'); END");
 await assert.rejects(ensureFundamentals(db),/BLOCK_FINANCE/);assert.equal(db.sqlite.prepare('SELECT fundamentals_version AS v FROM market').get().v,0);
 db.sqlite.exec('DROP TRIGGER block_finance');await ensureFundamentals(db);
 assert.deepEqual(db.sqlite.prepare('SELECT id,price,previous,initial,shares FROM stocks ORDER BY id').all(),original);assert.deepEqual(db.sqlite.prepare('SELECT * FROM accounts').get(),account);
 assert.equal(db.sqlite.prepare('SELECT qty FROM holdings').get().qty,10);assert.deepEqual(db.sqlite.prepare('SELECT * FROM orders').all(),orders);
 const after=db.sqlite.prepare('SELECT * FROM stocks ORDER BY id').all();await ensureFundamentals(db);assert.deepEqual(db.sqlite.prepare('SELECT * FROM stocks ORDER BY id').all(),after);
});
test('persisted market batches advance linked financials once and retries do not accrue twice',async()=>{
 const db=new LocalD1();await bootstrap(db,at);db.sqlite.prepare('UPDATE market SET last_tick=?').run(at-300000);
 const before=db.sqlite.prepare("SELECT * FROM stocks WHERE id='000008'").get();await advanceMarket(db,at,1);
 const after=db.sqlite.prepare("SELECT * FROM stocks WHERE id='000008'").get();assert.notEqual(after.bps,before.bps);assert.notEqual(after.debt_ratio,before.debt_ratio);
 await advanceMarket(db,at,4);assert.deepEqual(db.sqlite.prepare("SELECT * FROM stocks WHERE id='000008'").get(),after);
});


test('closed-market and launch editions quote current financials without unapplied statement changes',()=>{
 const closed=session(at).day+9*3600000;
 for(const article of [makeNews(closed,[stock],false,macro,0,'closed'),makeNews(at,[stock],true,macro,0,'initial'),makeNews(at,[stock],false,macro,0,'launch',[],false)]){
  const d=JSON.parse(article.details);assert.equal(d.financialUpdate,undefined);assert.ok(d.paragraphs.join(' ').includes(Math.round(stock.eps).toLocaleString('ko-KR')+'원'));
 }
});
