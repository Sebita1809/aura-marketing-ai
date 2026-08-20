import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import MaterialIcon from '../components/MaterialIcon';
import ContactModal from '../components/ContactModal';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // LoginPage no usa Navbar ni Footer (design.md Decisión 6), así que
  // maneja su propia instancia del ContactModal en vez de recibir
  // onContactClick por props.
  const [isContactOpen, setIsContactOpen] = useState(false);
  const location = useLocation();
  // Mensaje que trae ProtectedRoute cuando expulsa a un usuario cuyo estado
  // dejó de ser 'active' (blocked-user-enforcement, capa panel).
  const [error, setError] = useState(location.state?.message || '');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate('/admin');
    } catch (err) {
      setError(err.message || 'Error al iniciar sesión. Verificá tus credenciales.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-on-background font-body-md flex items-center justify-center relative overflow-hidden">
      {/* Ambient glow orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] ai-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-secondary/10 rounded-full blur-[100px] ai-pulse" style={{ animationDelay: '1.5s' }} />
        <div className="absolute top-1/3 right-1/3 w-[300px] h-[300px] bg-[#25D366]/5 rounded-full blur-[80px] ai-pulse" style={{ animationDelay: '3s' }} />
      </div>

      {/* Login card */}
      <div className="relative z-10 w-full max-w-md px-margin-mobile md:px-0">
        <div className="glass-card rounded-2xl p-8 md:p-10">
          {/* Brand header */}
          <div className="text-center mb-8">
            <img src="/logoAura.png" alt="Aura" className="w-20 h-20 object-contain mx-auto mb-4" />
            <h1 className="text-headline-lg font-headline-lg text-on-surface mb-1">
              Aura
            </h1>
            <p className="text-body-md font-body-md text-on-surface-variant">
              Marketing AI Ecosystem
            </p>
          </div>

          {/* Login form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email field */}
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/60">
                <MaterialIcon icon="mail" />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Correo electrónico"
                required
                className="w-full bg-surface-container/60 border border-white/10 rounded-xl pl-12 pr-4 py-3.5 text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
              />
            </div>

            {/* Password field */}
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/60">
                <MaterialIcon icon="lock" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña"
                required
                className="w-full bg-surface-container/60 border border-white/10 rounded-xl pl-12 pr-12 py-3.5 text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant/60 hover:text-primary transition-colors"
              >
                <MaterialIcon icon={showPassword ? 'visibility_off' : 'visibility'} />
              </button>
            </div>

            {/* Remember me + Forgot password */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer group">
                <div
                  onClick={() => setRemember(!remember)}
                  className={`w-5 h-5 rounded-md border transition-all flex items-center justify-center ${
                    remember
                      ? 'bg-primary border-primary'
                      : 'border-white/20 group-hover:border-primary/50'
                  }`}
                >
                  {remember && <MaterialIcon icon="check" className="text-on-primary-container text-[16px]" />}
                </div>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="hidden"
                />
                <span className="text-label-sm font-label-sm text-on-surface-variant">
                  Recordar sesión en este dispositivo
                </span>
              </label>
              <Link
                to="#"
                className="text-label-sm font-label-sm text-primary hover:text-primary/80 transition-colors"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>

            {/* Error message */}
            {error && (
              <div className="p-3 rounded-xl bg-error/10 border border-error/20 text-error font-body-md text-sm flex items-center gap-2">
                <MaterialIcon icon="error" className="text-[18px]" />
                {error}
              </div>
            )}

            {/* Login button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-gradient-to-r from-[#ddb7ff] to-[#0566d9] text-on-primary-container font-bold py-3.5 rounded-xl hover:brightness-110 active:scale-[0.98] transition-all shadow-lg shadow-[#ddb7ff]/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Iniciando sesión...' : 'Iniciar Sesión'}
            </button>
          </form>
        </div>

        {/* Footer links */}
        <div className="mt-8 text-center">
          <p className="text-body-md font-body-md text-on-surface-variant mb-4">
            ¿Aún no tienes cuenta?{' '}
            <button
              type="button"
              onClick={() => setIsContactOpen(true)}
              className="text-primary font-medium hover:underline focus:outline-none focus:underline"
            >
              Contacta a un asesor
            </button>
          </p>
          <div className="flex items-center justify-center gap-6 flex-wrap">
            <div className="flex items-center gap-2 text-on-surface-variant/60 text-label-sm font-label-sm">
              <MaterialIcon icon="language" className="text-[16px]" />
              <span>Español (Latam)</span>
              <MaterialIcon icon="expand_more" className="text-[16px]" />
            </div>
            <Link to="#" className="text-label-sm font-label-sm text-on-surface-variant/60 hover:text-primary transition-colors">
              Privacidad
            </Link>
            <Link to="#" className="text-label-sm font-label-sm text-on-surface-variant/60 hover:text-primary transition-colors">
              Términos
            </Link>
          </div>
        </div>
      </div>

      <ContactModal isOpen={isContactOpen} onClose={() => setIsContactOpen(false)} />
    </div>
  );
}
