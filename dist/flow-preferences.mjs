const key='meme-fast:flow-window:v1';
const windows=[5,15,60,1440,7200];

export function readFlowWindow(getStorage=()=>window.localStorage){
  try{const minutes=Number(getStorage().getItem(key));return windows.includes(minutes)?minutes:60}catch{return 60}
}

export function saveFlowWindow(minutes,getStorage=()=>window.localStorage){
  if(!windows.includes(minutes))return;
  try{getStorage().setItem(key,String(minutes))}catch{/* Keep the current selection when storage is blocked. */}
}
