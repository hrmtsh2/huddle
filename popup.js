console.log("popup.js loaded successfully");

import { getDomain, escapeHtml, truncate, highlightSearchTerms, findBestPreview } from "./utils.js";

const newGroupNameInput = document.getElementById('newGroupName');
const groupColourSelect = document.getElementById('groupColour');
const addToNewGroupBtn = document.getElementById('addToNewGroup');
const addAllCurrentWindowBtn = document.getElementById('addAllCurrentWindow');
const groupByDomainBtn = document.getElementById('groupByDomain');
const deduplicateTabsBtn = document.getElementById('deduplicateTabs');
const suspendTabsBtn = document.getElementById('suspendTabs');
const activeGroupsContainer = document.getElementById('activeGroups');
const activeGroupsList = document.getElementById('activeGroupsList');
const groupSelectionCount = document.getElementById('groupSelectionCount');
const groupSelectionControls = document.getElementById('groupSelectionControls');
const mergeSelectedGroupsBtn = document.getElementById('mergeSelectedGroups');
const clearGroupSelectionBtn = document.getElementById('clearGroupSelection');
const existingGroupSelect = document.getElementById('existingGroupSelect');
const addToExistingGroupBtn = document.getElementById('addToExistingGroup');
const closeSelectedTabsBtn = document.getElementById('closeSelectedTabs');
const removeFromGroupBtn = document.getElementById('removeFromGroup');
const suspendSelectedTabsBtn = document.getElementById('suspendSelectedTabs');
const statusMessage = document.getElementById('statusMessage');
const tabsListContainer = document.getElementById('tabsList');
const selectionCountSpan = document.getElementById('selectionCount');
const selectAllBtn = document.getElementById('selectAll');
const selectNoneBtn = document.getElementById('selectNone');
const selectCurrentWindowBtn = document.getElementById('selectCurrentWindow');
const selectFilteredBtn = document.getElementById('selectFiltered');
const tabSearchInput = document.getElementById('tabSearch');
const clearSearchBtn = document.getElementById('clearSearch');
const contentSearchInput = document.getElementById('contentSearchInput');
const contentSearchBtn = document.getElementById('contentSearchBtn');
const searchGroupFilter = document.getElementById('searchGroupFilter');
const indexStats = document.getElementById('indexStats');
const contentSearchResults = document.getElementById('contentSearchResults');

let allTabs = [];
let selectedTabIds = new Set();
let selectedGroupIds = new Set();
let currentWindowId = null;
let searchQuery = '';
let contentStore = null;
let groupInfoCache = new Map();

const DOMAIN_COLOURS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    currentWindowId = currentWindow.id;
    
    contentStore = new TabContentStore();
    await contentStore.init();
    
    await loadAllTabs();
    await refreshActiveGroups();
    await updateSearchGroupFilter();
    await updateIndexStats();
    setupEventListeners();
    setupCollapsibles();
  } catch (error) {
    console.error(`popup.js:  init error: ${error}`);
    activeGroupsList.innerHTML = '<p class="empty-message">error loading</p>';
  }
}

function setupEventListeners() {
  addAllCurrentWindowBtn.addEventListener('click', addAllCurrentWindowTabsToGroup);
  groupByDomainBtn.addEventListener('click', groupTabsByDomain);
  deduplicateTabsBtn.addEventListener('click', removeDuplicateTabs);
  suspendTabsBtn.addEventListener('click', suspendInactiveTabs);
  
  addToNewGroupBtn.addEventListener('click', addSelectedTabsToNewGroup);
  addToExistingGroupBtn.addEventListener('click', addSelectedTabsToExistingGroup);
  closeSelectedTabsBtn.addEventListener('click', closeSelectedTabs);
  removeFromGroupBtn.addEventListener('click', removeSelectedTabsFromGroup);
  suspendSelectedTabsBtn.addEventListener('click', suspendSelectedTabs);
  
  selectAllBtn.addEventListener('click', selectAllTabs);
  selectNoneBtn.addEventListener('click', selectNoTabs);
  selectCurrentWindowBtn.addEventListener('click', selectCurrentWindowTabs);
  selectFilteredBtn.addEventListener('click', selectFilteredTabs);
  
  tabSearchInput.addEventListener('input', handleSearch);
  clearSearchBtn.addEventListener('click', clearSearch);
  
  contentSearchBtn.addEventListener('click', performContentSearch);
  contentSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performContentSearch();
  });
  
  mergeSelectedGroupsBtn.addEventListener('click', mergeSelectedGroups);
  clearGroupSelectionBtn.addEventListener('click', clearGroupSelection);
}

