#!/usr/bin/env node
/**
 * FinPulse — генератор вертикальных видео-новостей (TikTok / Shorts / Reels).
 *
 * Зачем: Telegram раздаёт контент тем, кто уже подписан. TikTok — платформа
 * ОТКРЫТИЙ: показывает незнакомым. Это единственный доступный канал, где
 * аудитория может появиться без ссылочной массы и без бюджета.
 *
 * Чем НЕ является: это не лечение индексации. Ссылка в профиле TikTok закрыта
 * nofollow и веса домену не даёт. Ролики дают трафик, а не авторитет.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/video.json'), 'utf8'));

// Режем абзац на предложения — из них потом собираются карточки ролика.
// Сокращения («U.S.», «Inc.») концом предложения НЕ считаются: иначе карточка
// обрывается на середине мысли и на экране висит огрызок в два слова.
const ABBR = /\b(?:U\.S|U\.K|E\.U|Inc|Ltd|Corp|Co|vs|approx|etc|e\.g|i\.e|Mr|Mrs|Ms|Dr|St|No)\.$/i;
function sentences(text) {
  const out = [];
  let buf = '';
  for (const chunk of String(text).split(/(?<=[.!?])\s+/)) {
    buf = buf ? buf + ' ' + chunk : chunk;
    if (ABBR.test(buf.trim())) continue;
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// Из предложений собираем карточки. Слишком короткое склеиваем со следующим:
// карточка в два слова — это пустой экран на три секунды, на нём зритель уходит.
// Слишком длинное не берём вовсе — на 1080 px оно превращается в мелкую стену текста.
// CARD_MAX 200 давал ~10 с речи на карточку. При замеренном удержании 3,64 с
// это заведомо больше, чем зритель готов слушать: режем до ~7 с.
const CARD_MIN = 60, CARD_MAX = 145;
function bodyCards(paragraphs, limit) {
  const cards = [];
  let buf = '';
  for (const s of (paragraphs || []).flatMap(sentences)) {
    if (s.length > CARD_MAX) { buf = ''; continue; }
    buf = buf ? buf + ' ' + s : s;
    if (buf.length >= CARD_MIN) {
      if (buf.length <= CARD_MAX) cards.push(buf);
      buf = '';
    }
    if (cards.length >= limit) break;
  }
  return cards.slice(0, limit);
}

// Плашка на первом кадре. «BREAKING» ставится ТОЛЬКО на свежую новость:
// на материале шестидневной давности это враньё зрителю, а для новостного
// аккаунта репутация дороже охвата.
const FRESH_MS = 48 * 60 * 60 * 1000;
const kickerFor = (dateIso, now) => (
  (now || Date.now()) - Date.parse(dateIso) <= FRESH_MS ? 'Breaking' : 'Crypto'
);

// Заголовок целиком на первом кадре — это девять слов, которые надо прочесть
// за секунду. Замер первого ролика: среднее время просмотра 3,64 с из 39,
// «большинство зрителей перестали смотреть в 0:01». Поэтому заголовок режется:
// первые 2-4 слова уходят на «крючок» огромным кеглем, остальное — на второй кадр.
function hookSplit(title) {
  const words = String(title).trim().split(/\s+/).filter(Boolean);
  if (words.length <= 4) return [words.join(' '), ''];
  // 22 символа и 3 слова — это предел того, что читается «одним взглядом».
  // Первый вариант допускал 34 символа, и на экран лезло «Standard Chartered
  // Becomes First» в четыре строки: обрывок фразы, который надо дочитывать.
  let n = 0;
  for (let i = 1; i <= Math.min(3, words.length - 1); i++) {
    if (words.slice(0, i).join(' ').length <= 22) n = i; else break;
  }
  if (!n) n = 1;
  return [words.slice(0, n).join(' '), words.slice(n).join(' ')];
}

// Кегль крючка. Полезная ширина кадра — 1080 - 84 (левое поле) - 190 (правое,
// под иконки TikTok) = 806 px; в DejaVu Sans Bold прописная буква занимает
// ~0,66 кегля. Значит самое длинное слово диктует потолок: при фиксированных
// 168 px «INDIA'S FOREX RESERVES» обрезало «RESERVES» краем кадра (05.09).
const HOOK_W = 806, CHAR_W = 0.66, HOOK_MAX = 168, HOOK_MIN = 96;
function hookSize(text) {
  const longest = String(text).trim().split(/\s+/).reduce((m, w) => Math.max(m, w.length), 1);
  return Math.max(HOOK_MIN, Math.min(HOOK_MAX, Math.floor(HOOK_W / (CHAR_W * longest))));
}

// Кегль от длины текста. Заголовок («крючок») крупнее обычной карточки:
// первые две секунды решают, останется зритель или пролистнёт.
const fitSize = (text, big) => {
  const n = String(text).length;
  if (big) return n < 60 ? 92 : n < 100 ? 78 : 64;
  return n < 80 ? 66 : n < 140 ? 56 : 48;
};

// Описание под роликом. URL в текст НЕ кладём: TikTok ссылки в описании не
// кликает, они только съедают место и читаются как спам. Работает ссылка в профиле.
function caption(t) {
  const tags = ['FinPulse', ...(cfg.hashtags || [])].map(h => '#' + h).join(' ');
  return t.title + '\n\n' + (t.excerpt || '') +
    '\n\nFull story: ' + cfg.site + ' (link in bio)\n\n' + tags + '\n';
}

// Длительность карточки. С озвучкой — РЕАЛЬНАЯ длина аудио плюс пауза: без паузы
// карточки сменяются встык и ролик частит, а с фиксированной длительностью голос
// и текст разъезжаются уже к третьей карточке.
const PAUSE = 0.45;
const cardDuration = audioSec => (audioSec > 0 ? audioSec + PAUSE : (cfg.secondsPerCardSilent || 3.6));


// Какой синтезатор речи использовать. Локальные модели (Kokoro, Piper) крутятся
// на том же раннере: ключа нет, счёта нет, лимита нет — поэтому требовать для них
// переменную окружения нельзя, иначе выключится единственный бесплатный вариант.
// Облачные (OpenAI, ElevenLabs) без ключа молча отключаются: ролик всё равно
// соберётся, просто молча.
const LOCAL_TTS = ['kokoro', 'piper'];
function ttsMode(cfg, env) {
  cfg = cfg || {}; env = env || {};
  if (cfg.enabled === false) return 'none';
  const p = String(cfg.provider || 'kokoro').toLowerCase();
  if (LOCAL_TTS.includes(p)) return p;
  if (p === 'elevenlabs') return env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'none';
  return env.OPENAI_API_KEY ? 'openai' : 'none';
}

// ---------------------------------------------------------------- вёрстка карточки

const ttsCfg = (() => {
  const p = path.join(ROOT, 'data/tts.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
})();

// Ник берём из общей точки правды data/social.json — чтобы подпись в ролике,
// кнопка в подвале сайта и sameAs не разъезжались между собой.
const social = (() => {
  const p = path.join(ROOT, 'data/social.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
})();
const HANDLE = (social.tiktok && social.tiktok.trim())
  ? '@' + social.tiktok.trim().replace(/^@/, '') : (cfg.handle || '');

const OUT = process.env.VIDEO_OUT || path.join(ROOT, 'out/video');
const DONE_FILE = path.join(ROOT, 'content/video-done.json');
const LANG = cfg.lang || 'en';
const W = cfg.width || 1080, H = cfg.height || 1920, FPS = cfg.fps || 30;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Карточка — это обычная HTML-страница 1080×1920. Так она выглядит ровно как сайт
// (та же палитра, те же кольца из логотипа), и вёрстку можно править глазами.
// Сборка кадров ролика. Вынесена из makeOne отдельной чистой функцией:
// именно порядок и состав кадров определяет, досмотрят ролик или смахнут,
// и именно это надо уметь проверять тестом, а не глазами на готовом mp4.
function buildCards(article, t, conf) {
  conf = conf || cfg;
  const body = bodyCards(t.body, conf.maxBodyCards || 4);
  if (!body.length) throw new Error('из текста не собралось ни одной карточки');

  const tag = article.category;
  const site = conf.site || '';

  // Первый кадр — 2-4 слова огромным кеглем. Он должен читаться быстрее, чем
  // палец успевает смахнуть: замер показал уход «в 0:01» на полном заголовке.
  const [hook, rest] = hookSplit(t.title);

  // Ставка для зрителя («тебя это касается, если…»). Живёт НА кадре с крючком
  // мелкой строкой сверху и произносится ПЕРВОЙ. Отдельным кадром её ставить
  // нельзя: это отодвинуло бы новость ровно на ту секунду, в которой зритель
  // и уходит. Пустая строка в data/video.json полностью выключает механику.
  // Ставка звучит только там, где она правдива. 05.09: «If you hold crypto…»
  // стояло на новости про валютные резервы Индии (forex) — обещание не про эту
  // новость, а несоответствие зритель ловит в первую же секунду.
  const rawStake = String(conf.openingLine || '').trim();
  const stake = (!/crypto|bitcoin|btc/i.test(rawStake) || article.category === 'crypto') ? rawStake : '';

  const first = { kind: 'hook', text: hook, kicker: kickerFor(article.date), tag, note: site };
  // Порядок озвучки: СНАЧАЛА новость, потом ставка. До 05.09 первым звучал
  // слоган («If you hold crypto…») — зритель слышал рекламную интонацию
  // в ту самую секунду, в которой уходит. Ставка остаётся, но второй.
  if (stake) { first.stake = stake; first.spoken = hook + '. ' + stake; }

  // Плашка «Follow @…» на средних карточках (со ~2-й карточки, т.е. с ~5-й
  // секунды). Замеры: среднее время просмотра 1,6 с из 28 — финальный CTA
  // почти никто не видит. Голосом звать «подпишись» посреди новости нельзя —
  // перебивает в момент решения; плашка видна и не мешает. Первый кадр
  // остаётся чистым, финальный несёт собственный CTA.
  const handle = String(conf.handle || '').trim();
  const cards = [
    first,
    ...(rest ? [{ kind: 'lead', text: rest, tag, note: site, follow: handle }] : []),
    ...body.map((text, i) => ({ kind: 'body', text, tag, note: (i + 1) + ' / ' + body.length, follow: handle })),
    { kind: 'cta', text: "Don't miss what matters in crypto", tag,
      note: 'Follow for daily updates',
      spoken: "Don't miss what matters. Follow Fin Pulse for daily crypto news." }
  ];
  for (const c of cards) if (!c.spoken) c.spoken = c.text;
  return cards;
}

// Подсветка ключевых цифр в заголовке. Разбор топ-аккаунтов ниши (31.08,
// @cryptodailyfeed 1M подписчиков и поисковая выдача TikTok): у всех формула
// «ALL CAPS + цифра цветом» — «BITCOIN JUST HIT $73,000», «CRASHED 70%».
// Цифра — единственное, что зритель успевает прочесть за полсекунды.
function emphasize(text) {
  const RE = /\$[\d][\d.,]*(?:\s?(?:Million|Billion|Trillion|M|B|K))?|[\d][\d.,]*\s?%/gi;
  const parts = [];
  let last = 0, m;
  const src = String(text);
  while ((m = RE.exec(src))) {
    parts.push(esc(src.slice(last, m.index)));
    parts.push('<b class="em">' + esc(m[0]) + '</b>');
    last = m.index + m[0].length;
  }
  parts.push(esc(src.slice(last)));
  return parts.join('');
}

// v3: сцены (картинки фона) раздаются карточкам по кругу: 4 сцены на 5 карточек —
// пятая получит первую. Нет сцен — карточка рисуется на градиенте, как в v2.
function sceneFor(scenes, i) {
  if (!Array.isArray(scenes) || !scenes.length) return undefined;
  return scenes[i % scenes.length];
}

function cardHtml(card, i, total) {
  const isHook = card.kind === 'hook' || card.kind === 'lead';
  const isCta = card.kind === 'cta';
  // 05.09: замер v3 — среднее время просмотра 1,55 с из 30, «большинство
  // зрителей перестали смотреть в 0:01», досмотр 0,6 %. Первый кадр не
  // успевает прочитаться и выглядит рекламой. Крючок крупнее, а бренд и
  // ярлык с него убраны совсем (см. ниже): первая секунда — только новость.
  const size = card.kind === 'hook' ? hookSize(card.text) : fitSize(card.text, isHook);
  const progress = total > 1 ? Math.round(((i + 1) / total) * 100) : 100;
  return '<!doctype html><meta charset="utf-8"><style>' +
'*{margin:0;padding:0;box-sizing:border-box}' +
// html красим тоже: без этого Chrome оставляет внизу белую полосу там,
// где body чуть ниже вьюпорта — на видео это выглядит как брак печати.
'html{width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:#070E1A}' +
'body{width:' + W + 'px;height:' + H + 'px;overflow:hidden}' +
// v3: если у карточки есть сцена (card.bg — путь к картинке от ChatGPT/генератора),
// она ложится фоном на всю карточку, а поверх — тёмный градиент, чтобы титры читались.
// Кольца в этом режиме не рисуем: поверх фотографии они выглядят мусором.
(card.bg
  ? 'body{background:linear-gradient(180deg,rgba(7,14,26,.42) 0%,rgba(7,14,26,.08) 35%,' +
    'rgba(7,14,26,.45) 70%,rgba(7,14,26,.90) 100%),url("file://' + card.bg + '") center/cover no-repeat;'
  : 'body{background:radial-gradient(120% 90% at 32% 22%,#16294A 0%,#0E1B30 55%,#070E1A 100%);') +
'color:#E8ECF4;font-family:"DejaVu Sans","Noto Sans","Liberation Sans",sans-serif;' +
// Нижние ~340 px в TikTok закрыты описанием и кнопками, правые ~180 px — иконками.
// Всё значимое держим выше и левее, иначе интерфейс приложения съест текст.
'display:flex;flex-direction:column;justify-content:space-between;padding:120px 190px 340px 84px}' +
'.rings{position:absolute;inset:0;overflow:hidden}' +
'.rings i{position:absolute;border:6px solid #24406B;border-radius:50%;opacity:.30}' +
'.r1{width:1340px;height:1340px;left:-280px;top:290px}' +
'.r2{width:1000px;height:1000px;left:-110px;top:460px;border-width:3px;opacity:.18}' +
'.top{position:relative;display:flex;align-items:center;gap:26px}' +
'.mark{width:78px;height:78px;border-radius:24px;flex:none;' +
'background:linear-gradient(135deg,#19C79A,#3BE8B0 55%,#F7C948)}' +
'.brand{font-size:42px;font-weight:700;letter-spacing:.5px}' +
'.tag{margin-left:auto;font-size:28px;color:#8FA3C4;text-transform:uppercase;letter-spacing:4px}' +
'main{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;gap:46px}' +
'.stake{font-size:38px;font-weight:700;line-height:1.3;color:#F7C948;max-width:760px}' +
'.kicker{font-size:34px;font-weight:700;letter-spacing:5px;text-transform:uppercase;color:#3BE8B0}' +
'.text{font-size:' + size + 'px;line-height:1.28;font-weight:' + (isHook ? 800 : 600) + ';' +
(card.bg ? 'text-shadow:0 4px 24px rgba(0,0,0,.85),0 0 2px rgba(0,0,0,.9);' : '') +
'text-wrap:balance' + (isHook ? ';letter-spacing:-1px;text-transform:uppercase' : '') + '}' +
'.em{color:#F7C948;font-style:normal;font-weight:inherit}' +
'.cta .text{font-size:74px;font-weight:800}' +
'.url{margin-top:40px;font-size:54px;font-weight:700;color:#3BE8B0}' +
'.handle{font-size:40px;color:#8FA3C4;margin-top:16px}' +
'.foot{position:relative;display:flex;flex-direction:column;gap:34px}' +
'.bar{height:10px;border-radius:6px;background:#ffffff1a;overflow:hidden}' +
'.bar b{display:block;height:100%;width:' + progress + '%;' +
'background:linear-gradient(90deg,#19C79A,#3BE8B0 60%,#F7C948)}' +
'.note{font-size:28px;color:#6F82A3;letter-spacing:1px}' +
'.follow-pill{position:absolute;right:0;top:-96px;display:inline-flex;align-items:center;gap:14px;' +
'background:#12233F;border:2px solid #3BE8B0;border-radius:48px;padding:16px 34px;' +
'font-size:32px;font-weight:700;color:#3BE8B0}' +
'</style>' +
(card.bg ? '' : '<div class="rings"><i class="r1"></i><i class="r2"></i></div>') +
// Брендовая плашка — со ВТОРОЙ карточки. На первом кадре логотип и ярлык
// читаются как «это реклама» раньше, чем сама новость, и палец уходит.
(card.kind === 'hook' ? '<div></div>' :
  '<div class="top"><div class="mark"></div><div class="brand">FinPulse</div>' +
  '<div class="tag">' + esc(card.tag || 'crypto') + '</div></div>') +
'<main class="' + (isCta ? 'cta' : '') + '">' +
(card.kicker && card.kind !== 'hook' ? '<div class="kicker">' + esc(card.kicker) + '</div>' : '') +
(card.stake ? '<div class="stake">' + esc(card.stake) + '</div>' : '') +
'<div class="text">' + emphasize(card.text) + '</div>' +
(isCta ? '<div><div class="url">' + esc(cfg.site) + '</div>' +
         '<div class="handle">' + esc(HANDLE) + '</div></div>' : '') +
'</main>' +
'<div class="foot">' +
(card.follow ? '<div class="follow-pill">+ Follow ' + esc(card.follow) + '</div>' : '') +
'<div class="bar"><b></b></div>' +
'<div class="note">' + esc(card.note || '') + '</div></div>';
}

// ---------------------------------------------------------------- рендер

// Headless Chrome вместо библиотеки рендеринга: в репозитории НЕТ ни одной
// npm-зависимости, и терять это ради подписей на картинке не хочется.
// `--screenshot` есть в самом браузере, а Chrome стоит и здесь, и на раннерах GitHub.
function chromeBinary() {
  const guesses = [process.env.CHROME_BIN, '/usr/bin/google-chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  for (const g of guesses) if (fs.existsSync(g)) return g;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'chrome-linux/chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('не найден Chrome — задайте CHROME_BIN');
}

function shot(html, png) {
  const tmp = png.replace(/\.png$/, '.html');
  fs.writeFileSync(tmp, html);
  execFileSync(chromeBinary(), ['--headless', '--no-sandbox', '--disable-gpu',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=' + W + ',' + H, '--screenshot=' + png, 'file://' + tmp],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  fs.unlinkSync(tmp);
  if (!fs.existsSync(png)) throw new Error('Chrome не отдал ' + png);
}

// ---------------------------------------------------------------- озвучка

// Локальный синтез: модель крутится на этом же раннере, сети и денег не требует.
// Kokoro (Apache 2.0) звучит заметно живее, Piper (GPL-3.0) в разы легче ставится.
// Лицензия GPL распространяется на сам движок, а не на порождённый им звук.
// ВЕСЬ ролик озвучивается ОДНИМ процессом. Запуск python и загрузка модели стоят
// ~13 с; на карточку это давало 78 с чистого простоя из 145 с рендера. Пакетом —
// один раз на ролик.
function speakLocalBatch(mode, texts, outs) {
  const wavs = outs.map(o => o.replace(/\.mp3$/, '.wav'));
  const job = texts.map((text, i) => ({ text, wav: wavs[i] }));
  const jobFile = wavs[0].replace(/\.wav$/, '-job.json');
  fs.writeFileSync(jobFile, JSON.stringify(job));
  try {
    if (mode === 'kokoro') {
      const py = 'import sys,json,numpy as np,soundfile as sf\n' +
        'from kokoro import KPipeline\n' +
        'p=KPipeline(lang_code=' + JSON.stringify(ttsCfg.langCode || 'a') + ')\n' +
        'for j in json.load(open(sys.argv[1])):\n' +
        '    a=np.concatenate([x for _,_,x in p(j["text"],voice=' + JSON.stringify(ttsCfg.voice || 'am_michael') +
        ',speed=' + (ttsCfg.speed || 1) + ')])\n' +
        '    sf.write(j["wav"],a,24000)\n';
      execFileSync('python3', ['-c', py, jobFile], { stdio: ['ignore', 'ignore', 'pipe'] });
    } else {
      for (const j of job) {
        execFileSync('python3', ['-m', 'piper', '-m', ttsCfg.voice || 'en_US-ryan-high',
          '--data-dir', ttsCfg.dataDir || 'tts-voices', '-f', j.wav],
          { input: j.text, stdio: ['pipe', 'ignore', 'pipe'] });
      }
    }
    return outs.map((out, i) => {
      if (!fs.existsSync(wavs[i])) return null;
      execFileSync('ffmpeg', ['-y', '-i', wavs[i], '-b:a', '128k', out], { stdio: 'ignore' });
      fs.unlinkSync(wavs[i]);
      return out;
    });
  } catch (e) {
    // Молчащий ролик — не повод терять ролик целиком.
    console.warn('  ' + mode + ' не озвучил: ' +
      String((e && e.stderr ? e.stderr.toString() : e.message) || e).slice(0, 200).replace(/\n/g, ' '));
    return outs.map(() => null);
  } finally {
    if (fs.existsSync(jobFile)) fs.unlinkSync(jobFile);
  }
}

// Без ключа (для облачных) или без установленной модели (для локальных) ролик
// собирается МОЛЧА и всё равно годен к публикации: конвейер не должен вставать
// из-за неоплаченного или неустановленного стороннего сервиса.
async function speakCloud(provider, text, mp3) {
  const key = provider === 'elevenlabs' ? process.env.ELEVENLABS_API_KEY : process.env.OPENAI_API_KEY;

  let url, headers, body;
  if (provider === 'elevenlabs') {
    url = 'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(ttsCfg.voice || 'Rachel');
    headers = { 'xi-api-key': key, 'content-type': 'application/json' };
    body = { text, model_id: ttsCfg.model || 'eleven_multilingual_v2' };
  } else {
    url = 'https://api.openai.com/v1/audio/speech';
    headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' };
    body = { model: ttsCfg.model || 'gpt-4o-mini-tts', voice: ttsCfg.voice || 'onyx',
             input: text, speed: ttsCfg.speed || 1, response_format: 'mp3' };
    if (ttsCfg.instructions) body.instructions = ttsCfg.instructions;
  }
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) {
    console.warn('  TTS ' + r.status + ': ' + (await r.text()).slice(0, 150) + ' — карточка будет молчать');
    return null;
  }
  fs.writeFileSync(mp3, Buffer.from(await r.arrayBuffer()));
  return mp3;
}

const audioSeconds = f => Number(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]
).toString().trim()) || 0;

// ---------------------------------------------------------------- сборка

function buildVideo(dir, cards, mp4) {
  // Сборка v2 (31.08). Раньше — один concat + общий медленный наезд: тот же
  // тип движения все 30 секунд, между карточками жёсткая склейка. Три замера
  // подряд показали уход в 0:01 при любом ТЕКСТЕ первого кадра — меняем
  // единственное, что не меняли: движение.
  //   кадр 1 — панч: резкий отъезд 1.30 -> 1.12 за ~0.3 с (движение с нулевого кадра),
  //   дальше карточки чередуют наезд и отъезд,
  //   между карточками свайп-переход (slideleft), как жест самого TikTok.
  const T = 0.28; // длительность перехода, с
  const n = cards.length;

  const withVoice = cards.some(c => c.mp3);
  if (withVoice) {
    // Молчащие карточки заменяем тишиной нужной длины, иначе голос уедет вперёд картинки.
    for (const c of cards) {
      if (c.mp3) continue;
      c.mp3 = path.join(dir, path.basename(c.png, '.png') + '-silence.mp3');
      execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
        '-t', String(c.seconds), '-q:a', '9', c.mp3], { stdio: 'ignore' });
    }
    // Пауза между карточками живёт В АУДИО — иначе -shortest режет хвост.
    for (const c of cards) {
      if (/-silence\.mp3$/.test(c.mp3)) continue;
      const padded = c.mp3.replace(/\.mp3$/, '-pad.mp3');
      execFileSync('ffmpeg', ['-y', '-i', c.mp3, '-af', 'apad=pad_dur=' + PAUSE,
        '-b:a', '128k', padded], { stdio: 'ignore' });
      c.mp3 = padded;
    }
  }

  const SRC_W = Math.round(W * 1.3 / 2) * 2, SRC_H = Math.round(H * 1.3 / 2) * 2;
  // Каждая карточка кодируется отдельным клипом со своим движением. Клипы,
  // кроме последнего, длиннее на T: xfade съедает T на наложение, и без запаса
  // видео стало бы короче звука на T*(n-1) — голос уехал бы вперёд картинки.
  cards.forEach((c, i) => {
    const len = c.seconds + (i < n - 1 ? T : 0);
    // Амплитуды считаны от отступов карточки: левый отступ 84 px, значит
    // зум выше ~1.14 начинает срезать текст (z=1.30 в первой версии резал
    // «BLOCKCHAIN» с обеих сторон). Панч 1.14 -> 1.04 за ~0.3 с, дрейф 1.00-1.10.
    const zoom = i === 0
      ? "max(1.04+0.0004*on\\,1.14-0.35*on/" + FPS + ")"
      : (i % 2 ? "max(1.0\\,1.10-0.0005*on)" : "min(1.10\\,1.0+0.0005*on)");
    c.clip = path.join(dir, path.basename(c.png, '.png') + '-clip.mp4');
    execFileSync('ffmpeg', ['-y', '-loop', '1', '-framerate', String(FPS),
      '-t', len.toFixed(3), '-i', c.png,
      '-vf', 'scale=' + SRC_W + ':' + SRC_H + ':force_original_aspect_ratio=increase,' +
        'crop=' + SRC_W + ':' + SRC_H + ',' +
        "zoompan=z='" + zoom + "':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':" +
        's=' + W + 'x' + H + ':fps=' + FPS,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', c.clip],
      { stdio: ['ignore', 'ignore', 'pipe'] });
  });

  const args = ['-y'];
  for (const c of cards) args.push('-i', c.clip);
  if (withVoice) {
    const aList = path.join(dir, 'audio.txt');
    fs.writeFileSync(aList, cards.map(c => "file '" + c.mp3 + "'").join('\n') + '\n');
    args.push('-f', 'concat', '-safe', '0', '-i', aList);
  }

  if (n > 1) {
    // Цепочка xfade. offset перехода k — момент, когда карточка k отговорила
    // своё: сумма чистых длительностей карточек 0..k.
    let chain = '', prev = '[0:v]', off = 0;
    for (let k = 1; k < n; k++) {
      off += cards[k - 1].seconds;
      const out = k === n - 1 ? '[vout]' : '[x' + k + ']';
      chain += prev + '[' + k + ':v]xfade=transition=slideleft:duration=' + T +
        ':offset=' + off.toFixed(3) + out + ';';
      prev = out;
    }
    args.push('-filter_complex', chain.slice(0, -1), '-map', '[vout]');
  } else {
    args.push('-map', '0:v');
  }
  if (withVoice) args.push('-map', n + ':a', '-c:a', 'aac', '-b:a', '128k', '-shortest');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-level', '4.1', '-movflags', '+faststart', mp4);
  execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  for (const c of cards) { try { fs.unlinkSync(c.clip); } catch (e) {} }
}

// ---------------------------------------------------------------- главное

async function makeOne(article) {
  const t = article.i18n && article.i18n[LANG];
  if (!t || !t.title || !Array.isArray(t.body)) throw new Error('нет версии ' + LANG);

  const dir = path.join(OUT, article.slug);
  fs.mkdirSync(dir, { recursive: true });
  console.log('Ролик: ' + article.slug);

  const cards = buildCards(article, t, cfg);

  // v3: сцены — картинки в out/scenes/<slug>/ (или каталог из env SCENES),
  // отсортированные по имени. Их рисует ChatGPT/генератор по промпту из
  // data/chatgpt-video-prompt.md; конвейер кладёт их фоном под свои титры.
  const scenesDir = process.env.SCENES || path.join(OUT, '..', 'scenes', article.slug);
  const scenes = fs.existsSync(scenesDir)
    ? fs.readdirSync(scenesDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort()
        .map(f => path.resolve(scenesDir, f))
    : [];
  if (scenes.length) console.log('  сцен: ' + scenes.length + ' из ' + scenesDir);

  cards.forEach((c, i) => {
    c.bg = sceneFor(scenes, i);
    const stem = path.join(dir, String(i).padStart(2, '0'));
    c.png = stem + '.png';
    c.audioPath = stem + '.mp3';
    shot(cardHtml(c, i, cards.length), c.png);
  });

  const mode = ttsMode(ttsCfg, process.env);
  if (LOCAL_TTS.includes(mode)) {
    const got = speakLocalBatch(mode, cards.map(c => c.spoken), cards.map(c => c.audioPath));
    cards.forEach((c, i) => { c.mp3 = got[i]; });
  } else if (mode !== 'none') {
    for (const c of cards) c.mp3 = await speakCloud(mode, c.spoken, c.audioPath);
  }

  let voiced = 0;
  for (const c of cards) {
    if (c.mp3) voiced++;
    c.seconds = cardDuration(c.mp3 ? audioSeconds(c.mp3) : 0);
  }

  const mp4 = path.join(OUT, article.slug + '.mp4');
  buildVideo(dir, cards, mp4);
  fs.writeFileSync(path.join(OUT, article.slug + '.txt'), caption(t));

  const total = cards.reduce((n, c) => n + c.seconds, 0);
  console.log('  ' + cards.length + ' карточек, ' + total.toFixed(1) + ' с, ' +
    (fs.statSync(mp4).size / 1048576).toFixed(1) + ' МБ, ' +
    (voiced ? 'озвучено ' + voiced + '/' + cards.length : 'без озвучки'));
  return mp4;
}

// Отбор статей на рендер. Чистая функция ради теста: именно здесь 30.08
// генератор чуть не отрендерил новость семидневной давности — после простоя
// ленты «новейшая неотрендеренная» и «свежая» перестали быть одним и тем же.
// Ролик по старой новости хуже отсутствия ролика: запоздание видно любому,
// кто читает новости ещё где-то. maxAgeHours в data/video.json, по умолчанию 48.
function pickQueue(articles, done, conf, now) {
  conf = conf || cfg;
  now = now || Date.now();
  const maxAge = Number(conf.maxAgeHours || 48) * 3600000;
  return articles
    .filter(a => !done.includes(a.slug) && a.i18n && a.i18n[LANG])
    .filter(a => now - Date.parse(a.date) <= maxAge)
    .sort((x, y) => Date.parse(y.date) - Date.parse(x.date))
    .slice(0, Math.max(1, Number(conf.perRun || 1)));
}

async function main() {
  const articles = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/articles.json'), 'utf8'));
  const done = fs.existsSync(DONE_FILE) ? JSON.parse(fs.readFileSync(DONE_FILE, 'utf8')) : [];
  fs.mkdirSync(OUT, { recursive: true });

  let queue;
  if (process.env.SLUG) {
    queue = articles.filter(a => a.slug === process.env.SLUG);
    if (!queue.length) { console.error('Нет статьи со slug=' + process.env.SLUG); process.exit(1); }
  } else {
    queue = pickQueue(articles, done, cfg);
  }
  if (!queue.length) { console.log('Свежих неотрендеренных статей нет — ролик не делаем. Старьё не рендерим сознательно: запоздалый ролик хуже пропуска.'); return; }

  let ok = 0;
  for (const a of queue) {
    try {
      await makeOne(a);
      if (!done.includes(a.slug)) done.push(a.slug);
      fs.writeFileSync(DONE_FILE, JSON.stringify(done.slice(-300), null, 1) + '\n');
      ok++;
    } catch (e) {
      console.error('  ' + a.slug + ' не получился: ' + (e && e.message ? e.message : e));
    }
  }
  console.log('Готово: ' + ok + ' из ' + queue.length + ' → ' + OUT);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { sentences, bodyCards, fitSize, caption, cardDuration, cardHtml, ttsMode, hookSplit, hookSize, kickerFor, buildCards, pickQueue, emphasize, sceneFor };
