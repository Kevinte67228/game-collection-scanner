/**
 * ocr.js - 雙模 OCR 辨識引擎 (Tesseract 離線端側 + Gemini Flash 雲端高精準與即時日翻中)
 */

class OcrEngine {
  constructor() {
    this.tesseractWorker = null;
    this.isWorkerReady = false;
    this.geminiApiKey = localStorage.getItem('gemini_api_key') || '';
    this.preferredEngine = localStorage.getItem('preferred_engine') || 'gemini'; // 預設優先嘗試 Gemini
  }

  setGeminiApiKey(key) {
    this.geminiApiKey = key.trim();
    localStorage.setItem('gemini_api_key', this.geminiApiKey);
  }

  setPreferredEngine(engine) {
    this.preferredEngine = engine;
    localStorage.setItem('preferred_engine', engine);
  }

  /**
   * 初始化 Tesseract.js Worker (支援橫排與直排文字)
   */
  async initTesseract(onProgress, isVertical = false) {
    if (this.isWorkerReady && this.tesseractWorker) return;
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract.js 未載入');
    }

    if (onProgress) onProgress('正在載入離線 OCR 核心...');
    const langs = isVertical ? 'eng+jpn_vert' : 'eng+jpn';
    try {
      this.tesseractWorker = await Tesseract.createWorker(langs, 1, {
        logger: m => {
          if (onProgress && m.status === 'recognizing text') {
            onProgress(`離線辨識中 ${Math.round(m.progress * 100)}%`);
          }
        }
      });
    } catch (e) {
      console.warn('[OcrEngine] Fallback to eng+jpn:', e);
      this.tesseractWorker = await Tesseract.createWorker('eng+jpn', 1);
    }

    await this.tesseractWorker.setParameters({
      tessedit_pageseg_mode: isVertical ? '5' : '6'
    });

    this.isWorkerReady = true;
    this.currentIsVertical = isVertical;
    console.log(`[OcrEngine] Tesseract Worker ready (Vertical: ${isVertical}).`);
  }

  /**
   * 執行 OCR 辨識
   */
  async recognize(imageDataUrl, onProgress, isVertical = false) {
    // 若設定使用 Gemini 且有 API Key，優先使用 Gemini Flash
    if (this.preferredEngine === 'gemini' && this.geminiApiKey) {
      try {
        if (onProgress) onProgress('正在透過 Gemini Flash 深度解析與日翻中...');
        return await this.recognizeWithGemini(imageDataUrl);
      } catch (err) {
        console.warn('[OcrEngine] Gemini OCR 失敗，自動切換至離線 Tesseract 備援:', err);
        if (onProgress) onProgress('Gemini 連線異常，切換離線辨識...');
      }
    }

    // 離線 Tesseract 辨識
    if (!this.isWorkerReady) {
      await this.initTesseract(onProgress, isVertical);
    } else {
      await this.tesseractWorker.setParameters({
        tessedit_pageseg_mode: isVertical ? '5' : '6'
      });
    }

    if (onProgress) onProgress(isVertical ? '直排側標辨識中...' : '離線辨識書背文字與編號...');
    const result = await this.tesseractWorker.recognize(imageDataUrl);
    const rawText = result.data.text || '';

    return {
      engine: 'tesseract',
      rawText: rawText,
      confidence: result.data.confidence,
      displayText: rawText.trim(),
      parsed: {
        title_jp: '',
        title_zh: '',
        title_en: '',
        catalog: '',
        platform: ''
      }
    };
  }

  /**
   * 呼叫 Google Gemini 2.5 Flash / 1.5 Flash Vision API (AI 視覺辨識 + 日翻中)
   */
  async recognizeWithGemini(imageDataUrl) {
    const base64Data = imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
    
    // 優先使用 gemini-2.5-flash，若有問題則 fallback
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.geminiApiKey}`;

    const prompt = `你是復古與現代電玩遊戲收藏專家。請仔細分析這張遊戲光碟盒、卡匣、側標或書背（Spine/Cover）的照片。
因為使用者看不懂日文，請務必精準辨識日文原文，並提供通用的「繁體中文譯名」。

請直接回傳合法的 JSON 物件（請不要包含 markdown 標籤，直接回傳純 JSON）：
{
  "title_jp": "辨識出的精確日文原名（若封面為日文）",
  "title_zh": "精確的繁體中文譯名或官方/通俗中文名（例如: 實況野球、惡魔城月下夜想曲、勇者鬥惡龍IV、超級瑪利歐64 等）",
  "title_en": "英文名稱（若有，否則為空字串）",
  "catalog": "商品編號/型號（例如: SLPS-00542, SCPS-10011, GS-9027, T-13303G, SHVC-A96J, NUS-xxxx, HAC-P-xxxx 等，若無則為空字串）",
  "platform": "主機平台簡稱（例如: PS1, PS2, PS3, PS4, PS5, SS, SFC, N64, DC, MD, NGC, PCE, PSP, PSV, NS, GBA, NDS, 3DS, WS, GG，若無則為空字串）",
  "notes": "版本備註（例如: 通常版、初回限定版、Best廉價版、復刻版，無則留空）"
}`;

    const requestBody = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: "image/jpeg",
              data: base64Data
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512,
        responseMimeType: "application/json"
      }
    };

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
    } catch (netErr) {
      throw new Error(`網路連線失敗: ${netErr.message}`);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API 請求失敗 (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let parsed = { title_jp: '', title_zh: '', title_en: '', catalog: '', platform: '', notes: '' };
    try {
      const cleanJson = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
      parsed = Object.assign(parsed, JSON.parse(cleanJson));
    } catch (e) {
      console.warn('[OcrEngine] JSON parse fallback:', replyText);
      // 容錯提取
      const jpM = replyText.match(/"title_jp"\s*:\s*"([^"]+)/);
      const zhM = replyText.match(/"title_zh"\s*:\s*"([^"]+)/);
      const enM = replyText.match(/"title_en"\s*:\s*"([^"]+)/);
      const catM = replyText.match(/"catalog"\s*:\s*"([^"]+)/);
      const platM = replyText.match(/"platform"\s*:\s*"([^"]+)/);
      if (jpM) parsed.title_jp = jpM[1];
      if (zhM) parsed.title_zh = zhM[1];
      if (enM) parsed.title_en = enM[1];
      if (catM) parsed.catalog = catM[1];
      if (platM) parsed.platform = platM[1];
    }

    // 組合供 matcher 使用的純淨文字（catalog + 日文名 + 中文名 + 英文名）
    const parts = [parsed.catalog, parsed.title_jp, parsed.title_zh, parsed.title_en].filter(Boolean);
    const combinedText = parts.join(' ') || replyText;

    // 供前端預覽顯示的清楚格式
    const displayList = [
      parsed.title_zh ? `中文：${parsed.title_zh}` : '',
      parsed.title_jp ? `日文：${parsed.title_jp}` : '',
      parsed.title_en ? `英文：${parsed.title_en}` : '',
      parsed.catalog  ? `編號：${parsed.catalog}`  : '',
      parsed.platform ? `平台：${parsed.platform}` : '',
      parsed.notes    ? `備註：${parsed.notes}`    : ''
    ].filter(Boolean);

    return {
      engine: 'gemini',
      rawText: combinedText,
      displayText: displayList.join('\n') || replyText,
      confidence: 0.98,
      parsed: parsed
    };
  }
}

if (typeof window !== 'undefined') {
  window.OcrEngine = OcrEngine;
}
