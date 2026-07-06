console.log("popup.js loaded successfully");

import { state } from './state.js';
import {
  addAllCurrentWindowBtn, groupByDomainBtn, deduplicateTabsBtn, suspendTabsBtn,
  addToNewGroupBtn, addToExistingGroupBtn, closeSelectedTabsBtn, removeFromGroupBtn,
  suspendSelectedTabsBtn, selectAllBtn, selectNoneBtn, selectCurrentWindowBtn,
  selectFilteredBtn, tabSearchInput, clearSearchBtn, contentSearchBtn, contentSearchInput,
  mergeSelectedGroupsBtn, clearGroupSelectionBtn, activeGroupsList,
} from './dom.js';

import { loadAllTabs, handleSearch, clearSearch, selectAllTabs, selectNoTabs, selectCurrentWindowTabs, selectFilteredTabs } from './tabs.js';
import {
  refreshActiveGroups, updateSearchGroupFilter, groupTabsByDomain, removeDuplicateTabs,
  suspendInactiveTabs, addAllCurrentWindowTabsToGroup, addSelectedTabsToNewGroup,
  addSelectedTabsToExistingGroup, closeSelectedTabs, removeSelectedTabsFromGroup,
  suspendSelectedTabs, mergeSelectedGroups, clearGroupSelection,
} from './groups.js';
import { updateIndexStats, performContentSearch } from './content-search.js';
import { initSummaryCache } from './summarise.js';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    state.currentWindowId = currentWindow.id;
    const { aiFeaturesEnabled } = await chrome.storage.local.get(['aiFeaturesEnabled']);
    state.aiFeaturesEnabled = !!aiFeaturesEnabled;
    await initSummaryCache();
    state.contentStore = new TabContentStore();
    await state.contentStore.init();

    await loadAllTabs();
    await refreshActiveGroups();
    await updateSearchGroupFilter();
    await updateIndexStats();
    setupEventListeners();
    setupCollapsibles();
  } catch (error) {
    console.error(`popup.js: init error: ${error}`);
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

  contentSearchBtn.addEventListener('click', () => {
    performContentSearch();
  });
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