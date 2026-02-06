console.log("background.js loaded successfully.");

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Huddle installed');
    const welcomeUrl = chrome.runtime.getURL('welcome.html');
    chrome.tabs.create({ url: welcomeUrl });
  }
});

async function addAllTabsToTempGroup() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const tabIds = tabs.map(tab => tab.id);
    
    if (tabIds.length === 0) return;
    
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: 'huddle',
      color: 'blue'
    });
    
  } catch (error) {
    console.error(`background.js: Error creating temporary group of all tabs: ${error}`);
  }
}
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'add-all-to-group') {
    await addAllTabsToTempGroup();
  }
});
