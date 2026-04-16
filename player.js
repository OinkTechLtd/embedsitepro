/**
 * EmbedSitePro — Player Logic
 * Стратегии (по порядку):
 *  1. Прямой iframe — если сайт разрешает встраивание
 *  2. CORS-прокси (allorigins / corsproxy.io) → парсим HTML, ищем плеер
 *  3. Если нашли iframe/embed src — встраиваем его напрямую
 *  4. Если нашли .m3u8 / .mp4 — нативный HTML5/HLS плеер
 *  5. Ошибка с кнопкой "открыть оригинал"
 */

let currentUrl = '';

const CORS_PROXIES = [
  url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

// ─── Инициализация ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const urlParam = params.get('url');
  if (urlParam) {
    document.getElementById('urlInput').value = urlParam;
    startLoad(urlParam);
  }
});

// ─── Точки входа ─────────────────────────────────────────────────
function loadUrl() {
  const val = document.getElementById('urlInput').value.trim();
  if (!val) return;
  const url = val.startsWith('http') ? val : 'https://' + val;
  document.getElementById('urlInput').value = url;
  startLoad(url);
}

function loadFromStart() {
  const val = document.getElementById('startInput').value.trim();
  if (!val) return;
  const url = val.startsWith('http') ? val : 'https://' + val;
  document.getElementById('urlInput').value = url;
  startLoad(url);
}

function quickLoad(url) {
  document.getElementById('urlInput').value = url;
  startLoad(url);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement === document.getElementById('urlInput')) {
    loadUrl();
  }
});

// ─── Основной поток ───────────────────────────────────────────────
async function startLoad(url) {
  currentUrl = url;
  history.replaceState({}, '', `player.html?url=${encodeURIComponent(url)}`);

  showLoader('Загружаем страницу...');
  hide('startScreen');

  // Шаг 1: пробуем прямой iframe
  setLoaderStep('Проверяем iframe-доступ...');
  const iframeOk = await tryIframe(url);
  if (iframeOk) return;

  // Шаг 2: тянем HTML через CORS-прокси и парсим
  setLoaderStep('Ищем плеер на странице...');
  const html = await fetchHtmlViaCors(url);
  if (!html) {
    showError(
      'Не удалось загрузить страницу',
      'Сайт не разрешает встраивание и блокирует CORS-запросы. Попробуй открыть оригинал в новой вкладке.',
      url
    );
    return;
  }

  setLoaderStep('Анализируем источники...');
  const sources = extractSources(html, url);

  if (sources.hls.length > 0) {
    setLoaderStep('Найден HLS-поток! Запускаем...');
    playHls(sources.hls[0], url);
    return;
  }

  if (sources.mp4.length > 0) {
    setLoaderStep('Найдено прямое видео!');
    playMp4(sources.mp4[0], url);
    return;
  }

  if (sources.iframes.length > 0) {
    setLoaderStep('Найден iframe-плеер!');
    // Пробуем встроить iframe плеера напрямую
    showIframe(sources.iframes[0]);
    return;
  }

  if (sources.embeds.length > 0) {
    setLoaderStep('Найден embed-плеер!');
    showIframe(sources.embeds[0]);
    return;
  }

  // Ничего не нашли
  showError(
    'Плеер не найден',
    'На странице не обнаружено iframe/video/HLS источников. Возможно, плеер загружается через JS после взаимодействия.',
    url
  );
}

// ─── Стратегия 1: прямой iframe ──────────────────────────────────
function tryIframe(url) {
  return new Promise(resolve => {
    const iframe = document.getElementById('mainIframe');
    const overlay = document.getElementById('iframeOverlay');
    const wrap = document.getElementById('iframeWrap');

    // Список сайтов, которые 100% блокируют iframe
    const blockedDomains = [
      'youtube.com', 'vk.com', 'ok.ru', 'rutube.ru',
      'facebook.com', 'instagram.com', 'tiktok.com',
    ];
    const domain = extractDomain(url);
    if (blockedDomains.some(d => domain.includes(d))) {
      resolve(false);
      return;
    }

    // Временно показываем iframe, ждём load или error
    iframe.src = url;
    show(wrap, 'flex');
    overlay.style.display = 'none';
    hideLoader();

    let resolved = false;

    const onLoad = () => {
      if (resolved) return;
      // Пытаемся понять, не пустой ли iframe (X-Frame-Options)
      try {
        // Если доступ — ok, если ошибка доступа — заблокирован
        const _ = iframe.contentWindow.location.href;
        resolved = true;
        // Iframe загрузился — но нам нужен ТОЛЬКО плеер, не весь сайт
        // Поэтому сразу анализируем HTML тоже
        resolve(true);
      } catch (e) {
        // SecurityError — значит сайт открылся (кросс-доменный), но доступа нет
        // Это нормально для кросс-доменных iframe — считаем успехом
        resolved = true;
        resolve(true);
      }
    };

    const onError = () => {
      if (resolved) return;
      resolved = true;
      hide(wrap);
      resolve(false);
    };

    iframe.addEventListener('load', onLoad, { once: true });
    iframe.addEventListener('error', onError, { once: true });

    // Timeout — если за 8 сек не загрузилось
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Не загрузилось — попробуем другие стратегии
        hide(wrap);
        iframe.src = '';
        resolve(false);
      }
    }, 8000);
  });
}

