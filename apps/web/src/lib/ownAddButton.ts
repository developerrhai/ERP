// The page's own "+ New ..." button. The top bar's "＋ Add New" only tells the page to add something; pages that do not
// listen used to answer with a toast and nothing else (V40 case TC-21, "cannot initiate"). When nobody handles the event
// the bar presses the page's own button instead.
const ADD_LABEL = /^[+＋]\s*(new|add|import|record|report)\b/i;

const textOf = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * The first enabled "+ New / + Add" button inside `scope`, never one of the top bar's own buttons and never a register's
 * stand-in (data-add-proxy): a stand-in that found itself would press itself and nothing would open.
 */
export function findAddButton(scope: ParentNode): HTMLButtonElement | null {
  for (const b of Array.from(scope.querySelectorAll<HTMLButtonElement>('button'))) {
    if (b.hasAttribute('disabled') || b.hasAttribute('data-add-proxy') || b.closest('.actionbar')) continue;
    if (ADD_LABEL.test(textOf(b))) return b;
  }
  return null;
}
