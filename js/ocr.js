/**
 * ocr.js - 雙模 OCR 辨識引擎 (Tesseract 離線端側 + Gemini Flash 雲端高精準)
 */

class OcrEngine {
  constructor() {
    this.tesseractWorker = null;
    this.isWorkerReady = false;
    this.geminiApiKey = localStorage.getItem('gemini_api_key') || '';
    this.preferredEngine = localStorage.getItem('preferred_engine') || 'tesseract'; // 'tesseract' or 'gemini'
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
   * 初始化 Tesseract.js Worker (使用英數字+日文模式)
   */
  async initTesseract(onProgress) {
    if (this.isWorkerReady && this.tesseractWorker) return;
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract.js 未載入');
    }

    if (onProgress) onProgress('正在載入離線 OCR 核心...');
    this.tesseractWorker = await Tesseract.createWorker('eng+jpn', 1, {
      logger: m => {
        if (onProgress && m.status === 'recognizing text') {
          onProgress(`離線辨識中 ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    // 設定辨識參數以兼顧編號與字體
    await this.tesseractWorker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK
    });

    this.isWorkerReady = true;
    console.log('[OcrEngine] Tesseract Worker ready.');
  }

  /**
   * 執行 OCR 辨識
   * @param {string} imageDataUrl - base64 JPEG
   * @param {function} onProgress - 進度回報回調函數
   */
  async recognize(imageDataUrl, onProgress) {
    // 若設定使用 Gemini 且有 API Key，優先使用 Gemini Flash
    if (this.preferredEngine === 'gemini' && this.geminiApiKey) {
      try {
        if (onProgress) onProgress('正在透過 Gemini Flash 深度解析書背...');
        return await this.recognizeWithGemini(imageDataUrl);
      } catch (err) {
        console.warn('[OcrEngine] Gemini OCR 失敗，自動切換至離線 Tesseract 備援:', err);
        if (onProgress) onProgress('Gemini 連線失敗，切換離線辨識...');
      }
    }

    // 離線 Tesseract 辨識
    if (!this.isWorkerReady) {
      await this.initTesseract(onProgress);
    }

    if (onProgress) onProgress('離線辨識書背文字與編號...');
    const result = await this.tesseractWorker.recognize(imageDataUrl);
    const rawText = result.data.text || '';

    return {
      engine: 'tesseract',
      rawText: rawText,
      confidence: result.data.confidence,
      parsed: {
        title_jp: '',
        catalog: '',
        platform: ''
      }
    };
  }

  /**
   * 呼叫 Google Gemini 2.5 Flash Vision API
   */
  async recognizeWithGemini(imageDataUrl) {
    const base64Data = imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.geminiApiKey}`;

    const prompt = `這是復古或現代遊戲盒的「側標」或「書背」（Spine）特寫照片。
請辨識圖中的：
1. 日文原名或標題 (title_jp)
2. 英文名稱 (title_en)
3. 商品型號/編號 (catalog)，如 SLPS-00542, GS-9027, T-13303G, SHVC-MO, NUS-xxx, CUSA-xxxxx, HAC-P-xxxx 等。
4. 主機平台 (platform)，如 PS1, PS2, SS, SFC, DC, N64, PCE, Switch 等。

請以純 JSON 格式輸出，不要有多餘說明文字或 markdown 程式碼區塊：
{
  "title_jp": "遊戲日文名",
  "title_en": "英文名",
  "catalog": "商品編號",
  "platform": "平台名稱"
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
        maxOutputTokens: 256
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API 請求失敗 (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // 解析 JSON
    let parsed = { title_jp: '', title_en: '', catalog: '', platform: '' };
    try {
      const cleanJson = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      console.warn('[OcrEngine] Failed to parse Gemini response as JSON:', replyText);
    }

    const combinedText = `${parsed.catalog || ''} ${parsed.title_jp || ''} ${parsed.title_en || ''} ${replyText}`;

    return {
      engine: 'gemini',
      rawText: combinedText,
      confidence: 0.98,
      parsed: parsed
    };
  }
}

if (typeof window !== 'undefined') {
  window.OcrEngine = OcrEngine;
}
