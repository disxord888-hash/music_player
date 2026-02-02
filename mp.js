// Yuki Player Logic

// State
let queue = []; // Array of { id: string, title: string, author: string }
let currentIndex = -1;
let selectedListIndex = -1;
let player = null;
let isPlayerReady = false;
let isLocked = false;
let lockTimer = null;
let lockStartTime = 0;
let isLoop = false;
let isShuffle = false;

const MAX_QUEUE = 32767;

// Elements
const el = {
    nowTitle: document.getElementById('now-title'),
    nowAuthor: document.getElementById('now-author'),
    queueList: document.getElementById('queue-list'),
    queueStatus: document.getElementById('queue-status'),
    addUrl: document.getElementById('add-url'),
    addTitle: document.getElementById('add-title'),
    addAuthor: document.getElementById('add-author'),
    fileInput: document.getElementById('file-input'),
    lockOverlay: document.getElementById('lock-overlay'),
    lockProgress: document.getElementById('lock-progress'),
    btnLock: document.getElementById('btn-lock'),
    btnLoop: document.getElementById('btn-loop'),
    btnShuffle: document.getElementById('btn-shuffle')
};

// --- YouTube API ---
function onYouTubeIframeAPIReady() {
    player = new YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        videoId: '',
        playerVars: {
            'playsinline': 1,
            'controls': 1,
            'disablekb': 1,
            'iv_load_policy': 3
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    isPlayerReady = true;
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.ENDED) {
        skipNext();
    }
}

// --- Logic ---

function extractId(url) {
    if (!url) return null;
    if (url.length === 11) return url;
    if (url.includes('/shorts/')) {
        const parts = url.split('/shorts/');
        if (parts[1]) {
            const id = parts[1].split(/[?&]/)[0];
            if (id.length === 11) return "SHORT_DETECTED";
        }
    }
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|music\.youtube\.com\/watch\?v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function extractPlaylistId(url) {
    if (!url) return null;
    const regExp = /[?&]list=([^#&?]+)/;
    const match = url.match(regExp);
    return match ? match[1] : null;
}

async function isShort(videoId) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        img.onload = () => {
            resolve(img.width <= img.height);
        };
        img.onerror = () => resolve(false);
    });
}

async function fetchMetadata(videoId) {
    try {
        const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
        const data = await response.json();
        const shortStatus = await isShort(videoId);
        return {
            title: data.title || "Unknown Title",
            author: data.author_name || "Unknown Artist",
            isShort: shortStatus || (data.title && data.title.toLowerCase().includes('#shorts'))
        };
    } catch (e) {
        return null;
    }
}

async function fetchPlaylistItems(playlistId) {
    try {
        const url = `https://www.youtube.com/playlist?list=${playlistId}`;
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);
        const data = await response.json();
        const html = data.contents;
        const match = html.match(/var ytInitialData = (\{.*?\});/);
        if (match) {
            const json = JSON.parse(match[1]);
            const contents = json.contents?.twoColumnBrowseResultsRenderer?.tabs[0]?.content?.sectionListRenderer?.contents[0]?.itemSectionRenderer?.contents[0]?.playlistVideoListRenderer?.contents;
            if (contents) {
                const processed = await Promise.all(contents.map(async item => {
                    const videoData = item.playlistVideoRenderer;
                    if (!videoData) return null;
                    const title = videoData.title?.runs[0]?.text || videoData.title?.simpleText || "Unknown Title";
                    if (title.toLowerCase().includes('#shorts')) return "SKIP";
                    const shortStatus = await isShort(videoData.videoId);
                    if (shortStatus) return "SKIP";
                    return {
                        id: videoData.videoId,
                        title: title,
                        author: videoData.shortBylineText?.runs[0]?.text || "Unknown Artist"
                    };
                }));
                let skipCount = 0;
                const validItems = processed.filter(i => {
                    if (i === "SKIP") { skipCount++; return false; }
                    return i;
                });
                return { items: validItems, skipCount: skipCount };
            }
        }
    } catch (e) { console.error(e); }
    return null;
}

