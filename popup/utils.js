function getDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (e) {
    return 'other';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncate(str, length) {
  if (str.length <= length) return str;
  return str.substring(0, length) + '...';
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightSearchTerms(text, query) {
  if (!text) return '';
  
  const words = query.split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return escapeHtml(text);
  
  let result = escapeHtml(text);
  
  for (const word of words) {
    const regex = new RegExp(`(${escapeRegExp(word)})`, 'gi');
    result = result.replace(regex, '<mark>$1</mark>');
  }
  
  return result;
}

function findBestPreview(content, query, maxLength = 200) {
  if (!content) return '';
  
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return content.substring(0, maxLength);
  
  const contentLower = content.toLowerCase();
  let bestPos = -1;
  for (const word of words) {
    const pos = contentLower.indexOf(word);
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
      bestPos = pos;
    }
  }
  
  if (bestPos === -1) {
    return content.substring(0, maxLength);
  }
  const contextBefore = 40;
  const start = Math.max(0, bestPos - contextBefore);
  const end = Math.min(content.length, start + maxLength);
  
  let snippet = content.substring(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';
  
  return snippet;
}

export { getDomain, escapeHtml, truncate, highlightSearchTerms, findBestPreview }