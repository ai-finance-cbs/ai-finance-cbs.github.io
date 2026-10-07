// Menu button (phones only): opens the page menu and the course links.
document.documentElement.classList.add('js');
const toggle = document.querySelector('.menu-toggle');
const setMenu = open => {
  document.body.classList.toggle('menu-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.querySelector('span').textContent = open ? 'Close' : 'Menu';
  // On phones the course links sit directly under the open menu.
  if (open) document.querySelector('.site-sidebar').style.top = document.getElementById('topnav').getBoundingClientRect().bottom + 'px';
};
toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
window.matchMedia('(max-width: 819px)').addEventListener('change', () => setMenu(false));

// Left pane outline: one link per section heading (h2) on this page.
const outline = document.getElementById('outline');
let headings = [], links = [];
function rebuildOutline() {
  headings = [...document.querySelectorAll('.content h2, .content .prep-section-heading > h3')].filter(h => !h.closest('.page-footer') && !h.closest('.week-block .week-block'));  // skip headings of cards nested inside a section (e.g. Milestone under Due before class)
  outline.replaceChildren();
  headings.forEach((h, i) => {
    if (!h.id) h.id = 'section-' + (i + 1);
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent.trim();
    li.appendChild(a);
    outline.appendChild(li);
  });
  links = [...outline.querySelectorAll('a')];
  document.querySelector('.page-outline').hidden = !headings.length;
}
rebuildOutline();
document.addEventListener('course:content-changed', () => { rebuildOutline(); mark(); });

// Mark the section currently at the top of the screen.
const mark = () => {
  let current = headings[0];
  for (const h of headings) if (h.getBoundingClientRect().top < 260) current = h;
  links.forEach(a => a.classList.toggle('is-current', current && a.hash === '#' + current.id));
};
addEventListener('scroll', mark, { passive: true });
mark();

// Keep unannounced links visibly labelled and prevent an unexpected jump to the page top.
document.querySelectorAll('[data-pending]').forEach(link => link.addEventListener('click', e => e.preventDefault()));

// Library: "Show only required" hides Recommended and Optional materials on the page.
const reqToggle = document.querySelector('.required-toggle');
if (reqToggle) reqToggle.addEventListener('click', () => {
  const on = reqToggle.getAttribute('aria-pressed') !== 'true';
  reqToggle.setAttribute('aria-pressed', String(on));
  reqToggle.textContent = on ? 'Show all materials' : 'Show only required';
  document.querySelectorAll('.material:not([data-level="required"])').forEach(li => { li.hidden = on; });
  // a topic with only optional items says so while filtered
  document.querySelectorAll('.topic-block').forEach(t => {
    const hasItems = t.querySelector('.material');
    const hasReq = t.querySelector('.material[data-level="required"]');
    const note = t.querySelector('.material-empty');
    if (hasItems) note.hidden = !(on && !hasReq);
  });
});

// Staff tools dropdown: close on an outside click or Escape.
const staffMenu = document.querySelector('.staff-menu');
if (staffMenu) {
  document.addEventListener('click', e => { if (staffMenu.open && !staffMenu.contains(e.target)) staffMenu.open = false; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && staffMenu.open) { staffMenu.open = false; staffMenu.querySelector('summary').focus(); } });
}
