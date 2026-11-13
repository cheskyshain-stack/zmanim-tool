import published from '../../data/published.json' with {type:'json'};
import {validateAppearance} from '../public/display-assets/appearance.js';
import {addDays,localStamp} from '../public/display-assets/time.js';

// The browser engine embeds the same published calendar settings as this Worker.
// Change the prefix when the seed schema or calendar calculation contract changes.
let revision=2166136261;
for(const character of JSON.stringify(published)) revision=Math.imul(revision^character.charCodeAt(0),16777619)>>>0;
export const OFFLINE_ENGINE='shul-calendar-v9-'+revision.toString(16);
const fields={
  announcement:['message','contact','phone','category','displayGroup','sectionPosition','placement','priority','behavior','duration'],
  dedication:['sponsor','anonymous','dedicationType','dedicationName','dedicationText','message','sponsorshipDate','timing','duration','hebrewLabel'],
  schedule:['source','appliesFrom','appliesTo','portion','precedence','previewAt'],
};
/** Published future visible content is public so a previously connected screen can
 * activate it offline. This deliberately excludes all private/admin metadata. */
export function createOfflineSeed(items,appearance,at=new Date().toISOString()){
  const earliestSourceDay=addDays(localStamp(at).slice(0,10),-1);
  return {schema:1,engine:OFFLINE_ENGINE,generatedAt:at,appearance:validateAppearance(appearance),items:items
    .filter(item=>item.status==='published'&&fields[item.kind]&&(!item.endsAt||item.endsAt>at||item.kind==='schedule'&&item.data.appliesTo>=earliestSourceDay))
    .map(item=>({id:item.id,kind:item.kind,status:'published',title:item.title,startsAt:item.startsAt,endsAt:item.endsAt,
      data:Object.fromEntries(fields[item.kind].filter(key=>key in item.data&&!(key==='sponsor'&&item.data.anonymous)).map(key=>[key,item.data[key]]))}))};
}
