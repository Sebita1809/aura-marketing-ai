import { Link, useNavigate } from 'react-router-dom';
import MaterialIcon from './MaterialIcon';

// El estado isContactOpen y el ContactModal vivían acá (landing-contact-email,
// design.md Decisión 6). Se elevaron a LandingPage.jsx para que el Footer
// también pueda abrir el mismo modal -- Navbar ahora solo recibe
// onContactClick y ya no monta su propio ContactModal.
export default function Navbar({ onContactClick }) {
  const navigate = useNavigate();

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
      <nav className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-md border-b border-white/10 shadow-sm">
        <div className="max-w-container-max mx-auto px-4 md:px-10 flex items-center justify-between h-16 md:h-20">

          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 font-headline-lg font-bold text-primary tracking-tight text-lg md:text-headline-lg shrink-0">
            <img src="/logoAura.png" alt="Aura" className="w-7 h-7 md:w-8 md:h-8 object-contain" />
            Aura
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-6">
            <button onClick={() => scrollToSection('beneficios')} className="text-on-surface-variant font-medium hover:text-primary transition-colors duration-200">
              Beneficios
            </button>
            <button onClick={() => scrollToSection('como-funciona')} className="text-on-surface-variant font-medium hover:text-primary transition-colors duration-200">
              Cómo funciona
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 md:gap-4">
            {/* Mobile: icon-only login */}
            <button
              onClick={() => navigate('/login')}
              className="md:hidden w-9 h-9 flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors rounded-lg hover:bg-white/5"
              aria-label="Iniciar Sesión"
            >
              <MaterialIcon icon="person" />
            </button>

            {/* Desktop: text login */}
            <button
              onClick={() => navigate('/login')}
              className="hidden md:block text-on-surface-variant font-medium hover:text-primary transition-all duration-200 active:scale-95 px-4 py-2"
            >
              Iniciar Sesión
            </button>

            {/* Always: Contactar */}
            <button
              onClick={onContactClick}
              className="bg-primary text-on-primary-container font-bold px-4 md:px-6 py-2 md:py-2.5 text-sm md:text-base rounded-full hover:brightness-110 transition-all active:scale-95 shadow-lg shadow-primary/20 whitespace-nowrap"
            >
              Contactar
            </button>
          </div>
        </div>
      </nav>
  );
}
