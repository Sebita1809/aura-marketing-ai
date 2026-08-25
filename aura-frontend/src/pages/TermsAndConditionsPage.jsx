import { Link } from 'react-router-dom';
import Footer from '../components/Footer';
import MaterialIcon from '../components/MaterialIcon';
import termsConditionsHtml from '../assets/termsConditionsContent.html?raw';

// Página pública (sin ProtectedRoute): el bot de Telegram linkea acá directo en
// el mensaje de aceptación, y no todo el que abre este link está logueado.
// Mismo tratamiento que PrivacyPolicyPage.jsx: el HTML viene tal cual del
// documento legal (terms_and_conditions.txt), envuelto en una card clara
// porque fuerza texto negro sobre fondo transparente via [data-custom-class].
export default function TermsAndConditionsPage() {
  return (
    <div className="min-h-screen bg-background text-on-background font-body-md flex flex-col">
      <header className="border-b border-white/5 px-margin-mobile md:px-margin-desktop py-4">
        <div className="max-w-container-max mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img src="/logoAura.png" alt="Aura" className="w-10 h-10 object-contain" />
            <span className="font-headline-lg text-headline-lg text-on-surface">Aura</span>
          </Link>
          <Link
            to="/"
            className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-label-sm"
          >
            <MaterialIcon icon="arrow_back" size="text-sm" />
            Volver
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-margin-mobile md:px-margin-desktop py-12">
        <h1 className="font-display-lg text-display-lg text-on-surface mb-8">
          Términos y <span className="text-primary">Condiciones</span>
        </h1>
        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-10 overflow-x-auto">
          <div dangerouslySetInnerHTML={{ __html: termsConditionsHtml }} />
        </div>
      </main>

      <Footer />
    </div>
  );
}
