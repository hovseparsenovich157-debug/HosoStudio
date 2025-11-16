// Hoso Studio — РАБОТАЕТ ИЗ ЛЮБОЙ ССЫЛКИ
// Telegram, WhatsApp, Viber, Facebook, почта, SMS — ВСЁ

(function(){
  // Определяем, откуда открыли
  const isTelegram = /Telegram/i.test(navigator.userAgent);
  const isWhatsApp = /WhatsApp/i.test(navigator.userAgent);
  const isViber = /Viber/i.test(navigator.userAgent);
  const isFacebook = /FBAN|FBAV/i.test(navigator.userAgent);
  const isWebView = isTelegram || isWhatsApp || isViber || isFacebook;

  if (isWebView) {
    document.body.classList.add('telegram-webview');
  }

  // Баннер для Telegram
  if (isTelegram) {
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:linear-gradient(90deg,#ff6b35,#ff8c5a);color:white;padding:14px;text-align:center;font-size:14px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,.3);';
    banner.innerHTML = `Gallery Нажми «Добавить из галереи»<br><small>Не работает? → ⋯ → Открыть в Safari/Chrome</small>
      <button onclick="this.parentElement.remove()" style="margin-left:10px;background:white;color:#ff6b35;border:0;padding:4px 12px;border-radius:8px;font-size:13px;font-weight:600;">OK</button>`;
    document.body.prepend(banner);
    setTimeout(() => banner.remove(), 15000);
  }

  const $ = s => document.querySelector(s);
  const list = $('#playersList');
  const template = $('#playerTemplate');
  const addBtn = $('#addPlayerBtn');

  const DB = (function(){
    let db;
    const open = () => new Promise(r => {
      const req = indexedDB.open('hoso_universal_v1', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', {keyPath: 'id'});
      req.onsuccess = () => { db = req.result; r(); };
    });
    const put = async item => { if(!db) await open(); return new Promise(res => db.transaction('files', 'readwrite').objectStore('files').put(item).onsuccess = res); };
    const get = async id => { if(!db) await open(); return new Promise(res => db.transaction('files', 'readonly').objectStore('files').get(id).onsuccess = e => res(e.target.result)); };
    return {open, put, get};
  })();

  const isVideoLink = url => {
    return /\.(mp4|webm|ogg)($|\?)/i.test(url) || 
           /youtube\.com|youtu\.be/i.test(url) || 
           /facebook\.com.*video|fb\.watch/i.test(url) || 
           /instagram\.com.*(reel|p)/i.test(url) || 
           /tiktok\.com/i.test(url) || 
           /t\.me|whatsapp\.com|viber\.com|messenger\.com/i.test(url);
  };

  const getYTId = url => (url.match(/v=([0-9A-Za-z_-]{11})|youtu\.be\/([0-9A-Za-z_-]{11})/) || [])[1] || (url.match(/v=([0-9A-Za-z_-]{11})|youtu\.be\/([0-9A-Za-z_-]{11})/) || [])[2];

  class Player {
    constructor(id) { this.id = id; const node = template.content.cloneNode(true); list.appendChild(node); this.el = list.lastElementChild; this.setup(); this.bind(); }
    setup() {
      this.video = this.el.querySelector('.video-element'); this.iframe = this.el.querySelector('.iframe-wrapper'); this.poster = this.el.querySelector('.poster-overlay');
      this.playBtn = this.el.querySelector('.btn-playpause'); this.prevBtn = this.el.querySelector('.btn-prev'); this.nextBtn = this.el.querySelector('.btn-next');
      this.loopBtn = this.el.querySelector('.btn-loop'); this.removeBtn = this.el.querySelector('.btn-remove-player'); this.fullBtn = this.el.querySelector('.btn-fullscreen');
      this.progress = this.el.querySelector('.progress'); this.time = this.el.querySelector('.time'); this.form = this.el.querySelector('.addVideoForm');
      this.urlInput = this.el.querySelector('.url-input'); this.titleInput = this.el.querySelector('.title-input'); this.fileInput = this.el.querySelector('.mobileFileInput');
      this.listEl = this.el.querySelector('.playlist-list'); this.sortBtn = this.el.querySelector('.btn-sort'); this.clearBtn = this.el.querySelector('.btn-clear-list');
      this.playlist = []; this.idx = -1; this.yt = false; this.loop = false;
    }
    bind() {
      this.video.addEventListener('timeupdate', () => this.updateTime()); this.video.addEventListener('ended', () => this.next());
      this.playBtn.onclick = () => this.toggle(); this.prevBtn.onclick = () => this.prev(); this.nextBtn.onclick = () => this.next();
      this.loopBtn.onclick = () => { this.loop = !this.loop; this.loopBtn.classList.toggle('active', this.loop); save(); };
      this.removeBtn.onclick = () => { this.el.remove(); players.delete(this.id); save(); };
      this.fullBtn.onclick = () => this.el.querySelector('.media-wrap').requestFullscreen?.();
      this.progress.oninput = e => { if(!this.yt && this.video.duration) this.video.currentTime = (e.target.value/100)*this.video.duration; };

      this.fileInput.onchange = async e => {
        const files = Array.from(e.target.files);
        for (const file of files) {
          if (!file.type.startsWith('video/')) continue;
          const blobId = `file_${this.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await DB.put({id: blobId, blob: file});
          this.add({url: URL.createObjectURL(file), title: file.name, source: 'local', blobId});
        }
        e.target.value = ''; save();
      };

      this.form.onsubmit = async e => {
        e.preventDefault();
        const url = this.urlInput.value.trim();
        const title = this.titleInput.value.trim() || null;
        if (!url) return;

        if (isVideoLink(url)) {
          this.add({url, title, source: 'remote'});
        } else {
          alert('Ссылка не поддерживается. Скопируй прямую ссылку на видео.');
          return;
        }

        this.form.reset();
        save();
      };

      this.sortBtn.onclick = () => { this.playlist.reverse(); this.render(); save(); };
      this.clearBtn.onclick = () => { this.playlist = []; this.listEl.innerHTML = ''; this.idx = -1; this.showPoster(); save(); };
    }
    add(item) { this.playlist.push(item); this.render(); if(this.playlist.length === 1) this.play(0); save(); }
    render() { 
      this.listEl.innerHTML = ''; 
      this.playlist.forEach((it, i) => { 
        const li = document.createElement('li'); 
        li.className = 'playlist-item'; 
        if(this.idx === i) li.classList.add('active'); 
        li.innerHTML = `<div class="pi-title">${it.title || it.fileName || 'Видео '+(i+1)}</div>`; 
        li.onclick = () => this.play(i); 
        this.listEl.appendChild(li); 
      }); 
    }
    async play(i) {
      if(i < 0 || i >= this.playlist.length) return; this.idx = i; const it = this.playlist[i]; this.video.muted = true; this.yt = false;
      this.iframe.innerHTML = ''; this.iframe.style.display = 'none'; this.video.style.display = 'block'; this.poster.style.display = 'none';
      if(it.source === 'local' && it.blobId) { const rec = await DB.get(it.blobId); if(rec?.blob) this.video.src = URL.createObjectURL(rec.blob); }
      else if(it.url.includes('youtube.com') || it.url.includes('youtu.be')) { const id = getYTId(it.url); this.yt = true; this.iframe.innerHTML = `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1&mute=1&rel=0" allow="autoplay" frameborder="0"></iframe>`; this.iframe.style.display = 'block'; this.video.style.display = 'none'; setTimeout(() => { this.iframe.innerHTML = `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1&rel=0" allow="autoplay" frameborder="0"></iframe>`; }, 1000); this.render(); return; }
      else { this.video.src = it.url; }
      try { await this.video.play(); } catch(e) {} setTimeout(() => { this.video.muted = false; }, 800); this.render();
    }
    updateTime() { if(this.yt) return; const d = this.video.duration, c = this.video.currentTime; if(d > 0) { this.progress.value = (c/d)*100; this.time.textContent = `${fmt(c)} / ${fmt(d)}`; } }
    toggle() { this.video.paused ? this.video.play() : this.video.pause(); this.playBtn.classList.toggle('paused', this.video.paused); }
    prev() { if(this.idx > 0) this.play(this.idx - 1); }
    next() { if(this.loop) { this.video.currentTime = 0; this.video.play(); return; } if(this.idx < this.playlist.length - 1) this.play(this.idx + 1); }
    showPoster() { this.video.src = ''; this.iframe.innerHTML = ''; this.poster.style.display = 'flex'; }
  }

  const fmt = s => { if(!isFinite(s)) return '00:00'; const m = Math.floor(s/60).toString().padStart(2,'0'); const sec = Math.floor(s%60).toString().padStart(2,'0'); return `${m}:${sec}`; };
  const players = new Map(); let nextId = 1;
  const generateId = () => { let id; do { id = nextId++; } while (players.has(id)); return id; };
  const addPlayer = () => { const id = generateId(); const p = new Player(id); players.set(id, p); save(); return p; };
  const save = () => { const data = {}; players.forEach((p, id) => { data[id] = { playlist: p.playlist.map(i => ({...i, file: undefined})), idx: p.idx, loop: p.loop }; }); localStorage.setItem('hoso_anywhere', JSON.stringify(data)); };
  const restore = async () => {
    await DB.open(); const raw = localStorage.getItem('hoso_anywhere');
    if(raw) { try { const obj = JSON.parse(raw); Object.keys(obj).forEach(idStr => { const id = parseInt(idStr); const d = obj[idStr]; const p = addPlayer(); p.id = id; p.playlist = d.playlist || []; p.idx = d.idx ?? -1; p.loop = d.loop || false; p.render(); if(p.playlist.length > 0) { p.video.muted = true; p.play(0); setTimeout(() => p.video.muted = false, 1000); } }); nextId = Math.max(...Object.keys(obj).map(k => parseInt(k)), 0) + 1; } catch(e) {} }
    else { const p = addPlayer(); p.add({url: 'https://www.w3schools.com/html/mov_bbb.mp4', title: 'Пример', source: 'remote'}); }
  };
  addBtn.onclick = () => addPlayer(); restore();
})();