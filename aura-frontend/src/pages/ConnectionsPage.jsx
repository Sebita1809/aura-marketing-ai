import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import GlassCard from '../components/GlassCard';
import ExpiryBanner from '../components/ExpiryBanner';
import GradientButton from '../components/GradientButton';
import MaterialIcon from '../components/MaterialIcon';
import Avatar from '../components/Avatar';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const pulseActiveStyle = `
  @keyframes pulse-active {
    0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(221, 183, 255, 0.4); }
    70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(221, 183, 255, 0); }
    100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(221, 183, 255, 0); }
  }
  .pulse-active {
    animation: pulse-active 2s infinite;
  }
`;
const META_APP_ID = import.meta.env.VITE_META_APP_ID;
const X_CLIENT_ID = import.meta.env.VITE_X_CLIENT_ID;
const APP_ORIGIN = window.location.origin;
const META_CALLBACK_URL = import.meta.env.VITE_META_CALLBACK_URL || `${APP_ORIGIN}/oauth/meta/callback`;
const X_CALLBACK_URL = import.meta.env.VITE_X_CALLBACK_URL || `${APP_ORIGIN}/oauth/x/callback`;
const TELEGRAM_BOT = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'tu_bot';

const platformGroups = [
  {
    groupName: 'Meta / Instagram',
    groupIcon: 'photo_camera',
    bgGradient: 'bg-gradient-to-br from-[#833ab4] via-[#fd1d1d] to-[#fcb045]',
    platforms: [
      {
        id: 'instagram',
        name: 'Instagram',
        tagline: 'Visual Marketing',
        icon: 'photo_camera',
        bgGradient: 'bg-gradient-to-br from-[#833ab4] via-[#fd1d1d] to-[#fcb045]',
        iconColor: 'text-white',
      },
      {
        id: 'facebook',
        name: 'Facebook Page',
        tagline: 'Community Hub',
        icon: 'groups',
        bgColor: 'bg-[#1877F2]',
        iconColor: 'text-white',
        shadowColor: 'shadow-secondary-container/20',
      },
      {
        id: 'threads',
        name: 'Threads',
        tagline: 'Microblogging',
        icon: 'chat',
        bgColor: 'bg-[#101010]',
        iconColor: 'text-white',
      },
    ],
  },
  {
    groupName: 'X / Twitter',
    groupIcon: 'alternate_email',
    bgColor: 'bg-on-background',
    platforms: [
      {
        id: 'twitter',
        name: 'X / Twitter',
        tagline: 'Real-time Feed',
        icon: 'alternate_email',
        bgColor: 'bg-on-background',
        iconColor: 'text-background',
        isX: true,
      },
    ],
  },
];

