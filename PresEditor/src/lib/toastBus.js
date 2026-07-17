// Minimal pub/sub for transient UI feedback (toasts). Deliberately kept out
// of the editor's reducer state: toast messages are not application data,
// they don't get auto-saved, and giving them their own tiny channel avoids
// coupling every "show a toast" call site to a dispatch action.
const listeners = new Set();

export function subscribeToast(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function toast(message, isError = false) {
  listeners.forEach((cb) => cb({ message, isError, key: Date.now() + Math.random() }));
}
