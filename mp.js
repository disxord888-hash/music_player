// Yuki Player Logic

// State
let queue = []; // Array of { id: string, title: string, author: string, playCount: number, addedAt: number }
let currentIndex = -1;
let selectedListIndex = -1;
let player = null;
let isPlayerReady = false;
let autoSkipTimer = null;
let lastTimeUpdate = 0;
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
            'disablekb': 1, // Disable YT keyboard shortcuts to use ours
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
    console.log("Player Ready");
}

function onPlayerStateChange(event) {
    // YT.PlayerState.ENDED = 0
    if (event.data === YT.PlayerState.ENDED) {
        skipNext();
    }
}

// --- Logic ---

function extractId(url) {
    if (!url) return null;
    if (url.length === 11) return url;
    // Handle Shorts URL first
    if (url.includes('/shorts/')) {
        const parts = url.split('/shorts/');
        if (parts[1]) {
            const id = parts[1].split(/[?&]/)[0];
            if (id.length === 11) return "SHORT_DETECTED";
        }
    }
    // Standard YouTube and YouTube Music patterns
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

// Helper to check if a video might be a short based on thumbnail aspect ratio
async function isShort(videoId) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        img.onload = () => {
            if (img.width <= img.height) {
                resolve(true);
            } else {
                resolve(false);
            }
        };
        img.onerror = () => resolve(false);
    });
}

async function fetchMetadata(videoId) {
    try {
        const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
        const data = await response.json();
        const shortStatus = await isShort(videoId);

        // Convert "YYYY-MM-DD" or similar to timestamp
        let publishedAt = 0;
        if (data.upload_date) {
            publishedAt = new Date(data.upload_date).getTime();
        }

        return {
            title: data.title || "Unknown Title",
            author: data.author_name || "Unknown Artist",
            isShort: shortStatus || (data.title && data.title.toLowerCase().includes('#shorts')),
            publishedAt: publishedAt
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
                        author: videoData.shortBylineText?.runs[0]?.text || "Unknown Artist",
                        playCount: 0,
                        addedAt: Date.now(),
                        publishedAt: 0 // Playlist API doesn't always provide full date easily, will fetch on play if needed or leave as 0
                    };
                }));

                let skipCount = 0;
                const validItems = processed.filter(i => {
                    if (i === "SKIP") {
                        skipCount++;
                        return false;
                    }
                    return i;
                });
                return { items: validItems, skipCount: skipCount };
            }
        }
    } catch (e) {
        console.error("Playlist fetch failed", e);
    }
    return null;
}

async function addToQueue(urlOrId, title, author) {
    if (queue.length >= MAX_QUEUE) {
        alert("Queue full (Max 32767)");
        return;
    }

    const playlistId = extractPlaylistId(urlOrId);
    if (playlistId) {
        const result = await fetchPlaylistItems(playlistId);
        if (result && result.items && result.items.length > 0) {
            for (const item of result.items) {
                if (queue.length < MAX_QUEUE) {
                    queue.push(item);
                }
            }
            renderQueue();
            if (currentIndex === -1) playIndex(0);
            if (result.skipCount > 0) {
                alert(`${result.skipCount}件が除外されました！（ショート動画または縦長動画）`);
            }
            return;
        }
    }

    const id = extractId(urlOrId);
    if (!id) {
        alert("Invalid URL or ID");
        return;
    }
    if (id === "SHORT_DETECTED") {
        alert("ショート動画は再生リストに追加できません。");
        return;
    }

    let finalTitle = title;
    let finalAuthor = author;

    const tempSong = {
        id: id,
        title: finalTitle || "読み込み中...",
        author: finalAuthor || "...",
        playCount: 0,
        addedAt: Date.now(),
        publishedAt: 0
    };
    queue.push(tempSong);
    const itemIdx = queue.length - 1;
    renderQueue();

    if (!finalTitle || !finalAuthor) {
        const meta = await fetchMetadata(id);
        if (meta) {
            if (meta.isShort) {
                queue.splice(itemIdx, 1);
                renderQueue();
                alert("ショート動画（縦長または#shortsを含む）を検出したため、除外しました。");
                return;
            }
            if (!finalTitle) queue[itemIdx].title = meta.title;
            if (!finalAuthor) queue[itemIdx].author = meta.author;
            queue[itemIdx].publishedAt = meta.publishedAt;
            renderQueue();
            if (currentIndex === itemIdx) {
                el.nowTitle.value = queue[itemIdx].title;
                el.nowAuthor.value = queue[itemIdx].author;
            }
        }
    }

    if (currentIndex === -1) {
        playIndex(0);
    }
}

