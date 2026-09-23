import { validateAppearance } from '../public/display-assets/appearance.js';
import { ApiError } from './auth.js';
export async function readAppearance(db, privateFields=false) {
 const row=await db.prepare('SELECT * FROM display_appearance WHERE id=1').first();
 return {mode:row.mode,darkStart:row.dark_start,lightStart:row.light_start,...(privateFields?{version:row.version,updatedAt:row.updated_at,updatedBy:row.updated_by}:{})};
}
export async function saveAppearance(db,raw,actor) {
 const value=validateAppearance(raw);
 if(!Number.isInteger(raw.version)) throw new ApiError(409,'Reload Appearance before saving.');
 const at=new Date().toISOString();
 const result=await db.batch([
 db.prepare('UPDATE display_appearance SET mode=?,dark_start=?,light_start=?,version=version+1,updated_at=?,updated_by=? WHERE id=1 AND version=?').bind(value.mode,value.darkStart,value.lightStart,at,actor,raw.version),
 db.prepare('INSERT INTO display_audit SELECT ?,NULL,?,?,?,? WHERE changes()>0').bind(crypto.randomUUID(),'appearance',actor,at,raw.version+1)
 ]);
 if(!result[0].meta.changes) throw new ApiError(409,'Appearance changed in another session. Reopen it before saving.');
 return readAppearance(db,true);
}