// ─── Стратегия 2: CORS-прокси ────────────────────────────────────
async function fetchHtmlViaCors(url) {
  for (const proxyFn of CORS_PROXIES) {
    try {
      const proxyUrl = proxyFn(url);
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data && data.contents) return data.contents;
      const text = await res.text().catch(() => null);
      if (text && text.length > 100) return text;
    } catch (e) {
      // пробуем следующий прокси
    }
  }
  return null;
}

// ─── Парсер источников ────────────────────────────────────────────
function extractSources(html, baseUrl) {
  const sources = { hls: [], mp4: [], iframes: [], embeds: [] };
  const base = new URL(baseUrl);

  // HLS потоки (.m3u8)
  const hlsMatches = html.matchAll(/["'`\s](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)/gi);
  for (const m of hlsMatches) {
    const u = m[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
    if (!sources.hls.includes(u)) sources.hls.push(u);
  }
  // m3u8 без полного URL
  const hlsRel = html.matchAll(/["'`](\/[^"'`\s]+\.m3u8[^"'`\s]*)/gi);
  for (const m of hlsRel) {
    const u = base.origin + m[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
    if (!sources.hls.includes(u)) sources.hls.push(u);
  }

  // MP4
  const mp4Matches = html.matchAll(/["'`\s](https?:\/\/[^"'`\s]+\.mp4[^"'`\s]*)/gi);
  for (const m of mp4Matches) {
    if (!sources.mp4.includes(m[1])) sources.mp4.push(m[1]);
  }

  // Iframes — ищем src плееров
  const iframeMatches = html.matchAll(/<iframe[^>]+src=["']([^"']+)["'][^>]*/gi);
  for (const m of iframeMatches) {
    let src = m[1];
    if (src.startsWith('//')) src = 'https:' + src;
    if (src.startsWith('/')) src = base.origin + src;
    if (!src.startsWith('http')) continue;
    // Пропускаем рекламные и служебные iframe
    if (isAdFrame(src)) continue;
    if (!sources.iframes.includes(src)) sources.iframes.push(src);
  }

  // Embeds
  const embedMatches = html.matchAll(/<embed[^>]+src=["']([^"']+)["']/gi);
  for (const m of embedMatches) {
    let src = m[1];
    if (src.startsWith('//')) src = 'https:' + src;
    if (src.startsWith('/')) src = base.origin + src;
    if (!sources.embeds.includes(src)) sources.embeds.push(src);
  }

  // Поиск JSON-LD / data-src / data-url плееров
  const dataSrc = html.matchAll(/data-(?:src|url|stream)=["']([^"']+\.(?:m3u8|mp4)[^"']*)/gi);
  for (const m of dataSrc) {
    let src = m[1];
    if (src.startsWith('/')) src = base.origin + src;
    if (src.includes('.m3u8') && !sources.hls.includes(src)) sources.hls.push(src);
    if (src.includes('.mp4') && !sources.mp4.includes(src)) sources.mp4.push(src);
  }

  // Поиск в JS-коде: file: "...", src: "...", stream: "..."
  const jsStream = html.matchAll(/(?:file|src|stream|url|source)\s*[:=]\s*["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)/gi);
  for (const m of jsStream) {
    const u = m[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
    if (!sources.hls.includes(u)) sources.hls.push(u);
  }

  return sources;
}

// Список рекламных / служебных доменов
function isAdFrame(url) {
  const adDomains = [
    'googletagmanager', 'googlesyndication', 'doubleclick', 'google-analytics',
    'facebook.com/plugins', 'mc.yandex', 'top.mail.ru', 'counter.yadro',
    'adnxs.com', 'openx.net', 'pubmatic.com', 'rubiconproject.com',
    'advertising.com', 'adform.net', 'criteo.com', 'smartadserver.com',
    'adriver.ru', 'begun.ru', 'smi2.ru',
  ];
  return adDomains.some(d => url.includes(d));
}

// ─── Показ результатов ────────────────────────────────────────────
function showIframe(src) {
  hideLoader();
  hide('startScreen');
  hide('nativeWrap');
  hide('errorScreen');

  const iframe = document.getElementById('mainIframe');
  const wrap = document.getElementById('iframeWrap');
  const overlay = document.getElementById('iframeOverlay');

  iframe.src = src;
  overlay.style.display = 'none';
  show(wrap, 'flex');
}

function playHls(src, label) {
  hideLoader();
  hide('startScreen');
  hide('iframeWrap');
  hide('errorScreen');

  const wrap = document.getElementById('nativeWrap');
  const video = document.getElementById('nativeVideo');
  const lbl = document.getElementById('nativeLabel');

  lbl.textContent = '📡 ' + extractDomain(label || src);
  show(wrap, 'flex');

  if (Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true });
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        showError('Ошибка HLS-потока', 'Поток недоступен или требует авторизации: ' + src, currentUrl);
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
    video.play().catch(() => {});
  } else {
    showError('HLS не поддерживается', 'Ваш браузер не поддерживает HLS. Попробуйте Chrome или Firefox.', currentUrl);
  }
}

function playMp4(src, label) {
  hideLoader();
  hide('startScreen');
  hide('iframeWrap');
  hide('errorScreen');

  const wrap = document.getElementById('nativeWrap');
  const video = document.getElementById('nativeVideo');
  const lbl = document.getElementById('nativeLabel');

  lbl.textContent = '🎬 ' + extractDomain(label || src);
  show(wrap, 'flex');
  video.src = src;
  video.play().catch(() => {});
}

// ─── UI helpers ──────────────────────────────────────────────────
function showLoader(msg) {
  hide('startScreen');
  hide('iframeWrap');
  hide('nativeWrap');
  hide('errorScreen');
  document.getElementById('loaderText').textContent = msg;
  document.getElementById('loaderSteps').innerHTML = '';
  show('loaderScreen', 'flex');
}

function hideLoader() {
  hide('loaderScreen');
}

function setLoaderStep(msg) {
  const steps = document.getElementById('loaderSteps');
  const el = document.createElement('div');
  el.className = 'loader-step';
  el.textContent = '✓ ' + msg;
  steps.appendChild(el);
  document.getElementById('loaderText').textContent = msg;
}

function showError(title, msg, url) {
  hideLoader();
  hide('iframeWrap');
  hide('nativeWrap');
  hide('startScreen');
  document.getElementById('errorTitle').textContent = title;
  document.getElementById('errorMsg').textContent = msg;
  show('errorScreen', 'flex');
}

function resetPlayer() {
  hide('iframeWrap');
  hide('nativeWrap');
  hide('errorScreen');
  hide('loaderScreen');
  show('startScreen', 'flex');
  document.getElementById('urlInput').value = '';
  history.replaceState({}, '', 'player.html');
}

function show(id, display) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el) el.style.display = display || 'block';
}

function hide(id) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el) el.style.display = 'none';
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

// ─── Дополнительные действия ──────────────────────────────────────
function tryDirectExtract() {
  if (!currentUrl) return;
  startLoad(currentUrl);
}

function openOriginal() {
  if (currentUrl) window.open(currentUrl, '_blank');
}

function toggleFullscreen() {
  const area = document.getElementById('playerArea');
  if (!document.fullscreenElement) {
    area.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

function showEmbed() {
  if (!currentUrl) return;
  const embedUrl = window.location.origin + window.location.pathname + '?url=' + encodeURIComponent(currentUrl);
  const code = `<iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; fullscreen"></iframe>`;
  document.getElementById('embedCode').value = code;
  show('embedModal', 'flex');
}

function copyEmbed() {
  const ta = document.getElementById('embedCode');
  ta.select();
  document.execCommand('copy');
  const btn = event.target;
  btn.textContent = 'Скопировано ✓';
  setTimeout(() => btn.textContent = 'Скопировать', 2000);
}

function closeEmbed(e) {
  if (e.target.id === 'embedModal') closeEmbedModal();
}

function closeEmbedModal() {
  hide('embedModal');
}

// ─── Keyboard shortcuts ──────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeEmbedModal();
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});
