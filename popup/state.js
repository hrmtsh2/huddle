export const state = {
  allTabs: [],
  selectedTabIds: new Set(),
  selectedGroupIds: new Set(),
  currentWindowId: null,
  searchQuery: '',
  contentStore: null,
  groupInfoCache: new Map(),
  aiFeaturesEnabled: false,
  tabSummaryCache: new Map()
};

export const tabGroupColours = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];