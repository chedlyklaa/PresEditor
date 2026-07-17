import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { EI } from '../lib/icons';

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: (EI as Record<string, string>)[name] }} />;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignUp() {
  const { status, signUp } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [busy, setBusy] = useState(false);

  if (status === 'authed') {
    const from = (location.state as { from?: Location })?.from?.pathname || '/home';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    let ok = true;
    if (!EMAIL_RE.test(email)) {
      setEmailError('Adresse e-mail invalide.');
      ok = false;
    } else {
      setEmailError('');
    }
    if (password.length < 8) {
      setPasswordError('Le mot de passe doit contenir au moins 8 caractères.');
      ok = false;
    } else {
      setPasswordError('');
    }
    if (!ok) return;

    setBusy(true);
    const created = await signUp(email, password, displayName);
    setBusy(false);
    if (created) {
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
        <h2>Créer un compte</h2>
        <form onSubmit={handleSubmit}>
          <div className="ed-auth-field">
            <label>Nom affiché (facultatif)</label>
            <input type="text" autoFocus value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="ed-auth-field">
            <label>E-mail</label>
            <input
              type="email"
              required
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
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError('');
                }}
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
            {passwordError && <span className="ed-auth-error">{passwordError}</span>}
          </div>
          <button type="submit" className="ed-btn primary ed-auth-submit" disabled={busy}>
            {busy ? 'Création…' : 'Créer le compte'}
          </button>
        </form>
        <div className="ed-auth-links">
          <Link to="/signin">Déjà un compte ? Se connecter</Link>
          <Link to="/editor/local">Continuer sans compte →</Link>
        </div>
      </div>
    </div>
  );
}
