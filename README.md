# FinPulse — мультиязычный крипто/финансовый новостной сайт

Статический сайт на 10 языках (en, uk, ru, es, pt, de, fr, ar, zh, hi) с автопубликацией новостей каждые 6 часов и партнёрскими карточками бирж (SalesDoubler).

## Структура
- `build.js` — генератор сайта (dist/), без зависимостей, чистый Node
- `content/articles.json` — все статьи (пополняется автоматически)
- `data/offers.json` — карточки офферов (Binance, Bybit, OKX, Bitget, KuCoin, Exness, XM)
- `data/i18n.json` — переводы интерфейса
- `scripts/generate.js` — движок: RSS → Claude API → 3 новые статьи на 10 языках
- `.github/workflows/publish.yml` — крон каждые 6 часов

## Деплой (один раз, ~15 минут)
1. Создайте репозиторий на GitHub и запушьте эту папку.
2. В GitHub: Settings → Secrets and variables → Actions:
   - Secret `ANTHROPIC_API_KEY` = ваш ключ с console.anthropic.com
   - Variable `SITE_URL` = https://ваш-домен.com
3. Cloudflare Dash → Workers & Pages → Create → Pages → Connect to Git:
   - Build command: `node build.js`
   - Build output directory: `dist`
   - Environment variable: `SITE_URL` = https://ваш-домен.com
4. Привяжите домен в Cloudflare Pages → Custom domains.
5. В GitHub → Actions → «Auto-publish news every 6 hours» → Run workflow (первый запуск вручную).

Дальше всё автоматически: каждые 6 часов Actions генерирует 3 свежие статьи на 10 языках, коммитит их, Cloudflare пересобирает сайт.

## Партнёрские ссылки
В `data/offers.json` замените `#REPLACE_WITH_SALESDOUBLER_LINK` на ваши трекинг-ссылки из кабинета SalesDoubler, затем закоммитьте.

## Локально
```
node build.js && node build.test.js
npx serve dist   # посмотреть сайт
ANTHROPIC_API_KEY=sk-... node scripts/generate.js   # сгенерировать свежие статьи
```

## SEO из коробки
hreflang на все 10 языков, canonical, sitemap.xml (hourly), robots.txt, JSON-LD (NewsArticle/WebSite), мобильная версия, sticky-CTA, живой тикер цен (CoinGecko).
