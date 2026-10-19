import {env} from 'cloudflare:workers';
import {advanceMarket} from '../../../lib/engine';
export const dynamic='force-dynamic';
export async function GET(){
 try{if(!env.DB)throw Error('DB unavailable');const now=Date.now(),syncing=await advanceMarket(env.DB,now,4),market=await env.DB.prepare('SELECT last_tick FROM market WHERE id=1').first();return Response.json({ok:true,syncing,now,...market},{headers:{'Cache-Control':'no-store'}});}catch(e){console.error('heartbeat',e);return Response.json({ok:false},{status:503,headers:{'Cache-Control':'no-store'}});}
}