function setupCollapsibles() {
  document.querySelectorAll('.collapsible-header').forEach(header => {
    header.addEventListener('click', () => {
      const target = document.getElementById(header.dataset.target);
      const icon = header.querySelector('.collapse-icon');
      target.classList.toggle('collapsed');
      icon.textContent = target.classList.contains('collapsed') ? '►' : '▼';
    });
  });
}

function showStatus(message, type = 'success') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  
  setTimeout(() => {
    statusMessage.classList.add('hidden');
  }, 2500);
}

async function loadAllTabs() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    allTabs = [];
    
    for (const win of windows) {
      for (const tab of win.tabs) {
        allTabs.push({
          ...tab,
          windowId: win.id,
          isCurrentWindow: win.id === currentWindowId
        });
      }
    }
    
    await renderTabsList();
  } catch (error) {
    console.error(`popup.js: Error loading tabs: ${error}`);
    tabsListContainer.innerHTML = '<p class="empty-message">error loading tabs</p>';
  }
}

function findDuplicates() {
  const urlMap = new Map();
  const duplicates = [];
  
  for (const tab of allTabs) {
    const url = tab.url;
    if (urlMap.has(url)) {
      duplicates.push(tab.id);
    } else {
      urlMap.set(url, tab.id);
    }
  }
  
  return duplicates;
}

