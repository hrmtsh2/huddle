import { escapeHtml, truncate, highlightSearchTerms, findBestPreview } from './utils.js';
import { state } from './state.js';
import { contentSearchInput, contentSearchResults, searchGroupFilter, indexStats } from './dom.js';
import { showStatus } from './status.js';

export async function updateIndexStats() {
  try {
    const stats = await state.contentStore.getStats();
    indexStats.textContent = `${stats.tabCount} pages indexed`;
  } catch (e) {
    indexStats.textContent = '';
  }
}

export async function extractTabContent(tabId) {
  let tabInfo = null;
  try {
    tabInfo = await chrome.tabs.get(tabId);
  } catch (e) {
    console.log(`content-search.js: Could not get tab info for ${tabId}`);
    return '';
  }

  const url = tabInfo.url || '';
  const title = tabInfo.title || '';
  const isPdf = url.toLowerCase().endsWith('.pdf') ||
                url.includes('/pdf') ||
                title.toLowerCase().includes('.pdf') ||
                (tabInfo.favIconUrl && tabInfo.favIconUrl.includes('pdf'));

  const isRestricted = url.startsWith('chrome://') ||
                       url.startsWith('chrome-extension://') ||
                       url.startsWith('about:') ||
                       url.startsWith('file://');
  if (isPdf) {
    console.log(`content-search.js: [Extract] Tab ${tabId} is a PDF, using title/URL as content`);
    let urlContent = '';
    try {
      const urlObj = new URL(url);
      urlContent = decodeURIComponent(urlObj.pathname.replace(/[\/_-]/g, ' '));
    } catch (e) {}
    return `[PDF Document] ${title} ${urlContent}`.trim();
  }
  if (isRestricted) {
    console.log(`content-search.js: [Extract] Tab ${tabId} is restricted, using title only`);
    return title;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const body = document.body;
        if (!body) return '';
        const clone = body.cloneNode(true);
        const removeSelectors = 'script, style, noscript, iframe, svg, img, video, audio, canvas';
        clone.querySelectorAll(removeSelectors).forEach(el => el.remove());
        let text = clone.innerText || clone.textContent || '';
        text = text.replace(/\s+/g, ' ').trim();

        return text;
      }
    });

    const content = results[0]?.result || '';
    if (!content || content.length < 10) {
      console.log(`content-search.js: [Extract] Tab ${tabId} returned minimal content, using title as fallback`);
      return title;
    }

    return content;
  } catch (e) {
    console.log(`content-search.js: Could not extract content from tab ${tabId}:`, e.message);
    return title;
  }
}

export async function ensureTabsIndexed() {
  const stats = await state.contentStore.getStats();
  if (stats.tabCount === 0) {
    await indexTabsSilently(state.allTabs);
  }
}

export async function indexTabsSilently(tabs) {
  for (const tab of tabs) {
    try {
      const content = await extractTabContent(tab.id);
      if (content) {
        await state.contentStore.saveTabContent(
          tab.id,
          tab.groupId,
          tab.url,
          tab.title,
          content
        );
      }
    } catch (e) {
    }
  }
  await updateIndexStats();
}

// Not currently wired to any button, kept for parity with the original
// implementation (and available for manual/future use).
export async function indexCurrentGroup() {
  const groupId = searchGroupFilter.value ? parseInt(searchGroupFilter.value) : null;
  contentSearchResults.classList.remove('hidden');
  contentSearchResults.innerHTML = `
    <div class="indexing-progress">
      <div class="spinner"></div>
      <span id="indexingStatus">preparing to index...</span>
    </div>
  `;

  const statusEl = document.getElementById('indexingStatus');

  try {
    let tabsToIndex = [];

    if (groupId) {
      tabsToIndex = state.allTabs.filter(tab => tab.groupId === groupId);
      console.log(`content-search.js: [Index] Filtering for groupId ${groupId}, found ${tabsToIndex.length} tabs`);
    } else {
      tabsToIndex = state.allTabs.filter(tab => tab.groupId !== -1 && tab.groupId !== undefined);
      console.log(`content-search.js: [Index] Getting all grouped tabs, found ${tabsToIndex.length} tabs`);
    }

    if (tabsToIndex.length === 0) {
      contentSearchResults.innerHTML = '<div class="no-results">no tabs in group to index. add tabs to a group first.</div>';
      return;
    }

    let indexed = 0;
    let failed = 0;

    for (const tab of tabsToIndex) {
      statusEl.textContent = `indexing ${indexed + 1}/${tabsToIndex.length}: ${truncate(tab.title, 30)}`;

      try {
        const content = await extractTabContent(tab.id);

        if (content) {
          console.log(`content-search.js: [Index] Tab ${tab.id} extracted ${content.length} chars, groupId: ${tab.groupId}`);
          await state.contentStore.saveTabContent(
            tab.id,
            tab.groupId,
            tab.url,
            tab.title,
            content
          );
          indexed++;
        } else {
          console.log(`content-search.js: [Index] Tab ${tab.id} - no content extracted`);
          failed++;
        }
      } catch (e) {
        console.error(`content-search.js: Failed to index tab ${tab.id}:`, e);
        failed++;
      }
    }

    await updateIndexStats();

    contentSearchResults.innerHTML = `
      <div class="search-results-summary">
        ✓ indexed ${indexed} pages${failed > 0 ? ` (${failed} failed)` : ''}
      </div>
    `;

    showStatus(`indexed ${indexed} pages`);

  } catch (error) {
    console.error(`content-search.js: Indexing error: ${error}`);
    contentSearchResults.innerHTML = '<div class="no-results">error during indexing. see console for details.</div>';
  }
}

