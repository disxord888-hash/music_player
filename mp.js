// Yuki Player Logic - Performance Optimized

// Clear any persistent storage to respect user request - No data left behind
try {
    localStorage.clear();
    sessionStorage.clear();
    // Clear cookies if possible (limited by subdomain/security)
    document.cookie.split(";").forEach((c) => {
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
} catch (e) { }

// State
let queue = [];
let currentIndex = -1;
let selectedListIndex = -1;
let selectedIndices = new Set();
let selectionAnchor = -1;
let alarmConfig = { enabled: false, time: '', target: '', triggered: false };
let player = null;
let scWidget = null;
let vimeoPlayer = null;
let isPlayerReady = false;
let isLocked = false;
let lockTimer = null;
let lockStartTime = 0;
let isLoop = false;
let isQueueLoop = false;
let isShuffle = false;
let isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
let importedFileNames = new Set();
let lastVolumeBeforeMute = 100;
let tPrefixCount = 0;
let yPrefixCount = 0;
let isSlashKeyPrefixActive = false;
let isBackslashPressed = false; // \ (\) state for offset seek
let isSlashPressed = false; // / state for offset seek
let imageStartTime = 0; // For seeking in images/GIFs
let heldKeysMap = new Map(); // For keyboard monitor
let isShortcutDisplayEnabled = false;
let isShortVideoAllowed = false; // Toggle for allowing #shorts
let escPrefix = false;

// Helpers
function safe(str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
}

function decodeChars(s) {
    if (!s) return "";
    return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\u0026/g, '&')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'");
}

// Vocaloid曲キャッシュ（動的取得用）
let vocaloidCache = [];
let vocaloidCacheTime = 0;
const VOCALOID_CACHE_DURATION = 30 * 60 * 1000; // 30分キャッシュ

// Vocaloardから動的に曲を取得
async function fetchVocaloidSongs() {
    const now = Date.now();
    // キャッシュが有効ならそれを使う
    if (vocaloidCache.length > 0 && (now - vocaloidCacheTime) < VOCALOID_CACHE_DURATION) {
        return vocaloidCache;
    }

    try {
        // ランダムなページを選択（1-6）
        const randomPage = Math.floor(Math.random() * 6) + 1;
        const urls = [
            `https://vocaloard.injpok.tokyo/?s=2&g=${randomPage}`,
            `https://vocaloard.injpok.tokyo/?s=1&g=${randomPage}`,
            `https://vocaloard.injpok.tokyo/?s=3&g=${randomPage}`
        ];
        const url = urls[Math.floor(Math.random() * urls.length)];

        // CORSプロキシを使用
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);
        const data = await response.json();
        const html = data.contents;

        // プレイリストURLからビデオIDを抽出
        const playlistMatch = html.match(/watch_videos\?video_ids=([^"&]+)/);
        if (playlistMatch) {
            const ids = playlistMatch[1].split(',').filter(id => id.length === 11);
            vocaloidCache = ids.map(id => ({ id, title: 'Loading...', author: 'Vocaloid' }));
            vocaloidCacheTime = now;
            return vocaloidCache;
        }

        // 個別リンクからも抽出を試みる
        const linkMatches = html.matchAll(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/g);
        const ids = [...new Set([...linkMatches].map(m => m[1]))];
        if (ids.length > 0) {
            vocaloidCache = ids.map(id => ({ id, title: 'Loading...', author: 'Vocaloid' }));
            vocaloidCacheTime = now;
            return vocaloidCache;
        }
    } catch (e) {
        console.warn('Vocaloard fetch failed:', e);
    }

    // フォールバック: 静的リスト
    return [
        { id: "bB7XYri8O4c", title: "千本桜", author: "黒うさP" },
        { id: "1urGM6LFpQ", title: "メルト", author: "ryo" },
        { id: "Mqps4anhz0Q", title: "ワールドイズマイン", author: "ryo" },
        { id: "HOz-9FzIDf0", title: "マトリョシカ", author: "ハチ" },
        { id: "Ej8EaLF382c", title: "砂の惑星", author: "ハチ" },
        { id: "e-U0Yb0c-50", title: "シャルル", author: "バルーン" },
        { id: "dJf4wCdLU18", title: "ロキ", author: "みきとP" },
        { id: "hxSg2Ioz3LM", title: "ダブルラリアット", author: "アゴアニキP" },
        { id: "gcS04BI2sbk", title: "ローリンガール", author: "wowaka" },
        { id: "L5guLvJhxi4", title: "アンノウン・マザーグース", author: "wowaka" },
        { id: "Ahq6qe_kBYg", title: "KING", author: "Kanaria" },
        { id: "dHXC_ahjtEE", title: "酔いどれ知らず", author: "Kanaria" },
        { id: "-wNRC69Ypco", title: "ヒバナ", author: "DECO*27" },
        { id: "HOz-9FzIDf0", title: "ゴーストルール", author: "DECO*27" },
        { id: "Njd3RTSu5jk", title: "ラビットホール", author: "DECO*27" },
        { id: "fJjD7rqcLqY", title: "ヴァンパイア", author: "DECO*27" },
        { id: "iP1EAgXd42s", title: "たびだちのうた", author: "烏屋茶房" },
        { id: "STBoCK69vVQ", title: "スポットレイト", author: "稲葉曇" },
        { id: "cF91xil98Mc", title: "CONNECT:COMMUNE", author: "FLAVOR FOLEY" },
        { id: "w44WoaDCFJQ", title: "KAWAII100%", author: "めろくる" },
        { id: "lccaBSbyAs8", title: "プシュケー", author: "wotaku" },
        { id: "FvOpPeKSf_4", title: "強風オールバック", author: "ゆこぴ" },
        { id: "r80-XbeMvC8", title: "可愛くてごめん", author: "HoneyWorks" },
        { id: "egcUvLgE1dU", title: "神っぽいな", author: "ピノキオピー" },
        { id: "xPSEPhkPRkY", title: "すろぉもぉしょん", author: "ピノキオピー" },
        { id: "OxmHkzkRV9Q", title: "ノンブレス・オブリージュ", author: "ピノキオピー" },
        { id: "7g6PN7JfpGE", title: "転生林檎", author: "ピノキオピー" },
        { id: "TBREQMI_MdU", title: "フォニイ", author: "ツミキ" },
        { id: "HXmOr3cXcqI", title: "トンデモワンダーズ", author: "sasakure.UK" },
        { id: "OvE_0Tq7Q_k", title: "ビターチョコデコレーション", author: "syudou" },
        { id: "kzOhbI1uGv8", title: "キュートなカノジョ", author: "syudou" },
        { id: "9Xzs_TG9LI8", title: "命に嫌われている", author: "カンザキイオリ" }
    ];
}

// Time tracking
let cumulativeSeconds = 0;
let lastKnownTime = 0;
let timeUpdateInterval = null;

// Audio Context & Effects
let audioCtx = null;

const MAX_QUEUE = 32767;

// Tier ranking order (higher index = better tier)
const TIER_ORDER = ['Fail', '-', '×', '△', '＊', '＊＊', '＊＊＊', '＊＊＊＊', '＊＊＊＊＊', '＊＊＊＊＊＊', '💯'];

// Tier theme colors
const TIER_THEMES = {
    '💯': { primary: '#ff00ff', light: '#ffccff', accent: '#880088', contrast: '#fff' }, // 100: Rainbow/Magenta
    '＊＊＊＊＊＊': { primary: '#990000', light: '#cc0000', accent: '#660000', contrast: '#fff' }, // 6: 濃紅
    '＊＊＊＊＊': { primary: '#ff0000', light: '#ff4d4d', accent: '#cc0000', contrast: '#fff' }, // 5: 赤
    '＊＊＊＊': { primary: '#ffa500', light: '#ffc04d', accent: '#cc8400', contrast: '#fff' }, // 4: オレンジ
    '＊＊＊': { primary: '#fbbf24', light: '#fef3c7', accent: '#92400e', contrast: '#000' }, // 3: 黄色
    '＊＊': { primary: '#9ad82e', light: '#bef264', accent: '#65a30d', contrast: '#000' }, // 2: 黄緑
    '＊': { primary: '#3b82f6', light: '#93c5fd', accent: '#1d4ed8', contrast: '#fff' }, // 1: 青
    '△': { primary: '#8b5cf6', light: '#a78bfa', accent: '#f43f5e', contrast: '#fff' },
    '×': { primary: '#475569', light: '#94a3b8', accent: '#1e293b', contrast: '#fff' },
    '-': { primary: '#333333', light: '#555555', accent: '#222222', contrast: '#fff' },
    'Fail': { primary: '#000000', light: '#333333', accent: '#000000', contrast: '#fff' },
    '': { primary: '#475569', light: '#94a3b8', accent: '#1e293b', contrast: '#fff' }
};

function applyTierTheme(tier) {
    const theme = TIER_THEMES[tier] || TIER_THEMES[''];
    const root = document.documentElement;
    root.style.setProperty('--primary', theme.primary);
    root.style.setProperty('--primary-light', theme.light);
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--on-primary', theme.contrast);

    // Choose active background opacity and text color based on contrast
    const isActiveLight = theme.contrast === '#000';
    const activeAlpha = isActiveLight ? 0.8 : 0.25;
    const activeText = isActiveLight ? '#000' : 'var(--text-main)';
    root.style.setProperty('--on-active-text', activeText);

    // Convert hex to rgba for active background
    const hexToRgba = (hex, alpha) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };
    root.style.setProperty('--active-bg', hexToRgba(theme.primary, activeAlpha));

    // Also update progress bar directly for immediate effect
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) {
        progressBar.style.background = theme.primary;
        progressBar.style.boxShadow = `0 0 15px ${theme.primary}`;
    }

    console.log('Theme applied:', tier, theme);
}

function getTierRank(tier) {
    if (!tier) return -1; // No tier = lowest priority
    const idx = TIER_ORDER.indexOf(tier);
    return idx >= 0 ? idx : -1;
}

// DOM Elements
const el = {
    nowTitle: document.getElementById('now-title'),
    nowTier: document.getElementById('now-tier'),
    nowAuthor: document.getElementById('now-author'),
    nowMemo: document.getElementById('now-memo'),
    queueList: document.getElementById('queue-list'),
    queueStatus: document.getElementById('queue-status'),
    addUrl: document.getElementById('add-url'),
    addTitle: document.getElementById('add-title'),
    addAuthor: document.getElementById('add-author'),
    addMemo: document.getElementById('add-memo'),
    addTier: document.getElementById('add-tier'),
    sortMode: document.getElementById('sort-mode'),
    fileInput: document.getElementById('file-input'),
    lockOverlay: document.getElementById('lock-overlay'),
    lockProgress: document.getElementById('lock-progress'),
    btnLock: document.getElementById('btn-lock'),
    btnLoop: document.getElementById('btn-loop'),
    btnQueueLoop: document.getElementById('btn-queue-loop'),
    btnShuffle: document.getElementById('btn-shuffle'),
    currentTime: document.getElementById('current-time'),
    duration: document.getElementById('duration'),
    cumulativeTime: document.getElementById('cumulative-time'),
    nowId: document.getElementById('now-id'),
    progressBar: document.getElementById('progress-bar'),
    progressContainer: document.getElementById('progress-container'),
    lockCircles: document.querySelectorAll('.lock-fg-circle'),
    volumeSlider: document.getElementById('volume-slider'),
    volumeInput: document.getElementById('volume-input'),
    helpBtn: document.getElementById('help-btn'),
    helpModal: document.getElementById('help-modal'),
    heldKeysIndicator: document.getElementById('held-keys-indicator'),
    presetSelect: document.getElementById('preset-select'),
    localThumb: null // For dynamically assigned local thumbnail
};
const announcementTimes = document.querySelectorAll('.ann-time');
const announcementMsgs = document.querySelectorAll('.ann-msg');

function updateUIStates() {
    el.btnLoop.style.background = isLoop ? 'var(--primary)' : 'var(--bg-item)';
    el.btnQueueLoop.style.background = isQueueLoop ? 'var(--primary)' : 'var(--bg-item)';
    el.btnShuffle.style.background = isShuffle ? 'var(--primary)' : 'var(--bg-item)';
}

// --- YouTube API ---
function onYouTubeIframeAPIReady() {
    player = new YT.Player('youtube-player', {
        height: '100%', width: '100%', videoId: '',
        playerVars: {
            'playsinline': 1,
            'controls': 1,
            'disablekb': 1,
            'iv_load_policy': 3,
            'origin': window.location.origin,
            'autoplay': 1
        },
        events: {
            'onReady': (e) => {
                isPlayerReady = true;
                startTimeUpdates();
            },
            'onStateChange': (e) => {
                if (e.data === YT.PlayerState.ENDED) skipNext();
                if (e.data === YT.PlayerState.PLAYING) syncCurrentInfo();
            },
            'onError': (e) => {
                // エラーコード: 2=無効なパラメータ, 5=HTML5エラー, 100=動画が見つからない, 101/150=埋め込み禁止
                console.warn('YouTube Player Error:', e.data, 'for index:', currentIndex);
                if (currentIndex >= 0 && currentIndex < queue.length) {
                    const failedItem = queue[currentIndex];
                    console.log('Removing failed video:', failedItem.id, failedItem.title);
                    // 現在の曲を削除して次へ
                    queue.splice(currentIndex, 1);
                    if (queue.length > 0) {
                        // インデックスが範囲外にならないように調整
                        currentIndex = Math.min(currentIndex, queue.length - 1);
                        renderQueue();
                        playIndex(currentIndex);
                    } else {
                        currentIndex = -1;
                        renderQueue();
                        el.nowTitle.value = "";
                        el.nowAuthor.value = "";
                    }
                }
            }
        }
    });
}

function startTimeUpdates() {
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);
    timeUpdateInterval = setInterval(() => {
        if (currentIndex >= 0 && queue[currentIndex]) {
            const type = queue[currentIndex].type;
            if (type === 'soundcloud' || type === 'vimeo' || type === 'file') return;
        }
        if (!isPlayerReady || !player || typeof player.getCurrentTime !== 'function') return;

        const cur = player.getCurrentTime();
        const dur = player.getDuration();
        const nowMs = Date.now();

        // Standard Time Update
        el.currentTime.innerText = formatTime(cur);
        el.duration.innerText = formatTime(dur);
        el.cumulativeTime.innerText = formatCumulative(cumulativeSeconds);

        // Update Progress Bar
        if (dur > 0) {
            const pct = (cur / dur) * 100;
            el.progressBar.style.width = pct + '%';

            // Update Mini Progress Bar in Queue
            const mini = document.getElementById(`mini-progress-${currentIndex}`);
            if (mini) mini.style.width = pct + '%';

            // Save state
            if (currentIndex >= 0 && queue[currentIndex]) {
                queue[currentIndex].lastTime = cur;
                queue[currentIndex].duration = dur; // 長さを保存しておく
            }
        }

        // Auto-sync Info
        if (player.getPlayerState() === YT.PlayerState.PLAYING) {
            syncCurrentInfo();
            const diff = cur - lastKnownTime;
            if (diff > 0 && diff < 2) {
                cumulativeSeconds += diff;
            }
        }
        lastKnownTime = cur;
    }, 16);
}

function syncCurrentInfo() {
    if (currentIndex >= 0 && queue[currentIndex]) {
        const item = queue[currentIndex];

        // Fallback: If title is Loading or Video(ID), try getting from player
        if ((!item.type || item.type === 'youtube') && isPlayerReady && player && typeof player.getVideoData === 'function') {
            const data = player.getVideoData();
            if (data && data.title && (item.title === "Loading..." || item.title.startsWith("Video ("))) {
                item.title = data.title;
                item.author = data.author || item.author;
                renderQueue(); // Update list display
            }
        }

        // Only update if values are different to avoid flickering cursor
        const displayTitle = (item.tier && item.tier !== '-') ? `[${item.tier}] ${item.title}` : item.title;
        if (el.nowTitle.value !== displayTitle && document.activeElement !== el.nowTitle) {
            el.nowTitle.value = displayTitle;
        }
        if (el.nowAuthor.value !== item.author && document.activeElement !== el.nowAuthor) {
            el.nowAuthor.value = item.author;
        }
        if (el.nowMemo && el.nowMemo.value !== (item.memo || "") && document.activeElement !== el.nowMemo) {
            el.nowMemo.value = item.memo || "";
            autoResize(el.nowMemo);
        }

        let displayUrl = shortenUrl(item.id);
        if (item.type === 'soundcloud') displayUrl = item.id;

        if (el.nowId.value !== displayUrl && document.activeElement !== el.nowId) {
            el.nowId.value = displayUrl;
        }

        if (el.nowTier && el.nowTier.value !== (item.tier || "")) {
            el.nowTier.value = item.tier || "";
        }
    }
}

