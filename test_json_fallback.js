// 模擬 Gemini 回傳被截斷的 JSON
const replyText = '{ "title_jp": "\u30cf\u30fc\u30c9\u30dc\u30fc\u30eb5", "title_en": "HardBall';

// 純文字解析（會失敗）
const parsed = { title_jp: '', title_en: '', catalog: '', platform: '' };
for (const line of replyText.split('\n')) {
  const m = line.match(/^(日文名稱|英文名稱|商品編號|平台)[：:]\s*(.+)/);
  if (!m) continue;
}

// JSON fallback
if (!parsed.title_jp && !parsed.catalog) {
  try {
    const cleanJson = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
    const j = JSON.parse(cleanJson);
    parsed.title_jp = j.title_jp || '';
  } catch (e) {
    // JSON 截斷，用 regex 提取
    const jpMatch = replyText.match(/"title_jp"\s*:\s*"([^"]+)/);
    const enMatch = replyText.match(/"title_en"\s*:\s*"([^"]+)/);
    const catMatch = replyText.match(/"catalog"\s*:\s*"([^"]+)/);
    if (jpMatch) parsed.title_jp = jpMatch[1];
    if (enMatch) parsed.title_en = enMatch[1];
    if (catMatch) parsed.catalog = catMatch[1];
  }
}

const parts = [parsed.catalog, parsed.title_jp, parsed.title_en].filter(Boolean);
const combinedText = parts.join(' ') || replyText;

console.log('parsed:', JSON.stringify(parsed));
console.log('combinedText:', combinedText);

// 現在用 matcher 測試
const GameMatcher = require('./js/matcher.js');
const games = require('./data/games.json');
const m = new GameMatcher();
m.init(games);
const r = m.match(combinedText, 'ALL');
console.log('Match result:', r.status, r.type, r.game?.title_jp, r.game?.catalog);
