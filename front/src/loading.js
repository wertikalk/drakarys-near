// Tiny shared loading tracker. api.js reports pending requests and the router
// pulses on navigation; Loader renders whenever pending > 0.
const listeners = new Set();
let pending = 0;

const emit = () => listeners.forEach((l) => l(pending));

export const beginTask = () => {
  pending += 1;
  emit();
};

export const endTask = () => {
  pending = Math.max(0, pending - 1);
  emit();
};

export const subscribeLoading = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getPending = () => pending;
