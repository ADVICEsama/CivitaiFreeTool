/* Shared motion for standalone settings pages and dialogs. Menus stay immediate. */
(() => {
  'use strict';
  const root = globalThis, doc = root.document;
  const roots = '.rd-mask:not(.font-picker-mask),.df-mask,.model-style-mask,.update-whitelist-mask,.key-prompt-mask,.ob-mask,.rename-dialog,.reverse-tour-card';
  const panels = '.rename-dialog,.df-dialog,.model-style-dialog,.update-whitelist-dialog,.settings-exit-dialog,.key-setup-card,.ob-card,[role="dialog"]';
  const running = new WeakMap(), leaving = new WeakMap();
  const reduced = () => !doc || root.CFTMotion?.reduced() || root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const usable = element => element && typeof element === 'object' && typeof element.remove === 'function';
  function cancel(element) {
    const animations = running.get(element) || [];
    animations.forEach(animation => animation.cancel());
    running.delete(element);
  }
  function targets(element) {
    const panel = element.matches?.(panels) ? element : element.querySelector?.(panels);
    return panel && panel !== element ? [element, panel] : [element];
  }
  function animate(element, closing) {
    cancel(element);
    if (!element.isConnected || reduced() || !element.animate) return Promise.resolve();
    const children = targets(element), animations = [];
    for (const target of children) {
      const panel = target !== element || element.matches?.(panels) || element.matches?.('.reverse-tour-card');
      const fromOpacity = closing ? (root.getComputedStyle?.(target).opacity || '1') : '0';
      const frames = panel ? [
        {translate: closing ? '0px 0px' : '-60px 0px', opacity: fromOpacity},
        {translate: closing ? '90px 0px' : '0px 0px', opacity: closing ? '0' : '1'}
      ] : [{opacity: fromOpacity}, {opacity: closing ? '0' : '1'}];
      animations.push(target.animate(frames, {
        duration: closing ? 110 : 180,
        easing: closing ? 'cubic-bezier(.55,.05,.8,.5)' : 'cubic-bezier(.16,1,.3,1)',
        fill: 'both'
      }));
    }
    running.set(element, animations);
    return Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(() => {
      if (running.get(element) !== animations) return;
      animations.forEach(animation => animation.cancel());
      running.delete(element);
    });
  }
  function enter(element) {
    if (!usable(element) || leaving.has(element) || element.matches?.('.font-picker-mask')) return Promise.resolve();
    element.inert = false;
    if (element.dataset?.cftModalMotion === 'closing') {
      delete element.dataset.cftModalMotion;
      element.removeAttribute('aria-hidden');
    }
    return animate(element, false);
  }
  function finish(element, hide) {
    if (!usable(element)) return Promise.resolve();
    if (leaving.has(element)) return leaving.get(element);
    if (!element.isConnected || reduced()) {
      cancel(element);
      if (hide) element.style.display = 'none'; else element.remove();
      return Promise.resolve();
    }
    element.inert = true;
    element.setAttribute('aria-hidden', 'true');
    if (element.dataset) element.dataset.cftModalMotion = 'closing';
    const promise = animate(element, true).then(() => {
      if (hide) element.style.display = 'none'; else element.remove();
      leaving.delete(element);
    });
    leaving.set(element, promise);
    return promise;
  }
  root.CFTModalMotion = {enter, remove: element => finish(element, false), hide: element => finish(element, true)};
  if (!doc?.documentElement || !root.MutationObserver) return;
  // Only newly inserted modal roots. Persistent onboarding explicitly calls enter().
  new MutationObserver(records => {
    const added = new Set();
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches(roots)) added.add(node);
      node.querySelectorAll(roots).forEach(element => added.add(element));
    }
    for (const element of added) {
      if (!element.isConnected || [...added].some(parent => parent !== element && parent.contains(element))) continue;
      if (root.getComputedStyle(element).display !== 'none') enter(element);
    }
  }).observe(doc.documentElement, {childList: true, subtree: true});
})();
