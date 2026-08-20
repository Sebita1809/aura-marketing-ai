import { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import GlassCard from '../components/GlassCard';
import GradientButton from '../components/GradientButton';
import MaterialIcon from '../components/MaterialIcon';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// user-panel-features, Grupo 7 (campos simples, design.md D8) + Grupo 8
// (credenciales, Gate 0.B — APROBADO por el usuario 2026-08-18). Dos bloques
// visualmente separados a propósito: guardar nombre/empresa es una escritura
// idempotente y reversible; cambiar email/contraseña dispara un flujo de
// Supabase Auth con estado intermedio y no debe poder confundirse con "un
// campo más de un formulario" (D8).

const ROLE_LABEL = { admin: 'Administrador', user: 'Usuario' };
const STATUS_LABEL = { active: 'Activa', blocked: 'Bloqueada', deactivated: 'Dada de baja' };

function Field({ label, value }) {
  return (
    <div>
      <p className="font-label-sm text-on-surface-variant uppercase tracking-wider text-[10px] mb-1">{label}</p>
      <p className="font-body-md text-on-surface">{value ?? '—'}</p>
    </div>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();

  // --- Datos de la cuenta (MEDIUM, autónomo) ---
  const [row, setRow] = useState(null);
  const [rowLoading, setRowLoading] = useState(true);
  const [rowError, setRowError] = useState(null);
  const [fullName, setFullName] = useState('');
  const [company, setCompany] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const loadRow = useCallback(async () => {
    if (!user?.id) return;
    setRowLoading(true);
    setRowError(null);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, company, role, status, created_at, telegram_chat_id')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      setRow(data);
      setFullName(data.full_name || '');
      setCompany(data.company || '');
    } catch (err) {
      console.error('Error al cargar el perfil:', err.message);
      setRowError('No se pudo cargar tu perfil. Intentá de nuevo más tarde.');
    } finally {
      setRowLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadRow();
  }, [loadRow]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);
    if (!fullName.trim()) {
      setSaveError('El nombre no puede estar vacío.');
      return;
    }
    if (fullName.length > 200 || company.length > 200) {
      setSaveError('El nombre y la empresa no pueden superar los 200 caracteres.');
      return;
    }
    setSaving(true);
    try {
      // Update acotado a la fila propia por RLS; acotado a estas dos
      // columnas por el GRANT de columna (Gate 0.A) — role/status/
      // telegram_chat_id/email no son escribibles desde acá aunque se
      // intente. No dispara ningún cambio de email/contraseña (tasks.md 7.7).
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim(), company: company.trim() || null })
        .eq('id', user.id);
      if (error) throw error;
      setRow((r) => ({ ...r, full_name: fullName.trim(), company: company.trim() || null }));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Error al guardar el perfil:', err.message);
      // El formulario conserva lo ingresado (tasks.md 7.5); no se afirma éxito.
      setSaveError('No se pudo guardar. Tus cambios no se perdieron, intentá de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  // --- Acceso y seguridad (HIGH, Gate 0.B aprobado) ---
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    if (pwNew.length < 8) {
      setPwError('La contraseña nueva debe tener al menos 8 caracteres.');
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError('Las contraseñas nuevas no coinciden.');
      return;
    }
    setPwSaving(true);
    try {
      // Exige la contraseña ACTUAL aunque la sesión ya esté autenticada
      // (design.md D8): una sesión abierta y desatendida no alcanza para
      // secuestrar la cuenta. signInWithPassword revalida contra Auth.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: pwCurrent,
      });
      if (reauthError) {
        setPwError('La contraseña actual no es correcta.');
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: pwNew });
      if (updateError) throw updateError;
      setPwSuccess(true);
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
    } catch (err) {
      console.error('Error al cambiar la contraseña:', err.message);
      // Mensaje genérico: no filtra el motivo exacto del rechazo de Auth (tasks.md 8.5).
      setPwError('No se pudo cambiar la contraseña. Intentá de nuevo.');
    } finally {
      setPwSaving(false);
    }
  };

  const [newEmail, setNewEmail] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState(null);
  const [emailPending, setEmailPending] = useState(false);

  const handleEmailChange = async (e) => {
    e.preventDefault();
    setEmailError(null);
    if (!newEmail.trim() || newEmail.trim() === user.email) {
      setEmailError('Ingresá un email distinto al actual.');
      return;
    }
    setEmailSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (error) throw error;
      // El email vigente sigue siendo el actual hasta que se confirme (uno o
      // los dos links, según "Secure email change" del proyecto — 0.5,
      // chequeo manual pendiente). NUNCA se afirma que ya cambió.
      setEmailPending(true);
      setNewEmail('');
    } catch (err) {
      console.error('Error al solicitar el cambio de email:', err.message);
      setEmailError('No se pudo solicitar el cambio de email. Intentá de nuevo.');
    } finally {
      setEmailSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-dim text-on-surface">
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
              <span className="text-primary">Perfil</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full overflow-hidden border border-white/10 cursor-pointer active:scale-95 transition-all">
              <MaterialIcon icon="account_circle" size="text-[32px]" />
            </div>
          </div>
        </header>

        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 relative z-10 max-w-3xl">
          <h2 className="font-display-lg text-display-lg text-on-surface mb-8">Tu perfil</h2>

          {rowError && (
            <section className="p-6 glass-card rounded-xl border-l-4 border-l-error mb-8">
              <p className="font-body-md text-error font-bold mb-1">Error</p>
              <p className="font-body-md text-on-surface-variant">{rowError}</p>
              <button onClick={loadRow} className="mt-3 text-primary font-bold font-label-sm hover:underline">
                Intentar de nuevo
              </button>
            </section>
          )}

          {/* Bloque 1: Datos de la cuenta */}
          <GlassCard className="p-6 mb-8" hover={false}>
            <h3 className="font-bold text-lg mb-5 flex items-center gap-2">
              <MaterialIcon icon="badge" className="text-primary" />
              Datos de la cuenta
            </h3>

            {rowLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg bg-surface-container-highest animate-pulse" />)}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-5 mb-6">
                  <Field label="Email" value={user?.email} />
                  <Field label="Rol" value={ROLE_LABEL[row?.role] || row?.role} />
                  <Field label="Estado de la cuenta" value={STATUS_LABEL[row?.status] || row?.status} />
                  <Field label="Alta" value={row?.created_at ? new Date(row.created_at).toLocaleDateString('es-AR') : null} />
                  <Field
                    label="Telegram"
                    value={
                      row?.telegram_chat_id ? (
                        <span className="text-primary font-bold flex items-center gap-1">
                          <MaterialIcon icon="check_circle" size="text-sm" /> Vinculado
                        </span>
                      ) : (
                        <a href="/app/connections" className="text-primary hover:underline">Vincular en Conexiones →</a>
                      )
                    }
                  />
                </div>

                <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/5">
                  <div>
                    <label className="font-label-sm text-on-surface-variant block mb-1">Nombre completo</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      maxLength={200}
                      className="w-full px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all"
                    />
                  </div>
                  <div>
                    <label className="font-label-sm text-on-surface-variant block mb-1">Empresa</label>
                    <input
                      type="text"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      maxLength={200}
                      className="w-full px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all"
                    />
                  </div>
                  <div className="md:col-span-2 flex items-center gap-3">
                    <GradientButton type="submit" loading={saving} className="py-3 px-6">Guardar</GradientButton>
                    {saved && <span className="text-primary font-label-sm flex items-center gap-1"><MaterialIcon icon="check_circle" size="text-sm" /> Guardado</span>}
                    {saveError && <span className="text-error font-label-sm">{saveError}</span>}
                  </div>
                </form>
              </>
            )}
          </GlassCard>

          {/* Bloque 2: Acceso y seguridad (HIGH — Gate 0.B aprobado 2026-08-18) */}
          <GlassCard className="p-6" hover={false}>
            <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
              <MaterialIcon icon="lock" className="text-primary" />
              Acceso y seguridad
            </h3>
            <p className="font-body-sm text-on-surface-variant mb-5">
              Cambiar tu contraseña es inmediato. Cambiar tu email requiere confirmación por correo y puede tardar unos minutos en aplicarse.
            </p>

            <form onSubmit={handlePasswordChange} className="space-y-3 pb-6 mb-6 border-b border-white/5">
              <h4 className="font-bold text-sm text-on-surface-variant">Cambiar contraseña</h4>
              <input
                type="password"
                placeholder="Contraseña actual"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all"
                autoComplete="current-password"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="password"
                  placeholder="Contraseña nueva"
                  value={pwNew}
                  onChange={(e) => setPwNew(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all"
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  placeholder="Confirmar contraseña nueva"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all"
                  autoComplete="new-password"
                />
              </div>
              <div className="flex items-center gap-3">
                <GradientButton type="submit" loading={pwSaving} className="py-2.5 px-5 text-sm">Cambiar contraseña</GradientButton>
                {pwSuccess && <span className="text-primary font-label-sm flex items-center gap-1"><MaterialIcon icon="check_circle" size="text-sm" /> Contraseña actualizada</span>}
                {pwError && <span className="text-error font-label-sm">{pwError}</span>}
              </div>
            </form>

            <form onSubmit={handleEmailChange} className="space-y-3">
              <h4 className="font-bold text-sm text-on-surface-variant">Cambiar email</h4>
              {emailPending && (
                <div className="p-3 rounded-lg bg-amber-400/10 border border-amber-400/20 flex items-start gap-2">
                  <MaterialIcon icon="mail" className="text-amber-400 mt-0.5" size="text-sm" />
                  <p className="font-body-sm text-on-surface-variant">
                    Te enviamos un correo de confirmación. Tu email de acceso sigue siendo <strong>{user?.email}</strong> hasta que confirmes el cambio — revisá tu casilla (y, según la configuración de seguridad, también la casilla vieja).
                  </p>
                </div>
              )}
              <div className="flex flex-col md:flex-row gap-3">
                <input
                  type="email"
                  placeholder="Nuevo email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="flex-1 px-4 py-3 rounded-xl bg-surface-container-highest border border-white/10 outline-none focus:border-primary transition-all"
                  autoComplete="email"
                />
                <GradientButton type="submit" loading={emailSaving} className="py-3 px-5 text-sm shrink-0">Solicitar cambio</GradientButton>
              </div>
              {emailError && <span className="text-error font-label-sm block">{emailError}</span>}
            </form>
          </GlassCard>
        </div>
      </main>
    </div>
  );
}
