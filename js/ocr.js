/**
 * ocr.js - 雙模 OCR 辨識引擎 (Tesseract 離線端側 + Gemini Flash 雲端高精準與即時日翻中)
 */

class OcrEngine {
  constructor() {
    this.tesseractWorker = null;
    this.isWorkerReady = false;
    this.geminiApiKey = localStorage.getItem('gemini_api_key') || '';
    this.umiOcrUrl = localStorage.getItem('umi_ocr_url') || 'http://127.0.0.1:1224/api/ocr';
    this.preferredEngine = localStorage.getItem('preferred_engine') || 'gemini'; // 'gemini' | 'umi' | 'hybrid' | 'tesseract'
  }

  setGeminiApiKey(key) {
    this.geminiApiKey = key.trim();
    localStorage.setItem('gemini_api_key', this.geminiApiKey);
  }

  setUmiOcrUrl(url) {
    this.umiOcrUrl = (url || '').trim();
    localStorage.setItem('umi_ocr_url', this.umiOcrUrl);
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
   * 執行 OCR 辨識 (支援 Gemini 視覺模型、私有 Umi-OCR、混合增強與離線 Tesseract)
   */
  async recognize(imageDataUrl, onProgress, isVertical = false) {
    // 1. 純私有 Umi-OCR 伺服器
    if (this.preferredEngine === 'umi') {
      if (onProgress) onProgress('正在呼叫私有 Umi-OCR 辨識書背...');
      return await this.recognizeWithUmi(imageDataUrl);
    }

    // 2. 混合增強模式 (Umi-OCR 識字 + Gemini 翻中與結構化)
    if (this.preferredEngine === 'hybrid') {
      if (onProgress) onProgress('正在透過 Umi-OCR 抓取精確字元...');
      const umiRes = await this.recognizeWithUmi(imageDataUrl);
      if (this.geminiApiKey) {
        if (onProgress) onProgress('正在透過 Gemini 深度比對與日翻中...');
        return await this.refineWithGemini(umiRes.rawText, imageDataUrl);
      }
      return umiRes;
    }

    // 3. 預設：Gemini 2.5 Flash 視覺多模態 (日翻中 + 電玩實體理解)
    if (this.preferredEngine === 'gemini') {
      if (!this.geminiApiKey) {
        throw new Error('尚未設定 Gemini API Key，請至右上角齒輪設定');
      }
      if (onProgress) onProgress('正在透過 Gemini Flash 深度解析與日翻中...');
      return await this.recognizeWithGemini(imageDataUrl, isVertical);
    }

    // 4. 離線 Tesseract 辨識
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
   * 呼叫私有 Umi-OCR HTTP API
   */
  async recognizeWithUmi(imageDataUrl) {
    const base64Data = imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
    const url = this.umiOcrUrl.trim() || 'http://127.0.0.1:1224/api/ocr';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64: base64Data,
          options: {
            "ocr.cls": true,
            "ocr.limit_side_len": 1280
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Umi-OCR 服務回應錯誤 HTTP ${response.status}`);
      }

      const resJson = await response.json();
      const lines = (resJson.data || []).map(d => d.text).filter(Boolean);
      const fullText = lines.join(' ');

      // 快速正規化抓取型號
      const catMatch = fullText.match(/\b([A-Z]{2,5}[-_]?\d{3,6})\b/i);

      return {
        engine: 'umi-ocr',
        rawText: fullText,
        displayText: lines.join('\n'),
        parsed: {
          title_jp: fullText,
          title_zh: '',
          title_en: '',
          catalog: catMatch ? catMatch[1] : '',
          platform: ''
        }
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Umi-OCR 伺服器連線逾時，請確認家中電腦服務是否正常啟動');
      }
      throw new Error(`連線 Umi-OCR 伺服器失敗: ${err.message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 呼叫 Google Gemini 2.5 Flash / 1.5 Flash Vision API (直排側標專用升級版)
   */
  async recognizeWithGemini(imageDataUrl, isVertical = false) {
    const base64Data = imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.geminiApiKey}`;

    const prompt = `你是復古與現代電玩遊戲收藏專家。請仔細分析這張遊戲光碟盒、卡匣、側標或書背（Spine/Cover）的照片。
使用者看不懂日文，請務必精準辨識日文原文，並提供通用的【繁體中文譯名】。

【電玩側標/書背重要特徵指引】：
1. 排版方向：${isVertical ? '注意！此圖片文字為【直排/豎排】' : '注意：文字可能是直排或橫排'}。
   - 直排中的日文長音符號「ー」為垂直長條線，切勿誤認為數字1、減號或英文字母I。
   - 片假名「ツ/シ」、「ソ/ン」請根據已知遊戲標題詞彙進行上下文自動校正。
2. 商品編號（Catalog Code）：通常印在側標頂端或最末尾底端，請仔細尋找，如：
   - PS1/PS2/PS3/PS4/PS5: SLPS, SLPM, SCPS, SCES, SLES, SPSU, BLJS, PLJS, ELAS, PCJB 等 (格式如 SLPM-65001)
   - SS: GS-, T-
   - SFC: SHVC-
   - N64: NUS-
   - DC: T-, HDR-
   - PCE: SS8, HE-, HCD-
   - GBA/NDS/3DS: AGB-, NTR-, CTR-, LNA-
   - Switch: HAC-, LA-H-
   - 書籍/攻略 (BOOKS/Game Guide): 通常印有出版社或副標題。

請直接回傳合法的純 JSON 物件（絕對不要包含 markdown 標籤，直接回傳純 JSON）：
{
  "title_jp": "辨識出的精確日文原名（若封面為日文）",
  "title_zh": "精確的繁體中文譯名或官方/通俗中文名（例如: 實況野球、惡魔城月下夜想曲、勇者鬥惡龍IV、超級瑪利歐64 等）",
  "title_en": "英文名稱（若有，否則為空字串）",
  "catalog": "商品編號/型號（例如: SLPS-00542, SCPS-10011, GS-9027, T-13303G, SHVC-A96J, NUS-xxxx, HAC-P-xxxx 等，若無則為空字串）",
  "platform": "主機平台簡稱（例如: PS1, PS2, PS3, PS4, PS5, SS, SFC, N64, DC, MD, NGC, PCE, PSP, PSV, NS, GBA, NDS, 3DS, BOOKS, Game Guide 等）",
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } catch (netErr) {
      if (netErr.name === 'AbortError') {
        throw new Error('Gemini API 請求超時 (超過 15 秒無回應)，請檢查網路連線後重試');
      }
      throw new Error(`網路連線失敗: ${netErr.message}`);
    } finally {
      clearTimeout(timeoutId);
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
      let parsedJson = JSON.parse(cleanJson);
      if (Array.isArray(parsedJson) && parsedJson.length > 0) {
        parsedJson = parsedJson[0];
      }
      parsed = Object.assign(parsed, parsedJson);
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

  /**
   * 混合模式：利用 Gemini 將 Umi-OCR 提取之純文字進行電玩日翻中與正規化
   */
  async refineWithGemini(extractedText, imageDataUrl) {
    const base64Data = imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.geminiApiKey}`;

    const prompt = `你是復古與現代電玩遊戲收藏專家。
高精度 OCR 工具已從照片中辨識出以下文字片段：
"""
${extractedText}
"""
請比對附帶之書背照片與上述 OCR 文字，提供精確的日文原名、繁體中文譯名與商品編號。

請直接回傳純 JSON 物件：
{
  "title_jp": "辨識出的精確日文原名",
  "title_zh": "精確通俗之繁體中文譯名",
  "title_en": "英文名稱（若無則留空）",
  "catalog": "商品編號/型號（例如 SLPS-xxxxx, HAC-xxxx, GS-xxxx 等）",
  "platform": "主機平台簡稱",
  "notes": "版本備註"
}`;

    const requestBody = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/jpeg", data: base64Data } }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512,
        responseMimeType: "application/json"
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanJson = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
      let parsed = JSON.parse(cleanJson);
      if (Array.isArray(parsed)) parsed = parsed[0] || {};

      const parts = [parsed.catalog, parsed.title_jp, parsed.title_zh, parsed.title_en].filter(Boolean);
      return {
        engine: 'hybrid (umi+gemini)',
        rawText: parts.join(' ') || extractedText,
        displayText: `【Umi字元＋AI翻中】\n中文：${parsed.title_zh || '-'}\n日文：${parsed.title_jp || '-'}\n編號：${parsed.catalog || '-'}\n平台：${parsed.platform || '-'}`,
        confidence: 0.99,
        parsed: parsed
      };
    } catch (e) {
      console.warn('[OcrEngine] Refine fallback to raw Umi text:', e);
      return {
        engine: 'umi-ocr',
        rawText: extractedText,
        displayText: extractedText,
        parsed: { title_jp: extractedText }
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

if (typeof window !== 'undefined') {
  window.OcrEngine = OcrEngine;
}
