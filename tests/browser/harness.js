// Test-only host for the real SDK postMessage protocol. No Owlbear login is simulated as security.
export async function mountRoom(page, base) {
  await page.route('**/test-harness', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><script>
    window.metadata = JSON.parse(localStorage.getItem('test-room-metadata') || '{}');
    window.calls = []; window.failWrites = false; window.subscribers = new Set();
    function emit() {
      localStorage.setItem('test-room-metadata', JSON.stringify(metadata));
      for (const frame of subscribers) frame.contentWindow.postMessage({id:'OBR_ROOM_METADATA_EVENT_CHANGE',data:{metadata}},location.origin);
    }
    window.publish = update => { Object.assign(metadata,update); emit(); };
    window.addFrame = (id,user,role,url='${base}') => {
      const frame=document.createElement('iframe'); frame.id=id; frame.dataset.user=user; frame.dataset.role=role; frame.style='width:440px;height:800px';
      const target=new URL(url,location.origin); target.searchParams.set('obrref',btoa(location.origin+' test-room')); frame.src=target.href;
      frame.onload=()=>frame.contentWindow.postMessage({id:'OBR_READY',data:{ref:id,userId:user}},location.origin);
      document.body.append(frame); return frame;
    };
    addEventListener('message',event=>{
      const frame=[...document.querySelectorAll('iframe')].find(f=>f.contentWindow===event.source);
      if(!frame || !event.data?.id) return;
      const m=event.data;
      const reply=(data,error=false)=>event.source.postMessage({id:m.id+(error?'_ERROR':'_RESPONSE')+m.nonce,data},location.origin);
      if(m.id==='OBR_PLAYER_GET_ID') reply({id:frame.dataset.user});
      if(m.id==='OBR_PLAYER_GET_NAME') reply({name:'Игрок '+frame.dataset.user});
      if(m.id==='OBR_PLAYER_GET_ROLE') reply({role:frame.dataset.role});
      if(m.id==='OBR_ROOM_GET_METADATA') reply({metadata});
      if(m.id==='OBR_ROOM_METADATA_SUBSCRIBE') subscribers.add(frame);
      if(m.id==='OBR_ROOM_SET_METADATA') {
        if(failWrites) { reply({message:'Тест: сохранение недоступно'},true); return; }
        Object.assign(metadata,m.data.update); calls.push(m); emit(); reply({});
      }
      if(m.id==='OBR_MODAL_OPEN') { calls.push(m); addFrame('modal',frame.dataset.user,frame.dataset.role,m.data.url); reply({}); }
    });
    addFrame('alice','alice','PLAYER'); addFrame('bob','bob','PLAYER'); addFrame('gm','gm','GM');
  </script></body></html>` }));
  await page.goto(base + 'test-harness');
}
