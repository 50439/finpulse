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
function cardHtml(card, i, total) {
  const isHook = card.kind === 'hook' || card.kind === 'lead';
  const isCta = card.kind === 'cta';
  const size = card.kind === 'hook' ? 132 : fitSize(card.text, isHook);
  const progress = total > 1 ? Math.round(((i + 1) / total) * 100) : 100;
  return '<!doctype html><meta charset="utf-8"><style>' +
'*{margin:0;padding:0;box-sizing:border-box}' +
// html красим тоже: без этого Chrome оставляет внизу белую полосу там,
// где body чуть ниже вьюпорта — на видео это выглядит как брак печати.
'html{width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:#070E1A}' +
'body{width:' + W + 'px;height:' + H + 'px;overflow:hidden}' +
'body{background:radial-gradient(120% 90% at 32% 22%,#16294A 0%,#0E1B30 55%,#070E1A 100%);' +
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
'.kicker{font-size:34px;font-weight:700;letter-spacing:5px;text-transform:uppercase;color:#3BE8B0}' +
'.text{font-size:' + size + 'px;line-height:1.28;font-weight:' + (isHook ? 800 : 600) + ';' +
'text-wrap:balance' + (isHook ? ';letter-spacing:-1px' : '') + '}' +
'.cta .text{font-size:74px;font-weight:800}' +
'.url{margin-top:40px;font-size:54px;font-weight:700;color:#3BE8B0}' +
'.handle{font-size:40px;color:#8FA3C4;margin-top:16px}' +
'.foot{position:relative;display:flex;flex-direction:column;gap:34px}' +
'.bar{height:10px;border-radius:6px;background:#ffffff1a;overflow:hidden}' +
'.bar b{display:block;height:100%;width:' + progress + '%;' +
'background:linear-gradient(90deg,#19C79A,#3BE8B0 60%,#F7C948)}' +
'.note{font-size:28px;color:#6F82A3;letter-spacing:1px}' +
'</style>' +
'<div class="rings"><i class="r1"></i><i class="r2"></i></div>' +
'<div class="top"><div class="mark"></div><div class="brand">FinPulse</div>' +
'<div class="tag">' + esc(card.tag || 'crypto') + '</div></div>' +
'<main class="' + (isCta ? 'cta' : '') + '">' +
(card.kicker ? '<div class="kicker">' + esc(card.kicker) + '</div>' : '') +
'<div class="text">' + esc(card.text) + '</div>' +
(isCta ? '<div><div class="url">' + esc(cfg.site) + '</div>' +
         '<div class="handle">' + esc(HANDLE) + '</div></div>' : '') +
'</main>' +
'<div class="foot"><div class="bar"><b></b></div>' +
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
  // Последний файл в списке повторяется: concat-демультиплексор ffmpeg
  // игнорирует duration последней записи, и без дубля хвост ролика обрезается.
  const list = cards.map(c => "file '" + c.png + "'\nduration " + c.seconds.toFixed(3)).join('\n') +
    "\nfile '" + cards[cards.length - 1].png + "'\n";
  const listFile = path.join(dir, 'concat.txt');
  fs.writeFileSync(listFile, list);

  const withVoice = cards.some(c => c.mp3);
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile];
  if (withVoice) {
    // Молчащие карточки заменяем тишиной нужной длины, иначе голос уедет вперёд картинки.
    for (const c of cards) {
      if (c.mp3) continue;
      c.mp3 = path.join(dir, path.basename(c.png, '.png') + '-silence.mp3');
      execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
        '-t', String(c.seconds), '-q:a', '9', c.mp3], { stdio: 'ignore' });
    }
    // Паузу между карточками дописываем В АУДИО. Иначе видео длиннее звука на
    // сумму пауз, -shortest режет хвост, а голос уезжает вперёд картинки.
    for (const c of cards) {
      if (/-silence\.mp3$/.test(c.mp3)) continue;
      const padded = c.mp3.replace(/\.mp3$/, '-pad.mp3');
      execFileSync('ffmpeg', ['-y', '-i', c.mp3, '-af', 'apad=pad_dur=' + PAUSE,
        '-b:a', '128k', padded], { stdio: 'ignore' });
      c.mp3 = padded;
    }
    const aList = path.join(dir, 'audio.txt');
    fs.writeFileSync(aList, cards.map(c => "file '" + c.mp3 + "'").join('\n') + '\n');
    args.push('-f', 'concat', '-safe', '0', '-i', aList);
  }
  // Медленный наезд. Статичная картинка в ленте читается как пауза, и палец
  // уходит: TikTok раздаёт по удержанию, а удержание начинается с движения.
  // fps ДО zoompan обязателен: concat-демультиплексор отдаёт по одному кадру на
  // картинку, а zoompan работает покадрово — без него из 33 секунд получилось 0,2.
  const SRC_W = Math.round(W * 1.3 / 2) * 2, SRC_H = Math.round(H * 1.3 / 2) * 2;
  args.push('-vf', 'fps=' + FPS + ',scale=' + SRC_W + ':' + SRC_H +
      ':force_original_aspect_ratio=increase,crop=' + SRC_W + ':' + SRC_H + ',' +
      "zoompan=z='min(zoom+0.0004,1.12)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':" +
      's=' + W + 'x' + H + ':fps=' + FPS,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-level', '4.1', '-movflags', '+faststart');
  if (withVoice) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  args.push(mp4);
  execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

// ---------------------------------------------------------------- главное

async function makeOne(article) {
  const t = article.i18n && article.i18n[LANG];
  if (!t || !t.title || !Array.isArray(t.body)) throw new Error('нет версии ' + LANG);

  const dir = path.join(OUT, article.slug);
  fs.mkdirSync(dir, { recursive: true });
  console.log('Ролик: ' + article.slug);

  const body = bodyCards(t.body, cfg.maxBodyCards || 4);
  if (!body.length) throw new Error('из текста не собралось ни одной карточки');

  // Первый кадр — 2-4 слова огромным кеглем. Он должен читаться быстрее, чем
  // палец успевает смахнуть: замер показал уход «в 0:01» на полном заголовке.
  const [hook, rest] = hookSplit(t.title);
  const cards = [
    { kind: 'hook', text: hook, kicker: kickerFor(article.date), tag: article.category, note: cfg.site },
    ...(rest ? [{ kind: 'lead', text: rest, tag: article.category, note: cfg.site }] : []),
    ...body.map((text, i) => ({ kind: 'body', text, tag: article.category, note: (i + 1) + ' / ' + body.length })),
    { kind: 'cta', text: 'Daily crypto news, 17 languages', tag: article.category, note: 'Follow for daily updates' }
  ];

  cards.forEach((c, i) => {
    const stem = path.join(dir, String(i).padStart(2, '0'));
    c.png = stem + '.png';
    c.audioPath = stem + '.mp3';
    c.spoken = c.kind === 'cta' ? 'Full story on Fin Pulse. Follow for daily crypto news.' : c.text;
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

async function main() {
  const articles = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/articles.json'), 'utf8'));
  const done = fs.existsSync(DONE_FILE) ? JSON.parse(fs.readFileSync(DONE_FILE, 'utf8')) : [];
  fs.mkdirSync(OUT, { recursive: true });

  let queue;
  if (process.env.SLUG) {
    queue = articles.filter(a => a.slug === process.env.SLUG);
    if (!queue.length) { console.error('Нет статьи со slug=' + process.env.SLUG); process.exit(1); }
  } else {
    queue = articles.filter(a => !done.includes(a.slug) && a.i18n && a.i18n[LANG])
      .sort((x, y) => Date.parse(y.date) - Date.parse(x.date))
      .slice(0, Math.max(1, Number(cfg.perRun || 1)));
  }
  if (!queue.length) { console.log('Новых статей для роликов нет.'); return; }

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

module.exports = { sentences, bodyCards, fitSize, caption, cardDuration, cardHtml, ttsMode, hookSplit, kickerFor };
