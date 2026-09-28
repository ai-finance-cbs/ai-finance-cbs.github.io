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
const headings = [...document.querySelectorAll('.content h2')].filter(h => !h.closest('.page-footer'));
headings.forEach((h, i) => {
  if (!h.id) h.id = 'section-' + (i + 1);
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = '#' + h.id;
  a.textContent = h.textContent.trim();
  li.appendChild(a);
  outline.appendChild(li);
});
if (!headings.length) document.querySelector('.page-outline').hidden = true;

// Mark the section currently at the top of the screen.
const links = [...outline.querySelectorAll('a')];
const mark = () => {
  let current = headings[0];
  for (const h of headings) if (h.getBoundingClientRect().top < 260) current = h;
  links.forEach(a => a.classList.toggle('is-current', current && a.hash === '#' + current.id));
};
addEventListener('scroll', mark, { passive: true });
mark();

// Keep unannounced links visibly labelled and prevent an unexpected jump to the page top.
document.querySelectorAll('[data-pending]').forEach(link => link.addEventListener('click', e => e.preventDefault()));
