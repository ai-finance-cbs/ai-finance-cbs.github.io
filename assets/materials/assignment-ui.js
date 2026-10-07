import { itemName } from './assignment-core.js';
import { dueLine } from './due-ui.js';
import { renderPreparation } from './prep-ui.js';
import { canvasSubmissionBlock, canvasDue } from './canvas-student-ui.js';
import { canWrite } from './class-core.js';

const el = (tag, text, className = '') => {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
};
export function renderAssignments(ctx, catalog, pages) {
  const { root, data, access, backend, canvas } = ctx;
  const code = root.dataset.assignmentCode;
  const items = catalog.filter(i => code === 'optional' ? i.code.startsWith('O') : i.code === code);
  if (!items.length) { root.append(el('p','This assignment is not available for your role.')); return; }
  if (code !== 'optional') document.querySelector('.page-heading h1').textContent = itemName(items[0]);
  for (const item of items) {
    const section = el('section', '', 'assignment-page'); section.id = item.code.startsWith('O') ? `optional-task-${item.code[1]}` : item.code === 'FP' ? 'final-prototype' : `milestone-${item.code[1]}`;
    if (code === 'optional') section.append(el('h2',itemName(item)),el('span','Optional task','optional-task-label'));
    // Canvas due date when the item is mapped; otherwise the site's own due date, so the line is never blank.
    const canvasRow = canvas?.items.find(row=>row.site_key===item.code);
    // Show both modes; the one that applies is dark, the other greyed out.
    const mode = el('p','','assignment-mode');
    for (const [key, label] of [['individual','Individual'],['group','Group']]) {
      const option = el('span',label,`mode-option${(item.mode === 'group') === (key === 'group') ? ' is-active' : ''}`);
      if (!option.classList.contains('is-active')) option.setAttribute('aria-hidden','true');
      mode.append(option);
    }
    section.append(access.role === 'auditor' || !canvasRow?.due_at ? dueLine(item.due_at) : canvasDue(canvasRow), mode);
    const row = pages.find(p => p.code === item.code) || { body_md:'',updated_at:null };
    renderPreparation({ root:section, note:{body:row.body_md,updated_at:row.updated_at}, assignment:true,
      labelText:`${itemName(item)} instructions`, editable:access.role === 'instructor' && canWrite(access),
      backend:{ async saveInstructorNote(_,body) {
        const saved = await backend.saveAssignmentPage(data.term_id,item.code,body);
        return {body:saved.body_md,updated_at:saved.updated_at};
      } },
    });
    const week = item.code === 'FP' ? 6 : /^M[1-5]$/.test(item.code) ? Number(item.code[1]) : null;
    const assignment = data.assignments.find(a => a.id === week);
    if (assignment) {
      const summary = el('div','','assignment-summary');
      if (assignment.description) summary.append(el('p',assignment.description));
      for (const [label,text] of [['Deliverable',assignment.deliverable],['Graded on',assignment.grading]]) {
        if (text) { const line = el('p',''); line.append(el('strong',`${label}: `),document.createTextNode(text)); summary.append(line); }
      }
      section.append(summary);
    }
    if (access.role !== 'auditor') section.append(canvasSubmissionBlock(ctx,item.code,true));
    root.append(section);
  }
}
