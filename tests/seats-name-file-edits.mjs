import test from 'node:test';
import assert from 'node:assert/strict';
import { SeatsWorkspace } from '../worker/seats/worker.js';

const fileId='synthetic-file-legacy';
function setup() {
  const original={id:fileId,name:'Legacy list',names:['Original Person'],createdAt:'2026-10-26T12:00:00.000Z',createdBy:'First Organizer'};
  const stored=new Map([['names:'+fileId,structuredClone(original)]]);
  const workspace=new SeatsWorkspace({storage:{get:async key=>stored.get(key),put:async(key,value)=>stored.set(key,structuredClone(value)),list:async()=>stored},blockConcurrencyWhile:fn=>fn(),getWebSockets:()=>[]},{});
  workspace.session=async token=>token==='test-session'?{name:'Second Organizer'}:null;
  const call=(path='',body,auth=true)=>workspace.fetch(new Request('https://example.test/api/name-lists'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer test-session'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  return {original,stored,call};
}
const edit=(overrides={})=>({name:'Updated list',names:['Updated Person','Updated Person','דוד כהן'],revision:1,operationId:'synthetic-operation-001',...overrides});
test('name-file edits upgrade legacy records and preserve their identity and creation metadata',async()=>{
  const {original,call}=setup();assert.equal((await call('/'+fileId,edit(),false)).status,401);
  const response=await call('/'+fileId,edit());assert.equal(response.status,200);const file=await response.json();
  assert.equal(file.id,original.id);assert.equal(file.createdAt,original.createdAt);assert.equal(file.createdBy,original.createdBy);assert.equal(file.updatedBy,'Second Organizer');assert.equal(file.revision,2);assert.deepEqual(file.names,['Updated Person','דוד כהן']);
  const listing=await (await call()).json();assert.equal(listing.files.length,1);assert.equal(listing.files[0].count,2);assert.equal(listing.files[0].revision,2);assert.equal(listing.files[0].updatedBy,'Second Organizer');
});
test('retries are idempotent and stale edits cannot overwrite a newer version',async()=>{
  const {call}=setup(),first=await (await call('/'+fileId,edit())).json();
  assert.deepEqual(await (await call('/'+fileId,edit())).json(),first);
  assert.equal((await call('/'+fileId,edit({operationId:'synthetic-other-operation'}))).status,409);
  assert.deepEqual(await (await call('/'+fileId)).json(),first);
});
test('deleted files stay deleted and invalid edits do not modify stored names',async()=>{
  const {call,stored,original}=setup();
  for(const values of [{names:[]},{names:['1234']},{name:''},{revision:0},{operationId:''}])assert.equal((await call('/'+fileId,edit(values))).status,400);
  assert.deepEqual(stored.get('names:'+fileId),original);
  stored.set('names:'+fileId,{...original,deletedAt:'2026-10-27T12:00:00.000Z'});assert.equal((await call('/'+fileId,edit())).status,410);assert.equal(stored.get('names:'+fileId).names[0],'Original Person');
});
