import { getDomain, escapeHtml } from './utils.js';
import { state, tabGroupColours } from './state.js';
import {
  activeGroupsList,
  existingGroupSelect,
  groupSelectionControls,
  groupSelectionCount,
  newGroupNameInput,
  groupColourSelect,
  searchGroupFilter,
} from './dom.js';
import { showStatus } from './status.js';
import { loadAllTabs, findDuplicates } from './tabs.js';

export async function getActiveTabGroups() {
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
            console.log(`groups.js: Could not get group info for ${tab.groupId}:\n${e.message}`);
          }
        } else {
          groups.get(tab.groupId).tabCount++;
        }
      }
    }
  }

  return Array.from(groups.values());
}

export async function refreshActiveGroups() {
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
        <input type="checkbox" class="group-checkbox" data-group-id="${group.id}" ${state.selectedGroupIds.has(group.id) ? 'checked' : ''}>
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
    console.error(`groups.js: refreshActiveGroups error: ${error}`);
    activeGroupsList.innerHTML = '<p class="empty-message">error loading groups</p>';
  }
}

export async function handleGroupAction(e) {
  const action = e.target.dataset.action;
  const groupItem = e.target.closest('.group-item');
  const groupId = parseInt(groupItem.dataset.groupId);

  if (action === 'ungroup') {
    await ungroupTabs(groupId);
  }
}

export async function groupTabsByDomain() {
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
          color: DOMAIN_COLOURS[colourIndex % DOMAIN_COLOURS.length]
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
    console.error(`groups.js: Error grouping by domain: ${error}`);
    showStatus('failed to group by domain', 'error');
  }
}

export async function removeDuplicateTabs() {
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
    console.error(`groups.js: Error removing duplicates: ${error}`);
    showStatus('failed to remove duplicates', 'error');
  }
}

export async function suspendInactiveTabs() {
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
    console.error(`groups.js: Error suspending tabs: ${error}`);
    showStatus('failed to suspend tabs', 'error');
  }
}

export async function addSelectedTabsToNewGroup() {
  if (state.selectedTabIds.size === 0) {
    showStatus('please select at least one tab', 'error');
    return;
  }

  const groupName = newGroupNameInput.value.trim() || 'new group';
  const colour = groupColourSelect.value;

  try {
    const selectedTabs = state.allTabs.filter(tab => state.selectedTabIds.has(tab.id));
    const tabsByWindow = new Map();
    for (const tab of selectedTabs) {
      if (!tabsByWindow.has(tab.windowId)) {
        tabsByWindow.set(tab.windowId, []);
      }
      tabsByWindow.get(tab.windowId).push(tab);
    }
    const targetWindowId = state.currentWindowId;
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
      color: colour
    });

    showStatus(`created group "${groupName}" with ${allTabIds.length} tabs`);
    newGroupNameInput.value = '';
    state.selectedTabIds.clear();
    await loadAllTabs();
    await refreshActiveGroups();

  } catch (error) {
    console.error(`groups.js: Error creating group: ${error}`);
    showStatus('failed to create group: ' + error.message, 'error');
  }
}

export async function addSelectedTabsToExistingGroup() {
  const groupId = parseInt(existingGroupSelect.value);

  if (!groupId) {
    showStatus('please select a group', 'error');
    return;
  }

  if (state.selectedTabIds.size === 0) {
    showStatus('please select at least one tab', 'error');
    return;
  }

  try {
    const selectedOption = existingGroupSelect.options[existingGroupSelect.selectedIndex];
    const groupWindowId = parseInt(selectedOption.dataset.windowId);

    const selectedTabs = state.allTabs.filter(tab => state.selectedTabIds.has(tab.id));
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
    state.selectedTabIds.clear();
    await loadAllTabs();
    await refreshActiveGroups();

  } catch (error) {
    console.error(`groups.js: Error adding tabs to group: ${error}`);
    showStatus('failed to add tabs to group: ' + error.message, 'error');
  }
}

export async function addAllCurrentWindowTabsToGroup() {
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
    console.error(`groups.js: Error creating group: ${error}`);
    showStatus('failed to create group', 'error');
  }
}

export async function closeSelectedTabs() {
  if (state.selectedTabIds.size === 0) {
    showStatus('please select at least one tab', 'error');
    return;
  }

  try {
    const tabIdsArray = Array.from(state.selectedTabIds);
    await chrome.tabs.remove(tabIdsArray);

    showStatus(`closed ${tabIdsArray.length} tabs`);
    state.selectedTabIds.clear();
    await loadAllTabs();
    await refreshActiveGroups();

  } catch (error) {
    console.error(`groups.js: Error closing tabs: ${error}`);
    showStatus('failed to close tabs: ' + error.message, 'error');
  }
}