function formatTime(s) {
    if (isNaN(s) || s < 0) s = 0;
    const days = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    const cs = Math.floor((s * 100) % 100);

    const padded = (n) => String(n).padStart(2, '0');
    return `${padded(days)}Days ${padded(h)}:${padded(m)}:${padded(secs)}.${padded(cs)}`;
}

function formatCumulative(s) {
    return formatTime(s);
}

// ユーティリティ: 時間文字列を秒数(float)に変換
// サポート形式: "m:s.cs", "m:s", "s.cs", "s"
// 例: "1:23.45" -> 83.45秒
function parseTimeToSeconds(str) {
    if (!str) return 0;
    const parts = str.split(':');
    let s = 0;
    if (parts.length === 3) {
        s += parseInt(parts[0]) * 3600;
        s += parseInt(parts[1]) * 60;
        s += parseFloat(parts[2]);
    } else if (parts.length === 2) {
        s += parseInt(parts[0]) * 60;
        s += parseFloat(parts[1]);
    } else {
        s += parseFloat(parts[0]);
    }
    return s;
}

// --- Utilities ---
function shortenUrl(u) {
    const id = extractId(u);
    return id ? `https://www.youtube.com/watch?v=${id}` : u;
}

function extractId(u) {
    if (!u) return null;
    if (u.length === 11) return u;
    if (u.includes('/shorts/')) return u.split('/shorts/')[1]?.split(/[?&]/)[0];
    const m = u.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|music\.youtube\.com\/watch\?v=)([^#&?]*).*/);
    return (m && m[2].length === 11) ? m[2] : null;
}

async function isStrictlyShort(id) {
    return new Promise((res) => {
        const i = new Image();
        i.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        i.onload = () => res(i.width > 0 && i.width < i.height);
        i.onerror = () => res(false);
    });
}

async function getMetaData(id) {
    if (!id) return { title: "Invalid ID", author: "YouTube Video", isShort: false };

    return new Promise((resolve) => {
        const callbackName = 'yt_meta_' + Math.floor(Math.random() * 1000000);
        const script = document.createElement('script');

        const timeout = setTimeout(() => {
            if (window[callbackName]) {
                delete window[callbackName];
                if (script.parentNode) script.parentNode.removeChild(script);
                console.warn("Metadata timeout for:", id);
                resolve({ title: `Video (${id})`, author: "YouTube Video", isShort: false });
            }
        }, 5000);

        window[callbackName] = (data) => {
            clearTimeout(timeout);
            if (script.parentNode) script.parentNode.removeChild(script);
            delete window[callbackName];

            const title = data.title || `Video (${id})`;
            const author = data.author_name || "YouTube Artist";
            resolve({ title, author, isShort: (title.toLowerCase().includes('#shorts')) });
        };

        script.src = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}&callback=${callbackName}`;
        document.body.appendChild(script);
    });
}

async function searchYoutube(query) {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    // 試行するプロキシリスト
    const proxies = [
        url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
        url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
        url => `https://thingproxy.freeboard.io/fetch/${url}`
    ];

    let html = null;

    for (const getProxyUrl of proxies) {
        try {
            const proxyUrl = getProxyUrl(searchUrl);
            const response = await fetch(proxyUrl);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            // AllOriginsはJSONでラップされているが、他はテキストを直接返す場合がある
            if (proxyUrl.includes('allorigins.win')) {
                const data = await response.json();
                html = data.contents;
            } else {
                html = await response.text();
            }

            if (html && html.includes('videoRenderer')) break; // 成功
        } catch (e) {
            console.warn(`Proxy ${getProxyUrl.name || 'alternative'} failed:`, e);
            continue;
        }
    }

    if (!html) {
        console.error('All proxies failed for YouTube search');
        return [];
    }

    try {
        const results = [];
        // Find all videoRenderer starts
        const videoMatches = [...html.matchAll(/"videoRenderer"\s*:\s*\{/g)];
        const indices = videoMatches.map(m => m.index);

        for (let i = 0; i < indices.length; i++) {
            const start = indices[i];
            const end = (i < indices.length - 1) ? indices[i + 1] : html.length;
            const block = html.substring(start, end);

            // Extract Video ID
            const idMatch = block.match(/"videoId"\s*:\s*"([^"]+)"/);
            if (!idMatch) continue;
            const id = idMatch[1];

            // Shorts Check
            if (block.includes('"overlayStyle":"SHORTS"') || block.includes('"style":"SHORTS"') || block.includes('video-shorts-')) continue;

            // Extract Title - looks for "text":"..." inside a "title":{...}
            let title = "Unknown Title";
            const tMatch = block.match(/"title"\s*:\s*\{.*?"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (tMatch) {
                title = decodeChars(tMatch[1]);
            }

            if (title.toLowerCase().includes('#shorts')) continue;

            // Extract Author - looks for "text":"..." inside byline/owner keys
            let author = "Unknown Artist";
            const aMatch = block.match(/"(?:longBylineText|ownerText|shortBylineText|ownerTitle|bylineText)"\s*:\s*\{.*?"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (aMatch) {
                author = decodeChars(aMatch[1]);
            }

            results.push({ id, title, author });
            if (results.length >= 3) break;
        }

        // Fallback for ID only if nothing found
        if (results.length === 0) {
            const idMatches = [...html.matchAll(/"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/g)];
            const uniqueIds = [...new Set(idMatches.map(m => m[1]))].slice(0, 3);
            return uniqueIds.map(id => ({ id, title: `Video (${id})`, author: "YouTube" }));
        }

        return results;
    } catch (e) {
        console.warn('YouTube search parse failed:', e);
    }
    return [];
}

function showSearchSelectionModal(results, query, onSelect) {
    const modal = document.createElement('div');
    modal.className = 'help-modal active';
    modal.style.zIndex = "6000";

    let itemsHtml = results.map(item => `
        <div class="ts-list-item" onclick="this.parentElement.parentElement.parentElement.remove(); window.onSearchSelect('${item.id}', '${item.title.replace(/'/g, "\\'")}','${item.author.replace(/'/g, "\\'")}');">
            <img src="https://i.ytimg.com/vi/${item.id}/default.jpg" style="width:60px; height:auto; border-radius:4px;">
            <div style="flex:1; overflow:hidden;">
                <div class="q-title" style="white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${safe(item.title)}</div>
                <div class="q-author">${safe(item.author)}</div>
            </div>
        </div>
    `).join('');

    window.onSearchSelect = (id, title, author) => {
        onSelect({ id, title, author });
        delete window.onSearchSelect;
    };

    modal.innerHTML = `
        <div class="help-content ts-list-content" style="max-width:600px;">
            <h3 style="margin-bottom:1rem;">Search: "${safe(query)}"</h3>
            <div class="ts-list-container">${itemsHtml}</div>
            <button onclick="this.parentElement.parentElement.remove()" class="btn" style="margin-top:1rem; width:100%;">Cancel</button>
        </div>
    `;
    document.body.appendChild(modal);
}



function isSoundCloudUrl(u) {
    return u && u.includes('soundcloud.com/') && !u.includes('soundcloud.com/oembed');
}

async function getSoundCloudMeta(url) {
    try {
        const res = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`);
        const data = await res.json();
        return {
            title: data.title || "SoundCloud Track",
            author: data.author_name || "SoundCloud Artist",
            thumbnail: data.thumbnail_url
        };
    } catch (e) {
        console.warn("SoundCloud meta failed", e);
        return { title: "SoundCloud", author: "SoundCloud", thumbnail: null };
    }
}

function isVimeoUrl(u) {
    return u && (u.includes('vimeo.com/') || u.includes('player.vimeo.com/'));
}

function extractVimeoId(u) {
    if (!u) return null;
    // Match vimeo.com/123456789 or player.vimeo.com/video/123456789
    const m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return m ? m[1] : null;
}

async function getVimeoMeta(id) {
    try {
        const res = await fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${id}`);
        const data = await res.json();
        return {
            title: data.title || "Vimeo Video",
            author: data.author_name || "Vimeo User",
            thumbnail: data.thumbnail_url
        };
    } catch (e) {
        console.warn("Vimeo meta failed", e);
        return { title: "Vimeo Video", author: "Vimeo", thumbnail: null };
    }
}

// Updated regex to handle intl paths e.g. /intl-ja/track/...
function extractSpotifyId(u) {
    if (!u) return null;
    const m = u.match(/spotify\.com\/(?:[a-z]{2,4}-[a-z]{2,4}\/)?(track|episode)\/([a-zA-Z0-9]+)/);
    return m ? m[2] : null;
}

async function getSpotifyMeta(id) {
    try {
        const res = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${id}`);
        const data = await res.json();
        return {
            title: data.title || "Spotify Track",
            author: "Spotify Artist",
            thumbnail: data.thumbnail_url
        };
    } catch (e) {
        console.warn("Spotify meta failed", e);
        return { title: "Spotify Track", author: "Spotify", thumbnail: null };
    }
}

// --- Main ---

async function addToQueue(uOrId, tIn, aIn, memoIn, tierIn) {
    if (!uOrId) return;
    if (queue.length >= MAX_QUEUE) return;

    // もしURLでもIDでもない（プロンプト的な文字列）ならYouTube検索を試みる
    if (!isSoundCloudUrl(uOrId) && !isVimeoUrl(uOrId) && extractId(uOrId) === null && uOrId.length > 0 && !uOrId.startsWith('{')) {
        const btn = document.getElementById('btn-add');
        const originalText = btn ? btn.innerHTML : "";
        if (btn) btn.innerHTML = "🔍 Search...";

        const results = await searchYoutube(uOrId);
        if (btn) btn.innerHTML = originalText;

        if (results && results.length > 0) {
            showSearchSelectionModal(results, uOrId, (selected) => {
                addToQueue(selected.id, selected.title, selected.author, memoIn, tierIn);
            });
            return; // モーダルで選択されるまで待機（あるいはコールバックで再入）
        } else {
            alert("動画が見つかりませんでした: " + uOrId);
            return;
        }
    }

    // Handle JSON object input (for a single song)
    if (typeof uOrId === 'string' && uOrId.trim().startsWith('{')) {
        try {
            const data = JSON.parse(uOrId);
            const item = {
                id: data.id || "",
                type: data.type || "youtube",
                title: data.title || tIn || "Song",
                author: data.author || aIn || "Author",
                memo: data.memo || memoIn || "",
                tier: convertOldTierToNew(data.tier || tierIn || ""),
                lastTime: data.lastTime || 0,
                duration: data.duration || 0
            };
            if (item.id) {
                queue.push(item);
                const idx = queue.length - 1;
                renderQueue();
                if (currentIndex === -1) playIndex(idx);
                return idx;
            }
        } catch (e) {
            console.warn("JSON add failed", e);
        }
    }

    let type = 'youtube';
    // extractId is for YouTube
    let cleanId = extractId(uOrId);

    // Check SoundCloud
    if (isSoundCloudUrl(uOrId)) {
        cleanId = uOrId;
        type = 'soundcloud';
    } else if (isVimeoUrl(uOrId)) {
        cleanId = extractVimeoId(uOrId);
        type = 'vimeo';
    }
    // If neither, fallback to whatever extractId returned (YouTube)

    if (!cleanId) return;

    const tempItem = {
        id: cleanId,
        type: type,
        title: tIn || "Loading...",
        author: aIn || "...",
        memo: memoIn || "",
        tier: tierIn || "",
        lastTime: 0,
        thumbnail: null
    };
    queue.push(tempItem);
    const idx = queue.length - 1;
    renderQueue();

    // UIのURLを短縮表示（貼り付け直後などに反映）
    if (el.addUrl.value.includes(cleanId) || (type === 'soundcloud' && el.addUrl.value === cleanId)) {
        if (type === 'soundcloud') el.addUrl.value = cleanId;
        else if (type === 'vimeo') el.addUrl.value = `vimeo.com/${cleanId}`;
        else el.addUrl.value = shortenUrl(cleanId);
    }

    if (!tIn || !aIn) {
        if (type === 'soundcloud') {
            getSoundCloudMeta(cleanId).then(meta => {
                queue.forEach((it, qIdx) => {
                    if (it.id === cleanId && it.type === 'soundcloud') {
                        it.title = meta.title;
                        it.author = meta.author;
                        it.thumbnail = meta.thumbnail;
                        if (currentIndex === qIdx) {
                            el.nowTitle.value = (it.tier && it.tier !== '-') ? `[${it.tier}] ${it.title}` : it.title;
                            el.nowAuthor.value = it.author;
                        }
                    }
                });
                renderQueue();
            });
        } else if (type === 'vimeo') {
            getVimeoMeta(cleanId).then(meta => {
                queue.forEach((it, qIdx) => {
                    if (it.id === cleanId && it.type === 'vimeo') {
                        it.title = meta.title;
                        it.author = meta.author;
                        it.thumbnail = meta.thumbnail;
                        if (currentIndex === qIdx) {
                            el.nowTitle.value = (it.tier && it.tier !== '-') ? `[${it.tier}] ${it.title}` : it.title;
                            el.nowAuthor.value = it.author;
                        }
                    }
                });
                renderQueue();
            });
        } else {
            getMetaData(cleanId).then(meta => {
                // Short Video Check
                if (meta.isShort && !isShortVideoAllowed) {
                    queue = queue.filter(it => it.id !== cleanId);
                    renderQueue();
                    alert("ショート動画のため除外されました (Esc+Sで許可切替)");
                    return;
                }
                queue.forEach((it, qIdx) => {
                    if (it.id === cleanId) {
                        it.title = meta.title;
                        it.author = meta.author;
                        if (currentIndex === qIdx) {
                            el.nowTitle.value = (it.tier && it.tier !== '-') ? `[${it.tier}] ${it.title}` : it.title;
                            el.nowAuthor.value = it.author;
                        }
                    }
                });
                renderQueue();
                renderItemsActive();
            });
        }
    }
    if (currentIndex === -1) playIndex(idx);
}

function checkTouchDevice() {
    isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (isTouchDevice) {
        document.body.classList.add('mobile-ui');
    } else {
        document.body.classList.remove('mobile-ui');
    }
}

// 初期実行とリサイズ時に再確認
checkTouchDevice();
window.addEventListener('resize', checkTouchDevice);

function getTierBadgeHTML(tier) {
    if (!tier) return '';
    const tierClass = getTierColorClass(tier);
    return `<span class="tier-badge ${tierClass}">${tier}</span>`;
}

function getTierShortText(tier) {
    if (!tier || tier === '-') return "";
    if (tier === '💯') return '💯';
    if (tier.includes('＊')) {
        const count = (tier.match(/＊/g) || []).length;
        return count > 1 ? `＊x${count}` : '＊';
    }
    return tier;
}

function getTierColorClass(tier) {
    if (!tier || tier === '×') return 'tier-x';
    if (tier === '💯') return 'tier-100';
    if (tier === '＊＊＊＊＊＊') return 'tier-6';
    if (tier === '＊＊＊＊＊') return 'tier-5';
    if (tier === '＊＊＊＊') return 'tier-4';
    if (tier === '＊＊＊') return 'tier-3';
    if (tier === '＊＊') return 'tier-2';
    if (tier === '＊') return 'tier-1';
    if (tier === '△') return 'tier-0';
    if (tier === '-') return 'tier-minus';
    if (tier === 'Fail') return 'tier-fail';
    return '';
}


function renderQueue() {
    const frag = document.createDocumentFragment();
    el.queueList.innerHTML = '';
    queue.forEach((item, i) => {
        const li = document.createElement('li');
        li.className = `queue-item ${i === currentIndex ? 'active' : ''} ${selectedIndices.has(i) ? 'selected' : ''}`;
        li.setAttribute('data-idx', i);
        li.draggable = true;

        const isCurrent = (i === currentIndex);
        const thumbSrc = item.thumbnail || `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`;
        li.innerHTML = `
            <span class="q-idx">${isCurrent ? '▶' : i + 1}</span>
            <img class="q-thumb" src="${thumbSrc}" alt="thumb">
            <div class="q-info">
                <div class="q-title-row">
                    <span class="q-title">
                        ${item.tier && item.tier !== '-' ? `<span class="q-tier-label">${getTierShortText(item.tier)}</span> ` : ''}${safe(item.title)}
                    </span>
                </div>
                <span class="q-author">${safe(item.author)}</span>
                <div class="mini-progress-bg">
                    <div class="mini-progress-bar" id="mini-progress-${i}" style="width: 0%"></div>
                </div>
            </div>
            <div class="q-actions">
                <button class="action-btn download-btn" title="Export this song">📥</button>
                <button class="action-btn copy-btn" title="Copy">📋</button>
                <button class="action-btn del-btn" title="Delete">🗑️</button>
            </div>
        `;


        li.onclick = (e) => {
            if (e.target.closest('.action-btn')) return;

            if (e.shiftKey && selectionAnchor !== -1) {
                const start = Math.min(selectionAnchor, i);
                const end = Math.max(selectionAnchor, i);
                selectedIndices.clear();
                for (let j = start; j <= end; j++) {
                    selectedIndices.add(j);
                }
            } else {
                selectedIndices.clear();
                selectedIndices.add(i);
                selectionAnchor = i;
                selectedListIndex = i; // Keep this for editor context

                // Show info in editor for the clicked item
                const displayTitle = (item.tier && item.tier !== '-') ? `[${item.tier}] ${item.title}` : item.title;
                el.nowTitle.value = displayTitle;
                el.nowAuthor.value = item.author;
                if (el.nowMemo) el.nowMemo.value = item.memo || "";
                el.nowId.value = item.id;
                applyTierTheme(item.tier || '');
            }
            renderItemsActive();
        };
        li.ondblclick = (e) => {
            if (e.target.closest('.action-btn') || e.target.closest('.tier-inline-select')) return;
            playIndex(i);
        };

        li.querySelector('.download-btn').onclick = (e) => {
            e.stopPropagation();
            const format = selectExportFormat();
            if (format) exportItemToFile(i, format);
        };
        li.querySelector('.copy-btn').onclick = (e) => {
            e.stopPropagation();
            queue.splice(i + 1, 0, { ...queue[i] });
            renderQueue();
        };
        li.querySelector('.del-btn').onclick = (e) => {
            e.stopPropagation();
            deleteItemByIndex(i);
        };

        li.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', i);
            e.target.classList.add('dragging');
        };
        li.ondragend = (e) => e.target.classList.remove('dragging');
        li.ondragover = (e) => e.preventDefault();
        li.ondrop = (e) => {
            e.preventDefault();
            const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
            const toIdx = i;
            if (fromIdx !== toIdx) {
                const playingId = currentIndex >= 0 ? queue[currentIndex].id : null;
                const [movedItem] = queue.splice(fromIdx, 1);
                queue.splice(toIdx, 0, movedItem);
                currentIndex = playingId ? queue.findIndex(it => it.id === playingId) : -1;
                selectedListIndex = -1;
                renderQueue();
            }
        };

        frag.appendChild(li);
    });
    el.queueList.appendChild(frag);
    el.queueStatus.innerText = `${queue.length} / ${MAX_QUEUE}`;
}

function sortQueueByTier() {
    const playingId = currentIndex >= 0 ? queue[currentIndex].id : null;
    queue.sort((a, b) => {
        const rankA = getTierRank(a.tier);
        const rankB = getTierRank(b.tier);
        return rankB - rankA; // Higher tier first
    });
    currentIndex = playingId ? queue.findIndex(it => it.id === playingId) : -1;
    selectedListIndex = -1;
    renderQueue();
}

function deleteItemByIndex(idx) {
    const isRemovingCurrent = (idx === currentIndex);
    queue.splice(idx, 1);
    if (isRemovingCurrent) {
        if (queue.length > 0) {
            currentIndex = Math.min(idx, queue.length - 1);
            playIndex(currentIndex);
        } else {
            if (isPlayerReady) player.stopVideo();
            currentIndex = -1;
            el.nowTitle.value = ""; el.nowAuthor.value = "";
        }
    } else if (currentIndex > idx) {
        currentIndex--;
    }
    selectedListIndex = -1;
    renderQueue();
}

function renderItemsActive() {
    let activeLi = null;
    document.querySelectorAll('.queue-item').forEach((li, idx) => {
        const isActive = (idx === currentIndex);
        li.classList.toggle('active', isActive);
        li.classList.toggle('selected', selectedIndices.has(idx));

        // 再生マーク（三角）を確実に表示
        const qIdx = li.querySelector('.q-idx');
        if (qIdx) {
            qIdx.innerHTML = isActive ? '▶' : (idx + 1);
        }
        if (isActive) activeLi = li;
    });

    if (activeLi) {
        activeLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function playIndex(i) {
    if (i < 0 || i >= queue.length) return;
    currentIndex = i;
    const item = queue[i];
    lastKnownTime = item.lastTime || 0;
    const type = item.type || 'youtube';

    const ytContainer = document.getElementById('youtube-player');
    const scContainer = document.getElementById('soundcloud-player');
    const vimeoContainer = document.getElementById('vimeo-player');
    const localContainer = document.getElementById('local-player-container'); // Local

    // Reset displays
    if (ytContainer) ytContainer.style.display = 'none';
    scContainer.style.display = 'none';
    scContainer.innerHTML = '';
    vimeoContainer.style.display = 'none';
    vimeoContainer.innerHTML = '';
    if (localContainer) {
        localContainer.style.display = 'none';
        if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
            currentObjectUrl = null;
        }
        if (localVideo) { localVideo.pause(); localVideo.src = ""; }
        if (localImage) { localImage.src = ""; localImage.style.display = 'none'; }
        if (imageTimer) { clearTimeout(imageTimer); imageTimer = null; }
    }

    if (vimeoPlayer && typeof vimeoPlayer.destroy === 'function') {
        vimeoPlayer.destroy().catch(() => { });
    }
    vimeoPlayer = null;
    if (scWidget) scWidget = null;

    if (type === 'file') {
        if (!localContainer) initLocalPlayer(); // Ensure init
        document.getElementById('local-player-container').style.display = 'block';

        if (isPlayerReady && player && typeof player.stopVideo === 'function') player.stopVideo();

        const file = item.file;
        if (!file) {
            console.error("File object missing");
            return;
        }

        currentObjectUrl = URL.createObjectURL(file);

        if (item.isImage) {
            // WebP / Image
            if (localVideo) localVideo.style.display = 'none';
            if (localImage) {
                localImage.style.display = 'block';
                localImage.src = currentObjectUrl;
                localImage.style.zIndex = "10";

                // Timer for image duration
                lastKnownTime = 0;
                const dur = item.duration || 5;
                el.duration.innerText = formatTime(dur);

                imageStartTime = Date.now(); // Global for seeking

                const updateImageTime = () => {
                    if (currentIndex !== i) return;
                    const elapsed = (Date.now() - imageStartTime) / 1000;
                    el.currentTime.innerText = formatTime(elapsed);

                    const diff = elapsed - lastKnownTime;
                    if (diff > 0) cumulativeSeconds += diff;
                    lastKnownTime = elapsed;
                    el.cumulativeTime.innerText = formatCumulative(cumulativeSeconds);

                    const pct = Math.min(100, (elapsed / dur) * 100);
                    el.progressBar.style.width = pct + '%';

                    const mini = document.getElementById(`mini-progress-${currentIndex}`);
                    if (mini) mini.style.width = pct + '%';

                    if (elapsed >= dur) {
                        skipNext();
                    } else {
                        imageTimer = setTimeout(updateImageTime, 100);
                    }
                };
                updateImageTime();
            }
        } else {
            // Audio / Video
            if (localImage) {
                if (item.thumbnail) {
                    localImage.src = item.thumbnail;
                    localImage.style.display = 'block';
                    localImage.style.zIndex = "5"; // Below video if it has visual? No, audio-only will show this.
                } else {
                    localImage.style.display = 'none';
                }
            }
            if (localVideo) {
                localVideo.style.display = 'block';
                localVideo.src = currentObjectUrl;
                localVideo.style.zIndex = "10";
                localVideo.load();

                const vol = parseInt(el.volumeSlider.value) || 50;
                localVideo.volume = vol / 100;

                localVideo.play().catch(e => console.warn("Local play failed", e));
            }
        }
        el.nowId.value = item.title;

    } else if (type === 'vimeo') {
        if (isPlayerReady && player && typeof player.stopVideo === 'function') {
            player.stopVideo();
        }
        vimeoContainer.style.display = 'block';

        // Create Vimeo Player with responsive sizing
        try {
            vimeoPlayer = new Vimeo.Player(vimeoContainer, {
                id: item.id,
                autoplay: true,
                width: vimeoContainer.offsetWidth || 800,
                height: vimeoContainer.offsetHeight || 450
            });

            // Reset lastKnownTime to current item's start to ensure cumulative time starts correctly
            lastKnownTime = item.lastTime || 0;

            vimeoPlayer.on('loaded', () => {
                console.log('Vimeo Player Loaded');
                // iframeにtabindex="-1"を設定してキーボードフォーカスを防止
                const ifr = vimeoContainer.querySelector('iframe');
                if (ifr) ifr.setAttribute('tabindex', '-1');

                // Return focus to page so shortcuts work
                setTimeout(() => {
                    window.focus();
                    if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
                        document.body.focus();
                    }
                }, 100);

                const vol = parseInt(el.volumeSlider.value) || 50;
                vimeoPlayer.setVolume(vol / 100).catch(() => { });
                vimeoPlayer.play().catch(e => {
                    console.warn('Vimeo autoplay might be blocked:', e);
                });
            });

            vimeoPlayer.on('ended', () => {
                skipNext();
            });

            vimeoPlayer.on('timeupdate', (data) => {
                const cur = data.seconds;
                const dur = data.duration;

                if (isNaN(cur)) return;

                el.currentTime.innerText = formatTime(cur);
                if (dur > 0 && !isNaN(dur)) el.duration.innerText = formatTime(dur);

                // Cumulative Time Update
                const diff = cur - lastKnownTime;
                // Use a slightly larger threshold for Vimeo due to different event frequency
                if (diff > 0 && diff < 5) {
                    cumulativeSeconds += diff;
                }
                lastKnownTime = cur;
                el.cumulativeTime.innerText = formatCumulative(cumulativeSeconds);

                if (dur > 0 && !isNaN(dur)) {
                    const pct = (cur / dur) * 100;
                    el.progressBar.style.width = pct + '%';
                    const mini = document.getElementById(`mini-progress-${currentIndex}`);
                    if (mini) mini.style.width = pct + '%';

                    if (currentIndex >= 0 && queue[currentIndex]) {
                        queue[currentIndex].lastTime = cur;
                        queue[currentIndex].duration = dur;
                    }
                }
            });

            // Set volume
            const vol = parseInt(el.volumeSlider.value) || 50;
            vimeoPlayer.setVolume(vol / 100);

        } catch (e) {
            console.error("Vimeo Player Init Failed", e);
        }

        el.nowId.value = `vimeo.com/${item.id}`;

    } else if (type === 'soundcloud') {
        if (isPlayerReady && player && typeof player.stopVideo === 'function') {
            player.stopVideo();
        }
        lastKnownTime = item.lastTime || 0;
        scContainer.style.display = 'block';
        // Add ID="sc-iframe" and tabindex="-1"
        scContainer.innerHTML = `<iframe id="sc-iframe" tabindex="-1" width="100%" height="100%" scrolling="no" frameborder="no" allow="autoplay" src="https://w.soundcloud.com/player/?url=${encodeURIComponent(item.id)}&color=%23ff5500&auto_play=true&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true&visual=true"></iframe>`;

        // Init SC Widget
        try {
            const iframeElement = document.getElementById('sc-iframe');
            scWidget = SC.Widget(iframeElement);
            scWidget.bind(SC.Widget.Events.READY, () => {
                console.log('SC Widget Ready');
                // Return focus to page so shortcuts work
                setTimeout(() => {
                    window.focus();
                    if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
                        document.body.focus();
                    }
                }, 100);

                scWidget.play();
                // Set volume
                const vol = parseInt(el.volumeSlider.value);
                scWidget.setVolume(vol);
            });
            scWidget.bind(SC.Widget.Events.FINISH, () => {
                skipNext();
            });
            // Progress Update for SC
            scWidget.bind(SC.Widget.Events.PLAY_PROGRESS, (data) => {
                // data.currentPosition (ms)
                const cur = data.currentPosition / 1000;
                scWidget.getDuration(durMs => {
                    const dur = durMs / 1000;

                    // Update UI
                    el.currentTime.innerText = formatTime(cur);
                    if (dur > 0) el.duration.innerText = formatTime(dur);

                    // Cumulative Time Update for SC
                    const diff = cur - lastKnownTime;
                    if (diff > 0 && diff < 2) {
                        cumulativeSeconds += diff;
                    }
                    lastKnownTime = cur;
                    el.cumulativeTime.innerText = formatCumulative(cumulativeSeconds);

                    if (dur > 0) {
                        const pct = (cur / dur) * 100;
                        el.progressBar.style.width = pct + '%';
                        const mini = document.getElementById(`mini-progress-${currentIndex}`);
                        if (mini) mini.style.width = pct + '%';

                        // Save state
                        if (currentIndex >= 0 && queue[currentIndex]) {
                            queue[currentIndex].lastTime = cur;
                            queue[currentIndex].duration = dur;
                        }
                    }
                });
            });
        } catch (e) {
            console.error("SC Widget Init Failed", e);
        }

        el.nowId.value = item.id;

    } else {
        if (ytContainer) ytContainer.style.display = 'block';

        // 【再生時】終了の0.3秒前から終了+10sまでの間なら、最初から再生
        let startTime = item.lastTime || 0;
        const d = item.duration || 0;
        if (d > 0 && startTime >= d - 0.3 && startTime <= d + 10) {
            startTime = 0;
        }

        if (isPlayerReady) {
            player.loadVideoById({
                videoId: item.id,
                startSeconds: startTime
            });
        }
        el.nowId.value = shortenUrl(item.id);
    }

    el.nowTitle.value = item.title;
    el.nowAuthor.value = item.author;
    if (el.nowMemo) {
        el.nowMemo.value = item.memo || "";
        autoResize(el.nowMemo);
    }

    // Apply tier theme for current song
    applyTierTheme(item.tier || '');

    renderItemsActive();
    syncCurrentInfo();
}

// Local Media Player Init
let localVideo = null;
let localImage = null;
let imageTimer = null;
let currentObjectUrl = null;

function initLocalPlayer() {
    if (document.getElementById('local-player-container')) return;

    const container = document.createElement('div');
    container.id = 'local-player-container';
    Object.assign(container.style, {
        display: 'none', width: '100%', height: '100%',
        position: 'relative', background: '#000'
    });

    // Video/Audio Player
    localVideo = document.createElement('video');
    localVideo.className = 'local-media';
    Object.assign(localVideo.style, {
        width: '100%', height: '100%', objectFit: 'contain'
    });
    localVideo.controls = false; // Custom controls
    localVideo.playsInline = true;

    // Image Viewer
    localImage = document.createElement('img');
    localImage.className = 'local-media';
    Object.assign(localImage.style, {
        width: '100%', height: '100%', objectFit: 'contain', display: 'none'
    });

    container.appendChild(localVideo);
    container.appendChild(localImage);

    // Insert into DOM (assuming youtube-player parent is the main view)
    const yt = document.getElementById('youtube-player');
    if (yt && yt.parentNode) {
        yt.parentNode.insertBefore(container, yt);
    }

    // Events
    localVideo.addEventListener('timeupdate', () => {
        if (currentIndex < 0 || queue[currentIndex].type !== 'file' || queue[currentIndex].isImage) return;
        if (localVideo.paused) {
            lastKnownTime = localVideo.currentTime;
            return;
        }

        const cur = localVideo.currentTime;
        const dur = localVideo.duration;

        el.currentTime.innerText = formatTime(cur);
        if (dur > 0 && !isNaN(dur)) el.duration.innerText = formatTime(dur);

        const diff = cur - lastKnownTime;
        if (diff > 0 && diff < 2) cumulativeSeconds += diff;
        lastKnownTime = cur;
        el.cumulativeTime.innerText = formatCumulative(cumulativeSeconds);

        if (dur > 0) {
            const pct = (cur / dur) * 100;
            el.progressBar.style.width = pct + '%';
            const mini = document.getElementById(`mini-progress-${currentIndex}`);
            if (mini) mini.style.width = pct + '%';

            // Save lastTime
            queue[currentIndex].lastTime = cur;
        }
    });

    localVideo.addEventListener('ended', () => {
        skipNext();
    });

    localVideo.addEventListener('loadedmetadata', () => {
        if (queue[currentIndex] && queue[currentIndex].type === 'file') {
            queue[currentIndex].duration = localVideo.duration;
            if (queue[currentIndex].lastTime > 0) {
                localVideo.currentTime = queue[currentIndex].lastTime;
                lastKnownTime = queue[currentIndex].lastTime;
            }
        }
    });
}

// Call init once
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLocalPlayer);
} else {
    initLocalPlayer();
}

function safe(s) { return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : ""; }

function normalizeZenkaku(str) {
    if (!str) return "";
    return str.replace(/[！-～]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
        .replace(/　/g, " ")
        .replace(/ー/g, "-")
        .replace(/－/g, "-")
        .replace(/￥/g, "\\");
}

function skipNext() {
    // 現在の曲の再生位置をリセット（もう一度再生できるように）
    if (currentIndex >= 0 && queue[currentIndex]) {
        queue[currentIndex].lastTime = 0;
    }

    if (isLoop) return playIndex(currentIndex);
    if (isShuffle && queue.length > 1) {
        let n = currentIndex; while (n === currentIndex) n = Math.floor(Math.random() * queue.length);
        return playIndex(n);
    }
    if (currentIndex < queue.length - 1) {
        playIndex(currentIndex + 1);
    } else {
        if (isQueueLoop && queue.length > 0) {
            playIndex(0);
        } else {
            if (isPlayerReady && player && typeof player.stopVideo === 'function') {
                player.stopVideo();
            }
            const scContainer = document.getElementById('soundcloud-player');
            if (scContainer) scContainer.innerHTML = '';
        }
    }
}
function skipPrev() {
    if (currentIndex > 0) {
        playIndex(currentIndex - 1);
    } else {
        const item = queue[currentIndex];
        if (item && item.type === 'soundcloud') {
            const scContainer = document.getElementById('soundcloud-player');
            if (scContainer && scContainer.firstElementChild) {
                scContainer.firstElementChild.src = scContainer.firstElementChild.src;
            }
        } else if (isPlayerReady) {
            player.seekTo(0);
        }
    }
}

// Event Handlers
document.getElementById('btn-add').onclick = () => {
    addToQueue(el.addUrl.value, el.addTitle.value, el.addAuthor.value, el.addMemo.value, el.addTier ? el.addTier.value : '');
    el.addUrl.value = el.addTitle.value = el.addAuthor.value = el.addMemo.value = '';
    if (el.addTier) el.addTier.value = '';
};

// Sort mode change handler
if (el.sortMode) {
    el.sortMode.onchange = () => {
        if (el.sortMode.value === 'tier') {
            sortQueueByTier();
        }
        // 'manual' doesn't need action - user can drag to reorder
    };
}
// Screenshot Share Modal Logic
async function openScreenshotModal() {
    const modal = document.getElementById('share-screenshot-modal');
    if (!modal) return;

    // Get current item
    let item = null;
    if (currentIndex >= 0 && queue[currentIndex]) {
        item = queue[currentIndex];
    }

    // Elements
    const sTitle = document.getElementById('share-title');
    const sAuthor = document.getElementById('share-author');
    const sTier = document.getElementById('share-tier');
    const sArt = document.getElementById('share-art');
    const sBg = document.getElementById('share-bg');

    // Default values
    let title = "No Title";
    let author = "No Artist";
    let tier = "";
    let artUrl = "https://via.placeholder.com/600x600?text=No+Track";

    if (item) {
        title = item.title;
        author = item.author;
        tier = item.tier;

        if (item.type === 'youtube') {
            artUrl = `https://i.ytimg.com/vi/${item.id}/maxresdefault.jpg`;
        } else if (item.thumbnail) {
            artUrl = item.thumbnail;
        }
    }

    // Update Text
    sTitle.innerText = title;
    sAuthor.innerText = author;

    // Update Tier
    sTier.innerText = tier || "";
    if (tier && TIER_THEMES[tier]) {
        sTier.style.display = 'block';
        const theme = TIER_THEMES[tier];
        sTier.style.background = theme.primary;
        sTier.style.color = theme.contrast;
        sTier.style.boxShadow = `0 4px 15px ${theme.primary}66`; // 40% alpha

        // Update bars color
        const bars = document.querySelectorAll('.sc-bar');
        bars.forEach(b => {
            b.style.background = theme.primary;
            b.style.boxShadow = `0 0 10px ${theme.primary}`;
        });
    } else {
        sTier.style.display = 'none';
        // Default bars
        const bars = document.querySelectorAll('.sc-bar');
        bars.forEach(b => {
            b.style.background = 'var(--primary)';
            b.style.boxShadow = '0 0 10px var(--primary)';
        });
    }

    // Update Image
    // Check if maxresdefault exists for YouTube (sometimes 404), fallback to hqdefault
    if (item && item.type === 'youtube') {
        const checkImg = new Image();
        checkImg.src = artUrl;
        checkImg.onload = () => {
            if (checkImg.width < 121) { // YouTube returns small 'deleted' placeholder (120x90) if maxres missing
                const hq = `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
                sArt.src = hq;
                sBg.src = hq;
            } else {
                sArt.src = artUrl;
                sBg.src = artUrl;
            }
        };
        checkImg.onerror = () => {
            const hq = `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
            sArt.src = hq;
            sBg.src = hq;
        };
    } else {
        sArt.src = artUrl;
        sBg.src = artUrl;
    }

    modal.classList.add('active');
}

async function saveShareCardImage() {
    const card = document.getElementById('share-card');
    const btn = document.getElementById('btn-save-share-image');
    if (!card || !btn) return;

    const originalText = btn.innerText;
    btn.innerText = "生成中... (Processing)";
    btn.disabled = true;

    try {
        // Wait for images to load (just in case)
        await new Promise(r => setTimeout(r, 500));

        const canvas = await html2canvas(card, {
            useCORS: true,
            scale: 3, // High Res
            backgroundColor: null, // Transparent bg if rounded
            logging: false
        });

        const link = document.createElement('a');
        link.download = `YukiPlayer_Share_${new Date().getTime()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

        btn.innerText = "完了 (Done!)";
    } catch (e) {
        console.error("Share image gen failed:", e);
        alert("画像生成に失敗しました: " + e);
        btn.innerText = "Error";
    } finally {
        setTimeout(() => {
            btn.innerText = originalText;
            btn.disabled = false;
        }, 2000);
    }
}

// Bindings
document.getElementById('btn-screenshot').onclick = openScreenshotModal;
document.getElementById('btn-save-share-image').onclick = saveShareCardImage;

// 'B' key alias - needs to be updated in handleKeyDown too if it calls takeScreenshot directly
// Assuming handleKeyDown calls document.getElementById('btn-screenshot').click() or similar logic
// Let's ensure the global shortcut for 'B' works by checking if it calls .click() on the button.
// If it calls takeScreenshot() directly, we might need to update that. 
// But since we are replacing the function definition that was there... wait, I am replacing the lines that DEFINED takeScreenshot.
// So if any other code calls takeScreenshot(), it will fail because I am removing the function name 'takeScreenshot'.
// I should aliases 'takeScreenshot' to 'openScreenshotModal' to be safe.

const takeScreenshot = openScreenshotModal; // Alias for backward compatibility if needed

// GitHub Share Link Generator - Modal Version
let currentShareData = '';

function getShareableQueue() {
    const shareableTypes = ['youtube', 'soundcloud', 'vimeo'];
    return queue
        .filter(item => shareableTypes.includes(item.type || 'youtube'))
        .map(item => ({
            id: item.id,
            type: item.type || 'youtube',
            title: item.title,
            author: item.author,
            tier: item.tier
        }));
}

function openShareLinkModal() {
    const shareableQueue = getShareableQueue();
    if (shareableQueue.length === 0) {
        alert("共有可能な曲（YouTube/SoundCloud/Vimeo）がありません。");
        return;
    }
    currentShareData = encodeURIComponent(JSON.stringify(shareableQueue));
    document.getElementById('share-link-output').value = `${shareableQueue.length}曲を共有準備中...\n上のボタンでリンクを生成してください。`;
    document.getElementById('share-link-modal').classList.add('active');
}

document.getElementById('btn-share-link').onclick = openShareLinkModal;

document.getElementById('share-github-btn').onclick = () => {
    if (!currentShareData) return;
    const url = `https://disxord888-hash.github.io/yukic_player/?=${currentShareData}`;
    document.getElementById('share-link-output').value = url;
};

document.getElementById('share-local-btn').onclick = () => {
    if (!currentShareData) return;
    const url = `http://localhost:3000/mp/?=${currentShareData}`;
    document.getElementById('share-link-output').value = url;
};

document.getElementById('share-copy-btn').onclick = () => {
    const output = document.getElementById('share-link-output');
    const text = output.value;
    if (!text || text.includes('準備中')) {
        alert("先にリンクを生成してください。");
        return;
    }
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('share-copy-btn');
        btn.innerText = '✅';
        setTimeout(() => btn.innerText = 'コピー', 2000);
    }).catch(err => {
        console.error("Clipboard failed:", err);
        output.select();
        document.execCommand('copy');
    });
};

// Add tier dropdown theme change
if (el.addTier) {
    el.addTier.onchange = () => {
        applyTierTheme(el.addTier.value);
    };
}

document.getElementById('btn-recommend-vocaloid').onclick = async () => {
    const btn = document.getElementById('btn-recommend-vocaloid');
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ Loading...';
    btn.disabled = true;

    try {
        const songs = await fetchVocaloidSongs();
        // 30曲をランダムに追加（重複を避けてシャッフル）
        const shuffled = [...songs].sort(() => Math.random() - 0.5);
        const toAdd = shuffled.slice(0, Math.min(30, shuffled.length));
        for (const item of toAdd) {
            addToQueue(item.id, item.title, item.author);
        }
    } catch (e) {
        console.error('Vocaloid fetch error:', e);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};
el.addUrl.oninput = () => {
    const val = el.addUrl.value;
    if (val.includes('http') || val.includes('youtube.com') || val.includes('youtu.be')) {
        const id = extractId(val);
        if (id && val.length > 30) {
            el.addUrl.value = shortenUrl(id);
        }
    }
};

el.addUrl.onkeydown = (e) => {
    if (e.key === 'Enter') {
        document.getElementById('btn-add').click();
    }
};
const copySelection = () => {
    let indices = Array.from(selectedIndices).filter(idx => idx >= 0 && idx < queue.length);
    if (indices.length === 0) {
        let idx = (selectedListIndex >= 0) ? selectedListIndex : currentIndex;
        if (idx >= 0 && idx < queue.length) indices = [idx];
    }
    if (indices.length === 0) return;

    indices.sort((a, b) => a - b);
    const copiedItems = indices.map(idx => {
        try { return JSON.parse(JSON.stringify(queue[idx])); } catch (e) { return null; }
    }).filter(i => i !== null);
    if (copiedItems.length === 0) return;

    const insertAt = Math.max(...indices) + 1;
    queue.splice(insertAt, 0, ...copiedItems);
    renderQueue();
};
document.getElementById('btn-copy-sel')?.addEventListener('click', copySelection);
document.getElementById('btn-copy-sel-q')?.addEventListener('click', copySelection);

const deleteSelection = () => {
    let indices = Array.from(selectedIndices).filter(idx => idx >= 0 && idx < queue.length);
    if (indices.length === 0) {
        let idx = (selectedListIndex >= 0) ? selectedListIndex : currentIndex;
        if (idx >= 0 && idx < queue.length) indices = [idx];
    }
    if (indices.length === 0) return;

    const isRemovingCurrent = indices.includes(currentIndex);
    const playingId = (currentIndex >= 0 && !isRemovingCurrent) ? queue[currentIndex].id : null;

    indices.sort((a, b) => b - a); // Descending
    indices.forEach(idx => {
        queue.splice(idx, 1);
    });

    if (isRemovingCurrent) {
        if (queue.length > 0) {
            currentIndex = 0;
            const targetIdx = Math.min(Math.max(...indices) - indices.length + 1, queue.length - 1);
            playIndex(Math.max(0, targetIdx));
        } else {
            if (isPlayerReady && player && typeof player.stopVideo === 'function') player.stopVideo();
            currentIndex = -1;
            el.nowTitle.value = ""; el.nowAuthor.value = "";
        }
    } else {
        currentIndex = playingId ? queue.findIndex(it => it.id === playingId) : -1;
    }

    selectedIndices.clear();
    selectedListIndex = -1;
    selectionAnchor = -1;
    renderQueue();
};

document.getElementById('btn-delete')?.addEventListener('click', deleteSelection);
document.getElementById('btn-delete-q')?.addEventListener('click', deleteSelection);
document.getElementById('btn-clear').onclick = () => {
    if (confirm("情報をすべて初期化（消去）しますか？")) {
        queue = []; currentIndex = selectedListIndex = -1;
        if (isPlayerReady) player.stopVideo();
        renderQueue();
    }
};
document.getElementById('btn-dedupe').onclick = () => {
    const s = new Set(); const old = queue.length; const id = currentIndex >= 0 ? queue[currentIndex].id : null;
    queue = queue.filter(x => !s.has(x.id) && s.add(x.id));
    currentIndex = id ? queue.findIndex(x => x.id === id) : -1;
    renderQueue(); alert(`重複 ${old - queue.length} 件を削除しました`);
};

// Lock Timer Logic
function updateLockProgress(p) {
    if (el.lockCircles) {
        el.lockCircles.forEach(circle => {
            const circumference = circle.getTotalLength();
            const offset = circumference - (p / 100) * circumference;
            circle.style.strokeDasharray = circumference;
            circle.style.strokeDashoffset = offset;
        });
    }
}

const startLockTimer = (e) => {
    if (e.type === 'touchstart') e.preventDefault();
    lockStartTime = Date.now();
    updateLockProgress(0);
    if (lockTimer) clearInterval(lockTimer);
    lockTimer = setInterval(() => {
        const p = Math.min(((Date.now() - lockStartTime) / 4000) * 100, 100);
        updateLockProgress(p);
        if (p >= 100) {
            clearInterval(lockTimer);
            lockTimer = null;
            isLocked = !isLocked;
            el.lockOverlay.classList.toggle('active', isLocked);
            updateLockProgress(0);
        }
    }, 50);
};

const stopLockTimer = () => {
    if (lockTimer) {
        clearInterval(lockTimer);
        lockTimer = null;
    }
    updateLockProgress(0);
};

el.btnLock.addEventListener('pointerdown', startLockTimer);
el.lockOverlay.addEventListener('pointerdown', startLockTimer);
window.addEventListener('pointerup', stopLockTimer);
window.addEventListener('pointercancel', stopLockTimer);
// pointerup handles mouseup/touchend uniformly

// Controls (Consolidated below)
el.btnLoop.onclick = () => { isLoop = !isLoop; if (isLoop) isQueueLoop = false; updateUIStates(); };
el.btnQueueLoop.onclick = () => { isQueueLoop = !isQueueLoop; if (isQueueLoop) isLoop = false; updateUIStates(); };
el.btnShuffle.onclick = () => { isShuffle = !isShuffle; updateUIStates(); };

el.nowTitle.oninput = () => {
    const idx = selectedListIndex >= 0 ? selectedListIndex : currentIndex;
    if (idx >= 0) {
        queue[idx].title = el.nowTitle.value;
        const target = document.querySelector(`.queue-item[data-idx="${idx}"] .q-title`);
        if (target) {
            // Re-render only the title part or just text if shorthand isn't used
            const labelHtml = (queue[idx].tier && queue[idx].tier !== '-') ? `<span class="q-tier-label">${getTierShortText(queue[idx].tier)}</span> ` : '';
            target.innerHTML = `${labelHtml}${safe(el.nowTitle.value)}`;
        }
    }
};

el.nowTier.onchange = () => {
    const idx = selectedListIndex >= 0 ? selectedListIndex : currentIndex;
    if (idx >= 0) {
        queue[idx].tier = el.nowTier.value;
        if (idx === currentIndex) {
            applyTierTheme(el.nowTier.value);
            syncCurrentInfo(); // Update title box if needed
        }
        renderQueue(); // Refresh shorthand in queue
    }
};
el.nowAuthor.oninput = () => {
    const idx = selectedListIndex >= 0 ? selectedListIndex : currentIndex;
    if (idx >= 0) {
        queue[idx].author = el.nowAuthor.value;
        const target = document.querySelector(`.queue-item[data-idx="${idx}"] .q-author`);
        if (target) target.innerText = el.nowAuthor.value;
    }
};
el.nowMemo.oninput = () => {
    const idx = selectedListIndex >= 0 ? selectedListIndex : currentIndex;
    if (idx >= 0) {
        queue[idx].memo = el.nowMemo.value;
    }
};
el.nowId.oninput = () => {
    const idx = selectedListIndex >= 0 ? selectedListIndex : currentIndex;
    if (idx >= 0) {
        const inputVal = el.nowId.value;
        const newId = extractId(inputVal);
        if (newId) {
            queue[idx].id = newId;
            // 短縮して表示
            const clean = shortenUrl(inputVal);
            if (el.nowId.value !== clean && !clean.includes('undefined')) {
                // 自動短縮（ユーザーが入力中なので、フォーカス位置に注意が必要だが、基本は貼り付け時に効く）
            }
            if (idx === currentIndex && isPlayerReady) {
                player.cueVideoById(newId);
            }
        }
    }
};
el.nowId.onchange = () => {
    const idx = selectedListIndex >= 0 ? selectedListIndex : currentIndex;
    if (idx >= 0) {
        const clean = shortenUrl(el.nowId.value);
        el.nowId.value = clean;
        const newId = extractId(clean);
        if (newId) {
            queue[idx].id = newId;
            // 情報を再取得
            getMetaData(newId).then(meta => {
                queue[idx].title = meta.title;
                queue[idx].author = meta.author;
                renderQueue();
                if ((selectedListIndex >= 0 ? selectedListIndex : currentIndex) === idx) {
                    el.nowTitle.value = meta.title;
                    el.nowAuthor.value = meta.author;
                }
            });
            if (idx === currentIndex && isPlayerReady) {
                player.loadVideoById(newId);
            }
        }
    }
};

// Progress Bar Click to Seek
el.progressContainer.onclick = (e) => {
    // Media Playback Seek
    const rect = el.progressContainer.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    mediaSeekToPercent(pos);
};

// IO
// Tier形式変換関数
// Tier形式変換関数
function convertOldTierToNew(tier) {
    if (!tier) return '×';
    let sTier = String(tier);

    // Replace ★ with ＊
    sTier = sTier.replace(/★/g, '＊');

    // Check if new format (e.g. ＊, ＊＊, ..., 💯)
    if (TIER_ORDER.includes(sTier)) return sTier;

    // Map old tiers and unmapped star counts
    const tierMap = {
        'SSSSS': '＊＊＊＊＊',
        'SSSS': '＊＊＊＊',
        'SSS': '＊＊＊',
        'SS': '＊＊',
        'S+': '＊',
        'S': '＊',
        'S-': '＊',
        'A+': '△',
        'A': '△',
        'A-': '△',
        'B+': '△',
        'B': '△',
        'B-': '△',
        'C+': '×',
        'C': '×',
        'C-': '×',
        'D+': '×',
        'D': '×',
        'D-': '×',
        'F': 'Fail',
        'F-': 'Fail',
        'F--': '💯'
    };
    return tierMap[sTier] !== undefined ? tierMap[sTier] : '×';
}

function processImportFile(f) {
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
        let importedQueue = [];
        const content = ev.target.result;
        // Strip BOM if present (important for Windows created files)
        const safeContent = content.replace(/^\uFEFF/, '');

        try {
            // Try parsing as JSON first
            const d = JSON.parse(safeContent);
            if (Array.isArray(d)) {
                importedQueue = d;
            } else if (d && d.queue) {
                importedQueue = d.queue;
                if (!importedFileNames.has(f.name)) {
                    cumulativeSeconds += (d.cumulativeSeconds || 0);
                    if (d.clockFormat) currentClockFormat = d.clockFormat;

                    // Import Settings
                    if (d.settings) {
                        try {
                            if (typeof d.settings.isLoop === 'boolean') { isLoop = d.settings.isLoop; }
                            if (typeof d.settings.isQueueLoop === 'boolean') { isQueueLoop = d.settings.isQueueLoop; }
                            if (typeof d.settings.isShuffle === 'boolean') { isShuffle = d.settings.isShuffle; }
                            updateUIStates();

                            if (typeof d.settings.isShortVideoAllowed === 'boolean') {
                                toggleShortsAllowed(d.settings.isShortVideoAllowed);
                            }
                            if (typeof d.settings.volume === 'number') {
                                updateVolume(d.settings.volume);
                            }
                        } catch (e) { console.warn("Settings import failed", e); }
                    }

                    importedFileNames.add(f.name);
                    if (el.cumulativeTime) el.cumulativeTime.innerText = formatCumulative(cumulativeSeconds);
                }
            }
        } catch (e) {
            // If JSON fails, try line-by-line URL/text format
            const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            importedQueue = lines.map(line => {
                // If it looks like a URL, create a basic item
                if (line.includes('http') || line.length === 11) {
                    return { id: extractId(line), title: "Loading...", author: "...", tier: "×" };
                }
                return null;
            }).filter(i => i !== null);
        }

        // Standardize and sanitize imported items
        const sanitizedItems = importedQueue.map(item => {
            // Handle case where item might be a string (raw URL in array)
            if (typeof item === 'string') {
                return {
                    id: extractId(item),
                    type: isSoundCloudUrl(item) ? 'soundcloud' : (isVimeoUrl(item) ? 'vimeo' : 'youtube'),
                    title: "Loading...",
                    author: "...",
                    tier: "×",
                    lastTime: 0
                };
            }

            // Ensure we have an ID and it's clean (not a full URL)
            let cleanId = item.id || "";
            let type = item.type || 'youtube';

            if (cleanId.includes('http') || cleanId.includes('/') || cleanId.includes('.')) {
                if (isSoundCloudUrl(cleanId)) {
                    type = 'soundcloud';
                    // SoundCloud IDs are full URLs
                } else if (isVimeoUrl(cleanId)) {
                    type = 'vimeo';
                    cleanId = extractVimeoId(cleanId);
                } else {
                    cleanId = extractId(cleanId);
                }
            }

            return {
                ...item,
                id: cleanId,
                type: type,
                title: item.title || "Song",
                author: item.author || "Author",
                tier: convertOldTierToNew(item.tier),
                lastTime: item.lastTime || 0,
                duration: item.duration || 0,
                memo: item.memo || ""
            };
        }).filter(item => item.id); // Remove items without ID

        queue = [...queue, ...sanitizedItems].slice(0, MAX_QUEUE);
        selectedIndices.clear();
        selectionAnchor = -1;
        renderQueue();
    };
    r.readAsText(f);
}

function selectExportFormat() {
    const raw = prompt("保存形式を選択してください:\n[ j ]: JSON形式\n[ t ]: TXT形式\n(それ以外・キャンセルで中止)");
    if (!raw) return null;
    const input = normalizeZenkaku(raw).toLowerCase();
    if (input === 'j' || input === 'json') return 'json';
    if (input === 't' || input === 'txt') return 'txt';
    if (input === 'z' || input === 'zip') return 'zip';
    return null;
}

async function exportDataToFile(data, filename, extension) {
    const fullFilename = filename + "." + extension;

    if (extension === 'zip') {
        if (typeof JSZip === 'undefined') {
            alert("JSZip library not loaded. Please check your connection.");
            return;
        }
        const zip = new JSZip();

        // Remove File objects from metadata but keep filename info
        const cleanQueue = data.queue.map(item => {
            const { file, ...rest } = item;
            return rest;
        });
        const metaData = { ...data, queue: cleanQueue };
        zip.file("playlist.json", JSON.stringify(metaData, null, 2));

        // Add actual files
        const addedFiles = new Set();
        for (const item of data.queue) {
            if (item.type === 'file' && item.file) {
                // Ensure unique filenames in ZIP
                let fname = item.file.name;
                if (addedFiles.has(fname)) {
                    fname = Date.now() + "_" + fname;
                }
                zip.file(fname, item.file);
                addedFiles.add(fname);
            }
        }

        const content = await zip.generateAsync({ type: "blob" });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = fullFilename;
        a.click();
        return;
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fullFilename;
    a.click();
}

async function exportItemToFile(idx, format) {
    const item = queue[idx];
    if (!item) return;
    const safeTitle = (item.title || "song").replace(/[\\/:*?"<>|]/g, "_");
    await exportDataToFile({ queue: [item] }, safeTitle, format);
}

document.getElementById('btn-export').onclick = async () => {
    // 日付名を作成 (YYYYMMDD_HHMMSS)
    const now = new Date();
    const ts = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;

    // If queue contains local files, suggest ZIP
    const hasLocalFiles = queue.some(item => item.type === 'file' && item.file);
    let formatMsg = "保存形式を選択してください:\n[ j ]: JSON形式\n[ t ]: TXT形式";
    if (hasLocalFiles) {
        formatMsg += "\n[ z ]: ZIP形式 (ローカルファイル同梱)";
    }
    formatMsg += "\n(それ以外・キャンセルで中止)";

    const raw = prompt(formatMsg);
    if (!raw) return;
    const input = normalizeZenkaku(raw).toLowerCase();
    let format = null;
    if (input === 'j' || input === 'json') format = 'json';
    else if (input === 't' || input === 'txt') format = 'txt';
    else if (input === 'z' || input === 'zip') format = 'zip';

    if (!format) return;

    const exportData = {
        queue: queue,
        cumulativeSeconds: cumulativeSeconds,
        clockFormat: typeof currentClockFormat !== 'undefined' ? currentClockFormat : '24h',
        settings: {
            isLoop, isQueueLoop, isShuffle, isShortVideoAllowed,
            volume: parseInt(el.volumeSlider.value) || 100
        }
    };
    await exportDataToFile(exportData, ts, format);
};
document.getElementById('btn-import').onclick = () => el.fileInput.click();
if (document.getElementById('btn-load-file')) {
    document.getElementById('btn-load-file').onclick = () => el.fileInput.click();
}
el.fileInput.setAttribute('accept', '.json,.txt,.mp3,.wav,.m4a,.mp4,.mkv,.webp,.gif,.png,.jpeg,.jpg,.svg');
el.fileInput.onchange = (e) => handleFiles(e.target.files);

// Drag & Drop Import
const dropOverlay = document.createElement('div');
dropOverlay.className = 'drop-overlay';
dropOverlay.innerHTML = '<div class="drop-msg">ファイルをここにドロップしてインポート</div>';
document.body.appendChild(dropOverlay);

let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    dropOverlay.classList.add('active');
});

document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) {
        dropOverlay.classList.remove('active');
    }
});

document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    dropOverlay.classList.remove('active');

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
        handleFiles(files);
        return;
    }

    // Try to get text/URL data (for dragged links)
    const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
    if (text) {
        // Drop might contain multiple lines if it's a list, but usually it's one link
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        for (const line of lines) {
            addToQueue(line);
        }
    }
});

