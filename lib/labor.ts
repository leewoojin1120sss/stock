export const LABOR_TARGET=100,LABOR_REWARD=1000,LABOR_INTERVAL=60;
export type LaborState={totalTaps:number;progress:number;completed:number;earned:number;target:number;reward:number};
function view(taps=0):LaborState{return{totalTaps:taps,progress:taps%LABOR_TARGET,completed:Math.floor(taps/LABOR_TARGET),earned:Math.floor(taps/LABOR_TARGET)*LABOR_REWARD,target:LABOR_TARGET,reward:LABOR_REWARD};}
export async function laborState(db:D1Database,userId:string){const row=await db.prepare('SELECT taps FROM labor_state WHERE user_id=?').bind(userId).first<{taps:number}>();return view(row?.taps);}
export async function recordTap(db:D1Database,userId:string,input:Record<string,unknown>,now:number){const expected=input.expectedTaps,key=input.requestKey;if(!Number.isSafeInteger(expected)||Number(expected)<0||Number(expected)>Number.MAX_SAFE_INTEGER-100||typeof key!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(key))throw Error('터치 진행 상태를 확인해주세요.');
 await db.prepare('INSERT OR IGNORE INTO labor_state(user_id,taps,last_key,updated) VALUES(?,0,\'\',0)').bind(userId).run();
 const result=await db.prepare('UPDATE labor_state SET taps=taps+1,last_key=?,updated=? WHERE user_id=? AND taps=? AND last_key!=? AND updated<=?').bind(key,now,userId,expected,key,now-LABOR_INTERVAL).run();
 const state=await db.prepare('SELECT taps,last_key,updated FROM labor_state WHERE user_id=?').bind(userId).first<{taps:number;last_key:string;updated:number}>();if(!state)throw Error('진행 상태를 불러오지 못했습니다.');const work=view(state.taps);
 if(!result.meta.changes){if(state.taps===Number(expected)+1&&state.last_key===key)return{ok:true,duplicate:true,credited:0,work};if(state.taps!==expected||state.last_key===key)return{ok:false,conflict:true,credited:0,work};return{ok:false,retryAfter:Math.max(1,state.updated+LABOR_INTERVAL-now),credited:0,work};}
 return{ok:true,duplicate:false,credited:(Number(expected)+1)%LABOR_TARGET===0?LABOR_REWARD:0,work};
}
