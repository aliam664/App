import { PGlite } from '@electric-sql/pglite';
import { beforeAll,afterAll,it,expect } from 'vitest';
import { readFile } from 'node:fs/promises';
let db:PGlite;
beforeAll(async()=>{
  db=new PGlite();await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);`);
  await db.exec(await readFile('supabase/migrations/202611010001_platform.sql','utf8'));
});
afterAll(async()=>{await db.close();});
it('installs all tables and enforces RLS on each',async()=>{const result=await db.query<{tablename:string;rowsecurity:boolean}>("select tablename,rowsecurity from pg_tables where schemaname='uhm'");expect(result.rows.length).toBe(8);expect(result.rows.every(r=>r.rowsecurity)).toBe(true);});
it('has no anon/public RPC execution privilege',async()=>{const r=await db.query<{allowed:boolean}>("select has_function_privilege('anon','uhm.activate_license(text,text)','execute') as allowed");expect(r.rows[0].allowed).toBe(false);});
it('denies browser roles access to license data',async()=>{await db.exec('set role anon');await expect(db.query('select * from uhm.licenses')).rejects.toThrow();await db.exec('reset role');});
it('binds once, permits same-device retry and rejects another device',async()=>{
 await db.exec(`insert into uhm.licenses(id,code_hash,prefix,tier,duration_days) values('20000000-0000-4000-8000-000000000001','hash-one','UHM-TEST','pro',30)`);
 await db.exec('set role service_role');
 await db.query('select uhm.activate_license($1,$2)', ['hash-one','device-one']);
 await db.query('select uhm.activate_license($1,$2)', ['hash-one','device-one']);
 await expect(db.query('select uhm.activate_license($1,$2)', ['hash-one','device-two'])).rejects.toThrow();
 const r=await db.query<{activation_count:number}>('select activation_count from uhm.licenses where code_hash=$1',['hash-one']);expect(r.rows[0].activation_count).toBe(1);
 await db.exec('reset role');
});
it('keeps audit mutation and license update in the same transaction',async()=>{
 await db.exec('set role service_role');await db.query('select uhm.mutate_license($1,$2,$3,$4)',['20000000-0000-4000-8000-000000000001','revoke','owner-test',30]);
 const r=await db.query<{action:string}>("select action from uhm.audit_events where actor='owner-test'");expect(r.rows[0].action).toBe('license.revoke');
 await expect(db.query('select uhm.mutate_license($1,$2,$3,$4)',['20000000-0000-4000-8000-000000000001','suspend','owner-test',30])).rejects.toThrow();await db.exec('reset role');
});
it('stores immutable snapshots and refuses repeated release version',async()=>{
 const id='20000000-0000-4000-8000-000000000002';
 await db.query(`insert into uhm.packages(id,slug,name,description,category,tier,image,version,files,steps,status) values($1,'test','Test','Test description','tools','normal','/images/01.jpg','1.0.0','[{"id":"f"}]','[{"id":"s"}]','draft')`,[id]);
 await db.exec('set role service_role');await db.query("update uhm.packages set status='published' where id=$1",[id]);
 const r=await db.query<{version:string}>('select version from uhm.package_releases where package_id=$1',[id]);expect(r.rows[0].version).toBe('1.0.0');
 await expect(db.query("update uhm.packages set name='Changed' where id=$1",[id])).rejects.toThrow();
 await expect(db.query("update uhm.package_releases set version='2.0.0' where package_id=$1",[id])).rejects.toThrow();await db.exec('reset role');
});
it('rate limit increments atomically and denies beyond budget',async()=>{
 await db.exec('set role service_role');for(let i=0;i<3;i++){const r=await db.query<{allowed:boolean}>("select uhm.take_rate_limit('rate-test',2,60) as allowed");expect(r.rows[0].allowed).toBe(i<2);}await db.exec('reset role');
});
