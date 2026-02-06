class TabContentStore {
  constructor() {
    this.dbName = 'HuddleDB';
    this.dbVersion = 1;
    this.db = null;
  }
  async put(storeName, data) {
    const tx = this.db.transaction([storeName], 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(data);
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async init() {
    if (this.db) return this.db;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains('tabs')) {
          const tabStore = db.createObjectStore('tabs', { keyPath: 'id' });
          tabStore.createIndex('url', 'url', { unique: false });
          tabStore.createIndex('domain', 'domain', { unique: false });
          tabStore.createIndex('groupId', 'groupId', { unique: false });
          tabStore.createIndex('savedAt', 'savedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('searchIndex')) {
          db.createObjectStore('searchIndex', { keyPath: 'word' });
        }
      };
    });
  }

  async saveTabContent(tabId, groupId, url, title, content) {
    await this.init();
    
    const id = `tab-${tabId}`;
    let domain = 'unknown';
    try {
      domain = new URL(url).hostname;
    } catch (e) {}
    
    const words = this.tokenize(content + ' ' + title);
    
    const tabData = {
      id,
      tabId,
      groupId,
      url,
      domain,
      title,
      content: content.substring(0, 50000),
      contentPreview: content.substring(0, 300),
      wordCount: content.split(/\s+/).length,
      savedAt: Date.now()
    };

    console.log(`content-store.js: Saving tab ${tabId} with groupId ${groupId}, ${words.length} words`);

    await this.put('tabs', tabData);
    await this.updateSearchIndex(id, words);
    
    console.log(`content-store.js: Successfully saved tab ${tabId}`);
    
    return id;
  }
  tokenize(text) {
    if (!text) return [];
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .filter((word, i, arr) => arr.indexOf(word) === i);
  }
  async updateSearchIndex(docId, words) {
    await this.init();
    
    const tx = this.db.transaction(['searchIndex'], 'readwrite');
    const store = tx.objectStore('searchIndex');

    for (const word of words) {
      try {
        const existing = await this.promisify(store.get(word));
        
        if (existing) {
          if (!existing.docIds.includes(docId)) {
            existing.docIds.push(docId);
            store.put(existing);
          }
        } else {
          store.put({ word, docIds: [docId] });
        }
      } catch (e) {
      }
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async search(query, groupId = null, limit = 50) {
    await this.init();
    
    const searchWords = this.tokenize(query);
    if (searchWords.length === 0) return [];
    let matchingIds = new Set();
    
    try {
      const tx = this.db.transaction(['searchIndex'], 'readonly');
      const indexStore = tx.objectStore('searchIndex');
      const docIdSets = await Promise.all(
        searchWords.map(async (word) => {
          try {
            const entry = await this.promisify(indexStore.get(word));
            return entry ? new Set(entry.docIds) : new Set();
          } catch (e) {
            return new Set();
          }
        })
      );
      for (const set of docIdSets) {
        for (const id of set) {
          matchingIds.add(id);
        }
      }
    } catch (e) {
      console.log(`content-store.js: Inverted index search failed. Using direct search: ${e}`);
    }
    if (matchingIds.size === 0) {
      return this.directSearch(query, groupId, limit);
    }
    const results = [];
    const tx2 = this.db.transaction(['tabs'], 'readonly');
    const tabStore = tx2.objectStore('tabs');
    
    for (const id of [...matchingIds]) {
      try {
        const doc = await this.promisify(tabStore.get(id));
        if (doc) {
          if (groupId === null || doc.groupId === groupId) {
            doc.score = this.calculateRelevance(doc, searchWords);
            results.push(doc);
          }
        }
      } catch (e) {
      }
    }
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }
  async directSearch(query, groupId = null, limit = 50) {
    await this.init();
    
    const queryLower = query.toLowerCase();
    const searchWords = this.tokenize(query);
    
    const tx = this.db.transaction(['tabs'], 'readonly');
    const store = tx.objectStore('tabs');
    
    const allDocs = await this.promisify(store.getAll());
    const results = [];
    
    for (const doc of allDocs) {
      if (groupId !== null && doc.groupId !== groupId) {
        continue;
      }
      const content = (doc.content || '').toLowerCase();
      const title = (doc.title || '').toLowerCase();
      
      if (content.includes(queryLower) || title.includes(queryLower)) {
        doc.score = this.calculateRelevance(doc, searchWords);
        results.push(doc);
      }
    }
    
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
  calculateRelevance(doc, searchWords) {
    let score = 0;
    const titleLower = (doc.title || '').toLowerCase();
    const contentLower = (doc.content || '').toLowerCase();

    for (const word of searchWords) {
      if (titleLower.includes(word)) {
        score += 10;
      }
      const regex = new RegExp(word, 'gi');
      const matches = (contentLower.match(regex) || []).length;
      score += Math.min(matches, 20);
    }

    return score;
  }
  async getGroupContent(groupId) {
    await this.init();
    
    const tx = this.db.transaction(['tabs'], 'readonly');
    const store = tx.objectStore('tabs');
    const index = store.index('groupId');
    
    return this.promisify(index.getAll(groupId));
  }
  async getTabContent(tabId) {
    await this.init();
    
    const tx = this.db.transaction(['tabs'], 'readonly');
    const store = tx.objectStore('tabs');
    
    return this.promisify(store.get(`tab-${tabId}`));
  }
  async deleteTabContent(tabId) {
    await this.init();
    
    const id = `tab-${tabId}`;
    const tx = this.db.transaction(['tabs'], 'readwrite');
    const store = tx.objectStore('tabs');
    
    store.delete(id);
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async getStats() {
    await this.init();
    
    const tx = this.db.transaction(['tabs', 'searchIndex'], 'readonly');
    const tabStore = tx.objectStore('tabs');
    const indexStore = tx.objectStore('searchIndex');
    
    const tabCount = await this.promisify(tabStore.count());
    const wordCount = await this.promisify(indexStore.count());
    
    return { tabCount, wordCount };
  }
  async clear() {
    await this.init();
    
    const tx = this.db.transaction(['tabs', 'searchIndex'], 'readwrite');
    tx.objectStore('tabs').clear();
    tx.objectStore('searchIndex').clear();
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
}
if (typeof window !== 'undefined') {
  window.TabContentStore = TabContentStore;
}