function renderQueue() {
    el.queueList.innerHTML = '';

    queue.forEach((item, idx) => {
        const li = document.createElement('li');
        li.className = 'queue-item';
        if (idx === currentIndex) li.classList.add('active');
        if (idx === selectedListIndex) li.classList.add('selected');

        li.innerHTML = `
            <span class="q-idx">${idx + 1}</span>
            <div class="q-info">
                <span class="q-title">${safeHtml(item.title)}</span>
                <span class="q-author">${safeHtml(item.author)}</span>
            </div>
        `;

        li.onclick = (e) => {
            selectedListIndex = idx;
            renderQueue();
        };
        li.ondblclick = () => {
            playIndex(idx);
        };

        el.queueList.appendChild(li);
    });

    el.queueStatus.innerText = `${queue.length} / ${MAX_QUEUE}`;
}

function playIndex(idx) {
    if (idx < 0 || idx >= queue.length) return;
    currentIndex = idx;
    const item = queue[idx];

    // Play Count increment
    item.playCount = (item.playCount || 0) + 1;

    if (isPlayerReady) {
        player.loadVideoById(item.id);
    }

    el.nowTitle.value = item.title;
    el.nowAuthor.value = item.author;

    renderQueue();
    setTimeout(() => {
        const activeEl = document.querySelector('.queue-item.active');
        if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

// Editing
el.nowTitle.addEventListener('input', () => {
    if (currentIndex >= 0 && currentIndex < queue.length) {
        queue[currentIndex].title = el.nowTitle.value;
        const activeTitle = document.querySelector('.queue-item.active .q-title');
        if (activeTitle) activeTitle.innerText = el.nowTitle.value;
    }
});

el.nowAuthor.addEventListener('input', () => {
    if (currentIndex >= 0 && currentIndex < queue.length) {
        queue[currentIndex].author = el.nowAuthor.value;
        const activeAuthor = document.querySelector('.queue-item.active .q-author');
        if (activeAuthor) activeAuthor.innerText = el.nowAuthor.value;
    }
});

// Controls
function skipNext() {
    if (isLoop) {
        playIndex(currentIndex);
        return;
    }
    if (isShuffle && queue.length > 1) {
        let next = currentIndex;
        while (next === currentIndex) {
            next = Math.floor(Math.random() * queue.length);
        }
        playIndex(next);
        return;
    }
    if (currentIndex < queue.length - 1) {
        playIndex(currentIndex + 1);
    } else {
        player.stopVideo();
    }
}

function skipPrev() {
    if (currentIndex > 0) {
        playIndex(currentIndex - 1);
    } else {
        if (isPlayerReady) player.seekTo(0);
    }
}

function safeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function removeSelected() {
    if (selectedListIndex >= 0 && selectedListIndex < queue.length) {
        queue.splice(selectedListIndex, 1);
        if (currentIndex === selectedListIndex) {
            if (queue.length > 0) {
                if (currentIndex >= queue.length) currentIndex = queue.length - 1;
                playIndex(currentIndex);
            } else {
                player.stopVideo();
                currentIndex = -1;
            }
        } else if (currentIndex > selectedListIndex) {
            currentIndex--;
        }
        selectedListIndex = -1;
        renderQueue();
    }
}

// Button Events
document.getElementById('btn-delete').onclick = removeSelected;

document.getElementById('btn-dedupe').onclick = () => {
    const seen = new Set();
    const originalCount = queue.length;
    const currentId = currentIndex >= 0 ? queue[currentIndex].id : null;

    queue = queue.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });

    if (currentId) currentIndex = queue.findIndex(i => i.id === currentId);
    else currentIndex = -1;

    renderQueue();
    alert(`${originalCount - queue.length}件の重複を除去しました。`);
};

document.getElementById('sort-select').onchange = (e) => {
    const mode = e.target.value;
    const currentId = currentIndex >= 0 ? queue[currentIndex].id : null;

    if (mode === 'popular') {
        queue.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
    } else if (mode === 'recent') {
        queue.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    } else if (mode === 'published') {
        queue.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
    }

    if (currentId) currentIndex = queue.findIndex(i => i.id === currentId);
    renderQueue();
};

document.getElementById('btn-clear').onclick = () => {
    if (confirm("Queueをすべて削除しますか？")) {
        queue = []; currentIndex = -1; selectedListIndex = -1;
        if (isPlayerReady) player.stopVideo();
        renderQueue();
    }
};

document.getElementById('btn-add').addEventListener('click', () => {
    addToQueue(el.addUrl.value, el.addTitle.value, el.addAuthor.value);
    el.addUrl.value = ''; el.addTitle.value = ''; el.addAuthor.value = '';
});

// Lock Logic
function startLockTimer() {
    lockStartTime = Date.now();
    el.lockProgress.style.width = '0%'; el.lockProgress.style.display = 'block';
    if (lockTimer) clearInterval(lockTimer);
    lockTimer = setInterval(() => {
        const elapsed = Date.now() - lockStartTime;
        const progress = Math.min((elapsed / 4000) * 100, 100);
        el.lockProgress.style.width = progress + '%';
        if (elapsed >= 4000) {
            clearInterval(lockTimer); toggleLock();
            el.lockProgress.style.width = '0%'; lockTimer = null;
        }
    }, 50);
}

function stopLockTimer() {
    if (lockTimer) { clearInterval(lockTimer); lockTimer = null; }
    el.lockProgress.style.width = '0%'; el.lockProgress.style.display = 'none';
}

function toggleLock() {
    isLocked = !isLocked;
    if (isLocked) el.lockOverlay.classList.add('active');
    else el.lockOverlay.classList.remove('active');
}

el.btnLock.onmousedown = startLockTimer; el.btnLock.onmouseup = stopLockTimer; el.btnLock.onmouseleave = stopLockTimer;
el.btnLock.ontouchstart = (e) => { e.preventDefault(); startLockTimer(); }; el.btnLock.ontouchend = stopLockTimer;
el.lockOverlay.onmousedown = startLockTimer; el.lockOverlay.onmouseup = stopLockTimer; el.lockOverlay.onmouseleave = stopLockTimer;
el.lockOverlay.ontouchstart = (e) => { e.preventDefault(); startLockTimer(); }; el.lockOverlay.ontouchend = stopLockTimer;

document.getElementById('btn-prev').onclick = () => !isLocked && skipPrev();
document.getElementById('btn-next').onclick = () => !isLocked && skipNext();
document.getElementById('btn-pause').onclick = () => {
    if (isLocked || !isPlayerReady) return;
    if (player.getPlayerState() === 1) player.pauseVideo();
    else player.playVideo();
};
document.getElementById('btn-stop').onclick = () => !isLocked && isPlayerReady && player.stopVideo();
document.getElementById('btn-seek-back').onclick = () => !isLocked && isPlayerReady && player.seekTo(player.getCurrentTime() - 2);
document.getElementById('btn-seek-fwd').onclick = () => !isLocked && isPlayerReady && player.seekTo(player.getCurrentTime() + 2);
document.getElementById('btn-first').onclick = () => !isLocked && playIndex(0);
document.getElementById('btn-last').onclick = () => !isLocked && playIndex(queue.length - 1);

function toggleLoop() {
    isLoop = !isLoop;
    el.btnLoop.style.background = isLoop ? 'var(--primary)' : 'var(--bg-item)';
    el.btnLoop.innerHTML = 'Loop<small>Q</small>';
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    el.btnShuffle.style.background = isShuffle ? 'var(--primary)' : 'var(--bg-item)';
}

el.btnLoop.onclick = () => !isLocked && toggleLoop();
el.btnShuffle.onclick = () => !isLocked && toggleShuffle();

document.getElementById('btn-export').onclick = () => {
    const data = JSON.stringify(queue, null, 2);
    const blob = new Blob([data], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'playlist.txt'; a.click();
};

document.getElementById('btn-import').onclick = () => { el.fileInput.click(); };
el.fileInput.onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            if (Array.isArray(data)) {
                queue = data.slice(0, MAX_QUEUE); currentIndex = -1; renderQueue();
                if (queue.length > 0) playIndex(0);
                alert("Imported " + queue.length + " songs.");
            } else alert("Invalid format.");
        } catch (err) { alert("Error parsing file."); }
    };
    reader.readAsText(file);
};