function handleFiles(files) {
    if (!files || files.length === 0) return;

    // Check if it's a playlist import (json/txt) or media files
    const first = files[0];
    const imageExts = ['.webp', '.gif', '.png', '.jpeg', '.jpg', '.svg'];

    // Special case: If exactly one image is dropped while a local audio is playing, treat it as a thumbnail
    if (files.length === 1 && currentIndex >= 0 && queue[currentIndex].type === 'file' && !queue[currentIndex].isImage) {
        if (imageExts.some(ext => first.name.toLowerCase().endsWith(ext))) {
            const currentItem = queue[currentIndex];
            const reader = new FileReader();
            reader.onload = (e) => {
                currentItem.thumbnail = e.target.result;
                // If it's the currently playing one, update the view immediately
                if (localImage) {
                    localImage.src = currentItem.thumbnail;
                    localImage.style.display = 'block';
                    localImage.style.zIndex = "5";
                }
                renderQueue();
            };
            reader.readAsDataURL(first);
            return;
        }
    }

    if (first.name.endsWith('.json') || (first.name.endsWith('.txt') && files.length === 1)) {
        processImportFile(first);
        return;
    }

    // Media files
    const validExts = ['.mp3', '.wav', '.m4a', '.mp4', '.mkv', '.webp', '.gif', '.png', '.jpeg', '.jpg', '.svg'];
    let added = false;
    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const lowerName = f.name.toLowerCase();
        if (validExts.some(ext => lowerName.endsWith(ext))) {
            const item = {
                id: f.name, // Use filename as ID for display
                type: 'file',
                title: f.name,
                author: 'Local File',
                file: f, // Store File object
                tier: '×',
                lastTime: 0,
                duration: 0
            };
            if (imageExts.some(ext => lowerName.endsWith(ext))) {
                item.isImage = true;
                item.duration = 5; // Default 5s for images
            }
            queue.push(item);
            added = true;
        }
    }

    if (added) {
        renderQueue();
        if (currentIndex === -1) playIndex(queue.length - 1); // Play newly added
    }
}

