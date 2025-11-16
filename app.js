// Важные улучшения:
// 1) Винтажный стиль в CSS
// 2) Owner mode — только владелец может загружать локальные файлы
// 3) Сохранение плейлистов и удаление плееров в localStorage + local files в IndexedDB

(function(){ 
    // --- DETECT TELEGRAM WEBVIEW ---
  const ua = navigator.userAgent || "";
  const isTelegram = ua.includes("Telegram");

  if (isTelegram) {
      alert(
        "Вы открыли сайт внутри Telegram.\n\n" +
        "Telegram блокирует доступ к галерее, видео-файлам и загрузке файлов.\n\n" +
        "Пожалуйста, нажмите три точки ⋯ и выберите «Открыть в браузере».\n\n" +
        "После открытия в Safari или Chrome – добавление видео заработает."
      );
  }
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const playersContainer = $('#playersContainer');
  const playerTemplate = document.getElementById('playerTemplate');
  const addPlayerBtn = document.getElementById('addPlayerBtn');
  const fileInput = document.getElementById('fileInput');
  const fileLabel = document.getElementById('fileLabel');
  const ownerToggle = document.getElementById('ownerToggle');
  const yearEl = document.getElementById('year'); yearEl.textContent = new Date().getFullYear();

  // Simple IndexedDB wrapper for storing local file blobs
  const DB = (function(){
    const name = 'hoso_media_v1'; const store = 'files'; let db;
    function open(){
      return new Promise((res,rej)=>{
        const r = indexedDB.open(name,1);
        r.onupgradeneeded = e => { db = e.target.result; if(!db.objectStoreNames.contains(store)) db.createObjectStore(store,{keyPath:'id'}); };
        r.onsuccess = e => { db = e.target.result; res(db); };
        r.onerror = e => rej(e.target.error);
      });
    }
    async function put(item){ if(!db) await open(); return new Promise((res,rej)=>{ const tx = db.transaction(store,'readwrite'); const s = tx.objectStore(store); const r = s.put(item); r.onsuccess = ()=>res(r.result); r.onerror = e=>rej(e); }); }
    async function get(id){ if(!db) await open(); return new Promise((res,rej)=>{ const tx = db.transaction(store,'readonly'); const s = tx.objectStore(store); const r = s.get(id); r.onsuccess = ()=>res(r.result); r.onerror = e=>rej(e); }); }
    async function all(){ if(!db) await open(); return new Promise((res,rej)=>{ const tx = db.transaction(store,'readonly'); const s = tx.objectStore(store); const r = s.getAll(); r.onsuccess = ()=>res(r.result); r.onerror = e=>rej(e); }); }
    async function del(id){ if(!db) await open(); return new Promise((res,rej)=>{ const tx = db.transaction(store,'readwrite'); const s = tx.objectStore(store); const r = s.delete(id); r.onsuccess = ()=>res(); r.onerror = e=>rej(e); }); }
    return {open,put,get,all,del};
  })();

  // Theme: keep original dark/light persisted? We'll keep simple paper look.

  // Utils
  function isYouTube(url){ return /youtube\.com|youtu\.be/.test(url); }
  function extractYouTubeId(url){
    const patterns = [/v=([0-9A-Za-z_-]{11})/, /youtu\.be\/([0-9A-Za-z_-]{11})/];
    for(const p of patterns){ const m = url.match(p); if(m) return m[1]; }
    return null;
  }
  function formatTime(sec){ if(!isFinite(sec)) return '00:00'; const s = Math.floor(sec%60).toString().padStart(2,'0'); const m = Math.floor(sec/60).toString().padStart(2,'0'); return m+':'+s; }

  // Owner mode: simple password stored in localStorage (user requested local-only ownership)
  function isOwner(){ return localStorage.getItem('hoso_owner') === '1'; }
  function promptOwner(){
    // if owner not set, allow to set a password first time
    const exists = !!localStorage.getItem('hoso_owner_password');
    if(!exists){ const p = prompt('Установите пароль владельца (будет сохранён только в этом браузере):'); if(!p) return; localStorage.setItem('hoso_owner_password', p); localStorage.setItem('hoso_owner','1'); alert('Пароль установлен. Вы — владелец на этом устройстве.'); updateOwnerUI(); return; }
    const p = prompt('Введите пароль владельца:'); if(p === localStorage.getItem('hoso_owner_password')){ localStorage.setItem('hoso_owner','1'); alert('Вход выполнен.'); updateOwnerUI(); } else alert('Неверный пароль.');
  }
  function updateOwnerUI(){ if(isOwner()){ fileLabel.style.display = ''; ownerToggle.textContent = 'Выйти из режима владельца'; } else { fileLabel.style.display = 'none'; ownerToggle.textContent = 'Войти как владелец'; } }
  ownerToggle.addEventListener('click', ()=>{
    if(isOwner()){ localStorage.removeItem('hoso_owner'); updateOwnerUI(); alert('Вы вышли из режима владельца.'); }
    else promptOwner();
  });
  updateOwnerUI();

  // VideoPlayer class with persistence hooks
  class VideoPlayer{
    constructor(root, id){
      this.root = root; this.id = id; this.playlist = []; this.currentIndex = -1; this.isYT = false; this.loop = false; this.setup(); this.bind(); this.root.querySelector('.player-index').textContent = this.id;
    }
    setup(){
      this.video = this.root.querySelector('.video-element');
      this.iframeWrap = this.root.querySelector('.iframe-wrapper');
      this.poster = this.root.querySelector('.poster-overlay');
      this.playBtn = this.root.querySelector('.btn-playpause');
      this.prevBtn = this.root.querySelector('.btn-prev');
      this.nextBtn = this.root.querySelector('.btn-next');
      this.loopBtn = this.root.querySelector('.btn-loop');
      this.removeBtn = this.root.querySelector('.btn-remove');
      this.progress = this.root.querySelector('.progress');
      this.time = this.root.querySelector('.time');
      this.volume = this.root.querySelector('.volume');
      this.playlistList = this.root.querySelector('.playlist-list');
      this.addForm = this.root.querySelector('.addVideoForm');
      this.clearBtn = this.root.querySelector('.btn-clear');
      this.clearListBtn = this.root.querySelector('.btn-clear-list');
      this.sortBtn = this.root.querySelector('.btn-sort');
      this.fullscreenBtn = this.root.querySelector('.btn-fullscreen');
    }
    bind(){
      this.video.addEventListener('timeupdate', ()=> this.updateProgress());
      this.video.addEventListener('loadedmetadata', ()=> this.updateProgress());
      this.video.addEventListener('ended', ()=> this.onEnded());
      this.playBtn.addEventListener('click', ()=> this.togglePlay());
      this.prevBtn.addEventListener('click', ()=> this.prev());
      this.nextBtn.addEventListener('click', ()=> this.next());
      this.loopBtn.addEventListener('click', ()=> { this.loop = !this.loop; this.loopBtn.classList.toggle('active', this.loop); saveState(); });
      this.removeBtn.addEventListener('click', ()=> { this.root.remove(); removePlayer(this.id); saveState(); });

      this.progress.addEventListener('input', (e)=>{ if(this.isYT) return; const pct = parseFloat(e.target.value); if(isFinite(this.video.duration)) this.video.currentTime = (pct/100) * this.video.duration; });
      this.volume.addEventListener('input', e => this.video.volume = parseFloat(e.target.value));

      this.addForm.addEventListener('submit', e => { e.preventDefault(); const url = this.addForm.videoUrl.value.trim(); const title = this.addForm.title.value.trim() || null; if(!url) return; this.addToPlaylist({url, title, source: 'remote'}); this.addForm.reset(); saveState(); });
      this.clearBtn.addEventListener('click', ()=> this.addForm.reset());
      if(this.clearListBtn) this.clearListBtn.addEventListener('click', ()=> { this.playlist = []; this.playlistList.innerHTML = ''; this.currentIndex = -1; this.showPoster(); saveState(); });
      if(this.sortBtn) this.sortBtn.addEventListener('click', ()=> { this.playlist.reverse(); this.renderPlaylist(); saveState(); });
      if(this.fullscreenBtn) this.fullscreenBtn.addEventListener('click', ()=> { const el = this.root.querySelector('.media-wrap'); if(!document.fullscreenElement) el.requestFullscreen?.(); else document.exitFullscreen?.(); });
    }
    addToPlaylist(item){ this.playlist.push(item); this.renderPlaylist(); if(this.playlist.length === 1) this.playByIndex(0); saveState(); }
    renderPlaylist(){ this.playlistList.innerHTML = ''; this.playlist.forEach((it, i) => { const li = document.createElement('li'); li.className = 'playlist-item'; const t = document.createElement('div'); t.className = 'pi-title'; t.textContent = it.title || (it.fileName || (it.url.length>40 ? it.url.slice(0,40)+'...' : it.url)); const m = document.createElement('div'); m.className = 'pi-meta'; m.textContent = it.source === 'local' ? 'Локальный файл' : (isYouTube(it.url) ? 'YouTube' : 'MP4'); li.appendChild(t); li.appendChild(m); li.addEventListener('click', ()=> { this.playByIndex(i); }); this.playlistList.appendChild(li); }); }
  async playByIndex(i){
  if(i < 0 || i >= this.playlist.length) return;
  this.currentIndex = i;
  const item = this.playlist[i];

  // ======== важное: заставляем автоплей работать ========
  this.video.muted = true; // autoplay всегда разрешён если видео без звука
  // =======================================================

  if(item.source === 'local'){
    this.isYT = false;
    this.iframeWrap.innerHTML = '';
    this.iframeWrap.style.display = 'none';
    this.video.style.display = 'block';

    if(item.blobId){
      const rec = await DB.get(item.blobId);
      if(rec && rec.blob){
        const url = URL.createObjectURL(rec.blob);
        this.video.src = url;
        await this.video.play(); 
        this.poster.style.display = 'none';

        setTimeout(()=>{ this.video.muted = false; }, 800);
        return;
      }
    }

    // fallback
    this.video.src = item.url;
    await this.video.play(); 
    this.poster.style.display = 'none';
    setTimeout(()=>{ this.video.muted = false; }, 800);
  } else {

    // YouTube autoplay работает сам через autoplay=1
    if(isYouTube(item.url)){
      const id = extractYouTubeId(item.url);
      this.isYT = true;
      this.iframeWrap.innerHTML =
        `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1&mute=1&rel=0"
         frameborder="0"
         allow="autoplay; encrypted-media; picture-in-picture"
         allowfullscreen></iframe>`;
      this.iframeWrap.style.display = 'block';
      this.video.style.display = 'none';
      this.poster.style.display = 'none';

      // Через секунду включаем звук
      setTimeout(()=>{
        this.iframeWrap.innerHTML =
          `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1&rel=0"
            frameborder="0"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowfullscreen></iframe>`;
      }, 1200);

      return;
    }

    // обычный MP4
    this.isYT = false;
    this.iframeWrap.innerHTML = '';
    this.iframeWrap.style.display = 'none';
    this.video.style.display = 'block';
    this.video.src = item.url;
    await this.video.play();
    this.poster.style.display = 'none';
    setTimeout(()=>{ this.video.muted = false; }, 800);
  }
}

    updateProgress(){ if(this.isYT) return; const d = this.video.duration, c = this.video.currentTime; if(isFinite(d) && d>0){ const pct = (c/d)*100; this.progress.value = pct; this.time.textContent = `${formatTime(c)} / ${formatTime(d)}`; } else { this.time.textContent = '00:00 / 00:00'; } }
    onEnded(){ if(this.loop){ this.video.currentTime = 0; this.video.play(); return; } if(this.currentIndex < this.playlist.length - 1) this.playByIndex(this.currentIndex + 1); }
    togglePlay(){ if(this.isYT) return; if(this.video.paused){ this.video.play(); this.playBtn.textContent = '❚❚'; } else { this.video.pause(); this.playBtn.textContent = '▶'; } }
    prev(){ if(this.currentIndex > 0) this.playByIndex(this.currentIndex - 1); }
    next(){ if(this.currentIndex < this.playlist.length - 1) this.playByIndex(this.currentIndex + 1); }
    showPoster(){ this.video.src = ''; this.iframeWrap.innerHTML = ''; this.iframeWrap.style.display = 'none'; this.video.style.display = 'block'; this.poster.style.display = 'flex'; this.time.textContent = '00:00 / 00:00'; this.progress.value = 0; }
  }

  // manager
  let playerCount = 0; const players = new Map();
  function addPlayer(id=null,data){ playerCount += 1; const node = document.importNode(playerTemplate.content, true); playersContainer.appendChild(node); const el = playersContainer.lastElementChild; const pid = id || (Date.now()+Math.floor(Math.random()*999)); const vp = new VideoPlayer(el,pid); players.set(pid, vp); el.style.opacity = 0; el.style.transform = 'translateY(8px)'; requestAnimationFrame(()=>{ el.style.transition = 'all .45s cubic-bezier(.2,.9,.3,1)'; el.style.opacity = 1; el.style.transform = 'translateY(0)'; }); if(data && data.playlist){ vp.playlist = data.playlist; vp.renderPlaylist(); if(data.currentIndex != null) vp.currentIndex = data.currentIndex; if(vp.playlist.length>0) vp.showPoster(); } return vp; }

  // restore state from localStorage + IndexedDB
  async function restoreState(){ const raw = localStorage.getItem('hoso_state_v1'); if(!raw) return; try{ const obj = JSON.parse(raw); if(obj.players && Array.isArray(obj.players)){
        for(const p of obj.players){ addPlayer(p.id,p); }
      }
    }catch(e){} }

  function saveState(){
    const snapshot = { players: [] };
    for(const [id,vp] of players.entries()){
      // serialize playlist but remove file.blob or file objects, keep blobId for local
      const pls = vp.playlist.map(it=>{
        const copy = Object.assign({}, it);
        if(copy.file){ delete copy.file; }
        return copy;
      });
      snapshot.players.push({ id, playlist: pls, currentIndex: vp.currentIndex, loop: vp.loop });
    }
    localStorage.setItem('hoso_state_v1', JSON.stringify(snapshot));
  }

  function removePlayer(id){ players.delete(id); saveState(); }

  // initial
  (async ()=>{
    await DB.open();
    await restoreState();
    // if none - create two players
    if(players.size === 0){ const p1 = addPlayer(); const p2 = addPlayer(); // demo remote
      p1.addToPlaylist({url: 'https://www.w3schools.com/html/mov_bbb.mp4', title: 'Пример MP4', source: 'remote'});
      p1.addToPlaylist({url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Пример YouTube', source: 'remote'});
      saveState(); }
  })();

async function restoreState(){ 
  const raw = localStorage.getItem('hoso_state_v1'); 
  if(!raw) return; 

  try { 
    const obj = JSON.parse(raw); 

    if(obj.players && Array.isArray(obj.players)){
      for(const p of obj.players){ 
          
        // создаём плеер
        const vp = addPlayer(p.id, p);

        // === АВТОЗАПУСК ПЕРВОГО ВИДЕО ===
        if (vp.playlist.length > 0) {
          vp.video.muted = true;   // чтобы не блокировался autoplay
          vp.playByIndex(0);

          // возвращаем громкость спустя секунду
          setTimeout(()=>{ 
            vp.video.muted = false; 
          }, 1000);
        }
      }
    }
  } catch(e){}
}


  addPlayerBtn.addEventListener('click', ()=>{ addPlayer(); saveState(); });

  // Handle local file input — only when owner
  fileInput.addEventListener('change', async (e)=>{
    if(!isOwner()){ alert('Только владелец может загружать локальные файлы. Войдите как владелец.'); return; }
    const files = Array.from(e.target.files || []);
    if(files.length === 0) return;
    // add files to first player (or create one)
    let target = players.values().next().value;
    if(!target) target = addPlayer();
    for(const file of files){
      // read blob and save to indexedDB
      const id = 'f-'+Date.now()+Math.floor(Math.random()*9999);
      const rec = { id, name: file.name, type: file.type, blob: file };
      try{ await DB.put(rec); const url = URL.createObjectURL(file); target.addToPlaylist({url, title: file.name, source: 'local', blobId: id, fileName: file.name}); }
      catch(err){ console.error('DB save failed',err); target.addToPlaylist({url: URL.createObjectURL(file), title: file.name, source: 'local', fileName: file.name}); }
    }
    e.target.value = '';
    saveState();
  });

  // drag & drop support — if owner allow adding creates new player
  playersContainer.addEventListener('dragover', e=> e.preventDefault());
  playersContainer.addEventListener('drop', async e=>{
    e.preventDefault(); const dt = e.dataTransfer; const files = Array.from(dt.files || []).filter(f => f.type.startsWith('video/'));
    if(files.length === 0) return; if(!isOwner()){ alert('Только владелец может загружать локальные файлы.'); return; }
    const vp = addPlayer();
    for(const f of files){ const id = 'f-'+Date.now()+Math.floor(Math.random()*9999); try{ await DB.put({id,name:f.name,type:f.type,blob:f}); vp.addToPlaylist({url: URL.createObjectURL(f), title: f.name, source: 'local', blobId: id, fileName: f.name}); }catch(err){ vp.addToPlaylist({url: URL.createObjectURL(f), title: f.name, source: 'local', fileName: f.name}); } }
    saveState();
  });

  // small accessibility: clear demo / reset
  window.hoso_reset_storage = function(){ if(confirm('Удалить всю локальную информацию (localStorage + IndexedDB)?')){ localStorage.removeItem('hoso_state_v1'); localStorage.removeItem('hoso_owner'); localStorage.removeItem('hoso_owner_password'); indexedDB.deleteDatabase('hoso_media_v1'); alert('Удалено. Перезагрузите страницу.'); } };

})();
