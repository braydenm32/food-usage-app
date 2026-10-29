/**
 * Focus management for lists where an action removes the row that had focus.
 * Rows mark their main button with `data-row-focus="<item id>"`.
 */

const visible = (el: HTMLElement) => el.isConnected && el.getClientRects().length > 0;

/** Focus a row's main button by item id. Returns true when found and visible. */
export function focusRow(id: string): boolean {
  const el = Array.from(document.querySelectorAll<HTMLElement>(`[data-row-focus="${CSS.escape(id)}"]`)).find(visible);
  el?.focus();
  return !!el;
}

/**
 * Call *before* an action that removes the row containing `el`. Once the row is gone, focus
 * moves to the next row on the page (or the previous one, or `fallback`) instead of the body.
 */
export function keepFocusNear(el: Element | null, fallback?: () => HTMLElement | null) {
  const row = el?.closest("li");
  if (!row) return;
  const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-row-focus]")).filter(visible);
  const i = rows.findIndex((r) => row.contains(r));
  const after = i < 0 ? rows : rows.slice(i + 1);
  const before = i < 0 ? [] : rows.slice(0, i).reverse();
  // After React has committed the removal.
  setTimeout(() => {
    if (row.isConnected) return; // nothing was removed
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return; // something else took focus
    const ids = [...after, ...before].map((r) => r.dataset.rowFocus).filter((id): id is string => !!id);
    if (!ids.some(focusRow)) fallback?.()?.focus();
  }, 50);
}
