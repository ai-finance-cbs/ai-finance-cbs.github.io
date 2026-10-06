import { courseTime } from './week-core.js';
import { dueCountdown } from './assignment-core.js';

function update(node) {
  let countdown = dueCountdown(node.dataset.dueAt);
  if (node.dataset.compactDue) countdown = countdown.replace(/ remaining$/, '');
  node.textContent = `Due ${courseTime(node.dataset.dueAt)} · ${countdown}`;
  node.classList.toggle('past-due', countdown === 'Past due');
}
export function dueLine(due, tag = 'p', compact = false) {
  const node = document.createElement(tag); node.className = 'due-line';
  if(compact)node.dataset.compactDue='true';
  if (due) { node.dataset.dueAt = due; update(node); }
  else node.textContent = 'Due time to be announced.';
  return node;
}
// One timer updates connected lines. Refreshing pages never retains detached editors or rows.
setInterval(() => document.querySelectorAll('[data-due-at]').forEach(update), 60000);
