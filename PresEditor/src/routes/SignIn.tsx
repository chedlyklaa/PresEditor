import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { EI } from '../lib/icons';

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: (EI as Record<string, string>)[name] }} />;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignIn() {
  const { status, signIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [busy, setBusy] = useState(false);

  // Already signed in (e.g. hard-refreshing /signin directly) — go straight
  // to wherever a guard originally redirected from, defaulting to /home.
  if (status === 'authed') {
    const from = (location.state as { from?: Location })?.from?.pathname || '/home';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email)) {
      setEmailError('Adresse e-mail invalide.');
      return;
    }
    setEmailError('');
    setBusy(true);
    const ok = await signIn(email, password);
    setBusy(false);
    if (ok) {
      const from = (location.state as { from?: Location })?.from?.pathname || '/home';
      navigate(from, { replace: true });
    }
  }

  return (
    <div className="ed-auth-page">
      <div className="ed-auth-card">
        <div className="ed-auth-brand">
          <Icon name="sitemap" /> Éditeur
        </div>
        <h2>Se connecter</h2>
        <form onSubmit={handleSubmit}>
          <div className="ed-auth-field">
            <label>E-mail</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError('');
              }}
            />
            {emailError && <span className="ed-auth-error">{emailError}</span>}
          </div>
          <div className="ed-auth-field">
            <label>Mot de passe</label>
            <div className="ed-auth-password-row">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="ed-icon-btn"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} />
              </button>
            </div>
          </div>
          <button type="submit" className="ed-btn primary ed-auth-submit" disabled={busy}>
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
        <div className="ed-auth-links">
          <Link to="/signup">Pas de compte ? En créer un</Link>
          <Link to="/editor/local">Continuer sans compte →</Link>
        </div>
      </div>
    </div>
  );
}
