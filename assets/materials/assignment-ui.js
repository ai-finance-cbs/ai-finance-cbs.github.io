import { itemName } from './assignment-core.js';
import { dueLine } from './due-ui.js';
import { renderAssignmentSections } from './prep-ui.js';
import { canvasSubmissionBlock, canvasDue } from './canvas-student-ui.js';
import { canWrite } from './class-core.js';
import { renderTaskMap } from './task-map-ui.js';

const el = (tag, text, className = '') => {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
};
export async function renderAssignments(ctx, catalog, pages) {
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
      const option = el('span',label,`mode-option${(item.code !== 'M2' && item.mode === 'group') === (key === 'group') ? ' is-active' : ''}`);
      if (!option.classList.contains('is-active')) option.setAttribute('aria-hidden','true');
      mode.append(option);
    }
    section.append(item.code === 'M2' || access.role === 'auditor' || !canvasRow?.due_at ? dueLine(item.due_at) : canvasDue(canvasRow), mode);
    const row = pages.find(p => p.code === item.code) || { body_md:'',updated_at:null };
    const submitAnchor = `submission-${item.code}`;
    renderAssignmentSections({ root:section, note:{body:row.body_md,updated_at:row.updated_at}, submitAnchor,
      editable:access.role === 'instructor' && canWrite(access),
      backend:{ async saveInstructorNote(_,body) {
        const saved = await backend.saveAssignmentPage(data.term_id,item.code,body);
        return {body:saved.body_md,updated_at:saved.updated_at};
      } },
    });
    // Submission panel: the target of the Deliverable link. The form itself is built per milestone.
    const submission = el('section','','assignment-panel assignment-submission'); submission.id = submitAnchor;
    submission.dataset.assignmentSection = 'Submission';
    const head = el('div','','assignment-panel-head'); head.append(el('h2','Submission'));
    submission.append(head);
    if (item.code !== 'M2') {
      submission.append(el('p','The submission form will appear here.','assignment-panel-empty'));
      if (access.role !== 'auditor') submission.append(canvasSubmissionBlock(ctx,item.code,true));
    }
    if (item.code !== 'M2' || ['student','instructor','grader'].includes(access.role)) {
      // Instruction saves replace their section container. Keep the form outside it.
      section.append(submission);
    }
    root.append(section);
    if (item.code === 'M2') await renderTaskMap(submission,ctx);
  }
}
