/**
 * matcher.js - 遊戲資料庫索引與模糊比對核心
 */

class GameMatcher {
  constructor() {
    this.games = [];
    this.catalogMap = new Map(); // cleanCatalog -> [game, ...]
    this.numericCatalogMap = new Map(); // numbers only -> [game, ...]
    this.titleMap = new Map(); // normalized title -> [game, ...]
    this.fuse = null;
    this.isReady = false;
  }

  init(gamesData) {
    this.games = gamesData.games || gamesData;
    this.catalogMap.clear();
    this.numericCatalogMap.clear();
    this.titleMap.clear();

    for (const g of this.games) {
      // 1. Index catalogs
      if (g.catalogs_clean && g.catalogs_clean.length > 0) {
        for (const cat of g.catalogs_clean) {
          const upperCat = cat.toUpperCase();
          if (!this.catalogMap.has(upperCat)) {
            this.catalogMap.set(upperCat, []);
          }
          this.catalogMap.get(upperCat).push(g);

          // Numeric sub-index for e.g. "00542"
          const nums = upperCat.replace(/\D/g, '');
          if (nums.length >= 4) {
            if (!this.numericCatalogMap.has(nums)) {
              this.numericCatalogMap.set(nums, []);
            }
            this.numericCatalogMap.get(nums).push(g);
          }
        }
      }

      // 2. Index simple title
      const normTitle = this.normalize(g.title_jp || g.title_zh || g.title_en);
      if (normTitle) {
        if (!this.titleMap.has(normTitle)) {
          this.titleMap.set(normTitle, []);
        }
        this.titleMap.get(normTitle).push(g);
      }
    }

    // 依長度排序以優先比對最長、最精準的型號與標題
    this.catalogsSortedByLength = Array.from(this.catalogMap.keys()).sort((a, b) => b.length - a.length);
    this.gamesSortedByLength = [...this.games].sort((a, b) => {
      const lenA = Math.max(a.title_jp?.length || 0, a.title_en?.length || 0);
      const lenB = Math.max(b.title_jp?.length || 0, b.title_en?.length || 0);
      return lenB - lenA;
    });

    // 3. Initialize Fuse.js
    if (typeof Fuse !== 'undefined') {
      const options = {
        includeScore: true,
        threshold: 0.4,
        distance: 100,
        keys: [
          { name: 'title_jp', weight: 0.45 },
          { name: 'title_zh', weight: 0.3 },
          { name: 'title_en', weight: 0.25 },
          { name: 'catalog', weight: 0.5 },
          { name: 'catalogs_clean', weight: 0.6 }
        ]
      };
      this.fuse = new Fuse(this.games, options);
    }

    this.isReady = true;
    console.log(`[GameMatcher] Initialized with ${this.games.length} records.`);
  }

