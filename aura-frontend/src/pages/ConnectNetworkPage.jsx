import { useNavigate } from 'react-router-dom';
import MaterialIcon from '../components/MaterialIcon';
import { useAuth } from '../context/AuthContext';

const APP_ORIGIN = window.location.origin;

const glassPanelStyle = `
  .glass-panel {
    background: rgba(26, 26, 26, 0.6);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .glass-card-custom {
    background: rgba(255, 255, 255, 0.03);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.05);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .glass-card-custom:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(221, 183, 255, 0.3);
    transform: translateY(-4px);
    box-shadow: 0 10px 30px -10px rgba(132, 43, 210, 0.2);
  }
  .primary-gradient {
    background: linear-gradient(135deg, #ddb7ff 0%, #0566d9 100%);
  }
  .ai-glow {
    box-shadow: 0 0 20px 2px rgba(221, 183, 255, 0.15);
  }
`;

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const platforms = [
  {
    id: 'tiktok',
    name: 'TikTok',
    description: 'Audiencia joven y contenido vertical de alto impacto.',
    icon: 'music_note',
    iconColor: 'text-[#FE2C55]',
    badge: { label: 'Trending', className: 'bg-primary/10 text-primary' },
    borderColor: 'group-hover:border-primary/50',
    buttonVariant: 'default',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Optimización de video largo y Shorts con IA avanzada.',
    icon: 'smart_display',
    iconColor: 'text-[#FF0000]',
    badge: null,
    borderColor: 'group-hover:border-[#FF0000]/50',
    buttonVariant: 'default',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Marketing B2B y automatización de red profesional.',
    icon: 'group_add',
    iconColor: 'text-[#0077B5]',
    badge: { label: 'Recomendado', className: 'bg-secondary/10 text-secondary' },
    borderColor: 'group-hover:border-primary/60',
    buttonVariant: 'gradient',
    highlighted: true,
  },
  {
    id: 'facebook',
    name: 'Facebook',
    description: 'Gestión de páginas corporativas y audiencias globales.',
    icon: 'face_nod',
    iconColor: 'text-[#1877F2]',
    badge: null,
    borderColor: 'group-hover:border-[#1877F2]/50',
    buttonVariant: 'default',
    metaGroup: true,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Contenido visual, Reels y Stories con automatización inteligente.',
    icon: 'photo_camera',
    iconColor: 'text-[#E4405F]',
    badge: null,
    borderColor: 'group-hover:border-[#E4405F]/50',
    buttonVariant: 'default',
    metaGroup: true,
  },
  {
    id: 'threads',
    name: 'Threads',
    description: 'Conversaciones en tiempo real y tendencias culturales.',
    icon: 'chat',
    iconColor: 'text-[#000000]',
    badge: null,
    borderColor: 'group-hover:border-[#000000]/50',
    buttonVariant: 'default',
    metaGroup: true,
  },
  {
    id: 'twitter',
    name: 'X (Twitter)',
    description: 'Microblogging, tendencias en vivo y engagement público.',
    icon: 'alternate_email',
    iconColor: 'text-[#000000]',
    badge: null,
    borderColor: 'group-hover:border-[#000000]/50',
    buttonVariant: 'default',
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    description: 'Descubrimiento visual y marketing de intención.',
    icon: 'push_pin',
    iconColor: 'text-[#E60023]',
    badge: null,
    borderColor: 'group-hover:border-[#E60023]/50',
    buttonVariant: 'default',
  },
];

