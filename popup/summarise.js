import { state } from './state.js';
import { truncate } from './utils.js';
import { extractTabContent } from './content-search.js';

const supportedOutputLangs = ['en', 'es', 'ja', 'de', 'fr'];
const summariserInstances = new Map();
const maxCachedSummaries = 100;

const storageKey = "huddle_groupSummaries"
let detectorInstance = null;

export async function initSummaryCache(){
  try {
    const { [storageKey]: stored } = await chrome.storage.local.get([storageKey]);
    if (stored){
      for (const [url, entry] of Object.entries(stored)){
        state.tabSummaryCache.set(url, entry);
      }
    }
  } catch (e){
    console.log(`summarise.js: could not load persisted summaries: ${e}`);
  }
}

async function persistCache(){
  while (state.tabSummaryCache.size > maxCachedSummaries){
    const oldestKey = state.tabSummaryCache.keys().next().value;
    state.tabSummaryCache.delete(oldestKey);
  }
  const obj = {};
  for (const [url, entry] of state.tabSummaryCache.entries()){
    obj[url] = entry;
  }
  try {
    await chrome.storage.local.set({ [storageKey]: obj });
  } catch (e){
    console.log(`summarise.js: could not persist summaries: ${e}`);
  }
}

async function getDetector() {
  if (detectorInstance) return detectorInstance;
  if (!('LanguageDetector' in self)) return null;
  const availability = await LanguageDetector.availability();
  if (availability === 'unavailable') return null;
  detectorInstance = await LanguageDetector.create();
  return detectorInstance;
}

async function detectOutputLanguage(text) {
  try {
    const detector = await getDetector();
    if (!detector || !text) return 'en';
    const results = await detector.detect(text.slice(0, 500));
    const top = results[0]?.detectedLanguage;
    return supportedOutputLangs.includes(top) ? top : 'en';
  } catch (e) {
    return 'en';
  }
}

async function getSummariser(outputLanguage) {
  if (summariserInstances.has(outputLanguage)) {
    return summariserInstances.get(outputLanguage);
  }
  if (!('Summarizer' in self)) return null;

  const options = {
    type: 'tldr',
    length: 'medium',
    format: 'plain-text',
    outputLanguage,
    sharedContext: 'This is the content of a browser tab. Write a 1-2 sentence description of what the page is about.',
  };

  const availability = await Summarizer.availability(options);
  if (availability === 'unavailable') return null;

  const summariser = await Summarizer.create(options);
  summariserInstances.set(outputLanguage, summariser);
  return summariser;
}

export async function getTabSummary(tab, { force = false } = {}) {
  if (!state.aiFeaturesEnabled) return null;
  if (!tab.url) return null;

  const cached = state.tabSummaryCache.get(tab.url);

  if (!force && cached){
    return cached.summary;
  }

  try {
    const content = truncate(await extractTabContent(tab.id), 1500);
    if (!content) return null;
    
    const outputLanguage = await detectOutputLanguage(content);
    const summariser = await getSummariser(outputLanguage);
    if (!summariser) return null;

    const summary = await summariser.summarize(content);
    state.tabSummaryCache.set(tab.url, { summary });
    await persistCache();
    return summary;
  } catch (e) {
    console.log(`summarise.js: could not summarise tab ${tab.url}: ${e}`);
    return null;
  }
}

export async function getGroupTabSummaries(tabs, options = {}){
  const results = [];
  for (const tab of tabs){
    const summary = await getTabSummary(tab, options);
    results.push({ tabId: tab.id, title: tab.title, url: tab.url, summary });
  }
  return results;
}