async function getGroupInfo(groupId) {
  if (groupInfoCache.has(groupId)) {
    return groupInfoCache.get(groupId);
  }
  try {
    const groupInfo = await chrome.tabGroups.get(groupId);
    groupInfoCache.set(groupId, groupInfo);
    return groupInfo;
  } catch (e) {
    return null;
  }
}
async function renderTabsList() {
  if (allTabs.length === 0) {
    tabsListContainer.innerHTML = '<p class="empty-message">no tabs found</p>';
    return;
  }
  groupInfoCache.clear();
  const tabsByWindow = new Map();
  for (const tab of allTabs) {
    if (!tabsByWindow.has(tab.windowId)) {
      tabsByWindow.set(tab.windowId, []);
    }
    tabsByWindow.get(tab.windowId).push(tab);
  }
  
  let html = '';
  let windowIndex = 0;
  
  for (const [windowId, tabs] of tabsByWindow) {
    const isCurrentWindow = windowId === currentWindowId;
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
      const isChecked = selectedTabIds.has(tab.id) ? 'checked' : '';
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
  if (searchQuery) {
    filterTabs(searchQuery);
  }
}
function handleSearch(e) {
  searchQuery = e.target.value.toLowerCase().trim();
  filterTabs(searchQuery);
}
async function filterTabs(query) {
  const tabItems = tabsListContainer.querySelectorAll('.tab-item');
  const windowGroups = tabsListContainer.querySelectorAll('.window-group');

  if (!query) {
    tabItems.forEach(item => item.classList.remove('hidden'));
    windowGroups.forEach(group => group.classList.remove('hidden'));
    return allTabs.map(t => t.id);
  }
  let contentMatchTabIds = new Set();
  try {
    await ensureTabsIndexed();
    const contentResults = await contentStore.search(query, null, 100);
    for (const result of contentResults) {
      contentMatchTabIds.add(result.tabId);
    }
  } catch (e) {
    console.log(`popup.js: Content search error. Falling back to title/URL only: ${e}`);
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
async function ensureTabsIndexed() {
  const stats = await contentStore.getStats();
  if (stats.tabCount === 0) {
    await indexTabsSilently(allTabs);
  }
}
async function indexTabsSilently(tabs) {
  for (const tab of tabs) {
    try {
      const content = await extractTabContent(tab.id);
      if (content) {
        await contentStore.saveTabContent(
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
function clearSearch() {
  tabSearchInput.value = '';
  searchQuery = '';
  filterTabs('');
}
function selectFilteredTabs() {
  const visibleCheckboxes = tabsListContainer.querySelectorAll('.tab-item:not(.hidden) .tab-checkbox');
  
  visibleCheckboxes.forEach(cb => {
    cb.checked = true;
    selectedTabIds.add(parseInt(cb.dataset.tabId));
  });
  
  updateSelectionCount();
  updateWindowCheckboxes();
}
function handleTabCheckboxChange(e) {
  const tabId = parseInt(e.target.dataset.tabId);
  
  if (e.target.checked) {
    selectedTabIds.add(tabId);
  } else {
    selectedTabIds.delete(tabId);
  }
  
  updateSelectionCount();
  updateWindowCheckboxes();
}
function handleWindowSelectAll(e) {
  const windowId = parseInt(e.target.dataset.windowId);
  const isChecked = e.target.checked;
  
  const windowTabs = allTabs.filter(tab => tab.windowId === windowId);
  
  for (const tab of windowTabs) {
    if (isChecked) {
      selectedTabIds.add(tab.id);
    } else {
      selectedTabIds.delete(tab.id);
    }
  }
  tabsListContainer.querySelectorAll(`.tab-checkbox[data-window-id="${windowId}"]`).forEach(cb => {
    cb.checked = isChecked;
  });
  
  updateSelectionCount();
}
function updateWindowCheckboxes() {
  const windowIds = new Set(allTabs.map(t => t.windowId));
  
  for (const windowId of windowIds) {
    const windowTabs = allTabs.filter(tab => tab.windowId === windowId);
    const selectedInWindow = windowTabs.filter(tab => selectedTabIds.has(tab.id)).length;
    
    const windowCheckbox = tabsListContainer.querySelector(`.window-select-all[data-window-id="${windowId}"]`);
    if (windowCheckbox) {
      windowCheckbox.checked = selectedInWindow === windowTabs.length && windowTabs.length > 0;
      windowCheckbox.indeterminate = selectedInWindow > 0 && selectedInWindow < windowTabs.length;
    }
  }
}
function updateSelectionCount() {
  selectionCountSpan.textContent = `(${selectedTabIds.size} selected)`;
}
function selectAllTabs() {
  selectedTabIds = new Set(allTabs.map(tab => tab.id));
  tabsListContainer.querySelectorAll('.tab-checkbox').forEach(cb => cb.checked = true);
  tabsListContainer.querySelectorAll('.window-select-all').forEach(cb => {
    cb.checked = true;
    cb.indeterminate = false;
  });
  updateSelectionCount();
}
function selectNoTabs() {
  selectedTabIds.clear();
  tabsListContainer.querySelectorAll('.tab-checkbox').forEach(cb => cb.checked = false);
  tabsListContainer.querySelectorAll('.window-select-all').forEach(cb => {
    cb.checked = false;
    cb.indeterminate = false;
  });
  updateSelectionCount();
}
function selectCurrentWindowTabs() {
  selectNoTabs();
  const currentWindowTabs = allTabs.filter(tab => tab.windowId === currentWindowId);
  
  for (const tab of currentWindowTabs) {
    selectedTabIds.add(tab.id);
  }
  
  tabsListContainer.querySelectorAll(`.tab-checkbox[data-window-id="${currentWindowId}"]`).forEach(cb => {
    cb.checked = true;
  });
  
  updateWindowCheckboxes();
  updateSelectionCount();
}
async function getActiveTabGroups() {
  const windows = await chrome.windows.getAll({ populate: true });
  const groups = new Map();
  
  for (const win of windows) {
    for (const tab of win.tabs) {
      if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        if (!groups.has(tab.groupId)) {
          try {
            const groupInfo = await chrome.tabGroups.get(tab.groupId);
            groups.set(tab.groupId, {
              id: tab.groupId,
              title: groupInfo.title || 'untitled group',
              colour: groupInfo.color,
              windowId: win.id,
              tabCount: 1
            });
          } catch (e) {
            console.log(`popup.js: Could not get group info for ${tab.groupId}:\n${e.message}`);
          }
        } else {
          groups.get(tab.groupId).tabCount++;
        }
      }
    }
  }
  
  return Array.from(groups.values());
}
async function refreshActiveGroups() {
  try {
    const groups = await getActiveTabGroups();
    
    if (groups.length === 0) {
      activeGroupsList.innerHTML = '<p class="empty-message">no active tab groups</p>';
      existingGroupSelect.innerHTML = '<option value="">no groups available</option>';
      groupSelectionControls.style.display = 'none';
      updateGroupSelectionCount();
      return;
    }
    activeGroupsList.innerHTML = groups.map(group => `
    <div class="group-item" data-group-id="${group.id}">
      <label class="checkbox-label group-checkbox-label">
        <input type="checkbox" class="group-checkbox" data-group-id="${group.id}" ${selectedGroupIds.has(group.id) ? 'checked' : ''}>
      </label>
      <div class="group-info">
        <span class="colour-dot colour-${group.colour}"></span>
        <span class="group-name">${escapeHtml(group.title)}</span>
        <span class="tab-count">(${group.tabCount} tabs)</span>
      </div>
      <div class="group-actions">
        <button class="action-btn ungroup" data-action="ungroup" title="ungroup tabs">ungroup</button>
      </div>
    </div>
  `).join('');
  existingGroupSelect.innerHTML = '<option value="">select an open group...</option>' + 
    groups.map(group => `
      <option value="${group.id}" data-window-id="${group.windowId}">${escapeHtml(group.title)} (${group.tabCount} tabs)</option>
    `).join('');
  activeGroupsList.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', handleGroupAction);
  });
  activeGroupsList.querySelectorAll('.group-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', handleGroupCheckboxChange);
  });
  updateGroupSelectionCount();
  } catch (error) {
    console.error(`popup.js: refreshActiveGroups error: ${error}`);
    activeGroupsList.innerHTML = '<p class="empty-message">error loading groups</p>';
  }
}
async function handleGroupAction(e) {
  const action = e.target.dataset.action;
  const groupItem = e.target.closest('.group-item');
  const groupId = parseInt(groupItem.dataset.groupId);
  
  if (action === 'ungroup') {
    await ungroupTabs(groupId);
  }
}
async function groupTabsByDomain() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const domainMap = new Map();
    for (const tab of tabs) {
      if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) continue;
      
      const domain = getDomain(tab.url);
      if (!domainMap.has(domain)) {
        domainMap.set(domain, []);
      }
      domainMap.get(domain).push(tab.id);
    }
    let groupsCreated = 0;
    let colourIndex = 0;
    
    for (const [domain, tabIds] of domainMap) {
      if (tabIds.length >= 2) {
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, {
          title: domain,
          colour: DOMAIN_COLOURS[colourIndex % DOMAIN_COLOURS.length]
        });
        groupsCreated++;
        colourIndex++;
      }
    }
    
    if (groupsCreated > 0) {
      showStatus(`created ${groupsCreated} groups by domain`);
    } else {
      showStatus('no domains with 2+ tabs to group', 'error');
    }
    
    await loadAllTabs();
    await refreshActiveGroups();
    
  } catch (error) {
    console.error(`popup.js: Error grouping by domain: ${error}`);
    showStatus('failed to group by domain', 'error');
  }
}
async function removeDuplicateTabs() {
  try {
    const duplicateIds = findDuplicates();
    
    if (duplicateIds.length === 0) {
      showStatus('no duplicate tabs found');
      return;
    }
    
    await chrome.tabs.remove(duplicateIds);
    
    showStatus(`closed ${duplicateIds.length} duplicate tabs`);
    await loadAllTabs();
    await refreshActiveGroups();
    
  } catch (error) {
    console.error(`popup.js: Error removing duplicates: ${error}`);
    showStatus('failed to remove duplicates', 'error');
  }
}
async function suspendInactiveTabs() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true, active: false, discarded: false });
    const suspendableTabs = tabs.filter(tab => !tab.pinned && !tab.url.startsWith('chrome://'));
    
    if (suspendableTabs.length === 0) {
      showStatus('no tabs to suspend');
      return;
    }
    
    let suspended = 0;
    for (const tab of suspendableTabs) {
      try {
        await chrome.tabs.discard(tab.id);
        suspended++;
      } catch (e) {
      }
    }
    
    showStatus(`suspended ${suspended} inactive tabs`);
    await loadAllTabs();
    
  } catch (error) {
    console.error(`popup.js: Error suspending tabs: ${error}`);
    showStatus('failed to suspend tabs', 'error');
  }
}
async function addSelectedTabsToNewGroup() {
  if (selectedTabIds.size === 0) {
    showStatus('please select at least one tab', 'error');
    return;
  }
  
  const groupName = newGroupNameInput.value.trim() || 'new group';
  const colour = groupColourSelect.value;
  
  try {
    const selectedTabs = allTabs.filter(tab => selectedTabIds.has(tab.id));
    const tabsByWindow = new Map();
    for (const tab of selectedTabs) {
      if (!tabsByWindow.has(tab.windowId)) {
        tabsByWindow.set(tab.windowId, []);
      }
      tabsByWindow.get(tab.windowId).push(tab);
    }
    const targetWindowId = currentWindowId;
    const allTabIds = [];
    
    for (const [windowId, tabs] of tabsByWindow) {
      for (const tab of tabs) {
        if (windowId !== targetWindowId) {
          const movedTab = await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
          allTabIds.push(movedTab.id);
        } else {
          allTabIds.push(tab.id);
        }
      }
    }
    
    const groupId = await chrome.tabs.group({ tabIds: allTabIds });
    await chrome.tabGroups.update(groupId, {
      title: groupName,
      colour: colour
    });
    
    showStatus(`created group "${groupName}" with ${allTabIds.length} tabs`);
    newGroupNameInput.value = '';
    selectedTabIds.clear();
    await loadAllTabs();
    await refreshActiveGroups();
    
  } catch (error) {
    console.error(`popup.js: Error creating group: ${error}`);
    showStatus('failed to create group: ' + error.message, 'error');
  }
}
async function addSelectedTabsToExistingGroup() {
  const groupId = parseInt(existingGroupSelect.value);
  
  if (!groupId) {
    showStatus('please select a group', 'error');
    return;
  }
  
  if (selectedTabIds.size === 0) {
    showStatus('please select at least one tab', 'error');
    return;
  }
  
  try {
    const selectedOption = existingGroupSelect.options[existingGroupSelect.selectedIndex];
    const groupWindowId = parseInt(selectedOption.dataset.windowId);
    
    const selectedTabs = allTabs.filter(tab => selectedTabIds.has(tab.id));
    const tabIds = [];
    
    for (const tab of selectedTabs) {
      if (tab.windowId !== groupWindowId) {
        const movedTab = await chrome.tabs.move(tab.id, { windowId: groupWindowId, index: -1 });
        tabIds.push(movedTab.id);
      } else {
        tabIds.push(tab.id);
      }
    }
    
    await chrome.tabs.group({ tabIds, groupId });
    
    showStatus(`added ${tabIds.length} tabs to group`);
    selectedTabIds.clear();
    await loadAllTabs();
    await refreshActiveGroups();
    
  } catch (error) {
    console.error(`popup.js: Error adding tabs to group: ${error}`);
    showStatus('failed to add tabs to group: ' + error.message, 'error');
  }
}
async function addAllCurrentWindowTabsToGroup() {
  const groupName = newGroupNameInput.value.trim() || 'all tabs';
  const colour = groupColourSelect.value;
  
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const ungroupedTabs = tabs.filter(tab => tab.groupId === -1);
    const tabIds = ungroupedTabs.map(tab => tab.id);
    
    if (tabIds.length === 0) {
      showStatus('no ungrouped tabs to group', 'error');
      return;
    }
    
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: groupName,
      color: colour
    });
    
    showStatus(`created group "${groupName}" with ${tabIds.length} tabs`);
    newGroupNameInput.value = '';
    await loadAllTabs();
    await refreshActiveGroups();
    
  } catch (error) {
    console.error(`popup.js: Error creating group: ${error}`);
    showStatus('failed to create group', 'error');
  }
}
async function closeSelectedTabs() {
  if (selectedTabIds.size === 0) {
    showStatus('please select at least one tab', 'error');
    return;
  }
  
  try {
    const tabIdsArray = Array.from(selectedTabIds);
    await chrome.tabs.remove(tabIdsArray);
    
    showStatus(`closed ${tabIdsArray.length} tabs`);
    selectedTabIds.clear();
    await loadAllTabs();
    await refreshActiveGroups();
    
  } catch (error) {
    console.error(`popup.js: Error closing tabs: ${error}`);
    showStatus('failed to close tabs: ' + error.message, 'error');
  }
}
async function removeSelectedTabsFromGroup() {
  if (selectedTabIds.size === 0) {
    showStatus('please select at least one tab', 'error');
    return;
  }
  
  try {
    const tabsInGroups = allTabs.filter(
      tab => selectedTabIds.has(tab.id) && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
    );
    
    if (tabsInGroups.length === 0) {
      showStatus('no selected tabs are in a group', 'error');
      return;
    }
    
    const tabIds = tabsInGroups.map(tab => tab.id);
    await chrome.tabs.ungroup(tabIds);
    
    showStatus(`removed ${tabIds.length} tabs from their groups`);
    selectedTabIds.clear();
    await loadAllTabs();
    await refreshActiveGroups();
    
  } catch (error) {
    console.error(`popup.js: Error removing tabs from group: ${error}`);
    showStatus('failed to remove tabs from group: ' + error.message, 'error');
  }
}
async function suspendSelectedTabs() {
  if (selectedTabIds.size === 0) {
    showStatus('please select at least one tab', 'error');
    return;
  }
  
  try {
    const selectedTabs = allTabs.filter(tab => 
      selectedTabIds.has(tab.id) && 
      !tab.active && 
      !tab.discarded && 
      !tab.pinned &&
      !tab.url.startsWith('chrome://')
    );
    
    if (selectedTabs.length === 0) {
      showStatus('no suspendable tabs selected', 'error');
      return;
    }
    
    let suspended = 0;
    for (const tab of selectedTabs) {
      try {
        await chrome.tabs.discard(tab.id);
        suspended++;
      } catch (e) {
        console.error(`popup.js: Error suspending tab with id ${tab.id}: ${error}`);
      }
    }
    
    showStatus(`suspended ${suspended} tabs`);
    selectedTabIds.clear();
    await loadAllTabs();
    
  } catch (error) {
    console.error(`popup.js: Error suspending tabs: ${error}`);
    showStatus('failed to suspend tabs: ' + error.message, 'error');
  }
}
async function ungroupTabs(groupId) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    const tabIds = [];
    
    for (const win of windows) {
      for (const tab of win.tabs) {
        if (tab.groupId === groupId) {
          tabIds.push(tab.id);
        }
      }
    }
    
    await chrome.tabs.ungroup(tabIds);
    
    showStatus(`ungrouped ${tabIds.length} tabs`);
    await loadAllTabs();
    await refreshActiveGroups();
    
  } catch (error) {
    console.error(`popup.js: Error ungrouping tabs: ${error}`);
    showStatus('failed to ungroup tabs', 'error');
  }
}

