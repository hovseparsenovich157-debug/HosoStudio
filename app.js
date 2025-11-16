// Hoso Studio — ВИДЕО НАВСЕГДА, ДРУГ УВИДИТ ПО ССЫЛКЕ
// Работает в Telegram, WhatsApp, Viber, WebView, iPhone, Android

(function(){
  const $ = s => document.querySelector(s);
  const list = $('#playersList');
  const template = $('#playerTemplate');
  const addBtn = $('#addPlayerBtn');
  const shareBtn = $('#shareBtn');
  const importBtn = $('#importBtn');
  const importFile = $('#importFile');
  const dropZone = $('#dropZone');

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  const isWebView = /WebView|(iPhone|iPod|iPad)(?!.*Safari)|Android.*(wv|\.0\.0\.0)/i.test(navigator.userAgent);

  // Уникальный ID сессии
  let sessionId = localStorage.getItem('hoso_session_id');
  if (!sessionId) {
    sessionId = 's_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('hoso_session_id', sessionId);
  }

  // Проверка: открыта по общей ссылке?
  const urlParams = new URLSearchParams(location.search);
  const shareId = urlParams.get('share') || sessionId;

  // Кнопка "Поделиться"
  shareBtn.onclick = () => {
    const url = `${location.origin}${location.pathname}?share=${sessionId}`;
    if (navigator.share) {
      navigator.share({url}).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        alert('Ссылка скопирована! Отправь в Telegram, WhatsApp, Viber.');
      }).catch(() => prompt('Скопируй:', url));
    }
  };

  // Drag & Drop
  ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', async e => {
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('video/'));
    if (!files.length) return;
    const player = getFirstPlayer();
    for (const file of files) {
      const blobId = `${sessionId}_file_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
      await DB.put({id: blobId, blob: file});
      player.add({url: URL.createObjectURL(file), title: file.name, source: 'local', blobId});
    }
    save();
  });

  importBtn.onclick = () => importFile.click();
  importFile.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const obj = JSON.parse(ev.target.result);
        players.clear(); list.innerHTML = '';
        Object.keys(obj).forEach(idStr => {
          const id = parseInt(idStr); const d = obj[idStr];
          const p = addPlayer(); p.id = id; p.playlist = d.playlist || []; p.idx = d.idx ?? -1; p.loop = d.loop || false;
          p.render();
          if (p.playlist.length) { p.video.muted = true; p.play(0); setTimeout(() => p.video.muted = false, 1000); }
        });
        nextId = Math.max(...Object.keys(obj).map(k => parseInt(k)), 0) + 1;
        save();
      } catch { alert('Ошибка импорта'); }
    };
    reader.readAsText(file); e.target.value = '';
  };

  const DB = (function(){
    let db;
    const open = () => new Promise(r => {
      const req = indexedDB.open('hoso_permanent_v4', 6);
      req.onupgradeneeded = e => {
        db = e.target.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', {keyPath: 'id'});
      };
      req.onsuccess = () => { db = req.result; r(); };
    });
    const put = async item => { if(!db) await open(); return new Promise(res => db.transaction('files', 'readwrite').objectStore('files').put(item).onsuccess = res); };
    const get = async id => { if(!db) await open(); return new Promise(res => db.transaction('files', 'readonly').objectStore('files').get(id).onsuccess = e => res(e.target.result)); };
    return {open, put, get};
  })();

  const isVideoLink = url => /\.(mp4|webm|ogg)($|\?)/i.test(url) || /youtube|facebook|instagram|tiktok|t\.me|whatsapp|viber|messenger/i.test(url);
  const getYTId = url => {
    const match = url.match(/v=([0-9A-Za-z_-]{11})|youtu\.be\/([0-9A-Za-z_-]{11})/);
    return match ? match[1] || match[2] : null;
  };

  class Player {
    constructor(id) { 
      this.id = id; 
      const node = template.content.cloneNode(true); 
      list.appendChild(node); 
      this.el = list.lastElementChild; 
      this.setup(); 
      this.bind(); 
    }
    setup() {
      this.video = this.el.querySelector('.video-element'); 
      this.iframe = this.el.querySelector('.iframe-wrapper'); 
      this.poster = this.el.querySelector('.poster-overlay');
      this.playBtn = this.el.querySelector('.btn-playpause'); 
      this.prevBtn = this.el.querySelector('.btn-prev'); 
      this.nextBtn = this.el.querySelector('.btn-next');
      this.loopBtn = this.el.querySelector('.btn-loop'); 
      this.removeBtn = this.el.querySelector('.btn-remove-player'); 
      this.progress = this.el.querySelector('.progress'); 
      this.time = this.el.querySelector('.time'); 
      this.form = this.el.querySelector('.addVideoForm');
      this.urlInput = this.el.querySelector('.url-input'); 
      this.titleInput = this.el.querySelector('.title-input'); 
      this.fileInput = this.el.querySelector('.mobileFileInput');
      this.listEl = this.el.querySelector('.playlist-list'); 
      this.sortBtn = this.el.querySelector('.btn-sort'); 
      this.clearBtn = this.el.querySelector('.btn-clear-list');
      this.playlist = []; this.idx = -1; this.yt = false; this.loop = false;
    }

    bind() {
      this.video.addEventListener('timeupdate', () => this.updateTime());
      this.video.addEventListener('ended', () => this.next());

      this.playBtn.onclick = () => this.toggle();
      this.prevBtn.onclick = () => this.prev();
      this.nextBtn.onclick = () => this.next();
      this.loopBtn.onclick = () => { this.loop = !this.loop; this.loopBtn.classList.toggle('active', this.loop); save(); };
      this.removeBtn.onclick = () => { this.el.remove(); players.delete(this.id); save(); };

      this.progress.oninput = e => {
        if (!this.yt && this.video.duration) this.video.currentTime = (e.target.value / 100) * this.video.duration;
      };

      this.fileInput.onchange = async e => {
        const files = Array.from(e.target.files);
        for (const file of files) {
          if (!file.type.startsWith('video/')) continue;
          const blobId = `${sessionId}_file_${this.id}_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
          await DB.put({id: blobId, blob: file});
          this.add({url: URL.createObjectURL(file), title: file.name, source: 'local', blobId});
        }
        e.target.value = ''; save();
      };

      // Поддержка галереи в WebView
      if (isIOS || isAndroid || isWebView) {
        this.el.querySelector('.gallery-btn').addEventListener('click', () => this.fileInput.click());
      }

      this.form.onsubmit = async e => {
        e.preventDefault();
        const url = this.urlInput.value.trim();
        const title = this.titleInput.value.trim() || null;
        if (!url || !isVideoLink(url)) { alert('Ссылка не поддерживается'); return; }
        this.add({url, title, source: 'remote'});
        this.form.reset();
        save();
      };

      this.sortBtn.onclick = () => { this.playlist.reverse(); this.render(); save(); };
      this.clearBtn.onclick = () => { this.playlist = []; this.listEl.innerHTML = ''; this.idx = -1; this.showPoster(); save(); };
    }

    add(item) { 
      this.playlist.push(item); 
      this.render(); 
      if (this.playlist.length === 1) this.play(0); 
      save(); 
    }

    render() { 
      this.listEl.innerHTML = ''; 
      this.playlist.forEach((it, i) => { 
        const li = document.createElement('li'); 
        li.className = 'playlist-item'; 
        if (this.idx === i) li.classList.add('active'); 
        li.innerHTML = `<div class="pi-title">${it.title || it.fileName || 'Видео ' + (i+1)}</div>`; 
        li.onclick = () => this.play(i); 
        this.listEl.appendChild(li); 
      }); 
    }

    async play(i) {
      if (i < 0 || i >= this.playlist.length) return;
      this.idx = i; const it = this.playlist[i]; this.video.muted = true; this.yt = false;
      this.iframe.innerHTML = ''; this.iframe.style.display = 'none'; this.video.style.display = 'block'; this.poster.style.display = 'none';

      if (it.source === 'local' && it.blobId) {
        const rec = await DB.get(it.blobId);
        if (rec?.blob) {
          this.video.src = URL.createObjectURL(rec.blob);
        } else {
          alert('Видео не найдено');
          return;
        }
      } else if (it.url.includes('youtube.com') || it.url.includes('youtu.be')) {
        const id = getYTId(it.url);
        if (!id) return;
        this.yt = true;
        this.iframe.innerHTML = `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1&mute=1&rel=0" allow="autoplay" frameborder="0"></iframe>`;
        this.iframe.style.display = 'block'; this.video.style.display = 'none';
        setTimeout(() => {
          this.iframe.innerHTML = `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1&rel=0" allow="autoplay" frameborder="0"></iframe>`;
        }, 1000);
        this.render(); return;
      } else {
        this.video.src = it.url;
      }

      try { await this.video.play(); } catch(e) {}
      setTimeout(() => { this.video.muted = false; }, 800);
      this.render();
    }

    updateTime() { 
      if (this.yt) return; 
      const d = this.video.duration, c = this.video.currentTime; 
      if (d > 0) { 
        this.progress.value = (c/d)*100; 
        this.time.textContent = `${fmt(c)} / ${fmt(d)}`; 
      } 
    }

    toggle() { 
      this.video.paused ? this.video.play() : this.video.pause(); 
      this.playBtn.classList.toggle('paused', this.video.paused); 
    }

    prev() { if (this.idx > 0) this.play(this.idx - 1); }
    next() { 
      if (this.loop) { this.video.currentTime = 0; this.video.play(); return; } 
      if (this.idx < this.playlist.length - 1) this.play(this.idx + 1); 
    }

    showPoster() { 
      this.video.src = ''; 
      this.iframe.innerHTML = ''; 
      this.poster.style.display = 'flex'; 
    }
  }

  const fmt = s => { 
    if (!isFinite(s)) return '00:00'; 
    const m = Math.floor(s/60).toString().padStart(2,'0'); 
    const sec = Math.floor(s%60).toString().padStart(2,'0'); 
    return `${m}:${sec}`; 
  };

  const players = new Map(); 
  let nextId = 1;
  const generateId = () => { let id; do { id = nextId++; } while (players.has(id)); return id; };
  const getFirstPlayer = () => players.size === 0 ? addPlayer() : [...players.values()][0];
  const addPlayer = () => { const id = generateId(); const p = new Player(id); players.set(id, p); save(); return p; };

  const save = () => { 
    const data = {}; 
    players.forEach((p, id) => { 
      data[id] = { 
        playlist: p.playlist.map(i => ({url: i.url, title: i.title, source: i.source, blobId: i.blobId})), 
        idx: p.idx, 
        loop: p.loop 
      }; 
    }); 
    localStorage.setItem(`hoso_data_${shareId}`, JSON.stringify(data)); 
  };

  const restore = async () => {
    await DB.open(); 
    const raw = localStorage.getItem(`hoso_data_${shareId}`);
    if (raw) { 
      try { 
        const obj = JSON.parse(raw); 
        Object.keys(obj).forEach(idStr => { 
          const id = parseInt(idStr); 
          const d = obj[idStr]; 
          const p = addPlayer(); 
          p.id = id; 
          p.playlist = d.playlist || []; 
          p.idx = d.idx ?? -1; 
          p.loop = d.loop || false; 
          p.render(); 
          if (p.playlist.length > 0) { 
            p.video.muted = true; 
            p.play(0); 
            setTimeout(() => p.video.muted = false, 1000); 
          } 
        }); 
        nextId = Math.max(...Object.keys(obj).map(k => parseInt(k)), 0) + 1; 
      } catch(e) { console.error(e); } 
    } else { 
      const p = addPlayer(); 
      p.add({url: 'https://www.w3schools.com/html/mov_bbb.mp4', title: 'Пример', source: 'remote'}); 
    }

    if (urlParams.get('video') && isVideoLink(urlParams.get('video'))) {
      getFirstPlayer().add({url: urlParams.get('video'), title: null, source: 'remote'});
    }
  };

  addBtn.onclick = () => addPlayer(); 
  restore();
})();