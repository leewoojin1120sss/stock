import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export class LocalD1{
 constructor(legacy=false){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');this.migrate(legacy?0:Infinity);}
 migrate(to=Infinity){this.applied??=new Set();for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()){if(this.applied.has(f)||Number(f.slice(0,4))>to)continue;this.sqlite.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));this.applied.add(f);}}
 prepare(sql){const db=this.sqlite;return{sql,args:[],bind(...args){this.args=args;return this;},async first(){return db.prepare(sql).get(...this.args)||null;},async all(){return{results:db.prepare(sql).all(...this.args)};},async run(){const r=db.prepare(sql).run(...this.args);return{meta:{changes:Number(r.changes)}};}};}
 async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const results=[];for(const s of statements)results.push(await s.run());this.sqlite.exec('COMMIT');return results;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
}