function handleGroupCheckboxChange(e) {
  const groupId = parseInt(e.target.dataset.groupId);
  if (e.target.checked) {
    selectedGroupIds.add(groupId);
  } else {
    selectedGroupIds.delete(groupId);
  }
  updateGroupSelectionCount();
}

function updateGroupSelectionCount() {
  const count = selectedGroupIds.size;
  groupSelectionCount.textContent = `(${count} selected)`;
  groupSelectionControls.style.display = count >= 2 ? 'flex' : 'none';
}

function clearGroupSelection() {
  selectedGroupIds.clear();
  activeGroupsList.querySelectorAll('.group-checkbox').forEach(checkbox => {
    checkbox.checked = false;
  });
  updateGroupSelectionCount();
}

async function mergeSelectedGroups() {
  if (selectedGroupIds.size < 2) {
    showStatus('select at least 2 groups to merge', 'error');
    return;
  }
  
  try {
    const groupIdsArray = Array.from(selectedGroupIds);
    const groups = await getActiveTabGroups();
    const selectedGroups = groups.filter(g => selectedGroupIds.has(g.id));
    
    if (selectedGroups.length < 2) {
      showStatus('selected groups no longer exist', 'error');
      return;
    }
    
    const targetGroup = selectedGroups[0];
    const tabIdsToMove = [];
    
    const windows = await chrome.windows.getAll({ populate: true });
    for (const win of windows) {
      for (const tab of win.tabs) {
        if (selectedGroupIds.has(tab.groupId) && tab.groupId !== targetGroup.id) {
          tabIdsToMove.push(tab.id);
        }
      }
    }
    
    if (tabIdsToMove.length > 0) {
      await chrome.tabs.group({ groupId: targetGroup.id, tabIds: tabIdsToMove });
    }
    
    const mergedCount = selectedGroups.reduce((sum, g) => sum + g.tabCount, 0);
    showStatus(`merged ${selectedGroups.length} groups into "${targetGroup.title}" (${mergedCount} tabs)`);
    
    selectedGroupIds.clear();
    await loadAllTabs();
    await refreshActiveGroups();
    
  } catch (error) {
    console.error(`popup.js: Error merging groups: ${error}`);
    showStatus('failed to merge groups: ' + error.message, 'error');
  }
}

