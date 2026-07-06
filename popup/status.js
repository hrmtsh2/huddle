import { statusMessage } from './dom.js';

export function showStatus(message, type = 'success') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;

  setTimeout(() => {
    statusMessage.classList.add('hidden');
  }, 2500);
}