// Volume Control Implementation
function updateVolume(val) {
    val = Math.max(0, Math.min(100, val));

    // YouTube
    if (isPlayerReady && player && typeof player.setVolume === 'function') {
        player.setVolume(val);
    }

    // SoundCloud
    if (scWidget) {
        // SC Widget volume is 0-100
        scWidget.setVolume(val);
    }

    // Local File
    if (localVideo) {
        localVideo.volume = val / 100;
    }

    // Vimeo
    if (vimeoPlayer) {
        vimeoPlayer.setVolume(val / 100);
    }

    el.volumeSlider.value = val;
    el.volumeInput.value = val;
    // localStorage.setItem('yuki-player-volume', val); // Disabled per user request
}

el.volumeSlider.oninput = (e) => updateVolume(parseInt(e.target.value));
el.volumeInput.onchange = (e) => updateVolume(parseInt(e.target.value));
el.volumeInput.oninput = (e) => {
    const val = parseInt(e.target.value);
    if (!isNaN(val)) updateVolume(val);
};

// URL Import Modal
function openUrlImportModal() {
    document.getElementById('url-import-modal').classList.add('active');
    document.getElementById('url-import-input').value = '';
    document.getElementById('url-import-input').focus();
}

document.getElementById('btn-url-import').onclick = openUrlImportModal;