// Keyboard
document.addEventListener('keydown', (e) => {
    if (isLocked) return;
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const code = e.key.toLowerCase();
    if (code === 's') skipPrev();
    if (code === 'k') skipNext();
    if (code === 'f') isPlayerReady && player.seekTo(player.getCurrentTime() - 2);
    if (code === 'h') isPlayerReady && player.seekTo(player.getCurrentTime() + 2);
    if (code === 'g') { if (isPlayerReady) { if (player.getPlayerState() === 1) player.pauseVideo(); else player.playVideo(); } }
    if (code === 'o') isPlayerReady && player.stopVideo();
    if (code === 'd') playIndex(0);
    if (code === 'j') playIndex(queue.length - 1);
    if (code === 'q') toggleLoop();
    if (code === 'w') toggleShuffle();
    if (code === '[') {
        if (selectedListIndex >= 0 && selectedListIndex < queue.length) {
            const item = queue[selectedListIndex];
            if (queue.length < MAX_QUEUE) {
                queue.splice(selectedListIndex + 1, 0, { ...item, addedAt: Date.now() });
                renderQueue();
            }
        } else document.getElementById('btn-add').click();
    }
    if (code === ']') removeSelected();
    if (['1', '2', '3', '4', '5'].includes(e.key)) {
        const diff = parseInt(e.key) - 6;
        const target = currentIndex + diff;
        if (target >= 0) playIndex(target);
    }
    if (['6', '7', '8', '9', '0'].includes(e.key)) {
        let val = parseInt(e.key); if (val === 0) val = 10;
        const diff = val - 5;
        const target = currentIndex + diff;
        if (target < queue.length) playIndex(target);
    }
});