export async function removeSelectedTabsFromGroup() {
  if (state.selectedTabIds.size === 0) {
    showStatus('please select at least one tab', 'error');
    return;
  }

  try {
    const tabsInGroups = state.allTabs.filter(
      tab => state.selectedTabIds.has(tab.id) && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
    );

    if (tabsInGroups.length === 0) {
      showStatus('no selected tabs are in a group', 'error');
      return;
    }

    const tabIds = tabsInGroups.map(tab => tab.id);
    await chrome.tabs.ungroup(tabIds);

    showStatus(`removed ${tabIds.length} tabs from their groups`);
    state.selectedTabIds.clear();
    await loadAllTabs();
    await refreshActiveGroups();

  } catch (error) {
    console.error(`groups.js: Error removing tabs from group: ${error}`);
    showStatus('failed to remove tabs from group: ' + error.message, 'error');
  }
}

export async function suspendSelectedTabs() {
  if (state.selectedTabIds.size === 0) {
    showStatus('please select at least one tab', 'error');
    return;
  }

  try {
    const selectedTabs = state.allTabs.filter(tab =>
      state.selectedTabIds.has(tab.id) &&
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
        console.error(`groups.js: Error suspending tab with id ${tab.id}: ${e}`);
      }
    }

    showStatus(`suspended ${suspended} tabs`);
    state.selectedTabIds.clear();
    await loadAllTabs();

  } catch (error) {
    console.error(`groups.js: Error suspending tabs: ${error}`);
    showStatus('failed to suspend tabs: ' + error.message, 'error');
  }
}

export async function ungroupTabs(groupId) {
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
    console.error(`groups.js: Error ungrouping tabs: ${error}`);
    showStatus('failed to ungroup tabs', 'error');
  }
}

export function handleGroupCheckboxChange(e) {
  const groupId = parseInt(e.target.dataset.groupId);
  if (e.target.checked) {
    state.selectedGroupIds.add(groupId);
  } else {
    state.selectedGroupIds.delete(groupId);
  }
  updateGroupSelectionCount();
}

export function updateGroupSelectionCount() {
  const count = state.selectedGroupIds.size;
  groupSelectionCount.textContent = `(${count} selected)`;
  groupSelectionControls.style.display = count >= 2 ? 'flex' : 'none';
}

export function clearGroupSelection() {
  state.selectedGroupIds.clear();
  activeGroupsList.querySelectorAll('.group-checkbox').forEach(checkbox => {
    checkbox.checked = false;
  });
  updateGroupSelectionCount();
}

export async function mergeSelectedGroups() {
  if (state.selectedGroupIds.size < 2) {
    showStatus('select at least 2 groups to merge', 'error');
    return;
  }

  try {
    const groups = await getActiveTabGroups();
    const selectedGroups = groups.filter(g => state.selectedGroupIds.has(g.id));

    if (selectedGroups.length < 2) {
      showStatus('selected groups no longer exist', 'error');
      return;
    }

    const targetGroup = selectedGroups[0];
    const tabIdsToMove = [];

    const windows = await chrome.windows.getAll({ populate: true });
    for (const win of windows) {
      for (const tab of win.tabs) {
        if (state.selectedGroupIds.has(tab.groupId) && tab.groupId !== targetGroup.id) {
          tabIdsToMove.push(tab.id);
        }
      }
    }

    if (tabIdsToMove.length > 0) {
      await chrome.tabs.group({ groupId: targetGroup.id, tabIds: tabIdsToMove });
    }

    const mergedCount = selectedGroups.reduce((sum, g) => sum + g.tabCount, 0);
    showStatus(`merged ${selectedGroups.length} groups into "${targetGroup.title}" (${mergedCount} tabs)`);

    state.selectedGroupIds.clear();
    await loadAllTabs();
    await refreshActiveGroups();

  } catch (error) {
    console.error(`groups.js: Error merging groups: ${error}`);
    showStatus('failed to merge groups: ' + error.message, 'error');
  }
}

export async function updateSearchGroupFilter() {
  const groups = await getActiveTabGroups();

  searchGroupFilter.innerHTML = '<option value="">all groups</option>' +
    groups.map(group => `
      <option value="${group.id}">${escapeHtml(group.title)} (${group.tabCount} tabs)</option>
    `).join('');
}