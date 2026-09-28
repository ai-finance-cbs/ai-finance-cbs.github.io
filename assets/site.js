// The desktop and mobile navigation share the same links.
document.documentElement.classList.add('js');
const sidebar = document.querySelector('.site-sidebar');
const toggle = document.querySelector('.menu-toggle');
const phone = window.matchMedia('(max-width: 819px)');
const setMenu = open => {
  sidebar.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.querySelector('span').textContent = open ? 'Close' : 'Menu';
};
toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
    toggle.focus();
  }
});
phone.addEventListener('change', () => setMenu(false));
// Keep unannounced links visibly labelled and prevent an unexpected jump to the page top.
document.querySelectorAll('[data-pending]').forEach(link => link.addEventListener('click', event => event.preventDefault()));
