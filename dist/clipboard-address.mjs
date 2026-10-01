import {isContractAddress} from './recent-contracts.mjs';

// Keep clipboard contents in memory only, and never search until Paste CA is pressed.
export function setupClipboardAddress({button,input,clipboard,permissions,win,doc,onPaste}){
  let address='',revision=0;
  const show=value=>{
    address=typeof value==='string'&&isContractAddress(value.trim())?value.trim():'';
    button.hidden=!address;
  };
  async function refresh(interactive=false){
    const current=++revision;
    show('');
    try{
      if(!clipboard?.readText)return;
      // Background checks must not trigger a permission prompt.
      if(!interactive&&(await permissions?.query({name:'clipboard-read'}))?.state!=='granted')return;
      const text=await clipboard.readText();
      if(current===revision&&!doc.hidden)show(text);
    }catch{/* Unavailable, denied or invalid clipboard: leave the button hidden. */}
  }
  const clear=()=>{revision++;show('')};
  button.hidden=true;
  button.addEventListener('click',()=>{if(address)onPaste(address)});
  input.addEventListener('focus',()=>refresh(true));
  input.addEventListener('paste',event=>{revision++;show(event.clipboardData?.getData('text/plain'))});
  win.addEventListener('blur',clear);
  win.addEventListener('focus',()=>refresh());
  doc.addEventListener('visibilitychange',()=>doc.hidden?clear():refresh());
  refresh();
}
