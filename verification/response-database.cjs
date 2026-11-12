const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const ids={clinic:'11111111-1111-4111-8111-111111111111',security:'22222222-2222-4222-8222-222222222222',drrmo:'33333333-3333-4333-8333-333333333333',admin:'44444444-4444-4444-8444-444444444444',other:'55555555-5555-4555-8555-555555555555'};
const report={general:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',medical:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',legacy:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'};
(async()=>{const db=await PGlite.create();try{
await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
 GRANT USAGE ON SCHEMA auth TO authenticated,anon;
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,office text,fullname text);
 CREATE TABLE public.emergency_reports(id uuid PRIMARY KEY,emergency_type text,assigned_office text,status text,created_at timestamptz DEFAULT now());
 ALTER TABLE public.emergency_reports ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,UPDATE ON public.emergency_reports TO authenticated;GRANT SELECT ON public.profiles TO authenticated;
 CREATE POLICY original_office_read ON public.emergency_reports FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND (p.office='Administrator' OR p.office=assigned_office)));
 CREATE POLICY original_office_update ON public.emergency_reports FOR UPDATE TO authenticated USING(EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND (p.office='Administrator' OR p.office=assigned_office)));
`);
for(const [role,office] of Object.entries({clinic:'School Clinic',security:'Campus Security',drrmo:'DRRMO',admin:'Administrator',other:'Unapproved'}))await db.query('INSERT INTO profiles VALUES($1,$2,$3)',[ids[role],office,role]);
await db.query("INSERT INTO emergency_reports(id,emergency_type,assigned_office,status) VALUES($1,'General Emergency','Administrator','active'),($2,'Medical Emergency','School Clinic','active'),($3,'General Emergency','Administrator','acknowledged')",Object.values(report));
const migration=fs.readFileSync(path.join(__dirname,'../database/20261112_general_broadcast_acknowledgment.sql'),'utf8');await db.exec(migration);await db.exec(migration);
async function actor(role){await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[ids[role]]);await db.exec('SET ROLE authenticated');}
for(const role of ['clinic','security','drrmo','admin']){await actor(role);const visible=(await db.query('SELECT id FROM emergency_reports')).rows.map(r=>r.id);assert(visible.includes(report.general));assert.equal(visible.includes(report.medical),['clinic','admin'].includes(role));}
await actor('security');const first=(await db.query('SELECT * FROM acknowledge_emergency_report($1)',[report.general])).rows[0];assert.equal(first.status,'acknowledged');assert.equal(first.acknowledged_by,ids.security);assert.equal(first.acknowledged_office,'Campus Security');assert(first.acknowledged_at);
await actor('clinic');const repeated=(await db.query('SELECT * FROM acknowledge_emergency_report($1)',[report.general])).rows[0];assert.deepEqual(repeated,first,'Another office must not replace the first receipt');
await assert.rejects(db.query('UPDATE emergency_reports SET acknowledged_by=$1 WHERE id=$2',[ids.admin,report.medical]),/server managed/);
await assert.rejects(db.query("UPDATE emergency_reports SET acknowledged_at='2000-01-01',acknowledged_office='Administrator' WHERE id=$1",[report.medical]),/server managed/);
const old=(await db.query('SELECT acknowledged_at FROM emergency_reports WHERE id=$1',[report.legacy])).rows[0];assert.equal(old.acknowledged_at,null,'Legacy records do not get invented receipt dates');
await actor('admin');const editedLegacy=(await db.query('UPDATE emergency_reports SET created_at=created_at WHERE id=$1 RETURNING acknowledged_at',[report.legacy])).rows[0];assert.equal(editedLegacy.acknowledged_at,null,'Editing an already acknowledged legacy record must not invent its first actor/date');await actor('clinic');
const direct=(await db.query("UPDATE emergency_reports SET status='acknowledged' WHERE id=$1 RETURNING *",[report.medical])).rows[0];assert.equal(direct.acknowledged_by,ids.clinic,'Legacy status update paths are stamped too');assert.equal(direct.acknowledged_office,'School Clinic');
await actor('drrmo');await assert.rejects(db.query('SELECT * FROM acknowledge_emergency_report($1)',[report.medical]),/unavailable/);
await actor('other');assert.equal((await db.query('SELECT id FROM emergency_reports')).rows.length,0);await assert.rejects(db.query('SELECT * FROM acknowledge_emergency_report($1)',[report.general]),/unavailable/);
await db.exec('RESET ROLE;SET ROLE anon');await assert.rejects(db.query('SELECT * FROM acknowledge_emergency_report($1)',[report.general]),/permission denied/);
console.log('PASS SQL: repeatable migration, approved General audiences, normal office isolation, database timestamps/actor, immutable first receipt, legacy writes, forgery denial, unknown staff and anonymous denial.');
}finally{await db.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
