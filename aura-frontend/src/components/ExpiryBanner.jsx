import { useState } from 'react';
import MaterialIcon from './MaterialIcon';

const bannerAnimations = `
  @keyframes banner-slide-down {
    from { transform: translateY(-100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes banner-fade-up {
    from { opacity: 1; transform: translateY(0); }
    to { opacity: 0; transform: translateY(-20px); }
  }
  .animate-banner-in {
    animation: banner-slide-down 0.4s ease-out forwards;
  }
  .animate-banner-out {
    animation: banner-fade-up 0.3s ease-in forwards;
  }
`;

export default function ExpiryBanner({ expiredPlatforms, onDismiss, onConnect }) {
  const [dismissing, setDismissing] = useState(false);

  const handleDismiss = () => {
    setDismissing(true);
    setTimeout(() => onDismiss?.(), 300);
  };

  if (!expiredPlatforms || expiredPlatforms.length === 0) return null;

  return (
    <>
      <style>{bannerAnimations}</style>
      <div className={`glass-card rounded-2xl border-l-4 border-l-error bg-error/5 border border-error/10 p-6 mb-8 ${dismissing ? 'animate-banner-out' : 'animate-banner-in'}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-error/20 flex items-center justify-center shrink-0">
                <MaterialIcon icon="error" className="text-error" fill />
              </div>
              <h3 className="font-headline-lg text-lg text-on-surface font-bold">
                {expiredPlatforms.length === 1 ? 'Conexión expirada' : 'Conexiones expiradas'}
              </h3>
            </div>
            <div className="space-y-3">
              {expiredPlatforms.map((ep) => (
                <div key={ep.platform} className="flex items-center justify-between gap-4 p-3 rounded-xl bg-surface-dim border border-white/5">
                  <div className="flex items-center gap-3 min-w-0">
                    <MaterialIcon icon={ep.platformDef?.icon || 'link_off'} className="text-error shrink-0" />
                    <p className="font-body-sm text-on-surface-variant leading-relaxed">
                      Tu cuenta de <strong className="text-on-surface">{ep.platformDef?.name || ep.platform}</strong> se ha desconectado. Por favor, vuelve a conectarla desde aquí.
                    </p>
                  </div>
                  <button
                    onClick={() => onConnect?.(ep.platform)}
                    className="shrink-0 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[#ddb7ff] to-[#0566d9] text-[#400071] font-bold font-label-sm hover:brightness-110 active:scale-95 transition-all flex items-center gap-1.5"
                  >
                    <MaterialIcon icon="link" size="text-sm" />
                    Conectar
                  </button>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors -mr-1 -mt-1"
          >
            <MaterialIcon icon="close" className="text-on-surface-variant" />
          </button>
        </div>
      </div>
    </>
  );
}
