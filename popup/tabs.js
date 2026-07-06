import { escapeHtml, truncate } from './utils.js';
import { state } from './state.js';
import { tabsListContainer, selectionCountSpan, tabSearchInput } from './dom.js';
import { ensureTabsIndexed, navigateToTab } from './content-search.js';

export async function loadAllTabs() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    state.allTabs = [];

    for (const win of windows) {
      for (const tab of win.tabs) {
        state.allTabs.push({
          ...tab,
          windowId: win.id,
          isCurrentWindow: win.id === state.currentWindowId
        });
      }
    }

    await renderTabsList();
  } catch (error) {
    console.error(`tabs.js: Error loading tabs: ${error}`);
    tabsListContainer.innerHTML = '<p class="empty-message">error loading tabs</p>';
  }
}

export function findDuplicates() {
  const urlMap = new Map();
  const duplicates = [];

  for (const tab of state.allTabs) {
    const url = tab.url;
    if (urlMap.has(url)) {
      duplicates.push(tab.id);
    } else {
      urlMap.set(url, tab.id);
    }
  }

  return duplicates;
}

export async function getGroupInfo(groupId) {
  if (state.groupInfoCache.has(groupId)) {
    return state.groupInfoCache.get(groupId);
  }
  try {
    const groupInfo = await chrome.tabGroups.get(groupId);
    state.groupInfoCache.set(groupId, groupInfo);
    return groupInfo;
  } catch (e) {
    return null;
  }
}

export async function renderTabsList() {
  if (state.allTabs.length === 0) {
    tabsListContainer.innerHTML = '<p class="empty-message">no tabs found</p>';
    return;
  }
  state.groupInfoCache.clear();
  const tabsByWindow = new Map();
  for (const tab of state.allTabs) {
    if (!tabsByWindow.has(tab.windowId)) {
      tabsByWindow.set(tab.windowId, []);
    }
    tabsByWindow.get(tab.windowId).push(tab);
  }

  let html = '';
  let windowIndex = 0;

  for (const [windowId, tabs] of tabsByWindow) {
    const isCurrentWindow = windowId === state.currentWindowId;
    windowIndex++;

    html += `
      <div class="window-group" data-window-id="${windowId}">
        <div class="window-header">
          <label class="checkbox-label window-checkbox">
            <input type="checkbox" class="window-select-all" data-window-id="${windowId}">
            <span class="window-title">
              ${isCurrentWindow ? 'current window' : `window ${windowIndex}`}
              <span class="tab-count">(${tabs.length} tabs)</span>
            </span>
          </label>
        </div>
        <div class="window-tabs">
    `;

    for (const tab of tabs) {
      const isChecked = state.selectedTabIds.has(tab.id) ? 'checked' : '';
      const favicon = tab.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect fill="%23666" width="16" height="16" rx="2"/></svg>';
      let badges = '';
      if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const groupInfo = await getGroupInfo(tab.groupId);
        if (groupInfo) {
          badges += `<span class="in-group-badge group-badge-${groupInfo.color}">${escapeHtml(groupInfo.title || 'untitled')}</span>`;
        } else {
          badges += '<span class="in-group-badge">grouped</span>';
        }
      }
      if (tab.discarded) {
        badges += '<span class="suspended-badge">suspended</span>';
      }

      const suspendedClass = tab.discarded ? 'suspended' : '';

      html += `
        <label class="checkbox-label tab-item ${suspendedClass}" data-tab-id="${tab.id}" data-url="${escapeHtml(tab.url)}" data-title="${escapeHtml(tab.title)}">
          <input type="checkbox" class="tab-checkbox" data-tab-id="${tab.id}" data-window-id="${windowId}" ${isChecked}>
          <img src="${escapeHtml(favicon)}" class="tab-favicon">
          <span class="tab-title tab-title-clickable" title="${escapeHtml(tab.title)}" data-tab-id="${tab.id}">${escapeHtml(truncate(tab.title, 35))}</span>
          ${badges}
        </label>
      `;
    }

    html += `
        </div>
      </div>
    `;
  }

  tabsListContainer.innerHTML = html;
  tabsListContainer.querySelectorAll('.tab-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', handleTabCheckboxChange);
  });

  tabsListContainer.querySelectorAll('.window-select-all').forEach(checkbox => {
    checkbox.addEventListener('change', handleWindowSelectAll);
  });
  tabsListContainer.querySelectorAll('.tab-favicon').forEach(img => {
    img.addEventListener('error', function() {
      this.style.display = 'none';
    });
  });
  tabsListContainer.querySelectorAll('.tab-title-clickable').forEach(title => {
    title.addEventListener('click', async (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const tabId = parseInt(title.dataset.tabId);
        await navigateToTab(tabId, title.closest('.tab-item').dataset.url);
      }
    });
  });

  updateSelectionCount();
  updateWindowCheckboxes();
  if (state.searchQuery) {
    filterTabs(state.searchQuery);
  }
}

export function handleSearch(e) {
  state.searchQuery = e.target.value.toLowerCase().trim();
  filterTabs(state.searchQuery);
}

