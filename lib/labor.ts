export const LABOR_TARGET=100,LABOR_REWARD=1000,LABOR_INTERVAL=60,LABOR_DAILY_LIMIT=50000;
const DAY=86400000,KST=32400000;
export type LaborState={totalTaps:number;progress:number;completed:number;earned:number;target:number;reward:number;dailyLimit:number;dailyEarned:number;remaining:number;limitReached:boolean;resetAt:number;serverNow:number;day:string};
type LaborRecord={taps:number;last_key:string;updated:number;daily_earned:number};
export function laborDay(now:number){const start=Math.floor((now+KST)/DAY)*DAY-KST;return{start,end:start+DAY,day:new Date(now+KST).toISOString().slice(0,10)};}
function view(row:LaborRecord,now:number):LaborState{const{end,day}=laborDay(now),taps=row.taps,remaining=Math.max(0,LABOR_DAILY_LIMIT-row.daily_earned);return{totalTaps:taps,progress:taps%LABOR_TARGET,completed:Math.floor(taps/LABOR_TARGET),earned:Math.floor(taps/LABOR_TARGET)*LABOR_REWARD,target:LABOR_TARGET,reward:LABOR_REWARD,dailyLimit:LABOR_DAILY_LIMIT,dailyEarned:row.daily_earned,remaining,limitReached:remaining<LABOR_REWARD,resetAt:end,serverNow:now,day};}
async function read(db:D1Database,userId:string,now:number){const{start,end}=laborDay(now);return(await db.prepare("SELECT COALESCE(l.taps,0) AS taps,COALESCE(l.last_key,'') AS last_key,COALESCE(l.updated,0) AS updated,COALESCE((SELECT SUM(amount) FROM cash_events WHERE user_id=? AND kind='노동 수당' AND settled=1 AND created>=? AND created<?),0) AS daily_earned FROM (SELECT ? AS id) u LEFT JOIN labor_state l ON l.user_id=u.id").bind(userId,start,end,userId).first<LaborRecord>())!;}
export async function laborState(db:D1Database,userId:string,now=Date.now()){return view(await read(db,userId,now),now);}
export async function recordTap(db:D1Database,userId:string,input:Record<string,unknown>,now:number){const expected=input.expectedTaps,key=input.requestKey;if(!Number.isSafeInteger(expected)||Number(expected)<0||Number(expected)>Number.MAX_SAFE_INTEGER-100||typeof key!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(key))throw Error('터치 진행 상태를 확인해주세요.');
 await db.prepare('INSERT OR IGNORE INTO labor_state(user_id,taps,last_key,updated) VALUES(?,0,\'\',0)').bind(userId).run();
 let changed=0,capped=false;try{const result=await db.prepare('UPDATE labor_state SET taps=taps+1,last_key=?,updated=? WHERE user_id=? AND taps=? AND last_key!=? AND updated<=?').bind(key,now,userId,expected,key,now-LABOR_INTERVAL).run();changed=result.meta.changes||0;}catch(e){if(String(e).includes('LABOR_DAILY_LIMIT'))capped=true;else throw e;}
 const state=await read(db,userId,now),work=view(state,now);
 if(!changed){if(state.taps===Number(expected)+1&&state.last_key===key)return{ok:true,duplicate:true,credited:0,work};if(capped||work.limitReached)return{ok:false,limitReached:true,credited:0,work};if(state.taps!==expected||state.last_key===key)return{ok:false,conflict:true,credited:0,work};return{ok:false,retryAfter:Math.max(1,state.updated+LABOR_INTERVAL-now),credited:0,work};}
 return{ok:true,duplicate:false,credited:(Number(expected)+1)%LABOR_TARGET===0?LABOR_REWARD:0,work};
}
// One HTTP round trip can acknowledge several physical taps. Each increment
// still passes the existing SQL counter, pacing, daily cap and wage triggers.
export async function recordTaps(db:D1Database,userId:string,input:Record<string,unknown>,now:number){
 const expected=Number(input.expectedTaps),count=Number(input.count),key=input.requestKey;
 if(!Number.isSafeInteger(input.expectedTaps)||expected<0||expected>Number.MAX_SAFE_INTEGER-100||!Number.isInteger(input.count)||count<1||count>20||typeof key!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(key))throw Error('터치 진행 상태를 확인해주세요.');
 const initial=await read(db,userId,now),work=view(initial,now),already=initial.taps-expected;
 if(already>0&&already<=count&&initial.last_key===key+'-'+already)return{ok:true,duplicate:true,accepted:already,credited:0,work};
 if(initial.taps!==expected)return{ok:false,conflict:true,accepted:0,credited:0,work};
 if(work.limitReached)return{ok:false,limitReached:true,accepted:0,credited:0,work};
 const allowed=Math.min(count,Math.max(0,Math.floor((now-initial.updated)/LABOR_INTERVAL)),LABOR_TARGET-work.progress);
 if(!allowed)return{ok:false,retryAfter:Math.max(1,initial.updated+LABOR_INTERVAL-now),accepted:0,credited:0,work};
 let accepted=0,credited=0;
 for(let i=0;i<allowed;i++){
  const result=await recordTap(db,userId,{expectedTaps:expected+i,requestKey:key+'-'+(i+1)},now-(allowed-1-i)*LABOR_INTERVAL);
  if(!result.ok)return{...result,accepted,credited,work:await laborState(db,userId,now)};
  accepted++;credited+=result.credited;
 }
 return{ok:true,duplicate:false,accepted,credited,work:await laborState(db,userId,now)};
}
