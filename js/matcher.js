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

  isBookOrGuide(platform) {
    const p = (platform || '').toUpperCase();
    return p.includes('GUIDE') || p.includes('BOOK');
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

    // 3. 智慧標題子字串比對 (過濾主機品牌名干擾，高精準鎖定日文/中文/英文標題)
    const cleanJp = text
      .toLowerCase()
      .replace(/(playstation|プレイステーション|ps[1-5]?|sega\s*saturn|セガサターン|super\s*famicom|スーパーファミコン|nintendo\s*64|ニンテンドウ64|dreamcast|ドリームキャスト|pc\s*engine|メガドライブ|game\s*boy)/g, '')
      .replace(/[^一-龠ぁ-ゔァ-ヴーa-zA-Z0-9\u4e00-\u9fa5]/g, '');

    if (cleanJp.length >= 2) {
      // 搜尋所有符合條件的候選項目，而非第一筆就直接 return
      const candidates = [];

      for (const game of (this.gamesSortedByLength || this.games)) {
        if (targetPlatform !== 'ALL' && game.platform !== targetPlatform) {
          continue;
        }

        const gameTitleJp = (game.title_jp || '').toLowerCase().replace(/[^一-龠ぁ-ゔァ-ヴーa-zA-Z0-9\u4e00-\u9fa5]/g, '');
        const gameTitleZh = (game.title_zh || '').toLowerCase().replace(/[^一-龠ぁ-ゔァ-ヴーa-zA-Z0-9\u4e00-\u9fa5]/g, '');
        const gameTitleEn = (game.title_en || '').toLowerCase().replace(/[^一-龠ぁ-ゔァ-ヴーa-zA-Z0-9\u4e00-\u9fa5]/g, '');

        // 缺頭容錯：OCR直排首字常誤辨，嘗試去掉前1~2字仍能命中
        const jpSuffix1 = gameTitleJp.length >= 5 ? gameTitleJp.slice(1) : '';
        const jpSuffix2 = gameTitleJp.length >= 6 ? gameTitleJp.slice(2) : '';
        const enSuffix1 = gameTitleEn.length >= 5 ? gameTitleEn.slice(1) : '';
        const zhSuffix1 = gameTitleZh.length >= 4 ? gameTitleZh.slice(1) : '';

        // 計算匹配類型與吻合度
        // 1: 完全相等 (Exact Match)
        // 2: 遊戲標題是以輸入文字為開頭 (Prefix match, 如輸入 "天地を喰らうII"，遊戲是 "天地を喰らうII 諸葛孔明伝") -> 高精準鎖定續作或完整名稱
        // 3: 輸入文字是以該遊戲標題為開頭 (Prefix match, 如輸入 "天地を喰らう 必勝攻略法"，遊戲是 "天地を喰らう")
        // 4: 一般包含 (Substring)
        // 5: 缺頭容錯
        let matchRank = 0;

        if (cleanJp === gameTitleJp || cleanJp === gameTitleZh || cleanJp === gameTitleEn) {
          matchRank = 1;
        } else if (
          (cleanJp.length >= 3 && gameTitleJp.startsWith(cleanJp)) ||
          (cleanJp.length >= 2 && gameTitleZh.startsWith(cleanJp)) ||
          (cleanJp.length >= 4 && gameTitleEn.startsWith(cleanJp))
        ) {
          matchRank = 2;
        } else if (
          (gameTitleJp.length >= 3 && cleanJp.startsWith(gameTitleJp)) ||
          (gameTitleZh.length >= 2 && cleanJp.startsWith(gameTitleZh)) ||
          (gameTitleEn.length >= 4 && cleanJp.startsWith(gameTitleEn))
        ) {
          matchRank = 3;
        } else if (
          (gameTitleJp.length >= 3 && cleanJp.includes(gameTitleJp)) ||
          (gameTitleZh.length >= 2 && cleanJp.includes(gameTitleZh)) ||
          (gameTitleEn.length >= 4 && cleanJp.includes(gameTitleEn)) ||
          (cleanJp.length >= 3 && (gameTitleJp.includes(cleanJp) || gameTitleZh.includes(cleanJp) || gameTitleEn.includes(cleanJp)))
        ) {
          matchRank = 4;
        } else if (
          (jpSuffix1.length >= 4 && cleanJp.includes(jpSuffix1)) ||
          (jpSuffix2.length >= 4 && cleanJp.includes(jpSuffix2)) ||
          (zhSuffix1.length >= 3 && cleanJp.includes(zhSuffix1)) ||
          (enSuffix1.length >= 4 && cleanJp.includes(enSuffix1))
        ) {
          matchRank = 5;
        }

        if (matchRank > 0) {
          // 標記是否為攻略本或書籍 (遊戲本體優先度高於書籍)
          const isBook = this.isBookOrGuide(game.platform);
          candidates.push({ game, matchRank, isBook });
        }
      }

      if (candidates.length > 0) {
        // 排序規則：
        // 1. 完全相等 (matchRank=1) 優先於 開頭前綴匹配 (matchRank=2, 3) 優先於 一般包含 (matchRank=4, 5)
        // 2. 當指定 ALL 時，遊戲本體 (!isBook) 優先於 攻略本/書籍 (isBook)
        // 3. 在同一等級中，標題長度與輸入字數最接近者優先 (差異最小)
        candidates.sort((a, b) => {
          if (a.matchRank !== b.matchRank) return a.matchRank - b.matchRank;
          if (a.isBook !== b.isBook) return a.isBook ? 1 : -1;
          const lenDiffA = Math.abs((a.game.title_jp?.length || 0) - cleanJp.length);
          const lenDiffB = Math.abs((b.game.title_jp?.length || 0) - cleanJp.length);
          return lenDiffA - lenDiffB;
        });

        const bestGame = candidates[0].game;
        // 將候選名單與搜尋字串傳入 findRelated，確保同樣包含關鍵字的作品（如天地無用、天地を喰らう）都能在下方清單列出
        const candidateGames = candidates.map(c => c.game);
        const related = this.findRelated(bestGame, text, candidateGames);
        const displayMatchTitle = bestGame.title_zh || bestGame.title_jp;
        return {
          status: 'OWNED',
          type: 'SUBSTRING_TITLE',
          confidence: candidates[0].matchRank === 1 ? 0.98 : 0.88,
          matchedCatalog: bestGame.catalog,
          game: bestGame,
          relatedGames: related,
          message: `【已收藏】標題《${displayMatchTitle}》比對吻合！`
        };
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
        // 若指定特定平台，優先挑選符合該平台的最佳結果
        let best = fuseResults[0];
        if (targetPlatform !== 'ALL') {
          const samePlatCandidate = fuseResults.find(r => r.item.platform === targetPlatform && r.score <= 0.42);
          if (samePlatCandidate) {
            best = samePlatCandidate;
          }
        }
        const score = best.score;
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
      message: `在目前 ${this.games.length.toLocaleString()} 款收藏中未找到相符紀錄。`
    };
  }

  /**
   * 找尋不同平台或相同作品的系列作（支援關鍵字聯想）
   */
  findRelated(game, searchQuery = '', candidateList = []) {
    if (!game) return [];
    const baseTitle = this.normalize(game.title_jp || game.title_zh || game.title_en);
    const normZh = this.normalize(game.title_zh);
    const normQuery = this.normalize(searchQuery);

    const scored = [];
    const seenIds = new Set([game.id]);

    // 1. 若有傳入同時命中的候選遊戲（例如搜尋「天地」，天地無用、天地を喰らう皆有命中）
    if (Array.isArray(candidateList)) {
      for (const cand of candidateList) {
        if (!seenIds.has(cand.id)) {
          seenIds.add(cand.id);
          scored.push({
            game: cand,
            priority: 2,
            isBook: this.isBookOrGuide(cand.platform)
          });
        }
      }
    }

    // 2. 全庫遍歷找關聯系列作或同關鍵字作品
    for (const g of this.games) {
      if (seenIds.has(g.id)) continue;

      const otherJp = this.normalize(g.title_jp);
      const otherZh = this.normalize(g.title_zh);
      const otherEn = this.normalize(g.title_en);
      const otherTitle = this.normalize(g.title_jp || g.title_zh || g.title_en);

      // (A) 系列作品或跨平台版本 (標題高度交集或繁中譯名完全相同)
      const hasSeriesOverlap = (baseTitle && otherTitle && (otherTitle.includes(baseTitle) || baseTitle.includes(otherTitle)));
      const hasExactZh = (normZh && normZh.length >= 4 && otherZh === normZh);

      // (B) 符合使用者當前搜尋詞 (例如 '天地')
      const matchesQuery = (normQuery && normQuery.length >= 2 && (otherJp.includes(normQuery) || otherZh.includes(normQuery) || otherEn.includes(normQuery)));

      if (hasSeriesOverlap || hasExactZh || matchesQuery) {
        let priority = 3;
        if (hasSeriesOverlap || hasExactZh) priority = 1;
        else if (matchesQuery) priority = 2;

        seenIds.add(g.id);
        scored.push({
          game: g,
          priority,
          isBook: this.isBookOrGuide(g.platform)
        });
      }
    }

    // 排序：系列直接關聯 (priority=1) > 同關鍵字搜尋結果 (priority=2) > 遊戲優先於書籍
    scored.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.isBook !== b.isBook) return a.isBook ? 1 : -1;
      return 0;
    });

    return scored.slice(0, 8).map(s => s.game);
  }
}

// 供瀏覽器全域或模組使用
if (typeof window !== 'undefined') {
  window.GameMatcher = GameMatcher;
}
if (typeof module !== 'undefined') {
  module.exports = GameMatcher;
}
