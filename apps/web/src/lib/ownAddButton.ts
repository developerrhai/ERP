// The page's own "+ New ..." button. The top bar's "＋ Add New" only tells the page to add something; pages that do not
// listen used to answer with a toast and nothing else (V40 case TC-21, "cannot initiate"). When nobody handles the event
// the bar presses the page's own button instead.
const ADD_LABEL = /^[+＋]\s*(new|add|import)\b/i;

const textOf = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The first enabled "+ New / + Add" button inside `scope`, never one of the top bar's own buttons. */
export function findAddButton(scope: ParentNode): HTMLButtonElement | null {
  for (const b of Array.from(scope.querySelectorAll<HTMLButtonElement>('button'))) {
    if (b.hasAttribute('disabled') || b.closest('.actionbar')) continue;
    if (ADD_LABEL.test(textOf(b))) return b;
  }
  return null;
}