document.getElementById('url-import-btn').onclick = () => {
    const input = document.getElementById('url-import-input').value.trim();
    if (!input) {
        alert("URLを入力してください。");
        return;
    }

    try {
        // Extract ?= parameter from URL
        let jsonStr = '';
        if (input.includes('?=')) {
            const startIdx = input.indexOf('?=') + 2;
            jsonStr = decodeURIComponent(input.substring(startIdx));
        } else {
            // Try parsing as raw JSON
            jsonStr = input;
        }

        const importedQueue = JSON.parse(jsonStr);

        if (Array.isArray(importedQueue) && importedQueue.length > 0) {
            const validTypes = ['youtube', 'soundcloud', 'vimeo'];
            const sanitized = importedQueue
                .filter(item => item.id && validTypes.includes(item.type || 'youtube'))
                .map(item => ({
                    id: item.id,
                    type: item.type || 'youtube',
                    title: item.title || 'Untitled',
                    author: item.author || 'Unknown',
                    tier: item.tier || '×',
                    lastTime: 0,
                    duration: 0,
                    memo: ''
                }));

            if (sanitized.length > 0) {
                queue = [...queue, ...sanitized];
                renderQueue();
                alert(`${sanitized.length}曲をインポートしました。`);
                document.getElementById('url-import-modal').classList.remove('active');
            } else {
                alert("インポート可能な曲が見つかりませんでした。");
            }
        } else {
            alert("有効なキューデータが見つかりませんでした。");
        }
    } catch (e) {
        console.error('URL Import failed:', e);
        alert("URLの解析に失敗しました。形式を確認してください。");
    }
};

// Shortcuts Help
el.helpBtn.onclick = () => el.helpModal.classList.toggle('active');

