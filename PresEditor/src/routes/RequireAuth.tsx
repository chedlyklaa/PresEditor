import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';

// Wraps /home and /editor/:id (App.jsx) — /editor/local stays unguarded,
// per the plan's "local mode reachable without any account" constraint.
// Waits out the initial GET /api/auth/me check ('loading') instead of
// treating it as signed-out for a moment, which would otherwise bounce a
// genuinely-authenticated user to /signin on every hard refresh.
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="ed-app">
        <div className="ed-canvas-stage" style={{ width: '100%', gridColumn: '1 / -1' }}>
          <div className="ed-spinner">
            <div className="ed-ring" />
            <div>Chargement…</div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'anon') {
    // `from` lets the sign-in page return here afterward (deep-link
    // preservation) instead of always landing on /home.
    return <Navigate to="/signin" replace state={{ from: location }} />;
  }

  // 'unreachable' (API down/network blip) falls through here too — see
  // AuthContext.tsx's status comment for why that must not redirect.
  return <>{children}</>;
}
