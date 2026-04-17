# ProxyDPI — YouTube без блокировок

Смотри YouTube в России без VPN. Вставь ссылку — смотри прямо сейчас.

## Как работает

1. Пользователь вставляет ссылку на YouTube видео
2. Приложение автоматически перебирает 3 прокси сервера
3. Находит рабочий и загружает видео через embed
4. Если прокси упал — автоматически переключается на следующий

## Прокси серверы (в порядке приоритета)

| Сервер | URL |
|--------|-----|
| Vercel | `https://secure-272717.vercel.app` |
| TatNet | `https://secure-272717.tatnet.app` |
| Heroku | `https://secure-ridge-22999-537c838d4a8a.herokuapp.com` |

Формат embed URL: `{PROXY}/youtube.com/embed/{VIDEO_ID}`

## Быстрый деплой

### Vercel (рекомендуется)

```bash
npm i -g vercel
vercel --prod
```

Или через [vercel.com](https://vercel.com) — перетащи папку.

### Netlify

Перетащи папку на [netlify.com/drop](https://app.netlify.com/drop)  
`_redirects` уже настроен.

### GitHub Pages

```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/USERNAME/proxydpi.git
git push -u origin main
```
Включи GitHub Pages → `main` ветка → `/` (root).

## Структура файлов

```
proxydpi/
├── index.html      — лендинг + плеер
├── style.css       — стили (тёмная тема)
├── app.js          — логика: парсинг URL, fallback прокси
├── vercel.json     — роутинг для Vercel
├── _redirects      — роутинг для Netlify
├── 404.html        — редирект для прямых /youtube.com/embed/ID ссылок
└── README.md       — этот файл
```

## Прямые ссылки

Видео открывается по ссылке вида:

```
https://твой-домен.vercel.app/?v=VIDEO_ID
https://твой-домен.vercel.app/youtube.com/embed/VIDEO_ID
```

## Добавить прокси

Отредактируй массив `PROXIES` в `app.js`:

```js
const PROXIES = [
  {
    name: 'Мой прокси',
    base: 'https://my-proxy.example.com',
    buildUrl: (videoId) => `https://my-proxy.example.com/youtube.com/embed/${videoId}`,
  },
  // ...
];
```

## Поддерживаемые форматы ввода

- `https://youtube.com/watch?v=dQw4w9WgXcQ`
- `https://youtu.be/dQw4w9WgXcQ`
- `https://youtube.com/shorts/dQw4w9WgXcQ`
- `https://youtube.com/embed/dQw4w9WgXcQ`
- `dQw4w9WgXcQ` (просто ID)