const linkedin = {
  id: 'linkedin',
  name: 'LinkedIn',
  tagline: 'Professional Network',
  icon: 'work',
  bgColor: 'bg-[#0077b5]',
  iconColor: 'text-white',
};

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default function ConnectionsPage() {
  const navigate = useNavigate();
  const [loadingId, setLoadingId] = useState(null);
  const { user, session, profile } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [toast, setToast] = useState(null);
  const [dismissedBanner, setDismissedBanner] = useState(false);
  const [showEnvHint, setShowEnvHint] = useState(!localStorage.getItem('oauth_env_hint_dismissed'));
  const bannerRef = useRef(null);

  // Telegram link state
  const [telegramLinkState, setTelegramLinkState] = useState('idle'); // 'idle' | 'entering_code' | 'verifying' | 'disconnecting'
  const [telegramCode, setTelegramCode] = useState('');
  const [telegramCodeError, setTelegramCodeError] = useState(null);
  const [telegramChatId, setTelegramChatId] = useState(null);

  // Accordion state - all expanded by default
  const [expandedGroups, setExpandedGroups] = useState({ 'Meta / Instagram': true, 'X / Twitter': true, 'Telegram Bot': true });
  const toggleGroup = (name) => setExpandedGroups(prev => ({ ...prev, [name]: !prev[name] }));
  const userName = profile?.company || profile?.full_name || 'Usuario';

  const loadAccounts = useCallback(async () => {
    if (!user?.id) return;
    setDataLoading(true);
    setDataError(null);
    try {
      const { data, error } = await supabase
        .from('social_accounts')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;
      setAccounts(data || []);
    } catch (err) {
      console.error('Error al cargar cuentas:', err.message);
      setDataError('No se pudieron cargar las conexiones. Intentá de nuevo más tarde.');
    } finally {
      setDataLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const params = new URLSearchParams(window.location.search);
    const oauthStatus = params.get('oauth');
    const oauthMessage = params.get('message');

    if (oauthStatus === 'success') {
      setToast({ type: 'success', message: 'Cuenta conectada exitosamente' });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (oauthStatus === 'error') {
      setToast({ type: 'error', message: oauthMessage || 'Error al conectar la cuenta' });
      window.history.replaceState({}, '', window.location.pathname);
    }

    loadAccounts();
  }, [user?.id, loadAccounts]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    if (!user?.id) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadAccounts();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user?.id, loadAccounts]);

  // Load telegram_chat_id from profiles on mount
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', user.id)
      .single()
      .then(({ data }) => { if (data?.telegram_chat_id) setTelegramChatId(data.telegram_chat_id); });
  }, [user?.id]);


  const platformMap = useMemo(() => {
    const map = {};
    platformGroups.forEach(g => g.platforms.forEach(p => { map[p.id] = p; }));
    map[linkedin.id] = linkedin;
    return map;
  }, []);

  const _now = Date.now();
  const _dayAgo = _now - 86400000;

  const recentlyExpired = accounts.filter(acc =>
    !acc.is_connected &&
    acc.token_expires_at &&
    new Date(acc.token_expires_at).getTime() < _now &&
    new Date(acc.token_expires_at).getTime() >= _dayAgo
  );

  const expiredCount = accounts.filter(acc =>
    !acc.is_connected &&
    acc.token_expires_at &&
    new Date(acc.token_expires_at).getTime() < _now
  ).length;

  const expiredBannerPlatforms = recentlyExpired.map(acc => ({
    platform: acc.platform,
    platformDef: platformMap[acc.platform],
    account_name: acc.account_name || acc.account_id,
  }));

  const getAccountStatus = (platform) => {
    const account = accounts.find(a => a.platform === platform);
    if (!account) {
      return {
        label: 'Sin configurar',
        color: 'bg-on-surface-variant',
        textColor: 'text-on-surface-variant',
        bg: 'bg-on-surface-variant/10',
        border: 'border-white/5',
        buttonType: 'connect',
        account: null,
      };
    }
    if (account.is_connected) {
      if (account.token_expires_at) {
        const expiresAt = new Date(account.token_expires_at);
        const now = new Date();
        const diffMs = expiresAt - now;
        const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (daysUntilExpiry <= 0) {
          return {
            label: 'Token expirado',
            color: 'bg-error',
            textColor: 'text-error',
            bg: 'bg-error/10',
            border: 'border-error/20',
            buttonType: 'connect',
            handle: account.account_name || account.account_id,
            account,
          };
        }
        if (daysUntilExpiry <= 7) {
          return {
            label: 'Por expirar',
            color: 'bg-amber-400',
            textColor: 'text-amber-400',
            bg: 'bg-amber-400/10',
            border: 'border-amber-400/20',
            buttonType: 'revoke',
            handle: account.account_name || account.account_id,
            account,
          };
        }
      }
      return {
        label: 'Conectado',
        color: 'bg-primary pulse-active',
        textColor: 'text-primary',
        bg: 'bg-primary/10',
        border: 'border-primary/30',
        buttonType: 'revoke',
        handle: account.account_name || account.account_id,
        account,
      };
    }
    return {
      label: 'Desconectado',
      color: 'bg-error',
      textColor: 'text-error',
      bg: 'bg-error/10',
      border: 'border-error/20',
      buttonType: 'connect',
      account,
    };
  };

  const handleConnect = async (platformId, platformDef) => {
    setLoadingId(platformId);

    if (platformDef.isX) {
      try {
        const verifier = generateCodeVerifier();
        const challenge = await generateCodeChallenge(verifier);
        sessionStorage.setItem('x_pkce_verifier', verifier);
        const statePayload = encodeURIComponent(JSON.stringify({ user_id: user.id, code_verifier: verifier }));
        const xUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${X_CLIENT_ID}&redirect_uri=${encodeURIComponent(X_CALLBACK_URL)}&state=${statePayload}&code_challenge=${challenge}&code_challenge_method=S256&scope=tweet.read%20tweet.write%20users.read%20offline.access`;
        window.location.href = xUrl;
      } catch (err) {
        console.error('Error al iniciar OAuth de X:', err);
        setDataError('Error al iniciar la conexión con X.');
        setLoadingId(null);
      }
      return;
    }

    if (platformDef.bgGradient || ['instagram', 'facebook', 'threads'].includes(platformId)) {
      const scope = platformId === 'instagram'
        ? 'instagram_basic,instagram_content_publish'
        : platformId === 'facebook'
        ? 'pages_show_list,pages_read_engagement,pages_manage_posts'
        : 'threads_basic,threads_content_publish';
      const fbUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(META_CALLBACK_URL)}&state=${session?.access_token || user.id}&scope=${scope}&response_type=code`;
      window.location.href = fbUrl;
      return;
    }

    setLoadingId(null);
    setDataError(`La plataforma ${platformDef.name} no está disponible para conectar en este momento.`);
  };

  const handleRevoke = async (platform) => {
    setLoadingId(platform);
    setDataError(null);
    try {
      const account = accounts.find(a => a.platform === platform);
      if (!account) return;

      const { error } = await supabase
        .from('social_accounts')
        .update({ is_connected: false, connected_at: null })
        .eq('id', account.id);
      if (error) throw error;

      const { data, error: fetchError } = await supabase
        .from('social_accounts')
        .select('*')
        .eq('user_id', user.id);
      if (fetchError) throw fetchError;
      setAccounts(data || []);
    } catch (err) {
      console.error('Error al revocar:', err.message);
      setDataError('Error al revocar el acceso. Intentá de nuevo.');
    } finally {
      setLoadingId(null);
      setConfirmRevoke(null);
    }
  };

  const handleBellClick = () => {
    if (expiredCount > 0 && bannerRef.current) {
      bannerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const cancelTelegramLink = useCallback(() => {
    setTelegramCode('');
    setTelegramCodeError(null);
    setTelegramLinkState('idle');
  }, []);

  const handleConnectTelegram = () => {
    setTelegramCode('');
    setTelegramCodeError(null);
    setTelegramLinkState('entering_code');
  };

  const handleVerifyCode = async () => {
    if (telegramCode.length !== 6) {
      setTelegramCodeError('El código debe tener 6 dígitos.');
      return;
    }
    setTelegramLinkState('verifying');
    setTelegramCodeError(null);
    try {
      const { data, error } = await supabase.rpc('link_telegram_with_code', { p_code: telegramCode });
      if (error) throw error;
      if (!data.success) {
        setTelegramCodeError(data.error || 'Código inválido o expirado.');
        setTelegramLinkState('entering_code');
        return;
      }
      setTelegramChatId(data.chat_id);
      setTelegramCode('');
      setTelegramLinkState('idle');
      setToast({ type: 'success', message: '¡Telegram conectado exitosamente!' });
    } catch (err) {
      console.error('Error verificando código:', err);
      setTelegramCodeError('Error al verificar. Intentá de nuevo.');
      setTelegramLinkState('entering_code');
    }
  };

  const handleDisconnectTelegram = async () => {
    setTelegramLinkState('disconnecting');
    try {
      const { error } = await supabase.rpc('disconnect_telegram');
      if (error) throw error;
      setTelegramChatId(null);
      setToast({ type: 'success', message: 'Telegram desvinculado.' });
    } catch (err) {
      console.error('Error desconectando Telegram:', err);
      setToast({ type: 'error', message: 'Error al desvincular. Intentá de nuevo.' });
    } finally {
      setTelegramLinkState('idle');
    }
  };

  const renderTelegramCard = () => {
    const isConnected = !!telegramChatId;
    const isEnteringCode = telegramLinkState === 'entering_code';
    const isVerifying = telegramLinkState === 'verifying';
    const isDisconnecting = telegramLinkState === 'disconnecting';

    return (
      <GlassCard className="p-4 flex flex-col items-center text-center">
        <div className="w-10 h-10 rounded-xl bg-[#229ED9] flex items-center justify-center text-white mb-3 shadow-md shadow-[#229ED9]/20">
          <MaterialIcon icon="send" size="text-xl" />
        </div>
        <h3 className="font-bold text-base mb-0.5">Telegram Bot</h3>
        <p className={`font-label-sm text-on-surface-variant uppercase tracking-widest text-[10px] ${telegramChatId ? 'mb-0.5' : 'mb-3'}`}>Control Center</p>
        {telegramChatId && (
          <p className="font-label-sm text-primary mb-3 flex items-center justify-center gap-1 text-xs">
            <MaterialIcon icon="check_circle" size="text-xs" />
            Chat ID: {telegramChatId}
          </p>
        )}
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full mb-3 ${
          isConnected
            ? 'bg-primary/10 border border-primary/30'
            : 'bg-on-surface-variant/10 border border-white/5'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-primary pulse-active' : 'bg-on-surface-variant'}`} />
          <span className={`${isConnected ? 'text-primary' : 'text-on-surface-variant'} text-[10px] font-bold`}>
            {isConnected ? 'Conectado' : 'Sin configurar'}
          </span>
        </div>

        {(isEnteringCode || isVerifying) ? (
          <div className="flex flex-col gap-3 w-full">
            <div className="text-left space-y-1 mb-1">
              <p className="font-body-sm text-on-surface-variant">
                <span className="font-bold text-on-surface">1.</span> Abrí Telegram y escribile cualquier mensaje a{' '}
                <span className="text-primary font-bold">@{TELEGRAM_BOT}</span>
              </p>
              <p className="font-body-sm text-on-surface-variant">
                <span className="font-bold text-on-surface">2.</span> El bot te va a responder con un código de 6 dígitos.
              </p>
              <p className="font-body-sm text-on-surface-variant">
                <span className="font-bold text-on-surface">3.</span> Ingresá ese código acá:
              </p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={telegramCode}
              onChange={e => {
                setTelegramCode(e.target.value.replace(/\D/g, ''));
                setTelegramCodeError(null);
              }}
              onKeyDown={e => e.key === 'Enter' && handleVerifyCode()}
              disabled={isVerifying}
              className={`w-full py-4 rounded-xl bg-surface-container-highest border text-center font-mono text-2xl font-bold tracking-[0.5em] outline-none transition-all disabled:opacity-60 ${
                telegramCodeError ? 'border-error text-error' : 'border-white/10 text-on-surface focus:border-primary'
              }`}
            />
            {telegramCodeError && (
              <p className="font-label-sm text-error text-left">{telegramCodeError}</p>
            )}
            <GradientButton
              onClick={handleVerifyCode}
              loading={isVerifying}
              className="w-full py-4"
            >
              Verificar código
            </GradientButton>
            <button
              onClick={cancelTelegramLink}
              disabled={isVerifying}
              className="text-on-surface-variant font-label-sm hover:text-on-surface transition-colors disabled:opacity-40"
            >
              Cancelar
            </button>
          </div>
        ) : isConnected ? (
          <button
            onClick={handleDisconnectTelegram}
            disabled={isDisconnecting}
            className="w-full py-4 rounded-xl bg-surface-container-highest border border-white/10 text-on-surface font-bold text-body-md flex items-center justify-center gap-2 hover:bg-error/10 hover:text-error hover:border-error/20 active:scale-95 transition-all disabled:opacity-60"
          >
            {isDisconnecting
              ? <MaterialIcon icon="autorenew" className="animate-spin" />
              : <MaterialIcon icon="link_off" />
            }
            Desvincular
          </button>
        ) : (
          <GradientButton
            onClick={handleConnectTelegram}
            className="w-full py-4"
          >
            <MaterialIcon icon="link" />
            Vincular
          </GradientButton>
        )}
      </GlassCard>
    );
  };

  const renderPlatformCard = (net) => {
    const status = getAccountStatus(net.id);
    return (
      <GlassCard key={net.id} className="p-4 flex flex-col items-center text-center">
        <div className={`w-10 h-10 rounded-xl ${net.bgGradient || ''} ${net.bgColor || ''} flex items-center justify-center ${net.iconColor} mb-3 shadow-md`}>
          <MaterialIcon icon={net.icon} size="text-xl" />
        </div>
        <h3 className="font-bold text-base mb-0.5">{net.name}</h3>
        <p className={`font-label-sm text-on-surface-variant uppercase tracking-widest text-[10px] ${status.handle ? 'mb-0.5' : 'mb-3'}`}>{net.tagline}</p>
        {status.handle && (
          <p className="font-label-sm text-primary mb-3 flex items-center justify-center gap-1 text-xs">
            <MaterialIcon icon="check_circle" size="text-xs" />
            {status.handle}
          </p>
        )}
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full ${status.bg} border ${status.border} mb-3`}>
          {status.label === 'Token expirado' && <MaterialIcon icon="error" size="text-xs" className="text-error" />}
          {status.label === 'Por expirar' && <MaterialIcon icon="warning" size="text-xs" className="text-amber-400" />}
          {status.label !== 'Token expirado' && status.label !== 'Por expirar' && (
            <span className={`w-1.5 h-1.5 rounded-full ${status.color}`} />
          )}
          <span className={`${status.textColor} text-[10px] font-bold`}>{status.label}</span>
        </div>

        {status.buttonType === 'revoke' ? (
          <button
            onClick={() => setConfirmRevoke(net.id)}
            disabled={loadingId === net.id}
            className="w-full py-2.5 px-3 rounded-lg bg-surface-container-highest border border-white/10 text-on-surface font-bold text-sm flex items-center justify-center gap-2 hover:bg-error/10 hover:text-error hover:border-error/20 active:scale-95 transition-all disabled:opacity-60"
          >
            {loadingId === net.id ? (
              <MaterialIcon icon="autorenew" className="animate-spin" size="text-sm" />
            ) : (
              <MaterialIcon icon="link_off" size="text-sm" />
            )}
            Revocar
          </button>
        ) : (
          <GradientButton
            onClick={() => handleConnect(net.id, net)}
            loading={loadingId === net.id}
            className="w-full py-2.5 px-3 text-sm"
          >
            <MaterialIcon icon="link" size="text-sm" />
            {status.label === 'Sin configurar' ? 'Configurar' : 'Conectar'}
          </GradientButton>
        )}
      </GlassCard>
    );
  };

  return (
    <div className="min-h-screen bg-surface-dim text-on-surface">
      <style>{pulseActiveStyle}</style>
      <Sidebar />
      <main className="md:ml-64 min-h-screen overflow-y-auto relative">
        <header className="sticky top-0 z-40 bg-surface-container-lowest/80 backdrop-blur-xl border-b border-white/10 px-margin-mobile md:px-margin-desktop h-16 flex justify-between items-center">
          <div className="md:hidden flex items-center gap-2">
            <button
              onClick={() => document.dispatchEvent(new CustomEvent('open-sidebar'))}
              className="p-1 -ml-1 rounded-lg text-primary hover:bg-white/5 active:scale-95 transition-all"
              aria-label="Abrir menú"
            >
              <MaterialIcon icon="menu" />
            </button>
            <span className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-primary">Aura</span>
          </div>
          <div className="hidden md:block">
            <span className="text-on-surface-variant font-label-sm">
              <span className="text-primary">Conexiones</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={handleBellClick} className="relative w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors">
              <MaterialIcon icon="notifications" />
              {expiredCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-error rounded-full text-[10px] font-bold text-white flex items-center justify-center shadow-lg shadow-error/50">
                  {expiredCount}
                </span>
              )}
            </button>
            <div className="w-10 h-10 rounded-full overflow-hidden border border-white/10 cursor-pointer active:scale-95 transition-all">
              <Avatar avatarKey={profile?.avatar_key} size="text-[22px]" />
            </div>
          </div>
        </header>

        {toast && (
          <div className={`fixed top-4 right-4 z-50 px-6 py-4 rounded-xl shadow-xl backdrop-blur-xl border flex items-center gap-3 transition-all ${
            toast.type === 'success'
              ? 'bg-primary/20 border-primary/30 text-primary'
              : 'bg-error/20 border-error/30 text-error'
          }`}>
            <MaterialIcon icon={toast.type === 'success' ? 'check_circle' : 'error'} fill />
            <span className="font-label-sm font-bold">{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-4 hover:opacity-70">
              <MaterialIcon icon="close" />
            </button>
          </div>
        )}

        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-12 pb-24 sm:pb-12 relative z-10">
          <div ref={bannerRef}>
            {!dismissedBanner && expiredBannerPlatforms.length > 0 && (
              <ExpiryBanner
                expiredPlatforms={expiredBannerPlatforms}
                onDismiss={() => setDismissedBanner(true)}
                onConnect={(platformId) => {
                  const def = platformMap[platformId];
                  if (def) handleConnect(platformId, def);
                }}
              />
            )}
          </div>
          <section className="mb-12">
            <h2 className="font-display-lg text-display-lg text-on-surface mb-4">
              Hola, <span className="text-primary">{userName}</span>
            </h2>
            <div className="flex items-start gap-4 p-6 glass-card rounded-xl border-l-4 border-l-primary max-w-3xl">
              <MaterialIcon icon="info" className="text-primary mt-1" fill />
              <p className="font-body-md text-on-surface-variant leading-relaxed">
                Vincula tus cuentas de redes sociales para que <strong className="text-primary">Aura</strong> pueda publicar automáticamente tus campañas aprobadas desde Telegram. Centraliza tu estrategia digital con el poder de la IA.
              </p>
            </div>
          </section>

          {(!META_APP_ID || !X_CLIENT_ID) && showEnvHint && (
            <section className="p-4 glass-card rounded-xl border-l-4 border-l-amber-400 mb-8 relative">
              <div className="flex items-start gap-3">
                <MaterialIcon icon="info" className="text-amber-400 mt-1" />
                <p className="font-body-md text-on-surface-variant flex-1">
                  Conectá tus redes sociales configurando las credenciales en <code className="bg-surface-container-high px-1 rounded text-xs">.env</code>. 
                  Revisá <a href="/docs/oauth-config.md" className="text-primary hover:underline">docs/oauth-config.md</a> para obtener tus App ID y Client ID.
                </p>
                <button
                  onClick={() => {
                    localStorage.setItem('oauth_env_hint_dismissed', 'true');
                    setShowEnvHint(false);
                  }}
                  className="text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  <MaterialIcon icon="close" />
                </button>
              </div>
            </section>
          )}

          {dataError && (
            <section className="p-6 glass-card rounded-xl border-l-4 border-l-error mb-8">
              <div className="flex items-start gap-3">
                <MaterialIcon icon="error" className="text-error mt-1" />
                <div>
                  <p className="font-body-md text-error font-bold mb-1">Error de conexión</p>
                  <p className="font-body-md text-on-surface-variant">{dataError}</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-3 text-primary font-bold font-label-sm hover:underline"
                  >
                    Intentar de nuevo
                  </button>
                </div>
              </div>
            </section>
          )}

          {dataLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-14 glass-card rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {platformGroups.map((group) => {
                const isOpen = expandedGroups[group.groupName];
                const connectedCount = group.platforms.filter(p => {
                  const acc = accounts.find(a => a.platform === p.id);
                  return acc?.is_connected;
                }).length;
                return (
                  <div key={group.groupName} className="glass-card rounded-2xl overflow-hidden">
                    <button
                      onClick={() => toggleGroup(group.groupName)}
                      className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg ${group.bgGradient || group.bgColor || 'bg-surface-container-high'} flex items-center justify-center text-white shrink-0`}>
                          <MaterialIcon icon={group.groupIcon} size="text-base" />
                        </div>
                        <span className="font-bold text-on-surface text-sm">{group.groupName}</span>
                        {connectedCount > 0 && (
                          <span className="text-[10px] text-primary font-bold bg-primary/10 px-2 py-0.5 rounded-full">
                            {connectedCount} conectado{connectedCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <MaterialIcon
                        icon="expand_more"
                        className={`text-on-surface-variant transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 pt-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 border-t border-white/5">
                        {group.platforms.map(renderPlatformCard)}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Telegram Bot */}
              {(() => {
                const isOpen = expandedGroups['Telegram Bot'];
                return (
                  <div className="glass-card rounded-2xl overflow-hidden">
                    <button
                      onClick={() => toggleGroup('Telegram Bot')}
                      className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#229ED9] flex items-center justify-center text-white shrink-0">
                          <MaterialIcon icon="send" size="text-base" />
                        </div>
                        <span className="font-bold text-on-surface text-sm">Telegram Bot</span>
                        {telegramChatId && (
                          <span className="text-[10px] text-primary font-bold bg-primary/10 px-2 py-0.5 rounded-full">
                            1 conectado
                          </span>
                        )}
                      </div>
                      <MaterialIcon
                        icon="expand_more"
                        className={`text-on-surface-variant transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-2 border-t border-white/5">
                        {renderTelegramCard()}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {confirmRevoke && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="glass-card rounded-2xl p-8 max-w-sm w-full mx-4">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-full bg-error/20 flex items-center justify-center">
                  <MaterialIcon icon="warning" className="text-error" fill />
                </div>
                <h3 className="font-headline-lg text-xl text-on-surface">Revocar acceso</h3>
              </div>
              <p className="font-body-md text-on-surface-variant mb-8">
                ¿Estás seguro de que querés revocar el acceso de esta plataforma? Aura dejará de publicar en ella.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmRevoke(null)}
                  className="flex-1 py-3 rounded-xl bg-surface-container-highest border border-white/10 text-on-surface font-bold font-label-sm hover:brightness-110 active:scale-95 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleRevoke(confirmRevoke)}
                  disabled={loadingId === confirmRevoke}
                  className="flex-1 py-3 rounded-xl bg-error text-on-error font-bold font-label-sm hover:brightness-110 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loadingId === confirmRevoke ? (
                    <MaterialIcon icon="autorenew" className="animate-spin" />
                  ) : (
                    <MaterialIcon icon="link_off" />
                  )}
                  Revocar
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="fixed bottom-4 right-4 sm:bottom-8 sm:right-8 z-40">
          <button
            onClick={() => navigate('/app/connect-network')}
            className="flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 rounded-full bg-primary text-on-primary font-bold shadow-xl hover:scale-105 active:scale-95 transition-all"
          >
            <MaterialIcon icon="add" fill />
            <span className="hidden sm:inline">Nueva Red</span>
          </button>
        </div>
      </main>
    </div>
  );
}
