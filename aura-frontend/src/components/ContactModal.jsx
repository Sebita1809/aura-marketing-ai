import { useEffect, useState } from 'react';
import MaterialIcon from './MaterialIcon';
import { supabase } from '../lib/supabase';
import {
  validateContactPayload,
  NAME_MAX,
  MESSAGE_MAX,
} from '../lib/contactValidation';

// Formulario de contacto de la landing (landing-contact-email, design.md
// Decisión 2/6): antes el submit era un no-op que solo cerraba el modal y
// descartaba el mensaje (tasks.md 5.2). Ahora es un form controlado que
// valida client-side (mismos límites que el server, ver contactValidation.js)
// e invoca la Edge Function send-contact-email -- mismo patrón que
// RegisterUser.jsx (supabase.functions.invoke + estados loading/success/error).

const INITIAL_FORM = { name: '', email: '', message: '', company: '' };

export default function ContactModal({ isOpen, onClose }) {
  const [form, setForm] = useState(INITIAL_FORM);
  // status: 'idle' | 'sending' | 'success' | 'error'
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState(null);
  const [isRateLimited, setIsRateLimited] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  // Al cerrar el modal (no al desmontar el componente, que sigue montado
  // detrás de isOpen=false en Navbar/LandingPage) se resetea todo para que
  // la próxima apertura arranque limpia, salvo que se haya cerrado en medio
  // de un error -- ahí sí se pierde el draft, pero es comportamiento
  // aceptado (spec no pide persistir borradores entre aperturas).
  const handleClose = () => {
    if (status !== 'sending') {
      setStatus('idle');
      setErrorMsg(null);
      setIsRateLimited(false);
    }
    onClose();
  };

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status === 'sending') return;

    const { valid, error } = validateContactPayload(form);
    if (!valid) {
      setStatus('error');
      setErrorMsg(error);
      setIsRateLimited(false);
      return;
    }

    setStatus('sending');
    setErrorMsg(null);
    setIsRateLimited(false);

    try {
      const { data, error: funcError } = await supabase.functions.invoke('send-contact-email', {
        body: {
          name: form.name.trim(),
          email: form.email.trim(),
          message: form.message.trim(),
          company: form.company,
        },
      });

      // supabase-js no siempre expone el status HTTP de forma directa en
      // funcError; el contrato del backend siempre manda success:false con
      // error humano, así que se prioriza data?.success sobre funcError.
      if (funcError || !data?.success) {
        const status429 = funcError?.context?.status === 429;
        setIsRateLimited(status429);
        setStatus('error');
        setErrorMsg(data?.error || null);
        return;
      }

      setStatus('success');
      setForm(INITIAL_FORM);
    } catch (err) {
      console.error('Error al enviar el formulario de contacto:', err?.message || err);
      setStatus('error');
      setErrorMsg(null);
      setIsRateLimited(false);
    }
  };

  const isSending = status === 'sending';
  const isSuccess = status === 'success';
  const isError = status === 'error';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center bg-black/85 backdrop-blur-sm transition-opacity duration-300 p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-modal-title"
    >
      <div className="glass-card w-full max-w-lg rounded-3xl p-6 md:p-8 relative shadow-[0_0_30px_4px_rgba(221,183,255,0.15)] scale-100 transition-transform duration-300 hover:!translate-y-0">
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-primary/20 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-secondary/10 rounded-full blur-[60px] pointer-events-none" />

        <div className="relative z-10">
          <div className="flex justify-between items-start mb-6 md:mb-8">
            <div>
              <h3 id="contact-modal-title" className="font-headline-lg text-headline-lg text-primary">Contáctanos</h3>
              <p className="text-on-surface-variant text-sm mt-1">
                Estamos listos para impulsar tu marca con IA.
              </p>
            </div>
            <button
              onClick={handleClose}
              className="text-outline hover:text-on-surface transition-colors p-1"
              aria-label="Cerrar"
            >
              <MaterialIcon icon="close" />
            </button>
          </div>

          <a
            href="https://wa.me/5492616177756"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 md:gap-4 p-3 md:p-5 rounded-2xl bg-[#25D366]/10 border border-[#25D366]/20 hover:bg-[#25D366]/20 transition-all mb-4 md:mb-6 group"
          >
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-[#25D366] flex items-center justify-center text-white shadow-lg shadow-[#25D366]/20">
              <MaterialIcon icon="chat" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-on-surface">WhatsApp Directo</p>
              <p className="text-sm text-on-surface-variant">Respuesta en menos de 1 hora</p>
            </div>
            <MaterialIcon icon="arrow_forward" className="text-[#25D366] group-hover:translate-x-1 transition-transform" />
          </a>

          {isSuccess ? (
            <div
              role="status"
              className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-2"
            >
              <MaterialIcon icon="check_circle" className="text-emerald-400 text-[32px]" fill />
              <p className="font-bold text-on-surface">Mensaje enviado, te respondemos a la brevedad.</p>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit} noValidate>
              <div className="space-y-1.5">
                <label htmlFor="contact-name" className="font-label-sm text-label-sm text-outline ml-1">Nombre completo</label>
                <input
                  id="contact-name"
                  name="name"
                  type="text"
                  required
                  maxLength={NAME_MAX}
                  value={form.name}
                  onChange={handleChange}
                  placeholder="Tu nombre"
                  disabled={isSending}
                  className="w-full bg-surface-container-lowest border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-xl py-3 px-4 text-on-surface outline-none transition-all placeholder:text-outline/40 disabled:opacity-60"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="contact-email" className="font-label-sm text-label-sm text-outline ml-1">Correo electrónico</label>
                <input
                  id="contact-email"
                  name="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={handleChange}
                  placeholder="correo@empresa.com"
                  disabled={isSending}
                  className="w-full bg-surface-container-lowest border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-xl py-3 px-4 text-on-surface outline-none transition-all placeholder:text-outline/40 disabled:opacity-60"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="contact-message" className="font-label-sm text-label-sm text-outline ml-1">Mensaje</label>
                <textarea
                  id="contact-message"
                  name="message"
                  rows={3}
                  required
                  maxLength={MESSAGE_MAX}
                  value={form.message}
                  onChange={handleChange}
                  placeholder="Cuéntanos sobre tu proyecto..."
                  disabled={isSending}
                  className="w-full bg-surface-container-lowest border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-xl py-3 px-4 text-on-surface outline-none transition-all placeholder:text-outline/40 resize-none disabled:opacity-60"
                />
              </div>

              {/* Honeypot (tasks.md 5.3): oculto por CSS, no type="hidden",
                  para que un bot que autocompleta inputs lo llene. Excluido
                  del foco por teclado y de lectores de pantalla. */}
              <div className="absolute left-[-9999px] w-px h-px overflow-hidden" aria-hidden="true">
                <label htmlFor="contact-company">No completar este campo</label>
                <input
                  id="contact-company"
                  name="company"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.company}
                  onChange={handleChange}
                />
              </div>

              {isError && (
                <div role="status" aria-live="polite" className="p-3 rounded-xl bg-error/10 border border-error/20 text-error font-body-md text-sm space-y-1.5">
                  <p className="flex items-center gap-2">
                    <MaterialIcon icon="error" className="text-[18px]" />
                    {isRateLimited
                      ? 'Alcanzaste el límite de envíos. Reintentá en unos minutos.'
                      : (errorMsg || 'No pudimos enviar tu mensaje. Escribinos por WhatsApp o a botprueba418@gmail.com.')}
                  </p>
                  {!errorMsg || isRateLimited ? (
                    <p className="flex items-center gap-3 pl-6 text-on-surface-variant">
                      <a href="https://wa.me/5492616177756" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">WhatsApp</a>
                      <a href="mailto:botprueba418@gmail.com" className="underline hover:text-primary">botprueba418@gmail.com</a>
                    </p>
                  ) : null}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSending}
                  className="w-full bg-gradient-to-r from-[#ddb7ff] to-[#0566d9] text-[#400071] font-bold py-4 rounded-xl hover:brightness-110 hover:shadow-[0_0_20px_4px_rgba(221,183,255,0.3)] active:scale-[0.98] transition-all shadow-lg shadow-[#ddb7ff]/20 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:brightness-100 disabled:hover:shadow-none"
                >
                  {isSending ? 'Enviando...' : 'Enviar mensaje'}
                </button>
              </div>
            </form>
          )}

          <div className="flex items-center gap-3 my-4 md:my-5">
            <div className="flex-1 h-px bg-white/5" />
            <span className="text-outline text-xs font-label-sm">o contáctanos por</span>
            <div className="flex-1 h-px bg-white/5" />
          </div>

          <div className="flex items-center justify-center gap-4 md:gap-6">
            <a href="mailto:botprueba418@gmail.com" className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors text-sm">
              <MaterialIcon icon="mail" className="text-[18px]" />
              <span>Email</span>
            </a>
            <a href="tel:+5492616177756" className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors text-sm">
              <MaterialIcon icon="call" className="text-[18px]" />
              <span>Teléfono</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
