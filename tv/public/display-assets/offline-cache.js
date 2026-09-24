const DATABASE='shul-view-public-cache',STORE='display',KEY='published';
function open(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
export async function readOfflineCache(){
  const db=await open();
  try{return await new Promise((resolve,reject)=>{
    const request=db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);
  });}finally{db.close();}
}
export async function saveOfflineCache(value){
  const db=await open();
  try{await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,KEY);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
