export const GROUP_NOT_SET_UP = 'Group submission is not set up yet. Email the teaching team.';
export const GROUP_NOT_JOINED = 'Join your group on Canvas first. The site updates after the next Canvas sync.';
export const groupLinkClosed = (due, now=Date.now()) => !due || !Number.isFinite(Date.parse(due)) || Number(now)>=Date.parse(due);
export function validateGroupLink(value) {
  const link=typeof value==='string'?value.trim():'';
  if ([...link].length>2000 || !/^https:\/\/[^/?#\s\\]+(?:[/?#][^\s\\]*)?$/i.test(link))
    throw Error('Enter an https:// link of at most 2000 characters.');
  try { if (!new URL(link).hostname) throw Error(); }
  catch { throw Error('Enter a complete https:// website link.'); }
  return link;
}
export function groupLinkHint(value) {
  try {
    const host=new URL(validateGroupLink(value)).hostname.toLowerCase();
    return host==='github.io' || host.endsWith('.github.io')?'':'This is not a github.io address. A custom domain is fine; check that this is your live website.';
  } catch { return ''; }
}
