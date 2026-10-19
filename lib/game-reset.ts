import {randomBytes} from 'node:crypto';
import {INITIAL_CASH,STEP,seedStocks,type Row} from './market-data.ts';
import {makeNews} from './news.ts';

// One launch reset. Accounts and password/session records remain valid.
export const RESET_VERSION=1;
export async function resetGameIfNeeded(db:D1Database,now:number){
 const market=await db.prepare('SELECT reset_version FROM market WHERE id=1').first<Row>();
 if(!market||market.reset_version>=RESET_VERSION)return false;
 const guard='(SELECT reset_version FROM market WHERE id=1)<'+RESET_VERSION,anchor=Math.floor(now/STEP)*STEP,stocks=seedStocks();
 const commands:D1PreparedStatement[]=[];
 for(const table of ['fills','orders','holdings','watchlist','cash_events','labor_state','subscriptions','research_purchases','community_posts','research_reports','candles','news','ticks','stocks'])commands.push(db.prepare('DELETE FROM '+table+' WHERE '+guard));
 commands.push(db.prepare('UPDATE accounts SET cash=?,reserved=0,realized=0,tutorial_done=0 WHERE '+guard).bind(INITIAL_CASH));
 const put=(table:string,row:Row)=>{const columns=Object.keys(row);return db.prepare('INSERT INTO '+table+'('+columns.join(',')+') SELECT '+columns.map(()=>'?').join(',')+' WHERE '+guard).bind(...Object.values(row));};
 for(const stock of stocks){commands.push(put('stocks',stock),put('candles',{stock_id:stock.id,ts:anchor,open:stock.price,high:stock.price,low:stock.price,close:stock.price,volume:0}));}
 commands.push(put('ticks',{ts:anchor,index_value:1000,rate:3,fx:1340,oil:78,gold:2700}));
 for(let i=0;i<18;i++)commands.push(put('news',makeNews(now-i*60000,stocks,true,undefined,i)));
 // Every statement tests the persisted marker inside one transaction. A retry
 // or simultaneous reader cannot reset money earned after the first commit.
 commands.push(db.prepare('UPDATE market SET last_tick=?,revision=revision+1,catalog_version=2,info_version=0,info_cursor=?,reset_at=?,seed=?,reset_version=? WHERE '+guard).bind(anchor,anchor,now,randomBytes(32).toString('hex'),RESET_VERSION));
 const result=await db.batch(commands);
 return !!result.at(-1)?.meta.changes;
}
