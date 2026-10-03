const maximumCanvases = 2;
const waiting = new Set<symbol>();
const active = new Set<symbol>();
const listeners = new Set<() => void>();

function reconcile() {
  const next = new Set([...waiting].slice(0, maximumCanvases));
  if (
    next.size === active.size &&
    [...next].every((ticket) => active.has(ticket))
  )
    return;
  active.clear();
  for (const ticket of next) active.add(ticket);
  for (const listener of listeners) listener();
}

// Keep GPU rendering bounded when several feature cards are visible.
export function requestOrbCanvas(ticket: symbol) {
  waiting.add(ticket);
  reconcile();
  return () => {
    waiting.delete(ticket);
    reconcile();
  };
}

export function hasOrbCanvas(ticket: symbol) {
  return active.has(ticket);
}

export function subscribeOrbCanvases(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
