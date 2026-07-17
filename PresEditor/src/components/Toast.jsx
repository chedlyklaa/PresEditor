import { useEffect, useRef, useState } from 'react';
import { subscribeToast } from '../lib/toastBus';

export default function Toast() {
  const [entry, setEntry] = useState(null);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef(null);

  useEffect(() => {
    return subscribeToast((next) => {
      setEntry(next);
      setVisible(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), 2600);
    });
  }, []);

  return (
    <div className={`ed-toast${visible ? ' show' : ''}${entry?.isError ? ' error' : ''}`} role="status" aria-live="polite">
      {entry?.message}
    </div>
  );
}