async function addToQueue(urlOrId, title, author) {
    if (queue.length >= MAX_QUEUE) { alert("Queue Full"); return; }
    const plId = extractPlaylistId(urlOrId);
    if (plId) {
        const res = await fetchPlaylistItems(plId);
        if (res && res.items.length > 0) {
            for (const i of res.items) { if (queue.length < MAX_QUEUE) queue.push(i); }
            renderQueue();
            if (currentIndex === -1) playIndex(0);
            if (res.skipCount > 0) alert(`${res.skipCount}件除外`);
            return;
        }
    }
    const id = extractId(urlOrId);
    if (!id || id === "SHORT_DETECTED") { alert("Invalid/Shorts"); return; }
    const tempSong = { id: id, title: title || "読み込み中...", author: author || "..." };
    queue.push(tempSong);
    const idx = queue.length - 1;
    renderQueue();
    if (!title || !author) {
        const meta = await fetchMetadata(id);
        if (meta) {
            if (meta.isShort) { queue.splice(idx, 1); renderQueue(); alert("Shorts除外"); return; }
            queue[idx].title = meta.title; queue[idx].author = meta.author;
            renderQueue();
            if (currentIndex === idx) { el.nowTitle.value = meta.title; el.nowAuthor.value = meta.author; }
        }
    }
    if (currentIndex === -1) playIndex(0);
}

function renderQueue() {
    const fragment = document.createDocumentFragment();
    el.queueList.innerHTML = '';
    queue.forEach((item, idx) => {
        const li = document.createElement('li');
        li.className = 'queue-item' + (idx === currentIndex ? ' active' : '') + (idx === selectedListIndex ? ' selected' : '');
        li.innerHTML = `<span class="q-idx">${idx + 1}</span><div class="q-info"><span class="q-title">${safeHtml(item.title)}</span><span class="q-author">${safeHtml(item.author)}</span></div>`;
        li.onclick = () => { selectedListIndex = idx; renderQueue(); };
        li.ondblclick = () => playIndex(idx);
        fragment.appendChild(li);
    });
    el.queueList.appendChild(fragment);
    el.queueStatus.innerText = `${queue.length} / ${MAX_QUEUE}`;
}

