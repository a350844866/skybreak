/** Floating text feedback ("+212 m", "231 ms", "TOO EARLY") as pooled DOM nodes over the canvas. */
export type LabelStyle = 'gain' | 'gold' | 'big' | 'bad';

export function labels(root: HTMLElement, size = 14) {
  const pool = Array.from({ length: size }, () => {
    const node = document.createElement('div');
    node.className = 'fx-label';
    node.hidden = true;
    root.append(node);
    return { node, animation: undefined as Animation | undefined };
  });
  let next = 0;

  function show(text: string, x: number, y: number, style: LabelStyle) {
    const slot = pool[next];
    next = (next + 1) % pool.length;
    slot.animation?.cancel();
    const { node } = slot;
    node.textContent = text;
    node.className = `fx-label fx-${style}`;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.hidden = false;
    const rise = style === 'big' || style === 'bad' ? 0 : -56;
    slot.animation = node.animate([
      { transform: 'translate(-50%, -50%) scale(0.7)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.12)', opacity: 1, offset: 0.18 },
      { transform: `translate(-50%, calc(-50% + ${rise}px)) scale(1)`, opacity: 0 },
    ], { duration: style === 'big' || style === 'bad' ? 700 : 850, easing: 'cubic-bezier(.2,.7,.3,1)' });
    slot.animation.onfinish = () => { node.hidden = true; };
  }

  return {
    show,
    clear() {
      for (const slot of pool) { slot.animation?.cancel(); slot.node.hidden = true; }
    },
    dispose() { for (const slot of pool) slot.node.remove(); },
  };
}