export async function performContentSearch(query = contentSearchInput.value.trim()) {
  if (!query) {
    contentSearchResults.classList.add('hidden');
    return;
  }

  if (query.length < 3) {
    contentSearchResults.classList.remove('hidden');
    contentSearchResults.innerHTML = '<div class="no-results">search string is too short (minimum 3 characters)</div>';
    return;
  }

  const groupId = searchGroupFilter.value ? parseInt(searchGroupFilter.value) : null;

  console.log(`content-search.js: [Search] Searching for "${query}" in groupId: ${groupId}`);

  contentSearchResults.classList.remove('hidden');
  contentSearchResults.innerHTML = `
    <div class="indexing-progress">
      <div class="spinner"></div>
      <span>searching...</span>
    </div>
  `;

  try {
    let tabsForGroup = [];
    if (groupId) {
      tabsForGroup = state.allTabs.filter(tab => tab.groupId === groupId);
    } else {
      tabsForGroup = state.allTabs;
    }
    const stats = await state.contentStore.getStats();
    console.log(`content-search.js: [Search] Index stats: ${stats.tabCount} tabs, ${stats.wordCount} words`);
    if (stats.tabCount === 0 && tabsForGroup.length > 0) {
      contentSearchResults.innerHTML = `
        <div class="indexing-progress">
          <div class="spinner"></div>
          <span id="autoIndexStatus">auto-indexing tabs...</span>
        </div>
      `;

      const statusEl = document.getElementById('autoIndexStatus');
      let indexed = 0;

      for (const tab of tabsForGroup) {
        statusEl.textContent = `indexing ${indexed + 1}/${tabsForGroup.length}...`;
        try {
          const content = await extractTabContent(tab.id);
          if (content) {
            await state.contentStore.saveTabContent(tab.id, tab.groupId, tab.url, tab.title, content);
            indexed++;
          }
        } catch (e) {
        }
      }

      await updateIndexStats();
      contentSearchResults.innerHTML = `
        <div class="indexing-progress">
          <div class="spinner"></div>
          <span>searching...</span>
        </div>
      `;
    }

    const results = await state.contentStore.search(query, groupId);
    console.log(`content-search.js: [Search] Found ${results.length} results`);

    if (results.length === 0) {
      contentSearchResults.innerHTML = `
        <div class="no-results">
          no results found for "${escapeHtml(query)}"<br>
          <small>${groupId ? 'try searching in "all groups" or re-index this group.' : 'try different search terms.'}</small>
        </div>
      `;
      return;
    }
    const queryLower = query.toLowerCase();

    let html = `<div class="search-results-summary">found ${results.length} result${results.length !== 1 ? 's' : ''}</div>`;

    for (const result of results) {
      const bestSnippet = findBestPreview(result.content || result.contentPreview, queryLower, 200);
      const preview = highlightSearchTerms(bestSnippet, queryLower);
      const highlightedTitle = highlightSearchTerms(truncate(result.title || 'untitled', 50), queryLower);
      const isPdf = (result.content || '').startsWith('[PDF Document]');
      const pdfBadge = isPdf ? '<span class="pdf-badge">PDF</span>' : '';

      html += `
        <div class="search-result-item" data-tab-id="${result.tabId}" data-url="${escapeHtml(result.url)}">
          <div class="search-result-title">
            ${highlightedTitle} ${pdfBadge}
          </div>
          <div class="search-result-url">${escapeHtml(result.url)}</div>
          <div class="search-result-preview">${preview}</div>
          <div class="search-result-meta">
            <span>${result.domain}</span>
            <span>score: ${result.score}</span>
          </div>
        </div>
      `;
    }

    contentSearchResults.innerHTML = html;
    contentSearchResults.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const tabId = parseInt(item.dataset.tabId);
        navigateToTab(tabId, item.dataset.url);
      });
    });

  } catch (error) {
    console.error(`content-search.js: Search error: ${error}`);
    contentSearchResults.innerHTML = '<div class="no-results">search error. try again.</div>';
  }
}

export async function navigateToTab(tabId, url) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (e) {
    await chrome.tabs.create({ url });
  }
}