import { Link } from 'react-router-dom';
import MaterialIcon from './MaterialIcon';

// onContactClick (landing-contact-email, design.md Decisión 6): abre el
// mismo ContactModal montado por LandingPage. "Contacto" dejó de ser un
// <Link to="#"> muerto (tasks.md 6.3).
export default function Footer({ onContactClick }) {
  return (
    <footer className="bg-surface-container-lowest border-t border-white/5 font-label-sm text-label-sm">
      <div className="max-w-container-max mx-auto px-margin-desktop py-12 flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="flex items-start gap-4">
          <img src="/logoAura.png" alt="Aura" className="w-16 h-16 object-contain flex-shrink-0" />
          <div className="flex flex-col gap-4">
            <span className="text-headline-lg font-headline-lg text-on-surface">Aura</span>
            <p className="text-on-surface-variant max-w-xs text-left">
              Redefiniendo el futuro del marketing digital con automatización consciente e inteligente.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center md:items-end gap-6">
          <div className="flex items-center gap-8">
            <Link to="/privacy-policy" className="text-on-surface-variant hover:text-primary transition-colors opacity-80 hover:opacity-100">Privacidad</Link>
            <Link to="/terms-and-conditions" className="text-on-surface-variant hover:text-primary transition-colors opacity-80 hover:opacity-100">Términos</Link>
            <button
              type="button"
              onClick={onContactClick}
              className="text-on-surface-variant hover:text-primary transition-colors opacity-80 hover:opacity-100"
            >
              Contacto
            </button>
          </div>
          <div className="flex items-center gap-4">
            <a href="#" className="w-10 h-10 rounded-full glass-card flex items-center justify-center hover:text-primary"><MaterialIcon icon="public" /></a>
            <a
              href="mailto:botprueba418@gmail.com"
              aria-label="Enviar correo a botprueba418@gmail.com"
              className="w-10 h-10 rounded-full glass-card flex items-center justify-center hover:text-primary"
            >
              <MaterialIcon icon="alternate_email" />
            </a>
          </div>
          <p className="text-on-surface-variant/60">© 2024 Aura AI Marketing. Todos los derechos reservados.</p>
        </div>
      </div>
    </footer>
  );
}