export default function ConnectNetworkPage() {
  const navigate = useNavigate();
  const { user, session } = useAuth();

  const handleMetaConnect = () => {
    const META_APP_ID = import.meta.env.VITE_META_APP_ID;
    const REDIRECT_URI = import.meta.env.VITE_META_CALLBACK_URL || `${APP_ORIGIN}/oauth/meta/callback`;
    const state = session?.access_token || user?.id;
    const scopes = [
      'pages_show_list', 'pages_read_engagement', 'pages_manage_posts',
      'instagram_basic', 'instagram_content_publish',
      'threads_basic', 'threads_content_publish',
    ].join(',');

    const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(scopes)}&response_type=code`;
    window.location.href = url;
  };

  const handleXConnect = async () => {
    const X_CLIENT_ID = import.meta.env.VITE_X_CLIENT_ID;
    const REDIRECT_URI = import.meta.env.VITE_X_CALLBACK_URL || `${APP_ORIGIN}/oauth/x/callback`;
    const scopes = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'].join(' ');

    const codeVerifier = generateRandomString(64);
    const codeChallenge = await sha256(codeVerifier);
    const state = JSON.stringify({ user_id: user?.id, code_verifier: codeVerifier });

    sessionStorage.setItem('x_code_verifier', codeVerifier);

    const url = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${X_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    window.location.href = url;
  };

  const handleConnect = (p) => {
    if (p.metaGroup) return handleMetaConnect();
    if (p.id === 'twitter') return handleXConnect();
  };

  return (
    <div className="min-h-screen overflow-hidden bg-background text-on-background font-body-md selection:bg-primary/30">
      <style>{glassPanelStyle}</style>

      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[#0A0A0A]">
          <div className="hidden md:flex flex-col h-full w-64 bg-surface-container-low border-r border-white/5 p-base gap-4">
            <div className="p-4 flex items-center gap-3">
              <span className="font-headline-lg text-headline-lg font-bold text-primary/40">Aura</span>
            </div>
            <div className="space-y-2 mt-8">
              <div className="h-10 w-full bg-white/5 rounded-lg"></div>
              <div className="h-10 w-full bg-primary/10 rounded-lg"></div>
              <div className="h-10 w-full bg-white/5 rounded-lg"></div>
            </div>
          </div>
          <div className="absolute top-0 left-0 md:left-64 right-0 bottom-0 p-margin-desktop">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
              <div className="h-48 bg-surface-container-highest/20 rounded-xl border border-white/5"></div>
              <div className="h-48 bg-surface-container-highest/20 rounded-xl border border-white/5"></div>
              <div className="h-48 bg-surface-container-highest/20 rounded-xl border border-white/5"></div>
              <div className="col-span-1 md:col-span-2 h-96 bg-surface-container-highest/20 rounded-xl border border-white/5"></div>
              <div className="h-96 bg-surface-container-highest/20 rounded-xl border border-white/5"></div>
            </div>
          </div>
        </div>
        <div className="absolute inset-0 backdrop-blur-[12px] bg-black/60 z-10 transition-opacity duration-500"></div>
      </div>

      <div className="relative z-20 min-h-screen flex items-center justify-center p-margin-mobile md:p-margin-desktop overflow-y-auto">
        <div className="glass-panel w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl ai-glow transform transition-all duration-300 scale-100 opacity-100">
          <header className="relative px-8 py-6 border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div>
                <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface">Conectar Nueva Red</h1>
                <p className="text-on-surface-variant font-body-md mt-1 opacity-70">Expande tu ecosistema de marketing digital</p>
              </div>
            </div>
            <button
              aria-label="Cerrar modal"
              onClick={() => navigate('/app/connections')}
              className="absolute top-6 right-8 text-on-surface-variant hover:text-primary transition-colors focus:outline-none"
            >
              <MaterialIcon icon="close" size="text-[32px]" />
            </button>
          </header>

          <div className="px-8 pt-8">
            <div className="group relative flex items-center bg-[#050505] border border-white/10 rounded-xl px-4 py-3 transition-all">
              <MaterialIcon icon="search" className="text-on-surface-variant group-focus-within:text-secondary" />
              <input
                type="text"
                placeholder="Buscar plataformas (ej. Instagram, X, TikTok...)"
                className="bg-transparent border-none focus:ring-0 w-full text-on-surface font-body-md placeholder:text-on-surface-variant/40 px-3 outline-none"
              />
            </div>
          </div>

          <div className="px-8 py-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {platforms.map((p) => (
                <div
                  key={p.id}
                  className={`glass-card-custom p-6 rounded-2xl flex flex-col group ${p.highlighted ? 'ring-1 ring-primary/20' : ''}`}
                >
                  <div className="flex items-center justify-between mb-6">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-black border border-white/10 ${p.borderColor} transition-colors`}>
                      <MaterialIcon icon={p.icon} className={p.iconColor} size="text-[28px]" fill />
                    </div>
                    {p.badge && (
                      <span className={`text-[10px] uppercase tracking-widest font-label-sm px-2 py-1 rounded-full ${p.badge.className}`}>
                        {p.badge.label}
                      </span>
                    )}
                  </div>
                  <h3 className="font-headline-lg text-[20px] mb-1">{p.name}</h3>
                  <p className="text-on-surface-variant font-body-md text-[14px] mb-2 opacity-60">{p.description}</p>

                  {p.metaGroup && (
                    <span className="text-[10px] uppercase tracking-widest font-label-sm text-[#1877F2]/60 mb-4">
                      Parte de Meta / Instagram
                    </span>
                  )}

                  <div className="mt-auto">
                    {p.buttonVariant === 'gradient' ? (
                      <button
                        onClick={() => handleConnect(p)}
                        className="w-full py-2.5 rounded-lg primary-gradient font-label-sm text-on-primary-container font-bold hover:opacity-90 transition-all active:scale-[0.98] shadow-lg shadow-primary/20"
                      >
                        {p.metaGroup ? 'Conectar con Meta' : p.id === 'twitter' ? 'Conectar con X' : 'Conectar Ahora'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnect(p)}
                        className="w-full py-2.5 rounded-lg border border-white/10 font-label-sm text-on-surface hover:bg-white/10 hover:border-white/20 transition-all active:scale-[0.98]"
                      >
                        {p.metaGroup ? 'Conectar con Meta' : p.id === 'twitter' ? 'Conectar con X' : 'Conectar'}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <div className="glass-card-custom p-6 rounded-2xl flex flex-col items-center justify-center border-dashed border-white/20 group cursor-pointer hover:bg-primary/5">
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-white/5 mb-4 group-hover:scale-110 transition-transform">
                  <MaterialIcon icon="add" className="text-on-surface-variant" />
                </div>
                <span className="font-label-sm uppercase tracking-widest text-on-surface-variant opacity-60">Solicitar Red</span>
              </div>
            </div>
          </div>

          <footer className="px-8 py-6 bg-white/5 border-t border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-on-surface-variant/60 font-body-md text-xs">
              <MaterialIcon icon="verified_user" size="text-sm" />
              <span>Conexión segura vía OAuth 2.0. Aura nunca almacena tus contraseñas.</span>
            </div>
            <div className="flex gap-4">
              <button className="text-on-surface-variant font-label-sm hover:text-on-surface transition-colors">Ver tutorial</button>
              <button className="text-secondary font-label-sm hover:underline">Soporte técnico</button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
