/**
 * app.js - PWA 主控制器與互動邏輯
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('roi-canvas');
  const guideOverlay = document.getElementById('guide-overlay');
  const btnCapture = document.getElementById('btn-capture');
  const btnUpload = document.getElementById('btn-upload');
  const fileInput = document.getElementById('file-input');
  const btnTorch = document.getElementById('btn-torch');
  const btnOrient = document.getElementById('btn-orient');
  const btnForceRefresh = document.getElementById('btn-force-refresh');
  const btnSound = document.getElementById('btn-sound');
  const btnSettings = document.getElementById('btn-settings');
  const dbBadge = document.getElementById('db-badge');
  const dbInfo = document.getElementById('db-info');
  const scanStatus = document.getElementById('scan-status');
  const scanStatusText = document.getElementById('scan-status-text');
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  const platformChips = document.getElementById('platform-chips');

  // Result Sheet Elements
  const resultSheet = document.getElementById('result-sheet');
  const btnCloseSheet = document.getElementById('btn-close-sheet');
  const sheetHandle = document.getElementById('sheet-handle');
  const statusBanner = document.getElementById('status-banner');
  const statusIcon = document.getElementById('status-icon');
  const statusTitle = document.getElementById('status-title');
  const statusDesc = document.getElementById('status-desc');
  const resTitleJp = document.getElementById('res-title-jp');
  const resTitleZh = document.getElementById('res-title-zh');
  const resTitleEn = document.getElementById('res-title-en');
  const resPlatform = document.getElementById('res-platform');
  const resCatalog = document.getElementById('res-catalog');
  const resNo = document.getElementById('res-no');
  const resRegion = document.getElementById('res-region');
  const resNotes = document.getElementById('res-notes');
  const relatedSection = document.getElementById('related-section');
  const relatedList = document.getElementById('related-list');
  const roiPreview = document.getElementById('roi-preview');
  const editOcrText = document.getElementById('edit-ocr-text');
  const btnReMatch = document.getElementById('btn-re-match');

  // Settings Modal Elements
  const settingsModal = document.getElementById('settings-modal');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const selectEngine = document.getElementById('select-engine');
  const inputGeminiKey = document.getElementById('input-gemini-key');
  const checkVibration = document.getElementById('check-vibration');
  const checkSound = document.getElementById('check-sound');

  // State
  let currentPlatform = 'ALL';
  let soundEnabled = localStorage.getItem('sound_enabled') !== 'false';
  let vibrationEnabled = localStorage.getItem('vibration_enabled') !== 'false';
  let isScanningBusy = false;

  // Initialize Modules
  const scanner = new CameraScanner(video, canvas, guideOverlay);
  const matcher = new GameMatcher();
  const ocr = new OcrEngine();

  // 1. Register Service Worker for offline PWA
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      console.log('[PWA] Service Worker registered:', reg.scope);
    } catch (err) {
      console.warn('[PWA] Service Worker registration failed:', err);
    }
  }

  // 2. Load Games Database
  try {
    const res = await fetch('data/games.json');
    const data = await res.json();
    matcher.init(data);
    dbBadge.textContent = `${data.total_count} 款已就緒`;
    dbInfo.textContent = `共載入 ${data.total_count} 筆遊戲收藏紀錄（產出日期：${data.generated_at}）`;
  } catch (err) {
    console.error('[App] Failed to load games.json:', err);
    dbBadge.textContent = '資料庫載入失敗';
  }

  // 3. Start Camera
  try {
    await scanner.startCamera();
  } catch (err) {
    console.warn('[App] Camera auto-start failed, waiting for user click:', err);
  }

  // Audio Feedback (Web Audio API)
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  function playTone(type) {
    if (!soundEnabled) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'owned') {
        // Warning alert tone for duplicate (low double buzz)
        osc.frequency.setValueAtTime(330, audioCtx.currentTime);
        osc.frequency.setValueAtTime(220, audioCtx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      } else if (type === 'cross') {
        // Two mid tones for cross-platform reminder
        osc.frequency.setValueAtTime(440, audioCtx.currentTime); // A4
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.25);
      } else {
        // Cheerful pleasant ding-dong chime for new unowned game!
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1); // A5
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      }
    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  }

  function triggerVibration(type) {
    if (!vibrationEnabled || !navigator.vibrate) return;
    if (type === 'owned') {
      navigator.vibrate([120, 80, 150]); // 重複警告震動
    } else if (type === 'cross') {
      navigator.vibrate([100, 50, 100]);
    } else {
      navigator.vibrate([80]); // 新入單次輕快震動
    }
  }

  // 4. Perform Scan & Match Flow
  async function processImage(dataUrl) {
    if (isScanningBusy) return;
    isScanningBusy = true;
    showScanStatus('正在擷取影像與字體...');

    // 顯示即時裁切預覽
    if (roiPreview) {
      roiPreview.src = dataUrl;
    }

    try {
      const isVertical = (scanner.orientation === 'vertical');
      const ocrResult = await ocr.recognize(dataUrl, (msg) => {
        showScanStatus(msg);
      }, isVertical);

      if (editOcrText) {
        editOcrText.value = ocrResult.displayText || ocrResult.rawText || '';
      }

      // Match against database
      const matchResult = matcher.match(ocrResult.rawText, currentPlatform);
      displayResult(matchResult);
    } catch (err) {
      console.error('[App] OCR Process error:', err);
      alert('辨識過程發生錯誤：' + err.message);
    } finally {
      hideScanStatus();
      isScanningBusy = false;
    }
  }

  function showScanStatus(text) {
    scanStatusText.textContent = text;
    scanStatus.classList.remove('hidden');
  }

  function hideScanStatus() {
    scanStatus.classList.add('hidden');
  }

  // 5. Display Result
  function displayResult(res) {
    statusBanner.className = 'status-banner';
    relatedSection.style.display = 'none';
    relatedList.innerHTML = '';

    if (res.status === 'OWNED') {
      statusBanner.classList.add('owned');
      statusIcon.textContent = '🔴';
      statusTitle.textContent = '🔴【已收藏】重複注意！';
      statusDesc.textContent = res.message;
      playTone('owned');
      triggerVibration('owned');
      fillGameCard(res.game);
    } else if (res.status === 'CROSS_PLATFORM') {
      statusBanner.classList.add('cross');
      statusIcon.textContent = '🟡';
      statusTitle.textContent = '🟡【跨平台已有】提醒';
      statusDesc.textContent = res.message;
      playTone('cross');
      triggerVibration('cross');
      fillGameCard(res.game);
    } else if (res.status === 'PARTIAL') {
      statusBanner.classList.add('cross');
      statusIcon.textContent = '🔍';
      statusTitle.textContent = '🔍【可能相符】請核對';
      statusDesc.textContent = res.message;
      playTone('cross');
      triggerVibration('cross');
      fillGameCard(res.game);
    } else {
      statusBanner.classList.add('notowned');
      statusIcon.textContent = '🟢';
      statusTitle.textContent = '🟢【未收藏】推薦入手！';
      statusDesc.textContent = '在目前 2,143 款收藏中無此遊戲，可安心購買！';
      playTone('notowned');
      triggerVibration('notowned');

      resTitleJp.textContent = '未登錄之遊戲作品';
      resTitleZh.textContent = '可放心購買';
      resTitleEn.textContent = res.text ? `識別文字：${res.text.slice(0, 30)}...` : '';
      resPlatform.textContent = currentPlatform === 'ALL' ? '未知主機' : currentPlatform;
      resCatalog.textContent = '無重複紀錄';
      resNo.textContent = '-';
      resRegion.textContent = '-';
      resNotes.textContent = '掃描文字已記錄於下方原始 OCR 欄位中。';
    }

    // Related Games
    if (res.relatedGames && res.relatedGames.length > 0) {
      relatedSection.style.display = 'block';
      for (const rel of res.relatedGames) {
        const item = document.createElement('div');
        item.className = 'related-item';
        item.innerHTML = `
          <div>
            <strong>[${rel.platform}]</strong> ${rel.title_jp || rel.title_zh}
            <span style="color: #64748b; margin-left: 6px;">${rel.catalog || ''}</span>
          </div>
          <span style="color: #38bdf8;">No. ${rel.no}</span>
        `;
        relatedList.appendChild(item);
      }
    }

    resultSheet.classList.add('open');
  }

  function fillGameCard(game) {
    if (!game) return;
    resTitleJp.textContent = game.title_jp || '-';
    resTitleZh.textContent = game.title_zh || '-';
    resTitleEn.textContent = game.title_en || '-';
    resPlatform.textContent = game.platform;
    resCatalog.textContent = game.catalog || '無編號';
    resNo.textContent = `No. ${game.no}`;
    resRegion.textContent = game.region || '日版';
    resNotes.textContent = game.notes || '無備註';
  }

  // 6. Event Listeners
  // Capture
  btnCapture.addEventListener('click', async () => {
    const dataUrl = scanner.captureROI(true);
    if (dataUrl) {
      await processImage(dataUrl);
    } else {
      // If camera wasn't running, retry opening it
      try {
        await scanner.startCamera();
      } catch (e) {
        alert('請允許相機權限以進行掃描');
      }
    }
  });

  // Photo Upload
  btnUpload.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      await processImage(event.target.result);
    };
    reader.readAsDataURL(file);
    fileInput.value = '';
  });

  // Torch
  btnTorch.addEventListener('click', async () => {
    const isOn = await scanner.toggleTorch();
    btnTorch.classList.toggle('active', isOn);
  });

  // Orientation toggle (Horizontal / Vertical guide box)
  btnOrient.addEventListener('click', () => {
    const newMode = scanner.orientation === 'horizontal' ? 'vertical' : 'horizontal';
    scanner.setOrientation(newMode);
  });

  // Force Refresh & Clear Cache button
  if (btnForceRefresh) {
    btnForceRefresh.addEventListener('click', async () => {
      showScanStatus('正在清除快取並更新至最新版...');
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) await r.unregister();
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          for (const k of keys) await caches.delete(k);
        }
      } catch (e) {
        console.warn('Cache clear error:', e);
      }
      window.location.reload(true);
    });
  }

  // Sound toggle
  btnSound.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('sound_enabled', soundEnabled);
    btnSound.textContent = soundEnabled ? '🔔' : '🔕';
    btnSound.classList.toggle('active', soundEnabled);
  });

  // Platform chips
  platformChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentPlatform = chip.getAttribute('data-platform');
  });

  // Search input debounce
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim();
    searchClear.style.display = val ? 'inline' : 'none';
    clearTimeout(searchTimer);
    if (!val) return;

    searchTimer = setTimeout(() => {
      const match = matcher.match(val, currentPlatform);
      displayResult(match);
    }, 280);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
  });

  // Re-match edited OCR text
  if (btnReMatch && editOcrText) {
    btnReMatch.addEventListener('click', () => {
      const edited = editOcrText.value.trim();
      if (edited) {
        const matchResult = matcher.match(edited, currentPlatform);
        displayResult(matchResult);
      }
    });

    let editTimer = null;
    editOcrText.addEventListener('input', () => {
      clearTimeout(editTimer);
      editTimer = setTimeout(() => {
        const edited = editOcrText.value.trim();
        if (edited) {
          const matchResult = matcher.match(edited, currentPlatform);
          displayResult(matchResult);
        }
      }, 400);
    });
  }

  // Sheet close
  btnCloseSheet.addEventListener('click', () => resultSheet.classList.remove('open'));
  sheetHandle.addEventListener('click', () => resultSheet.classList.remove('open'));

  // Settings
  btnSettings.addEventListener('click', () => {
    selectEngine.value = ocr.preferredEngine;
    inputGeminiKey.value = ocr.geminiApiKey;
    checkVibration.checked = vibrationEnabled;
    checkSound.checked = soundEnabled;
    settingsModal.classList.remove('hidden');
  });

  btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));

  btnSaveSettings.addEventListener('click', () => {
    ocr.setPreferredEngine(selectEngine.value);
    ocr.setGeminiApiKey(inputGeminiKey.value);
    vibrationEnabled = checkVibration.checked;
    soundEnabled = checkSound.checked;
    localStorage.setItem('vibration_enabled', vibrationEnabled);
    localStorage.setItem('sound_enabled', soundEnabled);
    btnSound.textContent = soundEnabled ? '🔔' : '🔕';
    settingsModal.classList.add('hidden');
  });
});