function handleShortcutKey(rawK, e = null) {
    if (isLocked) return;
    const k = normalizeZenkaku(rawK);

    if (k === 'Escape') {
        escPrefix = true;
        tPrefixCount = 0; yPrefixCount = 0; // Reset others
        if (el.heldKeysIndicator) {
            el.heldKeysIndicator.innerText = "Esc";
            el.heldKeysIndicator.style.opacity = "1";
        }
        return;
    }

    if (escPrefix) {
        if (k.toLowerCase() === 's') {
            if (e) e.preventDefault();
            toggleShortsAllowed();
            escPrefix = false;
            return;
        }
        escPrefix = false;
        if (el.heldKeysIndicator) el.heldKeysIndicator.style.opacity = "0";
    }

    const kl = k.toLowerCase();
    if (kl === 'b') { if (e) e.preventDefault(); takeScreenshot(); }
    else if (kl === 'u') { if (e) e.preventDefault(); openUrlImportModal(); }
    else if (kl === 'i') { if (e) e.preventDefault(); el.fileInput.click(); }
    else if (k === ' ') { if (e) e.preventDefault(); mediaTogglePlay(); }
    else if (kl === 'g') { if (e) e.preventDefault(); mediaTogglePlay(); }
    else if (kl === 'o') mediaStop();
    else if (kl === 'a') {
        const item = queue[currentIndex];
        if (item && currentIndex >= 0) {
            getMediaDuration(item).then(dur => {
                if (dur <= 0) return;
                getCurrentMediaTime().then(curr => {
                    const pct = curr / dur;
                    const target = (Math.ceil(pct * 36 - 0.0001) - 1) / 36;
                    mediaSeekToPercent(Math.max(0, target));
                });
            });
        }
    }
    else if (kl === 's') {
        const item = queue[currentIndex];
        if (item && currentIndex >= 0) {
            getMediaDuration(item).then(dur => {
                if (dur <= 0) return;
                getCurrentMediaTime().then(curr => {
                    const pct = curr / dur;
                    const target = (Math.ceil(pct * 72 - 0.0001) - 1) / 72;
                    mediaSeekToPercent(Math.max(0, target));
                });
            });
        }
    }
    else if (kl === 'd') mediaSeek(-5);
    else if (kl === 'f') mediaSeek(-2);
    else if (kl === 'y') {
        if (e) e.preventDefault();
        yPrefixCount++;
        if (yPrefixCount > 5) {
            yPrefixCount = 0;
            if (el.heldKeysIndicator) el.heldKeysIndicator.style.opacity = "0";
            return;
        }
        isSlashKeyPrefixActive = false;

        // Y alone is 0%
        updateVolume(0);

        // Show Y prefix on indicator
        if (el.heldKeysIndicator) {
            el.heldKeysIndicator.innerText = "Y".repeat(yPrefixCount) + " (0%)";
            el.heldKeysIndicator.style.opacity = "1";
        }
        return;
    }
    else if (kl === 'h') mediaSeek(2);
    else if (kl === 'j') mediaSeek(5);
    else if (kl === 'k') {
        const item = queue[currentIndex];
        if (item && currentIndex >= 0) {
            getMediaDuration(item).then(dur => {
                if (dur <= 0) return;
                getCurrentMediaTime().then(curr => {
                    const pct = curr / dur;
                    const target = (Math.floor(pct * 72 + 0.0001) + 1) / 72;
                    mediaSeekToPercent(Math.min(1, target));
                });
            });
        }
    }
    else if (kl === 'l') {
        const item = queue[currentIndex];
        if (item && currentIndex >= 0) {
            getMediaDuration(item).then(dur => {
                if (dur <= 0) return;
                getCurrentMediaTime().then(curr => {
                    const pct = curr / dur;
                    const target = (Math.floor(pct * 36 + 0.0001) + 1) / 36;
                    mediaSeekToPercent(Math.min(1, target));
                });
            });
        }
    }
    else if (k === 'A') {
        if (queue.length > 0) {
            selectedIndices.clear();
            for (let i = 0; i < queue.length; i++) selectedIndices.add(i);
            selectionAnchor = 0;
            renderItemsActive();
        }
    }
    else if (kl === 'arrowup') { if (e) e.preventDefault(); updateVolume(parseInt(el.volumeSlider.value) + 5); }
    else if (kl === 'arrowdown') { if (e) e.preventDefault(); updateVolume(parseInt(el.volumeSlider.value) - 5); }
    else if (k === ',') {
        const input = prompt(`Time in seconds (e.g. 83.45):`);
        if (input) mediaSeekTo(parseTimeToSeconds(input));
    }
    else if (k === '.') {
        // Clear logic for dot as it's now on K
    }
    else if (k === '\\') { // ジャンプ（最後）
        if (e) e.preventDefault();
        const item = queue[currentIndex];
        if (item && currentIndex >= 0) {
            getMediaDuration(item).then(dur => {
                if (dur > 0) mediaSeekTo(dur - 0.1);
            });
        }
    }
    if (kl === 't') {
        if (e) e.preventDefault();
        tPrefixCount++;
        if (tPrefixCount > 5) {
            tPrefixCount = 0;
            if (el.heldKeysIndicator) el.heldKeysIndicator.style.opacity = "0";
            return;
        }
        isSlashKeyPrefixActive = false;
        // Show T prefix on indicator
        if (el.heldKeysIndicator) {
            el.heldKeysIndicator.innerText = "T".repeat(tPrefixCount);
            el.heldKeysIndicator.style.opacity = "1";
        }
        return;
    }
    if (k === 'T') {
        showTimestampList();
        return;
    }

    if (tPrefixCount > 0) {
        const tKeys = [
            '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '^', '\\', '¥', '|', '‾',
            'q', 'w', 'e', 'r', 'y', 'u', 'i', 'o', 'p', '@'
        ];
        if (tKeys.includes(k) && currentIndex >= 0) {
            if (e) e.preventDefault();
            const prefix = "T".repeat(tPrefixCount);
            jumpToTimestamp(prefix, k);
            // Show result on indicator briefly
            if (el.heldKeysIndicator) {
                el.heldKeysIndicator.innerText = prefix + k;
                setTimeout(() => { if (heldKeysMap.size === 0) el.heldKeysIndicator.style.opacity = "0"; }, 500);
            }
            tPrefixCount = 0;
            return;
        }
        // Consecutive 't' handled above, any other key cancels
        if (k !== 't') tPrefixCount = 0;
    }

    if (yPrefixCount > 0) {
        const yKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '^', '\\', '¥'];
        if (yKeys.includes(k)) {
            if (e) e.preventDefault();

            const volMap = {
                '1': 1, '2': 3, '3': 5, '4': 8, '5': 15, '6': 25,
                '7': 40, '8': 55, '9': 75, '0': 90, '-': 100
            };
            const currentVol = parseInt(el.volumeSlider.value);
            let targetVol = currentVol;

            if (volMap[k] !== undefined) {
                targetVol = volMap[k];
            } else if (k === '^') {
                targetVol = Math.max(0, currentVol - 5);
            } else if (k === '\\' || k === '¥') {
                targetVol = Math.min(100, currentVol + 5);
            }
            updateVolume(targetVol);

            // Show volume level
            if (el.heldKeysIndicator) {
                el.heldKeysIndicator.innerText = "Y".repeat(yPrefixCount) + k + ` (${targetVol}%)`;
                el.heldKeysIndicator.style.opacity = "1";
                setTimeout(() => { if (heldKeysMap.size === 0) el.heldKeysIndicator.style.opacity = "0"; }, 500);
            }

            yPrefixCount = 0;
            return;
        }
        if (k !== 'y') yPrefixCount = 0;
    }

    // Shift + Number keys for Percent Seek (Offset +1/24)
    if (e && e.shiftKey && currentIndex >= 0) {
        let scPct = -1;
        // Use e.code to handle Shift+Key correctly
        // Mapping 1-9, 0, -, ^ to 12 divisions (0-11)
        switch (e.code) {
            case 'Digit1': scPct = 0; break;
            case 'Digit2': scPct = 1; break;
            case 'Digit3': scPct = 2; break;
            case 'Digit4': scPct = 3; break;
            case 'Digit5': scPct = 4; break;
            case 'Digit6': scPct = 5; break;
            case 'Digit7': scPct = 6; break;
            case 'Digit8': scPct = 7; break;
            case 'Digit9': scPct = 8; break;
            case 'Digit0': scPct = 9; break;
            case 'Minus': scPct = 10; break;
            case 'Equal': scPct = 11; break; // ^ on JIS
            // \ (IntlRo/Backslash) is used as modifier not trigger
        }

        if (scPct !== -1) {
            e.preventDefault();
            let offset = 0;
            if (isSlashPressed) offset = 1;
            else if (isBackslashPressed) offset = 2;

            mediaSeekToPercent((scPct * 3 + offset) / 36);
            return;
        }
    }



    // Logic keys (always active)
    if (kl === 'z') playIndex(0);
    else if (kl === 'v') playIndex(queue.length - 1);
    else if (kl === 'x') skipPrev();
    else if (kl === 'c') skipNext();
    else if (kl === 'q') el.btnLoop.click();
    else if (kl === 'e') el.btnQueueLoop.click();
    else if (kl === 'w') el.btnShuffle.click();
    else if (kl === '[') {
        copySelection();
    }
    else if (kl === ']') {
        deleteSelection();
    }
    else if (kl === 'p') {
        openAlarmSettings();
    }
    else if (k === ';') {
        if (el.nowMemo) {
            const timeStr = el.currentTime.innerText;
            const res = getTLabelForMemo(el.nowMemo.value, timeStr);
            el.nowMemo.value += (el.nowMemo.value ? '\n' : '') + res.label;
            if (currentIndex >= 0) queue[currentIndex].memo = el.nowMemo.value;
            autoResize(el.nowMemo);
        }
    }
}

// Track \ and / key state
document.addEventListener('keydown', (e) => {
    if (e.code === 'IntlRo' || e.code === 'Backslash') isBackslashPressed = true;
    if (e.code === 'Slash') isSlashPressed = true;
});
document.addEventListener('keyup', (e) => {
    updateKeyMonitor(e, 'up');
    if (e.code === 'IntlRo' || e.code === 'Backslash') isBackslashPressed = false;
    if (e.code === 'Slash') isSlashPressed = false;
});

function getTLabelForMemo(memo, timeStr) {
    const keys = [
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '^', '\\',
        'q', 'w', 'e', 'r', 'y', 'u', 'i', 'o', 'p', '@'
    ];
    let depth = 1;
    while (depth <= 5) {
        const prefix = "T".repeat(depth);
        for (let k of keys) {
            const labelPattern = prefix + k + ":";
            if (!(memo || "").includes(labelPattern)) {
                return { key: k, depth, label: `${prefix}${k}:[${timeStr}]|comment:[] ` };
            }
        }
        depth++;
    }
    return { error: true };
}

function showTimestampList() {
    if (currentIndex < 0 || !queue[currentIndex]) return;
    const memo = queue[currentIndex].memo || "";
    // Match T1:[00:00.00]|comment:[...] or TT1...
    const regex = /(T+)([1-90\-^\\qweruio p@]):\[([^\]]+)\](?:\|comment:\[([^\]]*)\])?/g;
    let matches = [];
    let m;
    while ((m = regex.exec(memo)) !== null) {
        matches.push({ prefix: m[1], key: m[2], time: m[3], comment: m[4] || "" });
    }

    if (matches.length === 0) {
        alert("タイムスタンプが見つかりません。(: キーで作成できます)");
        return;
    }

    let listHtml = matches.map(item => `
        <div class="ts-list-item" onclick="jumpToTimestamp('${item.prefix}', '${item.key}'); document.getElementById('ts-modal').remove();">
            <span class="ts-tag">${item.prefix}${item.key}</span>
            <span class="ts-time">${item.time}</span>
            <span class="ts-comment">${item.comment}</span>
        </div>
    `).join('');

    const modal = document.createElement('div');
    modal.id = 'ts-modal';
    modal.className = 'help-modal active';
    modal.innerHTML = `
        <div class="help-content ts-list-content">
            <h3>Timestamps (${matches.length})</h3>
            <div class="ts-list-container">${listHtml}</div>
            <button onclick="this.parentElement.parentElement.remove()" class="btn" style="margin-top:1rem">閉じる</button>
        </div>
    `;
    document.body.appendChild(modal);
}

function jumpToTimestamp(prefix, key) {
    if (currentIndex < 0 || !queue[currentIndex]) return false;
    const memo = queue[currentIndex].memo || "";
    // Avoid finding T1 when looking for TT1 by ensuring no T precedes the match
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp("(?:^|[^T])" + prefix + escapedKey + ":\\[([^\\]]+)\\]");
    const match = memo.match(regex);
    if (match) {
        const timeStr = match[1];
        const secs = parseTimeToSeconds(timeStr);
        if (!isNaN(secs)) {
            mediaSeekTo(secs);
            return true;
        }
    }
    return false;
}

function updateKeyMonitor(e, type) {
    if (!el.heldKeysIndicator) return;

    // Exclude system/IME keys from display
    const excludeKeys = ['ZenkakuHankaku', 'HiraganaKatakana', 'Alphanumeric', 'Process', 'NonConvert', 'Convert', 'KanjiMode', 'Dead', 'Backquote'];
    const isExcluded = excludeKeys.includes(e.key) || excludeKeys.includes(e.code);

    // Track held keys (Map preserves insertion order)
    if (type === 'down') {
        if (!isExcluded) {
            heldKeysMap.set(e.code, e.key);
        }
    } else {
        heldKeysMap.delete(e.code);
    }

    // Update indicator
    if (!isShortcutDisplayEnabled) {
        el.heldKeysIndicator.style.opacity = "0";
        return;
    }

    const isShiftPressed = heldKeysMap.has('ShiftLeft') || heldKeysMap.has('ShiftRight');

    const heldNames = Array.from(heldKeysMap.entries()).map(([code, k]) => {
        if (k === " ") return "Space";

        // Shift + Number keys: show '3' instead of '#' (especially for JIS)
        if (isShiftPressed && code.startsWith('Digit')) {
            return code.replace('Digit', '');
        }

        // Other JIS symbols when Shift is held
        if (isShiftPressed) {
            const jisShiftMap = {
                'Minus': '-', 'Equal': '^', 'BracketLeft': '@', 'BracketRight': '[',
                'Semicolon': ';', 'Quote': ':', 'Backslash': ']',
                'IntlRo': '\\', 'IntlYen': '¥'
            };
            if (jisShiftMap[code]) return jisShiftMap[code];
        }

        if (k.length === 1) {
            const normalized = normalizeZenkaku(k);
            return (normalized >= 'a' && normalized <= 'z') ? normalized.toUpperCase() : normalized;
        }
        return k;
    });

    if (heldNames.length > 0) {
        // Remove duplicates and join
        const uniqueNames = [...new Set(heldNames)];
        el.heldKeysIndicator.innerText = uniqueNames.join(' + ');
        el.heldKeysIndicator.style.opacity = "1";
    } else {
        el.heldKeysIndicator.style.opacity = "0";
    }
}

window.addEventListener('blur', () => {
    heldKeysMap.clear();
    if (el.heldKeysIndicator) el.heldKeysIndicator.style.opacity = "0";
});

// Global Keys
document.addEventListener('keydown', (e) => {
    updateKeyMonitor(e, 'down');

    if (e.key === 'Escape') {
        el.helpModal.classList.toggle('active');
        return;
    }

    // Esc + m toggle for shortcut monitor
    if (e.key.toLowerCase() === 'm' && heldKeysMap.has('Escape')) {
        isShortcutDisplayEnabled = !isShortcutDisplayEnabled;
        if (!isShortcutDisplayEnabled) {
            el.heldKeysIndicator.style.opacity = "0";
        } else {
            updateKeyMonitor(e, 'down'); // Refresh display
        }
        el.helpModal.classList.remove('active'); // Close modal if it was opened by Esc
        e.preventDefault();
        return;
    }

    // Esc + t toggle for clock settings
    if (e.key.toLowerCase() === 't' && heldKeysMap.has('Escape')) {
        openClockSettings();
        el.helpModal.classList.remove('active'); // Close modal if it was opened by Esc
        e.preventDefault();
        return;
    }

    if (isLocked) return;

    // Allow shortcuts from document body OR the designated shortcut input
    const target = e.target;
    // const isInput = (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
    const isTextLikeInput = (target.tagName === 'TEXTAREA' ||
        (target.tagName === 'INPUT' && ['text', 'number', 'password', 'search', 'url', 'email', 'tel'].includes(target.type)));

    const isShortcutInput = (target.id === 'shortcut-input');

    if (isTextLikeInput && !isShortcutInput) return;

    if (isShortcutInput && e.key === 'Enter') {
        const val = e.target.value;
        if (val) handleShortcutKey(val, e);
        e.target.value = '';
        return;
    }

    // Normal shortcut handling (one-key)
    if (!isTextLikeInput || isShortcutInput) {
        handleShortcutKey(e.key, e); // Pass original key case
        if (isShortcutInput) e.target.value = '';
    }
});

