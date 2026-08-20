import { useState } from 'react';
import { supabase } from '../lib/supabase';
import MaterialIcon from '../components/MaterialIcon';

/**
 * Modal de alta de usuario, montado dentro de UsersPage (`/admin/users`).
 * Hasta admin-user-management Group 3 esto era una página completa en
 * `/admin/register-user` con un fondo simulado (maqueta blureada de sidebar
 * y tarjetas) para aparentar estar sobre el panel. Ahora se monta como modal
 * real sobre la lista, así que ese fondo ya no hace falta (design.md D6).
 *
 * onClose: cierra el modal sin recargar nada.
 * onCreated: se llama tras un alta exitosa, ANTES de cerrar, para que el
 *   padre (UsersPage) refresque el listado desde el servidor. No navega a
 *   ninguna ruta (esa responsabilidad era de `/admin`, que ahora es del
 *   change hermano admin-dashboard-metrics).
 */
export default function RegisterUser({ onClose, onCreated }) {
  const [formData, setFormData] = useState({
    name: '',
    company: '',
    email: '',
    password: '********',
    telegram: '',
    role: 'user',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [btnText, setBtnText] = useState('Crear Usuario');
  const [errorMsg, setErrorMsg] = useState(null);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setBtnText('Creando usuario...');
    setErrorMsg(null);

    try {
      const { data: funcResult, error: funcError } = await supabase.functions.invoke('create-user', {
        body: {
          email: formData.email,
          password: formData.password,
          full_name: formData.name,
          company: formData.company,
          telegram: formData.telegram || null,
          role: formData.role,
        },
      });

      if (funcError) throw funcError;
      if (!funcResult.success) throw new Error(funcResult.error || 'Error al crear el usuario');

      setLoading(false);
      setSuccess(true);
      setBtnText('Usuario Creado');

      onCreated?.();

      setTimeout(() => {
        onClose?.();
      }, 1200);
    } catch (err) {
      console.error('Error al registrar usuario:', err.message);
      setErrorMsg(err.message || 'Error al crear el usuario.');
      setLoading(false);
      setBtnText('Crear Usuario');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="register-user-title"
    >
      <div
        className="w-full max-w-lg rounded-xl overflow-hidden shadow-2xl transition-all duration-300 scale-100 opacity-100 max-h-[90vh] overflow-y-auto"
        style={{
          background: 'rgba(26, 26, 26, 0.7)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 0 15px rgba(221, 183, 255, 0.2)',
        }}
      >
        <div className="p-8 pb-4 relative">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-[1px] bg-outline-variant"></div>
              <span className="font-label-sm text-label-sm text-primary uppercase tracking-widest">Configuración</span>
            </div>
            <button
              onClick={() => onClose?.()}
              className="text-on-surface-variant hover:text-on-surface transition-colors"
              aria-label="Cerrar"
            >
              <MaterialIcon icon="close" />
            </button>
          </div>
          <h1 id="register-user-title" className="font-headline-lg text-headline-lg text-on-surface mb-2">Registrar Nuevo Usuario</h1>
          <p className="text-on-surface-variant">Asigna credenciales y permisos para un nuevo miembro del equipo.</p>
        </div>

        <form className="p-8 pt-4 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="group">
              <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1.5 group-focus-within:text-primary transition-colors" htmlFor="name">
                Nombre Completo
              </label>
              <div className="relative">
                <input
                  id="name"
                  name="name"
                  type="text"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Ej. Alex Martínez"
                  className="w-full bg-surface-container-lowest border-outline-variant rounded-lg px-4 py-3 text-on-surface focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-surface-variant transition-all outline-none"
                />
                <MaterialIcon icon="person" className="absolute right-4 top-1/2 -translate-y-1/2 text-surface-variant pointer-events-none group-focus-within:text-primary" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="group">
                <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1.5 group-focus-within:text-primary transition-colors" htmlFor="company">
                  Empresa
                </label>
                <input
                  id="company"
                  name="company"
                  type="text"
                  value={formData.company}
                  onChange={handleChange}
                  placeholder="Aura AI"
                  className="w-full bg-surface-container-lowest border-outline-variant rounded-lg px-4 py-3 text-on-surface focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-surface-variant transition-all outline-none"
                />
              </div>
              <div className="group">
                <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1.5 group-focus-within:text-primary transition-colors" htmlFor="email">
                  Correo Electrónico
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="alex@empresa.com"
                  className="w-full bg-surface-container-lowest border-outline-variant rounded-lg px-4 py-3 text-on-surface focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-surface-variant transition-all outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="group">
                <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1.5 group-focus-within:text-primary transition-colors" htmlFor="password">
                  Contraseña Temporal
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={handleChange}
                    className="w-full bg-surface-container-lowest border-outline-variant rounded-lg px-4 py-3 text-on-surface focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-surface-variant transition-all outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-surface-variant hover:text-on-surface transition-colors"
                  >
                    <MaterialIcon icon={showPassword ? 'visibility_off' : 'visibility'} />
                  </button>
                </div>
              </div>
              <div className="group">
                <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1.5 group-focus-within:text-primary transition-colors" htmlFor="telegram">
                  ID de Chat de Telegram
                </label>
                <div className="relative">
                  <input
                    id="telegram"
                    name="telegram"
                    type="text"
                    value={formData.telegram}
                    onChange={handleChange}
                    placeholder="@usuario_id"
                    className="w-full bg-surface-container-lowest border-outline-variant rounded-lg px-4 py-3 text-on-surface focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-surface-variant transition-all outline-none"
                  />
                  <MaterialIcon icon="send" className="absolute right-4 top-1/2 -translate-y-1/2 text-surface-variant pointer-events-none" />
                </div>
              </div>
            </div>

            <div>
              <span className="block font-label-sm text-label-sm text-on-surface-variant mb-3">Rol del Usuario</span>
              <div className="flex gap-4">
                <label className="flex-1 cursor-pointer">
                  <input
                    type="radio"
                    name="role"
                    value="user"
                    checked={formData.role === 'user'}
                    onChange={handleChange}
                    className="hidden peer"
                  />
                  <div className="flex items-center justify-center gap-3 p-4 border border-outline-variant rounded-xl peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:text-primary hover:bg-white/5 transition-all">
                    <MaterialIcon icon="person" />
                    <span className="font-bold">User</span>
                  </div>
                </label>
                <label className="flex-1 cursor-pointer">
                  <input
                    type="radio"
                    name="role"
                    value="admin"
                    checked={formData.role === 'admin'}
                    onChange={handleChange}
                    className="hidden peer"
                  />
                  <div className="flex items-center justify-center gap-3 p-4 border border-outline-variant rounded-xl peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:text-primary hover:bg-white/5 transition-all">
                    <MaterialIcon icon="verified_user" />
                    <span className="font-bold">Admin</span>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-error/10 border border-error/20 text-error font-body-md text-sm flex items-center gap-2">
              <MaterialIcon icon="error" className="text-[18px]" />
              {errorMsg}
            </div>
          )}
          <div className="flex items-center justify-end gap-4 pt-4 border-t border-white/10 mt-2">
            <button
              type="button"
              onClick={() => onClose?.()}
              className="px-6 py-3 text-on-surface-variant font-bold hover:text-on-surface transition-colors active:scale-95"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || success}
              className={`px-8 py-3 rounded-lg text-on-primary font-bold shadow-lg shadow-primary/20 hover:brightness-110 active:scale-95 transition-all flex items-center gap-2 group ${
                success ? 'bg-green-500' : 'bg-gradient-to-r from-[#ddb7ff] to-[#0566d9]'
              } disabled:opacity-70 disabled:cursor-not-allowed`}
            >
              {loading && (
                <MaterialIcon icon="autorenew" className="animate-spin text-[20px]" />
              )}
              {success && (
                <MaterialIcon icon="check_circle" className="text-[20px]" />
              )}
              {!loading && !success && (
                <MaterialIcon icon="arrow_forward" className="text-[20px] group-hover:translate-x-1 transition-transform" />
              )}
              {btnText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
