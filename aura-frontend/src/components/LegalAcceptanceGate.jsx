import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import MaterialIcon from './MaterialIcon';
import { LEGAL_DOCUMENTS } from '../lib/legalDocuments';
import privacyPolicyHtml from '../assets/privacyPolicyContent.html?raw';
import termsConditionsHtml from '../assets/termsConditionsContent.html?raw';

const TABS = [
  { ...LEGAL_DOCUMENTS.PRIVACY_POLICY, html: privacyPolicyHtml },
  { ...LEGAL_DOCUMENTS.TERMS_CONDITIONS, html: termsConditionsHtml },
];

// Interstitial de pantalla completa: se muestra en vez de las rutas
// protegidas (ver ProtectedRoute.jsx) hasta que el usuario acepta la versión
// vigente de AMBOS documentos legales (decisión combinada: un solo paso que
// acepta Privacidad + Términos juntos, aunque cada uno queda registrado por
// separado en Supabase). Bloqueo total: no hay forma de "saltear" esta
// pantalla salvo aceptando los dos.
export default function LegalAcceptanceGate() {
  const { legalStatus, acceptLegalDocuments, logout } = useAuth();
  const [activeTab, setActiveTab] = useState(TABS[0].slug);
  // Si un documento ya fue aceptado antes (ej. solo cambió la versión del
  // otro), el checkbox arranca marcado y deshabilitado -- no hace falta que
  // el usuario vuelva a tildarlo, pero sigue viajando al submit (idempotente).
  const [checked, setChecked] = useState(() => {
    const initial = {};
    for (const doc of TABS) initial[doc.slug] = !!legalStatus[doc.slug];
    return initial;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = TABS.every((doc) => checked[doc.slug]);
  const active = TABS.find((t) => t.slug === activeTab);

  const handleAccept = async () => {
    setSubmitting(true);
    setError('');
    try {
      await acceptLegalDocuments();
    } catch (err) {
      setError(err.message || 'Error al registrar tu aceptación. Intentá de nuevo.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-on-background font-body-md flex items-center justify-center relative overflow-hidden p-4">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] ai-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-secondary/10 rounded-full blur-[100px] ai-pulse" style={{ animationDelay: '1.5s' }} />
      </div>

      <div className="relative z-10 w-full max-w-2xl glass-card rounded-2xl p-6 md:p-10 flex flex-col max-h-[90vh]">
        <div className="text-center mb-6 shrink-0">
          <img src="/logoAura.png" alt="Aura" className="w-16 h-16 object-contain mx-auto mb-4" />
          <h1 className="text-headline-lg font-headline-lg text-on-surface mb-1">
            Antes de continuar
          </h1>
          <p className="text-body-md font-body-md text-on-surface-variant">
            Necesitamos que leas y aceptes estos dos documentos.
          </p>
        </div>

        <div className="flex gap-2 mb-4 shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.slug}
              type="button"
              onClick={() => setActiveTab(tab.slug)}
              className={`flex-1 py-2 px-3 rounded-lg font-label-sm font-bold flex items-center justify-center gap-2 transition-all ${
                activeTab === tab.slug
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {checked[tab.slug] && <MaterialIcon icon="check_circle" size="text-sm" />}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl p-4 md:p-6 overflow-y-auto flex-1 mb-6">
          <div dangerouslySetInnerHTML={{ __html: active.html }} />
        </div>

        {error && (
          <p className="text-error font-label-sm mb-4 text-center shrink-0">{error}</p>
        )}

        <div className="flex flex-col gap-3 mb-6 shrink-0">
          {TABS.map((doc) => (
            <label
              key={doc.slug}
              className={`flex items-start gap-3 ${checked[doc.slug] && legalStatus[doc.slug] ? 'opacity-60' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                checked={checked[doc.slug]}
                disabled={legalStatus[doc.slug]}
                onChange={(e) => setChecked((prev) => ({ ...prev, [doc.slug]: e.target.checked }))}
                className="mt-1 w-5 h-5 rounded accent-primary shrink-0"
              />
              <span className="font-body-sm text-on-surface-variant">
                Leí y acepto {doc.slug === 'privacy_policy' ? 'la' : 'los'} {doc.label} de Aura.
                {legalStatus[doc.slug] && ' (ya aceptado)'}
              </span>
            </label>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 shrink-0">
          <button
            type="button"
            onClick={() => logout()}
            disabled={submitting}
            className="flex-1 py-3 rounded-xl bg-surface-container-highest border border-white/10 text-on-surface font-bold font-label-sm hover:brightness-110 active:scale-95 transition-all disabled:opacity-60"
          >
            Cerrar sesión
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={!canSubmit || submitting}
            className="flex-1 py-3 rounded-xl bg-primary text-on-primary font-bold font-label-sm hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {submitting && <MaterialIcon icon="autorenew" className="animate-spin" size="text-base" />}
            Acepto y continúo
          </button>
        </div>
      </div>
    </div>
  );
}
