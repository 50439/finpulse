// IndexNow: мгновенное уведомление Bing/Yandex/Seznam о новых страницах
const fs = require('fs');
const path = require('path');

const KEY = 'ee221c0a3d35f01be5577688fa06a50a';
const SITE_FILE = path.join(ROOT, 'data/site.json');
const SITE = String((fs.existsSync(SITE_FILE) ? JSON.parse(fs.readFileSync(SITE_FILE,'utf8')).url : '')
  || process.env.SITE_URL || 'https://finpulse24.com').replace(/\/$/, '');
const HOST = SITE.replace(/^https?:\/\//, '');
const STATE = path.join(__dirname, '..', 'content', 'indexnow-sent.json');

const articles = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'articles.json'), 'utf8'));
const langs = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'i18n.json'), 'utf8')).languages);

let sent = [];
try { sent = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) {}
const sentSet = new Set(sent);

const urlList = [];
for (const a of articles) {
  if (sentSet.has(a.slug)) continue;
  if (Date.now() - new Date(a.date).getTime() > 12 * 3600 * 1000) { sentSet.add(a.slug); continue; }
  for (const l of langs) urlList.push(SITE + '/' + l + '/news/' + a.slug + '/');
  sentSet.add(a.slug);
}
// секции всегда обновляются
if (urlList.length) for (const l of langs) urlList.push(SITE + '/' + l + '/', SITE + '/' + l + '/news/');

if (!urlList.length) { console.log('IndexNow: нечего отправлять'); process.exit(0); }

const body = JSON.stringify({
  host: HOST,
  key: KEY,
  keyLocation: SITE + '/' + KEY + '.txt',
  urlList: urlList.slice(0, 10000)
});

fetch('https://api.indexnow.org/IndexNow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body
}).then(r => {
  console.log('IndexNow: HTTP ' + r.status + ' для ' + urlList.length + ' URL');
  if (r.status === 200 || r.status === 202) {
    fs.writeFileSync(STATE, JSON.stringify([...sentSet].slice(-300), null, 0));
  }
}).catch(e => console.log('IndexNow error: ' + e.message));