async function updateSearchGroupFilter() {
  const groups = await getActiveTabGroups();
  
  searchGroupFilter.innerHTML = '<option value="">all groups</option>' +
    groups.map(group => `
      <option value="${group.id}">${escapeHtml(group.title)} (${group.tabCount} tabs)</option>
    `).join('');
}
async function updateIndexStats() {
  try {
    const stats = await contentStore.getStats();
    indexStats.textContent = `${stats.tabCount} pages indexed`;
  } catch (e) {
    indexStats.textContent = '';
  }
}
async function indexCurrentGroup() {
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
      tabsToIndex = allTabs.filter(tab => tab.groupId === groupId);
      console.log(`popup.js: [Index] Filtering for groupId ${groupId}, found ${tabsToIndex.length} tabs`);
    } else {
      tabsToIndex = allTabs.filter(tab => tab.groupId !== -1 && tab.groupId !== undefined);
      console.log(`popup.js: [Index] Getting all grouped tabs, found ${tabsToIndex.length} tabs`);
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
          console.log(`popup.js: [Index] Tab ${tab.id} extracted ${content.length} chars, groupId: ${tab.groupId}`);
          await contentStore.saveTabContent(
            tab.id,
            tab.groupId,
            tab.url,
            tab.title,
            content
          );
          indexed++;
        } else {
          console.log(`popup.js: [Index] Tab ${tab.id} - no content extracted`);
          failed++;
        }
      } catch (e) {
        console.error(`popup.js: Failed to index tab ${tab.id}:`, e);
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
    console.error(`popup.js: Indexing error: ${error}`);
    contentSearchResults.innerHTML = '<div class="no-results">error during indexing. see console for details.</div>';
  }
}
async function extractTabContent(tabId) {
  let tabInfo = null;
  try {
    tabInfo = await chrome.tabs.get(tabId);
  } catch (e) {
    console.log(`popup.js: Could not get tab info for ${tabId}`);
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
    console.log(`popup.js: [Extract] Tab ${tabId} is a PDF, using title/URL as content`);
    let urlContent = '';
    try {
      const urlObj = new URL(url);
      urlContent = decodeURIComponent(urlObj.pathname.replace(/[\/_-]/g, ' '));
    } catch (e) {}
    return `[PDF Document] ${title} ${urlContent}`.trim();
  }
  if (isRestricted) {
    console.log(`popup.js: [Extract] Tab ${tabId} is restricted, using title only`);
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
      console.log(`popup.js: [Extract] Tab ${tabId} returned minimal content, using title as fallback`);
      return title;
    }
    
    return content;
  } catch (e) {
    console.log(`popup.js: Could not extract content from tab ${tabId}:`, e.message);
    return title;
  }
}
async function performContentSearch(query = contentSearchInput.value.trim()) {
  if (!query) {
    contentSearchResults.classList.add('hidden');
    return;
  }

  const groupId = searchGroupFilter.value ? parseInt(searchGroupFilter.value) : null;
  
  console.log(`popup.js: [Search] Searching for "${query}" in groupId: ${groupId}`);
  
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
      tabsForGroup = allTabs.filter(tab => tab.groupId === groupId);
    } else {
      tabsForGroup = allTabs;
    }
    const stats = await contentStore.getStats();
    console.log(`popup.js: [Search] Index stats: ${stats.tabCount} tabs, ${stats.wordCount} words`);
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
            await contentStore.saveTabContent(tab.id, tab.groupId, tab.url, tab.title, content);
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
    
    const results = await contentStore.search(query, groupId);
    console.log(`popup.js: [Search] Found ${results.length} results`);

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
    console.error(`popup.js: Search error: ${error}`);
    contentSearchResults.innerHTML = '<div class="no-results">search error. try again.</div>';
  }
}
async function navigateToTab(tabId, url) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (e) {
    await chrome.tabs.create({ url });
  }
}
