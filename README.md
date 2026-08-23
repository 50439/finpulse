# FinPulse — мультиязычный крипто/финансовый новостной сайт

Живой сайт: **https://finpulse24.com** · Telegram: **@finpulse24news**

Статический сайт на **17 языках** с автопубликацией новостей каждые 6 часов и партнёрскими карточками бирж.
Весь цикл работает без участия человека: RSS → Claude API → сайт → Telegram → IndexNow.

**Языки (17):** en, uk, ru, es, pt, de, fr, ar, zh, hi, id, vi, tr, ja, ko, pl, th
Выбор 7 последних обоснован в `docs/crypto-countries-languages-analysis.md` (легальность крипто по странам + Chainalysis Adoption Index).

## Структура
- `build.js` — генератор сайта (`dist/`), без зависимостей, чистый Node
- `build.test.js` — проверки сборки (гоняются в CI перед деплоем)
- `content/articles.json` — все статьи (пополняется автоматически)
- `data/offers.json` — карточки офферов, 20 шт., переводы на все 17 языков
- `data/i18n.json` — переводы интерфейса
- `brand/` — логотип (SVG, PNG 512, версия с надписью, анимированная SVG), og-картинка, favicon
- `scripts/generate.js` — движок: RSS → Claude API → 2 новые статьи на 17 языках
- `scripts/telegram.js` — постинг свежих статей в канал
- `scripts/indexnow.js` — пинг Bing/Yandex после деплоя
- `.github/workflows/publish.yml` — крон каждые 6 часов + деплой на GitHub Pages

## Как это задеплоено
Хостинг — **GitHub Pages** (не Cloudflare). Один workflow делает всё:

1. `generate.js` — тянет RSS, пишет 2 статьи через Claude API, переводит на 17 языков
2. `telegram.js` — постит их в @finpulse24news
3. коммитит свежие статьи обратно в `main`
4. `build.js` + `build.test.js` — собирает `dist/` и проверяет
5. `actions/deploy-pages` — публикует на finpulse24.com
6. `indexnow.js` — пингует Bing/Yandex

Секреты и переменные в GitHub → Settings → Secrets and variables → Actions:

| Тип | Имя | Назначение |
|---|---|---|
| Secret | `ANTHROPIC_API_KEY` | генерация статей |
| Secret | `TELEGRAM_BOT_TOKEN` | постинг в канал |
| Secret | `TELEGRAM_CHAT_ID` | id канала |
| Variable | `SITE_URL` | `https://finpulse24.com` |
| Variable | `BASE_PATH` | пусто (кастомный домен) |

⚠️ `SITE_URL` и `BASE_PATH` менять нельзя — старые значения (`50439.github.io` / `/finpulse`) ломали sitemap и canonical.

## Партнёрские ссылки — ГЛАВНОЕ ДЛЯ ДОХОДА
В `data/offers.json` у 19 из 20 офферов в поле `url` до сих пор стоит `#REPLACE_WITH_SALESDOUBLER_LINK`.

**Оффер с такой заглушкой на сайт не попадает** — `build.js` его отфильтровывает. Это сделано намеренно:
мёртвая кнопка (клик не делает ничего) хуже, чем её отсутствие, и раньше давала 374 битые CTA на 68 из 86 страниц.

Чтобы оффер появился — впишите в `url` реальную трекинг-ссылку (`https://...`) и закоммитьте. Всё остальное произойдёт само.

### Типы трафика — читайте перед добавлением ссылки
Рекламодатели ограничивают, где можно размещать их ссылки. finpulse24.com — это
«Контентні проєкти (SEO)» + «Редакційний контент (статті)». Если оффер такой трафик
не разрешает, ставить его нельзя: в правилах штраф вплоть до отмены всех конверсий и бана.

Для офферов, которые разрешают **витрины/сервисы сравнения**, но **запрещают статьи**,
есть поле `"placement": "home"` — такой оффер выводится в блоке-витрине на главной,
но не попадает внутрь статей:

```json
{ "id": "paybis", "url": "https://...", "placement": "home" }
```

Это защищено с двух сторон:
- `build.js` **падает с ошибкой**, если такая ссылка всё же оказалась в статье;
- `build.test.js` падает, если у оффера из списка `RESTRICTED_TO_HOME` сняли пометку.

### Гео-таргетинг через языковые версии
Часть офферов работает только в определённых странах. Поле `"langs"` ограничивает
оффер списком языковых версий; нет поля — показывается на всех 17.

```json
{ "id": "coinbase", "url": "https://...", "langs": ["en","de","fr","pt","pl","ja"] }
```

Принцип отбора: язык остаётся, если **хотя бы одна страна этого языка** входит
в разрешённый список оффера. Гео — не запрет (в отличие от типа трафика),
а условие засчёта конверсии, поэтому режутся только заведомо мёртвые связки.

### Текущая карта (кабинет SalesDoubler, 23.08.2026)

| Оффер | Статьи | Языки | Основание |
|---|---|---|---|
| Binance | да | все 17 | свой реферальный, правил сети нет |
| CoinBase | да | en de fr pt pl ja | разрешено ~29 стран; нет Испании, Украины, России, Турции, Индии, Индонезии, Вьетнама, Кореи, Таиланда, Китая |
| RockWallet | да | en | только США (кроме 8 штатов) |
| Paybis | **нет** | en de fr pt pl ar | ГЕО: EE FI HU IT LT PL PT SE BH HK AT BE CH DE IL NL NO US CA |
| Changelly | **нет** | все, кроме zh ja ko ru | чёрный список стран: Китай, Япония, Корея, Россия |
| Nexo, Kraken | — | — | не подключены: запрещены и статьи, и витрины |

Ждут апрува, `langs` уже проставлены: Libertex `uk`, ByBit `uk`, FxPro `uk`,
IN1 `de fr es pt pl` (ЕС), PocketOption `es pt tr ar uk ru hi id th`, Trezor — весь мир.

**Внимание:** на `ru`, `zh`, `ko` сейчас остаётся только Binance — эти языковые
версии почти не монетизируются. Нужны отдельные офферы под эти рынки.

### Защита от нарушений
Четыре сценария, каждый проверен намеренным сломом:

| Что сломали | Что упадёт |
|---|---|
| сняли `placement` в offers.json | `build.test.js` |
| сняли `langs` в offers.json | `build.test.js` |
| `build.js` перестал учитывать `langs` | `build.test.js` |
| `build.js` пустил home-only оффер в статью | **`build.js`, сборка останавливается** |

Списки `RESTRICTED_TO_HOME` и `GEO_LIMITED` зафиксированы прямо в `build.test.js` —
снятие пометки в данных роняет тест, а не отключает защиту.

Полная карта офферов, ставок и поданных заявок — в проектном документе `claude/finpulse-salesdoubler.md`.

## Локально
```bash
node build.js && node build.test.js     # собрать + проверить
npx serve dist                          # посмотреть сайт
ANTHROPIC_API_KEY=sk-... node scripts/generate.js   # сгенерировать свежие статьи
```
`build.js` печатает, сколько офферов скрыто из-за отсутствия ссылки.

## SEO из коробки
hreflang на все 17 языков, canonical, sitemap.xml (hourly), robots.txt, JSON-LD (NewsArticle/WebSite),
og-image + twitter:card, favicon/apple-touch-icon, мобильная вёрстка, sticky-CTA, живой тикер цен (CoinGecko).

Подключено: Google Search Console (файл `google56e389dfbc1262f1.html` пишется в `build.js` — **не удалять**),
Bing Webmaster Tools, IndexNow (ключ `ee221c0a3d35f01be5577688fa06a50a`).
