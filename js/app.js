/**
 * app.js - PWA 主控制器與互動邏輯 (支援 GitHub 雲端同步、離線快取、AI 視覺日翻中比對與採購籃)
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
  const btnSyncGithub = document.getElementById('btn-sync-github');
  const btnCart = document.getElementById('btn-cart');
  const cartBadge = document.getElementById('cart-badge');
  const btnSound = document.getElementById('btn-sound');
  const btnSettings = document.getElementById('btn-settings');
  const dbBadge = document.getElementById('db-badge');
  const dbInfo = document.getElementById('db-info');
  const dbSyncStatus = document.getElementById('db-sync-status');
  const scanStatus = document.getElementById('scan-status');
  const scanStatusText = document.getElementById('scan-status-text');
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  const resultSheet = document.getElementById('result-sheet');
  const btnCloseSheet = document.getElementById('btn-close-sheet');
  const sheetHandle = document.getElementById('sheet-handle');
  const statusBanner = document.getElementById('status-banner');
  const statusIcon = document.getElementById('status-icon');
  const statusTitle = document.getElementById('status-title');
  const statusDesc = document.getElementById('status-desc');
  const resTitleZh = document.getElementById('res-title-zh');
  const resTitleJp = document.getElementById('res-title-jp');
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
  const btnAddCart = document.getElementById('btn-add-cart');

  // Cart Modal Elements
  const cartModal = document.getElementById('cart-modal');
  const btnCloseCart = document.getElementById('btn-close-cart');
  const cartItemsContainer = document.getElementById('cart-items');
  const cartCount = document.getElementById('cart-count');
  const btnCopyCart = document.getElementById('btn-copy-cart');
  const btnClearCart = document.getElementById('btn-clear-cart');

  // Settings Modal Elements
  const settingsModal = document.getElementById('settings-modal');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const selectEngine = document.getElementById('select-engine');
  const inputGeminiKey = document.getElementById('input-gemini-key');
  const checkVibration = document.getElementById('check-vibration');
  const checkSound = document.getElementById('check-sound');
  const inputGithubUrl = document.getElementById('input-github-url');
  const btnSyncNow = document.getElementById('btn-sync-now');
  const btnExportJson = document.getElementById('btn-export-json');
  const btnImportJsonTrigger = document.getElementById('btn-import-json-trigger');
  const importJsonInput = document.getElementById('import-json-input');

  // State
  let currentPlatform = 'ALL';
  let soundEnabled = localStorage.getItem('sound_enabled') !== 'false';
  let vibrationEnabled = localStorage.getItem('vibration_enabled') !== 'false';
  let isScanningBusy = false;
  let lastScannedItem = null;
  let todayCart = JSON.parse(localStorage.getItem('today_cart') || '[]');

  // Default GitHub URL
  const DEFAULT_GITHUB_URL = 'https://raw.githubusercontent.com/Kevinte67228/game-collection-scanner/main/data/games.json';
  let currentGithubUrl = localStorage.getItem('github_sync_url') || DEFAULT_GITHUB_URL;

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

  // 2. Load Games Database (Cache-First + GitHub Sync)
  async function loadDatabase() {
    let loadedData = null;
    const cachedCustom = localStorage.getItem('games_db_custom');

    if (cachedCustom) {
      try {
        loadedData = JSON.parse(cachedCustom);
        console.log('[App] Loaded database from localStorage cache.');
      } catch (e) {
        console.warn('[App] LocalStorage cache corrupted, fall back to local file.');
      }
    }

    if (!loadedData) {
      try {
        const res = await fetch('data/games.json');
        loadedData = await res.json();
        console.log('[App] Loaded database from bundled data/games.json.');
      } catch (err) {
        console.error('[App] Failed to load data/games.json:', err);
      }
    }

    if (loadedData && (loadedData.games || Array.isArray(loadedData))) {
      applyDatabase(loadedData);
    } else {
      dbBadge.textContent = '載入失敗';
    }

    // Auto-check GitHub for updates in background
    if (navigator.onLine) {
      setTimeout(() => syncFromGitHub(currentGithubUrl, false), 1500);
    }
  }

  let allPlatforms = [];
  function applyDatabase(data) {
    matcher.init(data);
    const count = matcher.games.length;
    const dateStr = data.generated_at || '最新版';
    dbBadge.textContent = `${count.toLocaleString()} 款已就緒`;
    dbInfo.textContent = `共載入 ${count.toLocaleString()} 筆遊戲收藏（更新日期：${dateStr}）`;
    if (dbSyncStatus) {
      dbSyncStatus.textContent = `當前版本：${count.toLocaleString()} 筆 (${dateStr})`;
    }
    
    allPlatforms = [...new Set(matcher.games.map(g => g.platform))].filter(Boolean);
    allPlatforms.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    if (!allPlatforms.includes('書籍')) allPlatforms.push('書籍');
    if (!allPlatforms.includes('攻略')) allPlatforms.push('攻略');
    if (typeof window.renderPlatformList === 'function') window.renderPlatformList();
  }

  // GitHub Sync Function
  async function syncFromGitHub(url, isManual = false) {
    if (!url) return;
    if (isManual) showScanStatus('正在連線 GitHub 同步最新收藏庫...');
    
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const freshData = await res.json();

      if (!freshData.games && !Array.isArray(freshData)) {
        throw new Error('資料格式不正確，找不到 games 陣列');
      }

      // Save to localStorage
      try {
        localStorage.setItem('games_db_custom', JSON.stringify(freshData));
      } catch (storageErr) {
        console.warn('[App] LocalStorage quota exceeded, caching in memory only.');
      }

      applyDatabase(freshData);

      if (isManual) {
        alert(`🎉 同步成功！\n共載入 ${matcher.games.length.toLocaleString()} 筆收藏\n版本時間：${freshData.generated_at || '最新'}`);
      } else {
        console.log('[App] Background GitHub sync completed successfully.');
      }
    } catch (err) {
      console.warn('[App] GitHub sync failed:', err);
      if (isManual) {
        alert(`GitHub 連線同步失敗：\n${err.message}\n請檢查網路連線或自訂網址。`);
      }
    } finally {
      if (isManual) hideScanStatus();
    }
  }

  await loadDatabase();

  // 3. Start Camera
  try {
    await scanner.startCamera();
  } catch (err) {
    console.warn('[App] Camera auto-start failed, waiting for user click:', err);
  }

  // Audio Feedback (Web Audio API)
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioUnlocked = false;
  function unlockAudio() {
    if (!audioUnlocked && audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => { audioUnlocked = true; });
    }
  }
  ['touchstart', 'touchend', 'click'].forEach(e => document.body.addEventListener(e, unlockAudio, { once: true }));

  function playTone(type) {
    if (!soundEnabled) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'owned') {
        osc.frequency.setValueAtTime(330, audioCtx.currentTime);
        osc.frequency.setValueAtTime(220, audioCtx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      } else if (type === 'cross') {
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.25);
      } else {
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
        osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1);
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
      navigator.vibrate([120, 80, 150]);
    } else if (type === 'cross') {
      navigator.vibrate([100, 50, 100]);
    } else {
      navigator.vibrate([80]);
    }
  }

  // 4. Perform Scan & Match Flow
  async function processImage(dataUrl) {
    if (isScanningBusy) return;
    isScanningBusy = true;
    showScanStatus('正在擷取影像並由 AI 解析...');

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
      displayResult(matchResult, ocrResult);
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
  function displayResult(res, ocrResult = null) {
    statusBanner.className = 'status-banner';
    relatedSection.style.display = 'none';
    relatedList.innerHTML = '';

    const parsed = ocrResult?.parsed || {};

    if (res.status === 'OWNED') {
      statusBanner.classList.add('owned');
      statusIcon.textContent = '🔴';
      statusTitle.textContent = '🔴【已收藏】重複注意！';
      statusDesc.textContent = res.message;
      playTone('owned');
      triggerVibration('owned');
      fillGameCard(res.game, parsed);
      lastScannedItem = { ...res.game, isOwned: true };
    } else if (res.status === 'CROSS_PLATFORM') {
      statusBanner.classList.add('cross');
      statusIcon.textContent = '🟡';
      statusTitle.textContent = '🟡【跨平台已有】提醒';
      statusDesc.textContent = res.message;
      playTone('cross');
      triggerVibration('cross');
      fillGameCard(res.game, parsed);
      lastScannedItem = { ...res.game, isOwned: false, note: '跨平台已擁有' };
    } else if (res.status === 'PARTIAL') {
      statusBanner.classList.add('cross');
      statusIcon.textContent = '🔍';
      statusTitle.textContent = '🔍【可能相符】請核對';
      statusDesc.textContent = res.message;
      playTone('cross');
      triggerVibration('cross');
      fillGameCard(res.game, parsed);
      lastScannedItem = { ...res.game, isOwned: false, note: '疑似相似' };
    } else {
      statusBanner.classList.add('notowned');
      statusIcon.textContent = '🟢';
      statusTitle.textContent = '🟢【未收藏】推薦入手！';
      statusDesc.textContent = `在目前 ${matcher.games.length.toLocaleString()} 款收藏中無此遊戲，可安心購買！`;
      playTone('notowned');
      triggerVibration('notowned');

      // 呈現 AI 翻譯與辨識出的內容
      const displayZh = parsed.title_zh || '未登錄之遊戲作品 (安全可買)';
      const displayJp = parsed.title_jp || res.text || '日文原名未明確';
      const displayEn = parsed.title_en || '';
      const displayPlat = parsed.platform || (currentPlatform === 'ALL' ? '未知主機' : currentPlatform);
      const displayCat = parsed.catalog || '無編號';

      resTitleZh.textContent = displayZh;
      resTitleJp.textContent = displayJp;
      resTitleEn.textContent = displayEn;
      resPlatform.textContent = displayPlat;
      resCatalog.textContent = displayCat;
      resNo.textContent = '-';
      resRegion.textContent = '-';
      resNotes.textContent = parsed.notes ? `版本：${parsed.notes}` : '可點擊下方按鈕加入今日戰利品清單。';

      lastScannedItem = {
        title_zh: displayZh,
        title_jp: displayJp,
        title_en: displayEn,
        platform: displayPlat,
        catalog: displayCat,
        no: '-',
        isOwned: false
      };
    }

    // Related Games
    if (res.relatedGames && res.relatedGames.length > 0) {
      relatedSection.style.display = 'block';
      for (const rel of res.relatedGames) {
        const item = document.createElement('div');
        item.className = 'related-item';
        item.innerHTML = `
          <div>
            <strong>[${rel.platform}]</strong> ${rel.title_zh || rel.title_jp}
            <span style="color: #64748b; margin-left: 6px;">${rel.catalog || ''}</span>
          </div>
          <span style="color: #38bdf8;">No. ${rel.no}</span>
        `;
        relatedList.appendChild(item);
      }
    }

    resultSheet.classList.add('open');
  }

  function fillGameCard(game, parsed = {}) {
    if (!game) return;
    resTitleZh.textContent = game.title_zh || parsed.title_zh || game.title_jp;
    resTitleJp.textContent = game.title_jp || parsed.title_jp || '-';
    resTitleEn.textContent = game.title_en || parsed.title_en || '-';
    resPlatform.textContent = game.platform;
    resCatalog.textContent = game.catalog || parsed.catalog || '無編號';
    resNo.textContent = `No. ${game.no}`;
    resRegion.textContent = game.region || '日版';
    resNotes.textContent = game.notes || '無額外備註';
  }

  // 6. Cart Management
  function updateCartUI() {
    cartBadge.textContent = todayCart.length;
    cartCount.textContent = todayCart.length;
    cartBadge.classList.toggle('hidden', todayCart.length === 0);

    if (todayCart.length === 0) {
      cartItemsContainer.innerHTML = '<p style="color: #64748b; text-align: center; font-size: 13px; padding: 20px 0;">目前尚未加入任何遊戲</p>';
      return;
    }

    cartItemsContainer.innerHTML = '';
    todayCart.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'cart-row';
      row.innerHTML = `
        <div>
          <div class="cart-row-title">[${item.platform || '未知'}] ${item.title_zh || item.title_jp}</div>
          <div class="cart-row-sub">編號: ${item.catalog || '無'} | 日文: ${item.title_jp || '-'}</div>
        </div>
        <button class="btn-remove-item" data-index="${index}" title="刪除">✕</button>
      `;
      cartItemsContainer.appendChild(row);
    });

    // Bind remove buttons
    cartItemsContainer.querySelectorAll('.btn-remove-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        todayCart.splice(idx, 1);
        localStorage.setItem('today_cart', JSON.stringify(todayCart));
        updateCartUI();
      });
    });
  }

  btnAddCart.addEventListener('click', () => {
    if (!lastScannedItem) return;
    todayCart.push({
      title_zh: resTitleZh.textContent,
      title_jp: resTitleJp.textContent,
      platform: resPlatform.textContent,
      catalog: resCatalog.textContent,
      time: new Date().toLocaleTimeString()
    });
    localStorage.setItem('today_cart', JSON.stringify(todayCart));
    updateCartUI();
    alert(`已加入採購籃：${resTitleZh.textContent}`);
  });

  btnCart.addEventListener('click', () => {
    updateCartUI();
    cartModal.classList.remove('hidden');
  });

  btnCloseCart.addEventListener('click', () => cartModal.classList.add('hidden'));

  btnClearCart.addEventListener('click', () => {
    if (confirm('確定要清空今日採購清單嗎？')) {
      todayCart = [];
      localStorage.setItem('today_cart', JSON.stringify(todayCart));
      updateCartUI();
    }
  });

  btnCopyCart.addEventListener('click', () => {
    if (todayCart.length === 0) {
      alert('採購籃內無資料！');
      return;
    }
    const text = todayCart.map((it, i) => `${i + 1}. [${it.platform}] ${it.title_zh} (${it.title_jp}) - 編號: ${it.catalog}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      alert('已複製今日採購清單到剪貼簿！');
    }).catch(() => {
      alert(text);
    });
  });

  updateCartUI();

  // 7. Event Listeners
  // Capture
  btnCapture.addEventListener('click', async () => {
    const dataUrl = scanner.captureROI(true);
    if (dataUrl) {
      await processImage(dataUrl);
    } else {
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

  // GitHub Sync Header Button
  btnSyncGithub.addEventListener('click', async () => {
    await syncFromGitHub(currentGithubUrl, true);
  });

  // Sound toggle
  btnSound.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('sound_enabled', soundEnabled);
    btnSound.textContent = soundEnabled ? '🔔' : '🔕';
    btnSound.classList.toggle('active', soundEnabled);
  });

  // Platform Modal UI Logic
  const btnOpenPlatform = document.getElementById('btn-open-platform');
  const platformModal = document.getElementById('platform-modal');
  const btnClosePlatform = document.getElementById('btn-close-platform');
  const inputPlatformSearch = document.getElementById('input-platform-search');
  const platformList = document.getElementById('platform-list');
  const currentPlatformText = document.getElementById('current-platform-text');

  function renderPlatformList(filterText = '') {
    if (!platformList) return;
    platformList.innerHTML = '';
    
    const term = filterText.toLowerCase();
    
    if ('all'.includes(term) || '不指定'.includes(term) || term === '') {
      const allItem = document.createElement('div');
      allItem.className = 'platform-item special';
      allItem.textContent = '— 不指定 (ALL) —';
      allItem.onclick = () => selectPlatform('ALL', '— 不指定 (ALL) —');
      platformList.appendChild(allItem);
    }

    allPlatforms.forEach(p => {
      if (p.toLowerCase().includes(term)) {
        const item = document.createElement('div');
        item.className = 'platform-item';
        item.textContent = p;
        item.onclick = () => selectPlatform(p, p);
        platformList.appendChild(item);
      }
    });
  }
  window.renderPlatformList = renderPlatformList;

  function selectPlatform(val, display) {
    currentPlatform = val;
    if (currentPlatformText) currentPlatformText.textContent = display;
    if (platformModal) platformModal.classList.add('hidden');
  }

  if (btnOpenPlatform) {
    btnOpenPlatform.addEventListener('click', () => {
      inputPlatformSearch.value = '';
      renderPlatformList();
      platformModal.classList.remove('hidden');
      setTimeout(() => inputPlatformSearch.focus(), 100);
    });
  }

  if (btnClosePlatform) {
    btnClosePlatform.addEventListener('click', () => {
      platformModal.classList.add('hidden');
    });
  }

  if (inputPlatformSearch) {
    inputPlatformSearch.addEventListener('input', (e) => {
      renderPlatformList(e.target.value);
    });
  }

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

  // Settings Modal Handlers
  btnSettings.addEventListener('click', () => {
    selectEngine.value = ocr.preferredEngine;
    inputGeminiKey.value = ocr.geminiApiKey;
    checkVibration.checked = vibrationEnabled;
    checkSound.checked = soundEnabled;
    inputGithubUrl.value = currentGithubUrl;
    settingsModal.classList.remove('hidden');
  });

  btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));

  btnSyncNow.addEventListener('click', async () => {
    const url = inputGithubUrl.value.trim() || DEFAULT_GITHUB_URL;
    currentGithubUrl = url;
    localStorage.setItem('github_sync_url', url);
    await syncFromGitHub(url, true);
  });

  // Export / Backup JSON
  btnExportJson.addEventListener('click', () => {
    const dataToExport = {
      generated_at: new Date().toISOString(),
      total_count: matcher.games.length,
      games: matcher.games
    };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `games_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import JSON File
  btnImportJsonTrigger.addEventListener('click', () => importJsonInput.click());
  importJsonInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (!parsed.games && !Array.isArray(parsed)) {
          throw new Error('無效的 JSON 資料庫');
        }
        localStorage.setItem('games_db_custom', JSON.stringify(parsed));
        applyDatabase(parsed);
        alert(`成功匯入 ${matcher.games.length.toLocaleString()} 筆遊戲收藏！`);
      } catch (err) {
        alert('匯入失敗：' + err.message);
      }
    };
    reader.readAsText(file);
    importJsonInput.value = '';
  });

  btnSaveSettings.addEventListener('click', () => {
    ocr.setPreferredEngine(selectEngine.value);
    ocr.setGeminiApiKey(inputGeminiKey.value);
    vibrationEnabled = checkVibration.checked;
    soundEnabled = checkSound.checked;
    currentGithubUrl = inputGithubUrl.value.trim() || DEFAULT_GITHUB_URL;
    localStorage.setItem('github_sync_url', currentGithubUrl);
    localStorage.setItem('vibration_enabled', vibrationEnabled);
    localStorage.setItem('sound_enabled', soundEnabled);
    btnSound.textContent = soundEnabled ? '🔔' : '🔕';
    settingsModal.classList.add('hidden');
  });
});
