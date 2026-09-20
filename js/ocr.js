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
   * 初始化 Tesseract.js Worker (支援橫排與直排文字)
   */
  async initTesseract(onProgress, isVertical = false) {
    if (this.isWorkerReady && this.tesseractWorker) return;
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract.js 未載入');
    }

    if (onProgress) onProgress('正在載入離線 OCR 核心...');
    // 同時載入英文與日文 (含直排支援)
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
      // 若下載 jpn_vert 失敗，回退至 eng+jpn
      console.warn('[OcrEngine] Fallback to eng+jpn:', e);
      this.tesseractWorker = await Tesseract.createWorker('eng+jpn', 1);
    }

    // 設定 PSM: 5 為直書單塊文字 (Vertical block)，6 為橫書單塊文字 (Single block)
    await this.tesseractWorker.setParameters({
      tessedit_pageseg_mode: isVertical ? '5' : '6'
    });

    this.isWorkerReady = true;
    this.currentIsVertical = isVertical;
    console.log(`[OcrEngine] Tesseract Worker ready (Vertical: ${isVertical}).`);
  }

  /**
   * 執行 OCR 辨識
   * @param {string} imageDataUrl - base64 JPEG
   * @param {function} onProgress - 進度回報回調函數
   * @param {boolean} isVertical - 是否為垂直側標模式
   */
  async recognize(imageDataUrl, onProgress, isVertical = false) {
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
      await this.initTesseract(onProgress, isVertical);
    } else {
      // 切換橫向/直向 PSM 模式
      await this.tesseractWorker.setParameters({
        tessedit_pageseg_mode: isVertical ? '5' : '6'
      });
    }

    if (onProgress) onProgress(isVertical ? '直排側標文字辨識中...' : '離線辨識書背文字與編號...');
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

    // 組合供 matcher 使用的純淨文字（catalog + 日文名 + 英文名）
    const parts = [parsed.catalog, parsed.title_jp, parsed.title_en].filter(Boolean);
    const combinedText = parts.join(' ');

    // 供辨識文字框顯示的可讀文字
    const displayText = [
      parsed.title_jp ? `標題：${parsed.title_jp}` : '',
      parsed.title_en ? `英文：${parsed.title_en}` : '',
      parsed.catalog  ? `編號：${parsed.catalog}`  : '',
      parsed.platform ? `平台：${parsed.platform}` : ''
    ].filter(Boolean).join('\n') || replyText;

    return {
      engine: 'gemini',
      rawText: combinedText,
      displayText: displayText,
      confidence: 0.98,
      parsed: parsed
    };
  }
}

if (typeof window !== 'undefined') {
  window.OcrEngine = OcrEngine;
}
