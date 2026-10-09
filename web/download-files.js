/* Polling also covers extension-triggered downloads, not just the Parse button. */
window.CftDownloadFiles = (() => {
  let current = null, polling = false, lastFocus = null;
  const h = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function close() {
    if (!current) return;
    current.dialog.remove();
    document.removeEventListener('keydown', current.keydown, true);
    current = null;
    if (lastFocus?.isConnected) lastFocus.focus();
  }
  async function submit(indices) {
    if (!current || current.busy) return;
    const row = current;
    row.busy = true;
    row.dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {
      const result = await api.call('respond_download_file_choice',row.id,indices,false);
      if (result?.ok) { close(); setStatus(indices.length ? `已选择 ${indices.length} 个下载文件` : '已取消这个版本的下载'); }
      else { close(); setStatus(result?.msg || '文件选择已失效，请查看队列'); }
    } catch (_) {
      if (current !== row) return;
      row.busy = false;
      row.dialog.querySelectorAll('button').forEach(b=>b.disabled=false);
      row.dialog.querySelector('.df-countdown').textContent = '提交失败，请重试或取消';
    }
  }
  async function pause() {
    if (!current || current.paused) return;
    const row = current;
    try {
      const result = await api.call('respond_download_file_choice',row.id,null,true);
      if (current !== row) return;
      row.paused = !!result?.ok;
      row.dialog.querySelector('.df-countdown').textContent = row.paused ? '已停止自动选择，请确认或取消' : (result?.msg || '停止倒计时失败，请尽快确认');
    } catch (_) { if (current === row) row.dialog.querySelector('.df-countdown').textContent = '连接失败，请尽快确认'; }
  }
  function show(row) {
    close();
    lastFocus = document.activeElement;
    switchPage('dlmanager');
    const dialog = document.createElement('div');
    dialog.className = 'df-mask';
    dialog.innerHTML = `<section class="df-dialog" role="dialog" aria-modal="true" aria-labelledby="dfTitle"><header><h2 id="dfTitle">选择下载文件</h2><p>${h(row.title)} · ${row.files.length} 个可选文件</p></header><div class="df-list">${row.files.map((f,i)=>`<label class="df-option"><input type="checkbox" value="${i}" ${i===0 ? 'checked' : ''}/><span class="df-file"><strong>${h(f.name)}</strong><span>${h([f.metadata?.format,f.metadata?.fp,f.metadata?.size].filter(Boolean).join(' · ') || '未标注格式')}${f.primary ? ' · 主文件' : ''}</span></span><span class="df-size">${Number(f.sizeKB)>0 ? fmtSize(Number(f.sizeKB)*1024) : '大小未知'}</span></label>`).join('')}</div><footer><span class="df-countdown" role="status"></span><div><button class="btn" id="dfCancel">取消</button><button class="btn btn-primary" id="dfConfirm">确认下载</button></div></footer></section>`;
    document.body.appendChild(dialog);
    const keydown = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); submit([]); return; }
      if (e.key === 'Tab') {
        const items = [...dialog.querySelectorAll('input,button')].filter(x=>!x.disabled);
        const first=items[0],last=items.at(-1);
        if (e.shiftKey && document.activeElement===first) {e.preventDefault();last.focus();}
        else if (!e.shiftKey && document.activeElement===last) {e.preventDefault();first.focus();}
      }
    };
    current = {id:row.id,dialog,paused:row.paused,busy:false,keydown};
    document.addEventListener('keydown',keydown,true);
    dialog.querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{
      pause();
      dialog.querySelector('#dfConfirm').disabled = !dialog.querySelector('input:checked');
    }));
    dialog.querySelector('#dfCancel').addEventListener('click',()=>submit([]));
    dialog.querySelector('#dfConfirm').addEventListener('click',()=>submit([...dialog.querySelectorAll('input:checked')].map(i=>Number(i.value))));
    dialog.querySelector('input').focus();
    update(row);
  }
  function update(row) {
    if (!current || current.id !== row.id) return;
    if (row.paused) current.paused = true;
    current.dialog.querySelector('.df-countdown').textContent = current.paused ? '已停止自动选择，请确认或取消' : `${Math.ceil(row.seconds)} 秒后默认下载第一个文件`;
  }
  async function poll() {
    if (polling || !window.__ready) return;
    polling = true;
    try {
      const row = await api.call('get_download_file_choice');
      if (row?.id && Array.isArray(row.files)) {
        if (current?.id !== row.id) show(row); else update(row);
      } else if (current && !current.busy) { close(); setStatus('文件选择结束，请查看下载队列'); }
    } catch (_) { /* Temporary bridge unavailability must not create duplicate dialogs. */ }
    finally { polling = false; }
  }
  setInterval(poll,300);
  return {poll};
})();
