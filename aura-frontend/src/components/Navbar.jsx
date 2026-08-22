import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import MaterialIcon from './MaterialIcon';

// Debe coincidir con el spacer de 1 viewport que reserva VideoHero.jsx
// para el scroll del video -- es el punto en el que el texto del hero
// empieza a entrar en pantalla.
const SPACER_VH = 1;
// Fracción final de ese viewport en la que el navbar pasa de invisible a
// visible (se mantiene oculto mientras se ve el video, y aparece recién
// cuando el texto ya está entrando).
const FADE_IN_FRACTION = 0.3;

// El estado isContactOpen y el ContactModal vivían acá (landing-contact-email,
// design.md Decisión 6). Se elevaron a LandingPage.jsx para que el Footer
// también pueda abrir el mismo modal -- Navbar ahora solo recibe
// onContactClick y ya no monta su propio ContactModal.
export default function Navbar({ onContactClick }) {
  const navigate = useNavigate();
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const spacerHeight = window.innerHeight * SPACER_VH;
      const fadeInStart = spacerHeight * (1 - FADE_IN_FRACTION);
      const range = spacerHeight - fadeInStart;
      const next = Math.min(1, Math.max(0, (window.scrollY - fadeInStart) / range));
      setOpacity(next);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
      <nav
        className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-md border-b border-white/10 shadow-sm transition-opacity duration-150 ease-out"
        style={{ opacity, pointerEvents: opacity > 0.05 ? 'auto' : 'none' }}
      >
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