// --- Media Control Abstraction ---

function mediaPlay() {
    if (currentIndex < 0) return;
    const item = queue[currentIndex];
    if (item.type === 'file') {
        if (item.isImage) {
            // Pause/Resume for image timer? Not fully supported yet.
        } else if (localVideo) {
            localVideo.play();
        }
    } else if (item.type === 'vimeo') {
        if (vimeoPlayer) vimeoPlayer.play();
    } else if (item.type === 'soundcloud') {
        if (scWidget) scWidget.play();
    } else {
        if (player && typeof player.playVideo === 'function') player.playVideo();
    }
}

function mediaTogglePlay() {
    if (currentIndex < 0) return;
    const item = queue[currentIndex];
    if (item.type === 'file') {
        if (item.isImage) {
            // Toggle timer?
        } else if (localVideo) {
            if (localVideo.paused) localVideo.play(); else localVideo.pause();
        }
    } else if (item.type === 'vimeo') {
        if (vimeoPlayer) {
            vimeoPlayer.getPaused().then(paused => {
                if (paused) vimeoPlayer.play();
                else vimeoPlayer.pause();
            });
        }
    } else if (item.type === 'soundcloud') {
        if (scWidget && typeof scWidget.toggle === 'function') {
            scWidget.toggle();
        }
    } else {
        if (!player || typeof player.getPlayerState !== 'function') return;
        const state = player.getPlayerState();
        if (state === 1) player.pauseVideo(); else player.playVideo();
    }
}

function mediaStop() {
    if (currentIndex < 0) return;
    const item = queue[currentIndex];
    if (item.type === 'file') {
        if (localVideo) { localVideo.pause(); localVideo.currentTime = 0; }
        if (imageTimer) clearTimeout(imageTimer);
    } else if (item.type === 'vimeo') {
        if (vimeoPlayer) {
            vimeoPlayer.pause();
            vimeoPlayer.setCurrentTime(0);
        }
    } else if (item.type === 'soundcloud') {
        if (scWidget) { scWidget.pause(); scWidget.seekTo(0); }
    } else {
        if (player) { player.stopVideo(); }
    }
}

function mediaSeek(delta) {
    if (currentIndex < 0) return;
    const item = queue[currentIndex];
    if (item.type === 'file') {
        if (localVideo && !item.isImage) {
            localVideo.currentTime = Math.max(0, localVideo.currentTime + delta);
        }
    } else if (item.type === 'vimeo') {
        if (vimeoPlayer) {
            vimeoPlayer.getCurrentTime().then(cur => {
                vimeoPlayer.setCurrentTime(Math.max(0, cur + delta));
            });
        }
    } else if (item.type === 'soundcloud') {
        if (scWidget) {
            scWidget.getPosition((ms) => {
                scWidget.seekTo(ms + (delta * 1000));
            });
        }
    } else {
        if (player && typeof player.getCurrentTime === 'function') {
            player.seekTo(player.getCurrentTime() + delta);
        }
    }
}

function getCurrentMediaTime() {
    if (currentIndex < 0) return Promise.resolve(0);
    const item = queue[currentIndex];
    if (item.type === 'file') {
        if (item.isImage) {
            return Promise.resolve((Date.now() - imageStartTime) / 1000);
        } else if (localVideo) {
            return Promise.resolve(localVideo.currentTime);
        }
    } else if (item.type === 'vimeo') {
        if (vimeoPlayer) return vimeoPlayer.getCurrentTime();
    } else if (item.type === 'soundcloud') {
        return new Promise(resolve => {
            if (scWidget) scWidget.getPosition(ms => resolve(ms / 1000));
            else resolve(0);
        });
    } else {
        if (player && typeof player.getCurrentTime === 'function') {
            return Promise.resolve(player.getCurrentTime());
        }
    }
    return Promise.resolve(0);
}

function getMediaDuration(item) {
    if (item.type === 'file' && !item.isImage && localVideo) {
        if (localVideo.duration) return Promise.resolve(localVideo.duration);
    } else if (item.type === 'vimeo' && vimeoPlayer) {
        return vimeoPlayer.getDuration();
    } else if (item.type === 'soundcloud' && scWidget) {
        return new Promise(resolve => scWidget.getDuration(dMs => resolve(dMs / 1000)));
    } else if (player && typeof player.getDuration === 'function') {
        const d = player.getDuration();
        if (d > 0) return Promise.resolve(d);
    }
    return Promise.resolve(item.duration || 0);
}

function mediaSeekByDeltaPercent(deltaPct, dur) {
    getCurrentMediaTime().then(curr => {
        mediaSeekTo(curr + (dur * deltaPct));
    });
}

function mediaSeekTo(seconds) {
    if (currentIndex < 0) return;
    const item = queue[currentIndex];

    // Immediate UI update for responsiveness
    // Estimate duration for progress bar update
    let duration = item.duration || 0;
    if (player && typeof player.getDuration === 'function') {
        const d = player.getDuration();
        if (d > 0) duration = d;
    }
    // For other players, duration might be async, so we use check item.duration fallback
    if (duration > 0) {
        const pct = Math.min(100, Math.max(0, (seconds / duration) * 100));
        el.progressBar.style.width = pct + '%';
        const mini = document.getElementById(`mini-progress-${currentIndex}`);
        if (mini) mini.style.width = pct + '%';
    }

    if (item.type === 'file') {
        if (item.isImage) {
            // Seek image by adjusting start time
            // elapsed = (now - startTime) / 1000
            // target = seconds
            // seconds = (now - newStartTime) / 1000
            // newStartTime = now - seconds * 1000
            imageStartTime = Date.now() - (seconds * 1000);

            // Update UI immediately (optional, will be updated by loop)
            const dur = item.duration || 5;
            const pct = Math.min(100, Math.max(0, (seconds / dur) * 100));
            el.progressBar.style.width = pct + '%';
        } else if (localVideo) {
            localVideo.currentTime = seconds;
        }
    } else if (item.type === 'vimeo') {
        if (vimeoPlayer) vimeoPlayer.setCurrentTime(seconds);
    } else if (item.type === 'soundcloud') {
        if (scWidget) scWidget.seekTo(seconds * 1000);
    } else {
        if (player) player.seekTo(seconds);
    }
    mediaPlay();
}

function mediaSeekToPercent(pct) {
    if (currentIndex < 0) return;

    // Immediate UI update for responsiveness
    el.progressBar.style.width = (pct * 100) + '%';
    const mini = document.getElementById(`mini-progress-${currentIndex}`);
    if (mini) mini.style.width = (pct * 100) + '%';

    const item = queue[currentIndex];
    if (item.type === 'file') {
        if (item.isImage) {
            const dur = item.duration || 5;
            const targetSec = dur * pct;
            imageStartTime = Date.now() - (targetSec * 1000);
            el.progressBar.style.width = (pct * 100) + '%';
        } else if (localVideo) {
            const dur = localVideo.duration || item.duration || 0;
            if (dur > 0) localVideo.currentTime = dur * pct;
        }
    } else if (item.type === 'vimeo') {
        if (vimeoPlayer) {
            vimeoPlayer.getDuration().then(dur => {
                if (dur > 0) vimeoPlayer.setCurrentTime(dur * pct);
            }).catch(() => {
                // Fallback to queue duration
                const d = item.duration || 0;
                if (d > 0) vimeoPlayer.setCurrentTime(d * pct);
            });
        }
    } else if (item.type === 'soundcloud') {
        if (scWidget) {
            scWidget.getDuration(durMs => {
                const dur = durMs / 1000;
                if (dur > 0) scWidget.seekTo(dur * pct * 1000);
            });
        }
    } else {
        if (player && typeof player.seekTo === 'function') {
            let dur = (typeof player.getDuration === 'function') ? player.getDuration() : 0;
            if (dur <= 0) dur = item.duration || 0;
            if (dur > 0) {
                player.seekTo(dur * pct, true);
            }
        }
    }
    mediaPlay();
}

// --- Button Listeners Update ---
document.getElementById('btn-pause').onclick = () => mediaTogglePlay();
// document.getElementById('btn-stop').onclick = () => mediaStop(); // Removed from main UI
document.getElementById('btn-seek-back30').onclick = () => mediaSeek(-30);
document.getElementById('btn-seek-back10').onclick = () => mediaSeek(-10);
document.getElementById('btn-seek-back5').onclick = () => mediaSeek(-5);
document.getElementById('btn-seek-back').onclick = () => mediaSeek(-2);
document.getElementById('btn-seek-fwd').onclick = () => mediaSeek(2);
document.getElementById('btn-seek-fwd5').onclick = () => mediaSeek(5);
document.getElementById('btn-seek-fwd10').onclick = () => mediaSeek(10);
document.getElementById('btn-seek-fwd30').onclick = () => mediaSeek(30);

document.getElementById('btn-first').onclick = () => playIndex(0);
document.getElementById('btn-last').onclick = () => playIndex(queue.length - 1);
document.getElementById('btn-prev').onclick = () => skipPrev();
document.getElementById('btn-next').onclick = () => skipNext();

// Memo Time Insertion
const insertTime = (target) => {
    const timeStr = el.currentTime.innerText;
    const res = getTLabelForMemo(target.value, timeStr);
    if (res.error) {
        alert("エラー: TTTTT以上の空きタイムスタンプがありません。");
        return;
    }
    target.setRangeText(res.label, target.selectionStart, target.selectionEnd, "end");
    target.dispatchEvent(new Event('change'));
    if (target === el.nowMemo && currentIndex >= 0) {
        queue[currentIndex].memo = target.value;
    }
    autoResize(target);
};

if (el.nowMemo) {
    el.nowMemo.addEventListener('keydown', (e) => {
        if (e.key === ':' || e.key === '*') { // : is often shift+; on JIS, or just :. Check key property.
            // On strict keyboard handling, : might need shift. 
            // But the user said "shortcut :".
        }
    });
    // Actually, 'keypress' or just checking key in keydown. 
    // "Colon" might be produced by Shift + ; (US) or just : (JP).
    // e.key should be ':'
}

// Function to attach listner
function attachMemoTimeShortcut(textarea) {
    if (!textarea) return;
    textarea.addEventListener('keydown', (e) => {
        if (e.key === ';') {
            e.preventDefault();
            insertTime(textarea);
        }
    });
}
attachMemoTimeShortcut(el.nowMemo);
attachMemoTimeShortcut(el.addMemo);

