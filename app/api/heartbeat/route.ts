import {env} from 'cloudflare:workers';
import {advanceMarket} from '../../../lib/engine';
import {ensureInformation} from '../../../lib/information';
export const dynamic='force-dynamic';
export async function GET(){
 try{if(!env.DB)throw Error('DB unavailable');const now=Date.now(),marketSync=await advanceMarket(env.DB,now,4),content=await ensureInformation(env.DB,now),market=await env.DB.prepare('SELECT last_tick,info_cursor,reset_at,reset_version FROM market WHERE id=1').first();return Response.json({ok:true,syncing:marketSync||content.syncing,published:content.published,now,...market},{headers:{'Cache-Control':'no-store'}});}catch(e){console.error('heartbeat',e);return Response.json({ok:false},{status:503,headers:{'Cache-Control':'no-store'}});}
}
