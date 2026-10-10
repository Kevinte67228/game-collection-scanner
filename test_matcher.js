/**
 * matcher 壓力測試 — 模擬真實 OCR 辨識結果測試比對效果
 */
const GameMatcher = require('./js/matcher.js');
const games = require('./data/games.json');

const m = new GameMatcher();
m.init(games);

// 測試案例：[描述, OCR模擬文字, 期望status, 期望title片段(可選)]
const testCases = [
  // === Gemini 完美輸出（純文字 prompt 解析後的 rawText）===
  ['Gemini完美: ハードボール5', 'SLPS-00571 ハードボール5 HardBall 5', 'OWNED', 'ハードボール5'],
  ['Gemini完美: 三国志II', '三国志II 覇王の大陸 Romance of the Three Kingdoms II', 'OWNED', '三国志II'],
  ['Gemini完美: ファミスタ90', "RC-861 ファミスタ'90 Famista '90", 'OWNED', "ファミスタ'90"],
  
  // === Gemini 解析失敗（replyText 被當成 combinedText 的 fallback）===
  ['Gemini fallback raw: 只有日文名', 'ハードボール5', 'OWNED', 'ハードボール5'],
  ['Gemini fallback raw: JSON廢料', '{ "title_jp": "ハードボール', 'OWNED', 'ハードボール'],

  // === Tesseract 直排 OCR — 典型亂碼 ===
  ['Tesseract直排: ハ→亂碼', 'i SE\n思 )ー ド ボ ー ル 5', 'OWNED', 'ハードボール5'],
  ['Tesseract直排: 空格分離', 'ーー | |\nバード ボ ー ル 5 ド', 'OWNED', 'ハードボール5'],
  ['Tesseract直排: 三国志', '三国 志 II\n覇 王 の 大 陸', 'OWNED', '三国志II'],
  ['Tesseract直排: 殘缺片假名', 'ファミ スタ 92', 'OWNED', "ファミスタ'92"],
  
  // === Tesseract 橫排 OCR — 編號辨識 ===
  ['橫排編號: SLPS-00571', 'SLPS-00571 PlayStation', 'OWNED', 'ハードボール5'],
  ['橫排編號: GS-9027', 'GS-9027 SEGA SATURN', 'OWNED', null],
  ['橫排編號: SHVC-JQ', 'SHVC-JQ SFC', 'OWNED', null],
  ['橫排編號: 只有數字', '00571', 'OWNED', null],
  
  // === 殘缺/破碎文字 ===
  ['缺頭1字: ードボール5', 'ードボール5', 'OWNED', 'ハードボール5'],
  ['缺頭2字: ドボール5', 'ドボール5', 'OWNED', 'ハードボール5'],
  ['日文名被截斷: ファイナルラ', 'ファイナルラ', 'OWNED', null],
  ['英文名被截斷', 'HardBall', 'OWNED', null],
  ['完整英文名', 'Final Lap', 'OWNED', null],
  
  // === 應該 NOT_OWNED 的案例 ===
  ['完全無關文字', 'abcdefghijklmnop', 'NOT_OWNED', null],
  ['日文但非收藏', 'ドラゴンクエストXII', 'NOT_OWNED', null],
  ['只有平台名', 'PlayStation', 'NOT_OWNED', null],
  ['空字串', '', 'EMPTY', null],
  
  // === 邊界案例 ===
  ['超短文字2字', 'ハー', 'NOT_OWNED', null],
  ['namcot標誌干擾', 'namcot ファミリーサーキット', 'OWNED', 'ファミリーサーキット'],
  ['TAITO標誌干擾', 'TAITO フリップル 29', 'OWNED', 'フリップル'],
  ['數字干擾: No.29', 'フリップル BS-02', 'OWNED', 'フリップル'],
  
  // === 多款混在同一張書背 ===
  ['多遊戲書背', 'SLPS-00571 ハードボール5 SLPS-01234', 'OWNED', 'ハードボール5'],
];

console.log('=== Game Collection Matcher 壓力測試 ===\n');
console.log(`資料庫: ${games.games?.length || games.length} 款`);
console.log('---');

let pass = 0;
let fail = 0;

for (const [desc, ocrText, expectStatus, expectTitle] of testCases) {
  const r = m.match(ocrText, 'ALL');
  const actualStatus = r.status;
  const actualTitle = r.game?.title_jp || '';
  
  const statusOk = actualStatus === expectStatus;
  const titleOk = !expectTitle || actualTitle.includes(expectTitle) || expectTitle.includes(actualTitle);
  const ok = statusOk && titleOk;
  
  if (ok) {
    pass++;
    console.log(`  PASS  ${desc}`);
    console.log(`        -> ${actualStatus} ${r.type || ''} ${actualTitle} ${r.game?.catalog || ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${desc}`);
    console.log(`        OCR: ${JSON.stringify(ocrText).slice(0, 60)}`);
    console.log(`        Expected: ${expectStatus} ${expectTitle || '(any)'}`);
    console.log(`        Got:      ${actualStatus} ${r.type || ''} "${actualTitle}" ${r.game?.catalog || ''}`);
  }
}

console.log('\n=== 結果 ===');
console.log(`PASS: ${pass}/${pass+fail}  FAIL: ${fail}/${pass+fail}`);
process.exit(fail > 0 ? 1 : 0);
