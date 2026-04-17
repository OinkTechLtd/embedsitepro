/**
 * ProxyDPI — YouTube proxy viewer
 * Автоматически перебирает доступные прокси и выбирает рабочий
 */

const PROXIES = [
  {
    name: 'Vercel #1',
    base: 'https://secure-272717.vercel.app',
    buildUrl: (videoId) => `https://secure-272717.vercel.app/youtube.com/embed/${videoId}`,
  },
  {
    name: 'TatNet',
    base: 'https://secure-272717.tatnet.app',
    buildUrl: (videoId) => `https://secure-272717.tatnet.app/youtube.com/embed/${videoId}`,
  },
  {
    name: 'Heroku',
    base: 'https://secure-ridge-22999-537c838d4a8a.herokuapp.com',
    buildUrl: (videoId) => `https://secure-ridge-22999-537c838d4a8a.herokuapp.com/youtube.com/embed/${videoId}`,
  },
];

// Кэш результатов проверки прокси (живёт 5 минут)
const proxyCache = {};
const CACHE_TTL = 5 * 60 * 1000;

let currentVideoId = null;
let currentProxyIndex = 0;
let iframeLoaded = false;

// ─── URL PARSING ────────────────────────────────────────────────────────────

function extractVideoId(input) {
  if (!input || !input.trim()) return null;
  const s = input.trim();

  // Чистый ID (11 символов)
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;

  // Попытка парсить как URL
  let url;
  try {
    url = new URL(s.startsWith('http') ? s : 'https://' + s);
  } catch {
    // не URL — может, короткая ссылка или часть пути
    const m = s.match(/[a-zA-Z0-9_-]{11}/);
    return m ? m[0] : null;
  }

  // youtu.be/ID
  if (url.hostname === 'youtu.be') {
    return url.pathname.slice(1).split('?')[0] || null;
  }

  // ?v=ID
  if (url.searchParams.get('v')) return url.searchParams.get('v');

  // /embed/ID
  const embedMatch = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];

  // /shorts/ID
  const shortsMatch = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch) return shortsMatch[1];

  // /v/ID
  const vMatch = url.pathname.match(/\/v\/([a-zA-Z0-9_-]{11})/);
  if (vMatch) return vMatch[1];

  return null;
}

// ─── PROXY HEALTH CHECK ──────────────────────────────────────────────────────

async function checkProxy(proxy) {
  const now = Date.now();
  if (proxyCache[proxy.base] && now - proxyCache[proxy.base].ts < CACHE_TTL) {
    return proxyCache[proxy.base].ok;
  }

  try {
    // Пингуем базовый URL прокси через fetch (no-cors чтобы не упасть на CORS)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    await fetch(proxy.base, { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
    clearTimeout(timer);
    proxyCache[proxy.base] = { ok: true, ts: now };
    return true;
  } catch {
    proxyCache[proxy.base] = { ok: false, ts: now };
    return false;
  }
}

// ─── MAIN LOAD LOGIC ─────────────────────────────────────────────────────────

async function loadVideo() {
  const input = document.getElementById('url-input').value;
  const videoId = extractVideoId(input);

  if (!videoId) {
    showToast('Не удалось распознать ссылку. Вставь URL или ID видео.');
    return;
  }

  currentVideoId = videoId;
  currentProxyIndex = 0;
  iframeLoaded = false;

  showPlayer();
  setStatus('yellow', 'Проверяем прокси...');
  showLoader();

  // Обновляем URL страницы для шаринга
  const shareUrl = `${location.origin}${location.pathname}?v=${videoId}`;
  history.replaceState(null, '', shareUrl);

  await tryNextProxy();
}

async function tryNextProxy() {
  if (currentProxyIndex >= PROXIES.length) {
    showError('Все прокси недоступны. Попробуйте позже или обновите страницу.');
    setStatus('red', 'Нет связи');
    return;
  }

  const proxy = PROXIES[currentProxyIndex];
  setStatus('yellow', `Подключаемся: ${proxy.name}...`);

  const ok = await checkProxy(proxy);
  if (!ok) {
    currentProxyIndex++;
    await tryNextProxy();
    return;
  }

  const embedUrl = proxy.buildUrl(currentVideoId) + '?autoplay=1&rel=0&modestbranding=1';

  loadInIframe(embedUrl, proxy);
}

function loadInIframe(url, proxy) {
  const frame = document.getElementById('yt-frame');
  const loader = document.getElementById('loader');

  iframeLoaded = false;

  frame.style.display = 'none';
  loader.style.display = 'flex';
  document.getElementById('error-block').style.display = 'none';

  // Таймаут — если iframe не ответил за 12с, пробуем следующий
  const timeout = setTimeout(() => {
    if (!iframeLoaded) {
      currentProxyIndex++;
      tryNextProxy();
    }
  }, 12000);

  frame.onload = () => {
    iframeLoaded = true;
    clearTimeout(timeout);
    loader.style.display = 'none';
    frame.style.display = 'block';
    setStatus('green', `Работает через ${proxy.name}`);
    document.getElementById('player-title').textContent = `Видео: ${currentVideoId}`;
  };

  frame.onerror = () => {
    clearTimeout(timeout);
    currentProxyIndex++;
    tryNextProxy();
  };

  frame.src = url;
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────

function showPlayer() {
  const section = document.getElementById('player-section');
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showLoader() {
  document.getElementById('loader').style.display = 'flex';
  document.getElementById('yt-frame').style.display = 'none';
  document.getElementById('error-block').style.display = 'none';
}

function showError(msg) {
  document.getElementById('loader').style.display = 'none';
  document.getElementById('yt-frame').style.display = 'none';
  const eb = document.getElementById('error-block');
  document.getElementById('error-msg').textContent = msg;
  eb.style.display = 'flex';
}

function setStatus(color, text) {
  const dot = document.getElementById('status-dot');
  dot.className = 'dot ' + color;
  document.getElementById('status-text').textContent = text;
}

function retryLoad() {
  if (!currentVideoId) return;
  currentProxyIndex = 0;
  Object.keys(proxyCache).forEach(k => delete proxyCache[k]); // сбросить кэш
  showLoader();
  setStatus('yellow', 'Повторное подключение...');
  tryNextProxy();
}

function openNewSearch() {
  document.getElementById('url-input').value = '';
  document.getElementById('url-input').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function copyLink() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Ссылка скопирована!');
  }).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Ссылка скопирована!');
  });
}

function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

function demo() {
  document.getElementById('url-input').value = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
  loadVideo();
}

// ─── KEYBOARD SUPPORT ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('url-input');

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadVideo();
  });

  // Обработка ?v= параметра в URL (для шаринга)
  const params = new URLSearchParams(location.search);
  const vParam = params.get('v');
  if (vParam) {
    input.value = vParam;
    loadVideo();
  }

  // Обработка формата /youtube.com/embed/ID в пути (для прямых ссылок)
  const pathMatch = location.pathname.match(/\/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (pathMatch) {
    input.value = pathMatch[1];
    loadVideo();
  }
});

// ─── PASTE DETECTION ─────────────────────────────────────────────────────────

document.getElementById && document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('url-input');
  if (input) {
    input.addEventListener('paste', () => {
      setTimeout(() => {
        const val = input.value.trim();
        if (val && (val.includes('youtube') || val.includes('youtu.be') || /^[a-zA-Z0-9_-]{11}$/.test(val))) {
          loadVideo();
        }
      }, 50);
    });
  }
});