function playIndex(idx) {
    if (idx < 0 || idx >= queue.length) return;
    currentIndex = idx;
    const item = queue[idx];
    if (isPlayerReady) player.loadVideoById(item.id);
    el.nowTitle.value = item.title;
    el.nowAuthor.value = item.author;
    renderQueue();
    setTimeout(() => {
        const activeEl = document.querySelector('.queue-item.active');
        if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

el.nowTitle.addEventListener('input', () => {
    if (currentIndex >= 0) {
        queue[currentIndex].title = el.nowTitle.value;
        const target = document.querySelector('.queue-item.active .q-title');
        if (target) target.innerText = el.nowTitle.value;
    }
});

el.nowAuthor.addEventListener('input', () => {
    if (currentIndex >= 0) {
        queue[currentIndex].author = el.nowAuthor.value;
        const target = document.querySelector('.queue-item.active .q-author');
        if (target) target.innerText = el.nowAuthor.value;
    }
});

function skipNext() {
    if (isLoop) { playIndex(currentIndex); return; }
    if (isShuffle && queue.length > 1) {
        let n = currentIndex; while (n === currentIndex) n = Math.floor(Math.random() * queue.length);
        playIndex(n); return;
    }
    if (currentIndex < queue.length - 1) playIndex(currentIndex + 1);
    else player.stopVideo();
}

function skipPrev() {
    if (currentIndex > 0) playIndex(currentIndex - 1);
    else if (isPlayerReady) player.seekTo(0);
}

function safeHtml(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function removeSelected() {
    if (selectedListIndex >= 0 && selectedListIndex < queue.length) {
        queue.splice(selectedListIndex, 1);
        if (currentIndex === selectedListIndex) {
            if (queue.length > 0) {
                if (currentIndex >= queue.length) currentIndex = queue.length - 1;
                playIndex(currentIndex);
            } else { player.stopVideo(); currentIndex = -1; }
        } else if (currentIndex > selectedListIndex) currentIndex--;
        selectedListIndex = -1;
        renderQueue();
    }
}

document.getElementById('btn-delete').onclick = removeSelected;
document.getElementById('btn-dedupe').onclick = () => {
    const seen = new Set();
    const old = queue.length;
    const curId = currentIndex >= 0 ? queue[currentIndex].id : null;
    queue = queue.filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; });
    currentIndex = curId ? queue.findIndex(i => i.id === curId) : -1;
    renderQueue();
    alert(`${old - queue.length}件削除`);
};

document.getElementById('btn-clear').onclick = () => {
    if (confirm("Clear?")) {
        queue = []; currentIndex = -1; selectedListIndex = -1;
        if (isPlayerReady) player.stopVideo();
        renderQueue();
    }
};

document.getElementById('btn-add').onclick = () => {
    addToQueue(el.addUrl.value, el.addTitle.value, el.addAuthor.value);
    el.addUrl.value = ''; el.addTitle.value = ''; el.addAuthor.value = '';
};

function startLockTimer() {
    lockStartTime = Date.now();
    el.lockProgress.style.width = '0%'; el.lockProgress.style.display = 'block';
    if (lockTimer) clearInterval(lockTimer);
    lockTimer = setInterval(() => {
        const elap = Date.now() - lockStartTime;
        const prog = Math.min((elap / 4000) * 100, 100);
        el.lockProgress.style.width = prog + '%';
        if (elap >= 4000) { clearInterval(lockTimer); toggleLock(); el.lockProgress.style.width = '0%'; lockTimer = null; }
    }, 50);
}

function stopLockTimer() { if (lockTimer) { clearInterval(lockTimer); lockTimer = null; } el.lockProgress.style.width = '0%'; el.lockProgress.style.display = 'none'; }
function toggleLock() { isLocked = !isLocked; if (isLocked) el.lockOverlay.classList.add('active'); else el.lockOverlay.classList.remove('active'); }

el.btnLock.onmousedown = startLockTimer; el.btnLock.onmouseup = stopLockTimer; el.btnLock.onmouseleave = stopLockTimer;
el.btnLock.ontouchstart = (e) => { e.preventDefault(); startLockTimer(); }; el.btnLock.ontouchend = stopLockTimer;
el.lockOverlay.onmousedown = startLockTimer; el.lockOverlay.onmouseup = stopLockTimer; el.lockOverlay.onmouseleave = stopLockTimer;
el.lockOverlay.ontouchstart = (e) => { e.preventDefault(); startLockTimer(); }; el.lockOverlay.ontouchend = stopLockTimer;

document.getElementById('btn-prev').onclick = () => !isLocked && skipPrev();
document.getElementById('btn-next').onclick = () => !isLocked && skipNext();
document.getElementById('btn-pause').onclick = () => {
    if (isLocked || !isPlayerReady) return;
    if (player.getPlayerState() === 1) player.pauseVideo(); else player.playVideo();
};
document.getElementById('btn-stop').onclick = () => !isLocked && isPlayerReady && player.stopVideo();
document.getElementById('btn-seek-back').onclick = () => !isLocked && isPlayerReady && player.seekTo(player.getCurrentTime() - 2);
document.getElementById('btn-seek-fwd').onclick = () => !isLocked && isPlayerReady && player.seekTo(player.getCurrentTime() + 2);
document.getElementById('btn-first').onclick = () => !isLocked && playIndex(0);
document.getElementById('btn-last').onclick = () => !isLocked && playIndex(queue.length - 1);

function toggleLoop() {
    isLoop = !isLoop;
    el.btnLoop.style.background = isLoop ? 'var(--primary)' : 'var(--bg-item)';
}
function toggleShuffle() {
    isShuffle = !isShuffle;
    el.btnShuffle.style.background = isShuffle ? 'var(--primary)' : 'var(--bg-item)';
}
el.btnLoop.onclick = () => !isLocked && toggleLoop();
el.btnShuffle.onclick = () => !isLocked && toggleShuffle();

document.getElementById('btn-export').onclick = () => {
    const blob = new Blob([JSON.stringify(queue, null, 2)], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'playlist.txt'; a.click();
};
document.getElementById('btn-import').onclick = () => el.fileInput.click();
el.fileInput.onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            if (Array.isArray(data)) { queue = data.slice(0, MAX_QUEUE); currentIndex = -1; renderQueue(); if (queue.length > 0) playIndex(0); }
        } catch (err) { }
    };
    reader.readAsText(file);
};

document.addEventListener('keydown', (e) => {
    if (isLocked) return;
    if (e.target.tagName.toLowerCase() === 'input') return;
    const k = e.key.toLowerCase();
    if (k === 's') skipPrev(); if (k === 'k') skipNext();
    if (k === 'f') isPlayerReady && player.seekTo(player.getCurrentTime() - 2);
    if (k === 'h') isPlayerReady && player.seekTo(player.getCurrentTime() + 2);
    if (k === 'g') { if (isPlayerReady) { if (player.getPlayerState() === 1) player.pauseVideo(); else player.playVideo(); } }
    if (k === 'o') isPlayerReady && player.stopVideo();
    if (k === 'd') playIndex(0); if (k === 'j') playIndex(queue.length - 1);
    if (k === 'q') toggleLoop(); if (k === 'w') toggleShuffle();
    if (k === '[') {
        if (selectedListIndex >= 0) { queue.splice(selectedListIndex + 1, 0, { ...queue[selectedListIndex] }); renderQueue(); }
        else document.getElementById('btn-add').click();
    }
    if (k === ']') removeSelected();
    const n = parseInt(e.key);
    if (n >= 1 && n <= 5) { const t = currentIndex + (n - 6); if (t >= 0) playIndex(t); }
    if ((n >= 6 && n <= 9) || n === 0) { let v = n === 0 ? 10 : n; const t = currentIndex + (v - 5); if (t < queue.length) playIndex(t); }
});