export async function filterTabs(query) {
  const tabItems = tabsListContainer.querySelectorAll('.tab-item');
  const windowGroups = tabsListContainer.querySelectorAll('.window-group');

  if (!query) {
    tabItems.forEach(item => item.classList.remove('hidden'));
    windowGroups.forEach(group => group.classList.remove('hidden'));
    return state.allTabs.map(t => t.id);
  }
  let contentMatchTabIds = new Set();
  try {
    await ensureTabsIndexed();
    const contentResults = await state.contentStore.search(query, null, 100);
    for (const result of contentResults) {
      contentMatchTabIds.add(result.tabId);
    }
  } catch (e) {
    console.log(`tabs.js: Content search error. Falling back to title/URL only: ${e}`);
  }
  const visibleWindowIds = new Set();
  const visibleTabIds = [];

  tabItems.forEach(item => {
    const title = (item.dataset.title || '').toLowerCase();
    const url = (item.dataset.url || '').toLowerCase();
    const tabId = parseInt(item.dataset.tabId);
    const matchesTitleOrUrl = title.includes(query) || url.includes(query);
    const matchesContent = contentMatchTabIds.has(tabId);

    if (matchesTitleOrUrl || matchesContent) {
      item.classList.remove('hidden');
      const windowId = item.querySelector('.tab-checkbox').dataset.windowId;
      visibleWindowIds.add(windowId);
      visibleTabIds.push(tabId);
    } else {
      item.classList.add('hidden');
    }
  });
  windowGroups.forEach(group => {
    const windowId = group.dataset.windowId;
    if (visibleWindowIds.has(windowId)) {
      group.classList.remove('hidden');
    } else {
      group.classList.add('hidden');
    }
  });

  return visibleTabIds;
}

export function clearSearch() {
  tabSearchInput.value = '';
  state.searchQuery = '';
  filterTabs('');
}

export function selectFilteredTabs() {
  const visibleCheckboxes = tabsListContainer.querySelectorAll('.tab-item:not(.hidden) .tab-checkbox');

  visibleCheckboxes.forEach(cb => {
    cb.checked = true;
    state.selectedTabIds.add(parseInt(cb.dataset.tabId));
  });

  updateSelectionCount();
  updateWindowCheckboxes();
}

export function handleTabCheckboxChange(e) {
  const tabId = parseInt(e.target.dataset.tabId);

  if (e.target.checked) {
    state.selectedTabIds.add(tabId);
  } else {
    state.selectedTabIds.delete(tabId);
  }

  updateSelectionCount();
  updateWindowCheckboxes();
}

export function handleWindowSelectAll(e) {
  const windowId = parseInt(e.target.dataset.windowId);
  const isChecked = e.target.checked;

  const windowTabs = state.allTabs.filter(tab => tab.windowId === windowId);

  for (const tab of windowTabs) {
    if (isChecked) {
      state.selectedTabIds.add(tab.id);
    } else {
      state.selectedTabIds.delete(tab.id);
    }
  }
  tabsListContainer.querySelectorAll(`.tab-checkbox[data-window-id="${windowId}"]`).forEach(cb => {
    cb.checked = isChecked;
  });

  updateSelectionCount();
}

export function updateWindowCheckboxes() {
  const windowIds = new Set(state.allTabs.map(t => t.windowId));

  for (const windowId of windowIds) {
    const windowTabs = state.allTabs.filter(tab => tab.windowId === windowId);
    const selectedInWindow = windowTabs.filter(tab => state.selectedTabIds.has(tab.id)).length;

    const windowCheckbox = tabsListContainer.querySelector(`.window-select-all[data-window-id="${windowId}"]`);
    if (windowCheckbox) {
      windowCheckbox.checked = selectedInWindow === windowTabs.length && windowTabs.length > 0;
      windowCheckbox.indeterminate = selectedInWindow > 0 && selectedInWindow < windowTabs.length;
    }
  }
}

export function updateSelectionCount() {
  selectionCountSpan.textContent = `(${state.selectedTabIds.size} selected)`;
}

export function selectAllTabs() {
  state.selectedTabIds = new Set(state.allTabs.map(tab => tab.id));
  tabsListContainer.querySelectorAll('.tab-checkbox').forEach(cb => cb.checked = true);
  tabsListContainer.querySelectorAll('.window-select-all').forEach(cb => {
    cb.checked = true;
    cb.indeterminate = false;
  });
  updateSelectionCount();
}

export function selectNoTabs() {
  state.selectedTabIds.clear();
  tabsListContainer.querySelectorAll('.tab-checkbox').forEach(cb => cb.checked = false);
  tabsListContainer.querySelectorAll('.window-select-all').forEach(cb => {
    cb.checked = false;
    cb.indeterminate = false;
  });
  updateSelectionCount();
}

export function selectCurrentWindowTabs() {
  selectNoTabs();
  const currentWindowTabs = state.allTabs.filter(tab => tab.windowId === state.currentWindowId);

  for (const tab of currentWindowTabs) {
    state.selectedTabIds.add(tab.id);
  }

  tabsListContainer.querySelectorAll(`.tab-checkbox[data-window-id="${state.currentWindowId}"]`).forEach(cb => {
    cb.checked = true;
  });

  updateWindowCheckboxes();
  updateSelectionCount();
}