function autoResize(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

if (el.nowMemo) {
    el.nowMemo.addEventListener('input', () => autoResize(el.nowMemo));
    // Initial resize if needed
    // setTimeout(() => autoResize(el.nowMemo), 500);
}
if (el.addMemo) {
    el.addMemo.addEventListener('input', () => autoResize(el.addMemo));
}

// Shortcut Input Listener Removed (caused crashes)
// Preset Selection Logic
async function loadPresetFile(filename) {
    if (!filename) return;
    try {
        const response = await fetch(filename);
        if (!response.ok) throw new Error('File not found');
        const d = await response.json();

        if (d && d.queue) {
            if (confirm('現在のキューをクリアしてプリセットを読み込みますか？')) {
                queue = d.queue.map(item => ({
                    ...item,
                    tier: convertOldTierToNew(item.tier)
                }));
                cumulativeSeconds = d.cumulativeSeconds || 0;
                if (el.cumulativeTime) el.cumulativeTime.innerText = formatCumulative(cumulativeSeconds);
                if (d.clockFormat) currentClockFormat = d.clockFormat; // Preset load
                renderQueue();

                if (queue.length > 0) {
                    playIndex(0);
                }
            }
        }
    } catch (e) {
        console.warn('Preset load failed:', e);
        alert('プリセットの読み込みに失敗しました');
    }
}

if (el.presetSelect) {
    el.presetSelect.onchange = (e) => {
        loadPresetFile(e.target.value);
        e.target.value = ''; // 選択後に表示をPresetsに戻す
    };
}

// Initialize volume (Defaults to 100, no persistence)
updateVolume(100);

// Clock Logic
let currentClockFormat = 'yyyy/M/d hh:mm:ss.cccc'; // Default per user request

function formatClockDate(d, fmt) {
    const padded = (n, len = 2) => String(n).padStart(len, '0');

    // Check 30h/32h Mode (Extend hours logic)
    let h = d.getHours();
    let displayH = h;
    let displayDate = new Date(d);

    // Check for custom hour logic priority: 32h > 30h
    // 32h: if current hour < 9 (0-8), display as 24-32. Date -1.
    if (fmt.includes('32h') && h < 9) {
        displayH = h + 24;
        displayDate.setDate(d.getDate() - 1);
    } else if (fmt.includes('30h') && h < 6) {
        displayH = h + 24;
        displayDate.setDate(d.getDate() - 1);
    }

    // Date Parts
    const Y = displayDate.getFullYear();
    const M = displayDate.getMonth() + 1;
    const D = displayDate.getDate();

    // Calculated Fields
    const YM = Math.ceil(Y / 1000); // 3rd Millennium for 2001+
    const YC = Math.ceil(Y / 100); // 21st Century

    // Era (Reiwa)
    let era = "S", eraY = Y - 1925;
    if (Y >= 2019) { era = "R"; eraY = Y - 2018; }
    else if (Y >= 1989) { era = "H"; eraY = Y - 1988; }

    // yyyy -> yy conversion (e.g. 令和8)
    const yy = (era === "R" ? "令和" : era === "H" ? "平成" : "昭和") + eraY;
    const yStr = era + eraY;

    // Day of Year (ddd)
    const start = new Date(Y, 0, 0);
    const diff = displayDate - start;
    const oneDay = 1000 * 60 * 60 * 24;
    const ddd = Math.floor(diff / oneDay);

    // Time Parts (Standard)
    const H24 = padded(h); // hh=24 format always shows real hour? User example says "hh=08 (24h)".
    const H12 = padded(h % 12 || 12);
    const APM = h < 12 ? 'AM' : 'PM';
    const mm = padded(d.getMinutes());
    const m = d.getMinutes();
    const ss = padded(d.getSeconds());
    const s = d.getSeconds();
    const ms = d.getMilliseconds();

    // cccc: cs(00-99), ccc: 1/100 fraction, cc: 1/10 fraction(ds), c: 1/10 fraction(ds) simple
    const csVal = Math.floor(ms / 10);
    const dsVal = Math.floor(ms / 100);

    // cccc: センチ秒 (00-99)
    const cccc = padded(csVal, 2);

    // 上付き: ⁰¹²³⁴⁵⁶⁷⁸⁹
    // 下付き: ₀₁₂₃₄₅₆₇₈₉
    const supMap = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
    const subMap = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

    // ccc: 分数表記 (xx/100秒) -> ²³/₁₀₀秒
    const cs10 = Math.floor(csVal / 10); // 10の位
    const cs1 = csVal % 10;              // 1の位
    const topNum = (cs10 === 0 ? "" : supMap[cs10]) + supMap[cs1];

    // 分母 100 
    // 1 -> ¹, 0 -> ₀.  100 -> ¹₀₀
    const bottom100 = `${subMap[1]}${subMap[0]}${subMap[0]}`;
    const ccc = `${topNum}/${bottom100}秒`;

    // cc: デシ秒 (0-9)
    const cc = dsVal.toString();

    // c: 分数表記 (¹/₁₀秒)
    const bottom10 = `${subMap[1]}${subMap[0]}`;
    const c = `${supMap[dsVal]}/${bottom10}秒`;

    // Extended Hours
    const H32 = padded(displayH); // For 32h or 30h token

    // Timezone (PC Local)
    const tzOffset = -d.getTimezoneOffset(); // in minutes
    const tzSign = tzOffset >= 0 ? '+' : '-';
    const tzH = padded(Math.floor(Math.abs(tzOffset) / 60));
    const tzM = padded(Math.abs(tzOffset) % 60);
    const Z = `${tzSign}${tzH}${tzM}`;
    const ZZ = `${tzSign}${tzH}:${tzM}`;

    return fmt.replace(/YM|YC|yyyy|yy|y|MM|M|ddd|dd|d|32h|30h|hh|h|APM|mm|m|ss|s|cccc|ccc|cc|c|ZZ|Z/g, match => {
        switch (match) {
            case 'YM': return YM;
            case 'YC': return YC;
            case 'yyyy': return Y;
            case 'yy': return yy;
            case 'y': return yStr;
            case 'MM': return padded(M);
            case 'M': return M;
            case 'ddd': return ddd;
            case 'dd': return padded(D);
            case 'd': return D;
            case '32h': return H32;
            case '30h': return H32;
            case 'hh': return H24;
            case 'h': return H12;
            case 'APM': return APM;
            case 'mm': return mm;
            case 'm': return m;
            case 'ss': return ss;
            case 's': return s;
            case 'cccc': return cccc;
            case 'ccc': return ccc;
            case 'cc': return cc;
            case 'c': return c;
            case 'Z': return Z;
            case 'ZZ': return ZZ;
            default: return match;
        }
    });
}

const FORMAT_HELP_TEXT = `【時刻フォーマット設定】
YM:千年紀(3), YC:世紀(21), yyyy:西暦(2025)
yy:和暦(令和8), y:和暦略(R8)
MM:月(01), M:月(1)
ddd:通算日, dd:日(02), d:日(2)
32h:32時間制, 30h:30時間制
hh:24時間制, h:12時間制, APM:AM/PM
mm:分(02), m:分(2)
ss:秒(02), s:秒(2)
cccc:センチ秒(00-99), cc:デシ秒(0-9)
ccc:分数表記(²³/₁₀₀秒), c:分数表記(¹/₁₀秒)
Z:タイムゾーン(+0900), ZZ:タイムゾーン(+09:00)`;

function openClockSettings() {
    const existing = document.getElementById('clock-settings-modal');
    if (existing) {
        existing.classList.add('active');
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'clock-settings-modal';
    modal.className = 'help-modal';

    // Preset options
    const presets = [
        { label: '標準 (yyyy/M/d hh:mm:ss.cccc)', val: 'yyyy/M/d hh:mm:ss.cccc' },
        { label: '32時間制 (yyyy/M/d 32h:mm:ss.cccc)', val: 'yyyy/M/d 32h:mm:ss.cccc' },
        { label: '和暦 (yy hh:mm:ss.cccc)', val: 'yy hh:mm:ss.cccc' },
        { label: '和暦略 (y hh:mm:ss.cccc)', val: 'y hh:mm:ss.cccc' },
        { label: '時刻のみ (hh:mm:ss.cccc)', val: 'hh:mm:ss.cccc' }
    ];
    const optionsHtml = presets.map(p => `<option value="${p.val}">${p.label}</option>`).join('');

    modal.innerHTML = `
        <div class="help-content" style="max-width: 500px;">
            <h3 style="margin-top:0;">時計表示設定</h3>
            <pre style="background:rgba(0,0,0,0.3); padding:10px; font-size:0.7rem; border-radius:6px; overflow-x:auto; color:var(--text-muted); line-height:1.2;">${FORMAT_HELP_TEXT}</pre>
            
            <div style="display:flex; flex-direction:column; gap:12px; margin: 1.5rem 0;">
                <div>
                    <label style="display:block; font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;">プリセット</label>
                    <select id="clock-fmt-preset" class="app-input" style="width:100%;">
                        <option value="">-- 選択してください --</option>
                        ${optionsHtml}
                    </select>
                </div>
                <div>
                    <label style="display:block; font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;">フォーマット</label>
                    <input type="text" id="clock-fmt-ui-input" class="app-input" value="${currentClockFormat}" style="width:100%; font-family:monospace;">
                </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button id="clock-fmt-save-btn" class="btn primary-btn" style="padding:0.5rem 1.5rem;">保存</button>
                <button id="clock-fmt-cancel-btn" class="btn" style="padding:0.5rem 1.5rem;">閉じる</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Trigger reflow for transition
    setTimeout(() => modal.classList.add('active'), 10);

    const input = document.getElementById('clock-fmt-ui-input');
    const select = document.getElementById('clock-fmt-preset');

    select.onchange = () => { if (select.value) input.value = select.value; };

    document.getElementById('clock-fmt-save-btn').onclick = () => {
        if (input.value) currentClockFormat = input.value;
        closeClockSettings();
    };

    document.getElementById('clock-fmt-cancel-btn').onclick = closeClockSettings;
    modal.onclick = (e) => { if (e.target === modal) closeClockSettings(); };
}

function closeClockSettings() {
    const modal = document.getElementById('clock-settings-modal');
    if (modal) {
        modal.classList.remove('active');
        // Remove after transition
        setTimeout(() => modal.remove(), 300);
    }
}

function initClock() {
    const clockEl = document.getElementById('clock-display');
    const clockHelpBtn = document.getElementById('clock-help-btn');
    if (!clockEl) return;

    clockEl.style.cursor = 'pointer';
    clockEl.style.pointerEvents = 'auto'; // Enable clicks (overriding CSS)
    clockEl.title = 'クリックして時刻形式を変更';
    clockEl.onclick = (e) => {
        e.stopPropagation();
        openClockSettings();
    };

    if (clockHelpBtn) {
        clockHelpBtn.onclick = (e) => {
            e.stopPropagation();
            openClockSettings();
        };
    }

    function update() {
        const now = new Date();
        clockEl.innerText = formatClockDate(now, currentClockFormat);
        requestAnimationFrame(update);
    }
    update();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initClock();
        initProgressMarkers();
    });
} else {
    initClock();
    initProgressMarkers();
}

// Progress Bar 36-Division Markers
function initProgressMarkers() {
    const pContainer = document.getElementById('progress-container');
    if (!pContainer) return;

    if (document.getElementById('progress-markers-wrapper')) {
        document.getElementById('progress-markers-wrapper').remove();
    }

    const wrapper = document.createElement('div');
    wrapper.id = 'progress-markers-wrapper';

    // PC/スマホ共通でコンテナのoverflowをvisibleにする（マーカー表示のため）
    pContainer.style.position = 'relative';
    pContainer.style.overflow = 'visible';

    if (isTouchDevice) {
        // スマホ用: バーの上に重ねる
        Object.assign(wrapper.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: '5'
        });
        pContainer.appendChild(wrapper);
    } else {
        // PC用: 下に配置
        Object.assign(wrapper.style, {
            position: 'relative',
            width: '100%',
            height: '24px',
            marginTop: '2px',
            pointerEvents: 'none'
        });
        pContainer.parentNode.insertBefore(wrapper, pContainer.nextSibling);
    }

    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '^', '\\'];

    for (let i = 0; i <= 36; i++) {
        const marker = document.createElement('div');
        const pct = (i / 36) * 100;

        Object.assign(marker.style, {
            position: 'absolute',
            left: `${pct}%`,
            top: '0',
            width: '1px',
            height: isTouchDevice ? '100%' : '10px',
            background: isTouchDevice ? 'rgba(255,255,255,0.4)' : 'var(--text-muted, #aaa)',
            transform: 'translateX(-50%)',
            cursor: 'pointer',
            pointerEvents: 'auto',
            zIndex: '5',
            transition: isTouchDevice ? 'none' : 'background 0.1s, height 0.1s'
        });

        const markerDot = document.createElement('div');
        Object.assign(markerDot.style, {
            position: 'absolute',
            left: '50%',
            top: isTouchDevice ? '50%' : '3px',
            width: '4px',
            height: '4px',
            background: isTouchDevice ? '#fff' : 'var(--text-muted, #aaa)',
            borderRadius: '50%',
            transform: isTouchDevice ? 'translate(-50%, -50%)' : 'translateX(-50%)',
            pointerEvents: 'none'
        });
        marker.appendChild(markerDot);

        if (!isTouchDevice) {
            const n = Math.floor(i / 3);
            const mod = i % 3;
            const keyChar = keys[n] || '?';
            let labelText = `↑${keyChar}`;
            if (mod === 1) labelText = `↑/${keyChar}`;
            else if (mod === 2) {
                labelText = (keyChar === '\\' || keyChar === '¥') ? `\\` : `↑\\${keyChar}`;
            }
            if (i === 36 && (keyChar === '\\' || keyChar === '¥')) {
                labelText = `\\`;
            }

            const label = document.createElement('div');
            Object.assign(label.style, {
                position: 'absolute',
                top: '8px',
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: '9pt',
                color: '#aaa',
                whiteSpace: 'nowrap',
                pointerEvents: 'none'
            });
            label.innerText = labelText;
            marker.appendChild(label);

            marker.onmouseover = () => {
                marker.style.background = 'var(--primary, #f00)';
                markerDot.style.background = 'var(--primary, #f00)';
                marker.style.height = '14px';
                label.style.color = '#fff';
                label.style.fontWeight = 'bold';
            };
            marker.onmouseout = () => {
                marker.style.background = 'var(--text-muted, #aaa)';
                markerDot.style.background = 'var(--text-muted, #aaa)';
                marker.style.height = '10px';
                label.style.color = '#aaa';
                label.style.fontWeight = 'normal';
            };
        }

        marker.onclick = (e) => {
            e.stopPropagation();
            mediaSeekToPercent(i / 36);
        };
        wrapper.appendChild(marker);

        if (i < 36) {
            const dot = document.createElement('div');
            const dotPct = ((i + 0.5) / 36) * 100;
            Object.assign(dot.style, {
                position: 'absolute',
                left: `${dotPct}%`,
                top: isTouchDevice ? '50%' : '3px',
                width: '4px',
                height: '4px',
                background: isTouchDevice ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.3)',
                borderRadius: '50%',
                transform: isTouchDevice ? 'translate(-50%, -50%)' : 'translateX(-50%)',
                cursor: 'pointer',
                pointerEvents: 'auto',
                zIndex: '4',
                transition: isTouchDevice ? 'none' : 'background 0.1s, transform 0.1s'
            });
            if (!isTouchDevice) {
                dot.onmouseover = () => {
                    dot.style.background = 'var(--accent, #ffd700)';
                    dot.style.transform = 'translateX(-50%) scale(1.5)';
                };
                dot.onmouseout = () => {
                    dot.style.background = 'rgba(255, 255, 255, 0.3)';
                    dot.style.transform = 'translateX(-50%) scale(1)';
                };
            }
            dot.onclick = (e) => {
                e.stopPropagation();
                mediaSeekToPercent((i + 0.5) / 36);
            };
            wrapper.appendChild(dot);
        }
    }
}


// Ensure all tiers are updated to new format (★ -> ＊) on load
function migrateTiers() {
    if (window.queue && window.queue.length > 0) {
        let updated = false;
        window.queue.forEach(item => {
            const old = item.tier;
            const neu = convertOldTierToNew(old);
            if (old !== neu) {
                item.tier = neu;
                updated = true;
            }
        });
        if (updated && typeof renderQueue === 'function') {
            renderQueue();
            if (currentIndex >= 0 && queue[currentIndex]) {
                applyTierTheme(queue[currentIndex].tier);
            }
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', migrateTiers);
} else {
    setTimeout(migrateTiers, 500); // Wait for other inits
}

// URL Parameter Queue Import
function initFromUrlParams() {
    try {
        const urlParams = window.location.search;
        // Check for ?= format
        if (urlParams.startsWith('?=')) {
            const encoded = urlParams.substring(2); // Remove "?="
            const decoded = decodeURIComponent(encoded);
            const importedQueue = JSON.parse(decoded);

            if (Array.isArray(importedQueue) && importedQueue.length > 0) {
                // Validate and sanitize imported items
                const validTypes = ['youtube', 'soundcloud', 'vimeo'];
                const sanitized = importedQueue
                    .filter(item => item.id && validTypes.includes(item.type || 'youtube'))
                    .map(item => ({
                        id: item.id,
                        type: item.type || 'youtube',
                        title: item.title || 'Untitled',
                        author: item.author || 'Unknown',
                        tier: item.tier || '×',
                        lastTime: 0,
                        duration: 0,
                        memo: ''
                    }));

                if (sanitized.length > 0) {
                    queue = [...queue, ...sanitized];
                    if (typeof renderQueue === 'function') renderQueue();
                    console.log(`Imported ${sanitized.length} tracks from URL`);

                    // Clean URL after import (optional, remove query string)
                    if (window.history && window.history.replaceState) {
                        window.history.replaceState({}, document.title, window.location.pathname);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Failed to parse URL params:', e);
    }
}

// Run URL import on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFromUrlParams);
} else {
    setTimeout(initFromUrlParams, 100);
}


// Shorts Toggle Feature
function toggleShortsAllowed(forceState = null) {
    if (forceState !== null) {
        isShortVideoAllowed = Boolean(forceState);
    } else {
        isShortVideoAllowed = !isShortVideoAllowed;
    }

    // Update UI
    const toggle = document.getElementById('shorts-toggle');
    if (toggle) toggle.checked = isShortVideoAllowed;

    // Show indicator
    const status = isShortVideoAllowed ? "ALLOWED" : "BLOCKED";
    if (el.heldKeysIndicator) {
        el.heldKeysIndicator.innerText = `Shorts Check: ${status}`;
        el.heldKeysIndicator.style.opacity = "1";
        setTimeout(() => { if (heldKeysMap.size === 0) el.heldKeysIndicator.style.opacity = "0"; }, 1000);
    }
}

const shortsToggleListener = document.getElementById('shorts-toggle');
if (shortsToggleListener) {
    shortsToggleListener.addEventListener('change', (e) => toggleShortsAllowed(e.target.checked));
}

// Alarm Logic
function openAlarmSettings() {
    const modal = document.getElementById('alarm-modal');
    if (!modal) return;

    // Restore current config to UI
    document.getElementById('alarm-time').value = alarmConfig.time;
    document.getElementById('alarm-target').value = alarmConfig.target;
    updateAlarmStatusUI();

    modal.classList.add('active');
    document.getElementById('alarm-time').focus();
}

function updateAlarmStatusUI() {
    const statusEl = document.getElementById('alarm-status');
    if (!statusEl) return;
    if (alarmConfig.enabled) {
        statusEl.innerText = `ON (${alarmConfig.time})`;
        statusEl.style.color = 'var(--primary)';
    } else {
        statusEl.innerText = 'OFF';
        statusEl.style.color = 'var(--text-muted)';
    }
}

document.getElementById('btn-alarm-set').onclick = () => {
    const t = document.getElementById('alarm-time').value;
    const tgt = document.getElementById('alarm-target').value;

    if (!t) {
        alert("時刻を設定してください");
        return;
    }

    alarmConfig = {
        enabled: true,
        time: t,
        target: tgt,
        triggered: false
    };
    updateAlarmStatusUI();
    document.getElementById('alarm-modal').classList.remove('active');

    // Feedback
    if (el.heldKeysIndicator) {
        el.heldKeysIndicator.innerText = `Alarm Set: ${t}`;
        el.heldKeysIndicator.style.opacity = "1";
        setTimeout(() => { if (heldKeysMap.size === 0) el.heldKeysIndicator.style.opacity = "0"; }, 2000);
    }
};

document.getElementById('btn-alarm-clear').onclick = () => {
    alarmConfig.enabled = false;
    updateAlarmStatusUI();
    document.getElementById('alarm-time').value = '';
    document.getElementById('alarm-target').value = '';
};

// Check Alarm Loop (Run every second)
setInterval(() => {
    if (!alarmConfig.enabled || alarmConfig.triggered) return;

    const now = new Date();
    // Format HH:mm
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const nowTime = `${h}:${m}`;

    if (nowTime === alarmConfig.time) {
        triggerAlarm();
    }
}, 1000);

async function triggerAlarm() {
    alarmConfig.triggered = true; // Prevent multiple triggers in same minute
    // Auto disable after trigger? or Keep for daily?
    // Let's keep it daily for now, but mark triggered for this minute.
    // To support daily, we need to reset triggered flag when time changes.
    // Simplified: Disable after firing once unless we add Repeat option.
    alarmConfig.enabled = false;

    console.log("ALARM TRIGGERED!");

    const tgt = alarmConfig.target.trim();
    if (!tgt) {
        // Just play current if no target
        mediaPlay();
        return;
    }

    // Check if numeric (Queue Index)
    if (/^\d+$/.test(tgt)) {
        const idx = parseInt(tgt, 10) - 1; // 1-based to 0-based
        if (idx >= 0 && idx < queue.length) {
            playIndex(idx);
        } else {
            console.warn("Alarm: Invalid queue index");
            mediaPlay(); // Fallback
        }
    } else {
        // Assume URL
        try {
            await addNewSong(tgt); // This adds to queue
            // Play the last added song
            playIndex(queue.length - 1);
        } catch (e) {
            console.error("Alarm: URL import failed", e);
            mediaPlay(); // Fallback
        }
    }
}

// Reset trigger flag when minute changes (if we wanted repeating alarm)
// For now, it disables itself, so no need.