  normalize(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/[!！?？:：\-—_・•/／~～()（）\[\]【】「」『』\s]+/g, ' ')
      .trim();
  }

  cleanCatalog(str) {
    if (!str) return '';
    return str.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /**
   * 搜尋比對文本（包含 OCR 提取的多行字串）
   */
  match(rawText, targetPlatform = 'ALL') {
    if (!this.isReady || !rawText) {
      return { status: 'EMPTY', text: rawText, matches: [] };
    }

    const text = rawText.trim();
    const cleanAll = this.cleanCatalog(text);

    // 1. 全字串直接掃描已知商品編號庫 (由長至短)
    // 支援 PS1/2/3/4/5 (SLPS, SCPS), SS (GS-, T-), SFC (SHVC-), N64 (NUS-), DC, PCE, Switch 等
    if (cleanAll.length >= 4) {
      for (const cat of (this.catalogsSortedByLength || [])) {
        if (cat.length >= 4 && cleanAll.includes(cat)) {
          const matches = this.catalogMap.get(cat);
          const exact = targetPlatform === 'ALL' 
            ? matches[0] 
            : (matches.find(m => m.platform === targetPlatform) || matches[0]);

          return {
            status: 'OWNED',
            type: 'EXACT_CATALOG',
            confidence: 1.0,
            matchedCatalog: cat,
            game: exact,
            relatedGames: this.findRelated(exact),
            message: `【已收藏】商品編號 ${exact.catalog} 完全符合！`
          };
        }
      }
    }

    // 2. 嘗試純數字部分比對（例如只辨識到 "00542" 或 "9027"）
    const numRegex = /\b(\d{4,6})\b/g;
    let numMatch;
    while ((numMatch = numRegex.exec(text)) !== null) {
      const nums = numMatch[1];
      if (this.numericCatalogMap.has(nums)) {
        const candidates = this.numericCatalogMap.get(nums);
        // 如果候選人只有 1 款，或是當前平台只有 1 款
        const filtered = targetPlatform === 'ALL' ? candidates : candidates.filter(c => c.platform === targetPlatform);
        if (filtered.length === 1) {
          const game = filtered[0];
          return {
            status: 'OWNED',
            type: 'NUMERIC_CATALOG',
            confidence: 0.9,
            matchedCatalog: nums,
            game: game,
            relatedGames: this.findRelated(game),
            message: `【已收藏】依編號數字 ${nums} 命中 ${game.catalog}！`
          };
        }
      }
    }

    // 3. 智慧標題子字串比對 (過濾主機品牌名干擾，高精準鎖定書背日文/英文標題)
    const cleanJp = text
      .toLowerCase()
      .replace(/(playstation|プレイステーション|ps[1-5]?|sega\s*saturn|セガサターン|super\s*famicom|スーパーファミコン|nintendo\s*64|ニンテンドウ64|dreamcast|ドリームキャスト|pc\s*engine|メガドライブ|game\s*boy)/g, '')
      .replace(/[^一-龠ぁ-ゔァ-ヴーa-zA-Z0-9]/g, '');

    if (cleanJp.length >= 3) {
      // 依標題長度由長至短比對，優先命中精確完整標題 (如 ダービースタリオン96 優於 ダービースタリオン)
      for (const game of (this.gamesSortedByLength || this.games)) {
        if (targetPlatform !== 'ALL' && game.platform !== targetPlatform) {
          continue;
        }

        const gameTitleJp = (game.title_jp || '').toLowerCase().replace(/[^一-龠ぁ-ゔァ-ヴーa-zA-Z0-9]/g, '');
        const gameTitleEn = (game.title_en || '').toLowerCase().replace(/[^一-龠ぁ-ゔァ-ヴーa-zA-Z0-9]/g, '');

        if (
          (gameTitleJp.length >= 3 && cleanJp.includes(gameTitleJp)) ||
          (gameTitleEn.length >= 4 && cleanJp.includes(gameTitleEn)) ||
          (cleanJp.length >= 4 && (gameTitleJp.includes(cleanJp) || gameTitleEn.includes(cleanJp)))
        ) {
          const related = this.findRelated(game);
          return {
            status: 'OWNED',
            type: 'SUBSTRING_TITLE',
            confidence: 0.95,
            matchedCatalog: game.catalog,
            game: game,
            relatedGames: related,
            message: `【已收藏】書背標題《${game.title_jp}》比對吻合！`
          };
        }
      }
    }

    // 4. 標題模糊搜尋 (Fuse.js)
    if (this.fuse) {
      // 去除主機關鍵字後的純淨搜尋字串
      const cleanSearchQuery = text
        .replace(/(PlayStation|SEGA SATURN|Super Famicom|Nintendo 64|DREAMCAST)/gi, '')
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, 100);

      const fuseResults = this.fuse.search(cleanSearchQuery || text);

      if (fuseResults.length > 0) {
        const best = fuseResults[0];
        const score = best.score; // 0 是完美匹配，1 是完全不符
        const candidate = best.item;

        if (score <= 0.35) {
          // 高信心度命中
          const related = this.findRelated(candidate);
          const isSamePlatform = (targetPlatform === 'ALL' || candidate.platform === targetPlatform);

          if (!isSamePlatform) {
            return {
              status: 'CROSS_PLATFORM',
              type: 'FUZZY_TITLE_CROSS',
              confidence: 1 - score,
              game: candidate,
              relatedGames: related,
              message: `⚠️【跨平台提醒】您已收藏此作品的【${candidate.platform}】版（編號：${candidate.catalog}）！`
            };
          }

          return {
            status: 'OWNED',
            type: 'FUZZY_TITLE',
            confidence: 1 - score,
            game: candidate,
            relatedGames: related,
            message: `【已收藏】遊戲標題高度吻合（信心度 ${Math.round((1 - score) * 100)}%）！`
          };
        } else if (score <= 0.48) {
          // 潛在中度相似
          return {
            status: 'PARTIAL',
            type: 'POSSIBLE_MATCH',
            confidence: 1 - score,
            game: candidate,
            relatedGames: fuseResults.slice(1, 4).map(r => r.item),
            message: `🔍【可能相符】找到相似收藏《${candidate.title_jp || candidate.title_zh}》（${candidate.platform}），請核對確認。`
          };
        }
      }
    }

    // 5. 無任何相符
    return {
      status: 'NOT_OWNED',
      type: 'NO_MATCH',
      confidence: 0,
      text: text,
      game: null,
      relatedGames: [],
      message: '🔴【未收藏】在目前 2,143 款收藏中未找到相符紀錄，推薦入手！'
    };
  }

  /**
   * 找尋不同平台或相同作品的系列作
   */
  findRelated(game) {
    if (!game) return [];
    const baseTitle = this.normalize(game.title_jp || game.title_zh || game.title_en);
    if (!baseTitle || baseTitle.length < 2) return [];

    return this.games.filter(g => {
      if (g.id === game.id) return false;
      const otherTitle = this.normalize(g.title_jp || g.title_zh || g.title_en);
      return (
        otherTitle.includes(baseTitle) || 
        baseTitle.includes(otherTitle) ||
        (game.title_zh && g.title_zh && g.title_zh === game.title_zh)
      );
    }).slice(0, 5);
  }
}

// 供瀏覽器全域或模組使用
if (typeof window !== 'undefined') {
  window.GameMatcher = GameMatcher;
}
if (typeof module !== 'undefined') {
  module.exports = GameMatcher;
}
