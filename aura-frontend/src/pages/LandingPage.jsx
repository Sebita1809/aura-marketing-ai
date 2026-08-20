import { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import GlassCard from '../components/GlassCard';
import MaterialIcon from '../components/MaterialIcon';
import ContactModal from '../components/ContactModal';

export default function LandingPage() {
  // isContactOpen elevado acá (landing-contact-email, design.md Decisión 6):
  // antes vivía en Navbar y el Footer no tenía forma de abrir el modal.
  // LandingPage monta el ContactModal una sola vez y pasa onContactClick a
  // ambos hijos -- se descartó un Context porque hay un solo consumidor de
  // nivel página con dos props, sin ceremonia extra.
  const [isContactOpen, setIsContactOpen] = useState(false);

  useEffect(() => {
    const handleClick = (e) => {
      const target = e.target.closest('a[href^="#"]');
      if (target) {
        e.preventDefault();
        const id = target.getAttribute('href').slice(1);
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return (
    <div className="min-h-screen bg-background text-on-background font-body-md">
      <Navbar onContactClick={() => setIsContactOpen(true)} />

      <main>
        {/* ===== HERO SECTION ===== */}
        <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16 md:pt-20">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] ai-pulse" />
            <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-secondary/10 rounded-full blur-[100px] ai-pulse" style={{ animationDelay: '1.5s' }} />
          </div>
          <div className="relative z-10 w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop text-center">
            <div className="inline-flex items-center gap-2 glass-card rounded-full px-4 sm:px-6 py-2 mb-8">
              <MaterialIcon icon="auto_awesome" className="text-primary text-[18px]" fill />
              <span className="text-label-sm font-label-sm text-primary tracking-widest uppercase font-bold">
                IA DE ÚLTIMA GENERACIÓN
              </span>
            </div>
            <h1 className="text-[28px] leading-tight font-bold font-display-lg md:text-display-lg text-on-surface mb-6 max-w-5xl mx-auto">
              Tu agencia de marketing{' '}
              <span className="bg-gradient-to-r from-[#ddb7ff] via-[#adc6ff] to-[#0566d9] bg-clip-text text-transparent">
                automatizada con Inteligencia Artificial.
              </span>
            </h1>
            <p className="text-body-md font-body-md text-on-surface-variant max-w-3xl mx-auto mb-10 leading-relaxed">
              Aura analiza tu catálogo, diseña las publicidades y las publica automáticamente en tus redes sociales. Tú solo apruebas, nosotros hacemos el resto.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="https://wa.me/5492616177756"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gradient-to-r from-[#ddb7ff] to-[#0566d9] text-[#400071] font-bold px-8 py-4 rounded-xl hover:brightness-110 hover:shadow-[0_0_20px_4px_rgba(221,183,255,0.3)] active:scale-95 transition-all shadow-lg shadow-[#ddb7ff]/20 flex items-center gap-3"
              >
                <MaterialIcon icon="chat" />
                Hablar con un asesor
              </a>
              <button className="glass-card rounded-xl px-8 py-4 font-bold text-primary hover:bg-primary/10 active:scale-95 transition-all flex items-center gap-3">
                <MaterialIcon icon="play_circle" />
                Ver Demo
              </button>
            </div>

            {/* Stats card */}
            <div className="mt-16 w-fit mx-auto flex items-center gap-3 glass-card rounded-2xl px-5 sm:px-8 py-4 sm:py-5 border-l-4 border-l-primary">
              <MaterialIcon icon="monitoring" className="text-primary text-[32px]" fill />
              <div className="text-left">
                <p className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-widest">IA Analizando</p>
                <p className="text-headline-lg font-headline-lg font-bold text-primary">+124% ROAS proyectado</p>
              </div>
            </div>
          </div>
        </section>

        {/* ===== FEATURES SECTION ===== */}
        <section id="beneficios" className="py-24 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/2 left-0 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[100px]" />
          </div>
          <div className="relative z-10 w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
            <div className="text-center mb-16">
              <h2 className="text-headline-lg font-headline-lg text-on-surface mb-4">
                Potencia tu marca con <span className="text-primary">tecnología Aura</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
              <GlassCard className="p-8">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#ddb7ff]/20 to-[#842bd2]/20 flex items-center justify-center mb-6">
                  <MaterialIcon icon="database" className="text-primary text-[28px]" />
                </div>
                <h3 className="text-headline-lg font-headline-lg text-on-surface mb-4 text-[20px]">
                  Análisis Inteligente
                </h3>
                <p className="text-body-md font-body-md text-on-surface-variant mb-5 leading-relaxed">
                  Procesamiento masivo de datos directamente desde tus catálogos en PDF o Google Sheets para extraer insights de producto.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2 text-on-surface-variant">
                    <MaterialIcon icon="check_circle" className="text-secondary text-[18px]" fill />
                    <span className="text-body-md">Sincronización en tiempo real</span>
                  </li>
                  <li className="flex items-center gap-2 text-on-surface-variant">
                    <MaterialIcon icon="check_circle" className="text-secondary text-[18px]" fill />
                    <span className="text-body-md">Limpieza de datos automática</span>
                  </li>
                </ul>
              </GlassCard>
              <GlassCard className="p-8">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#adc6ff]/20 to-[#0566d9]/20 flex items-center justify-center mb-6">
                  <MaterialIcon icon="brush" className="text-secondary text-[28px]" />
                </div>
                <h3 className="text-headline-lg font-headline-lg text-on-surface mb-4 text-[20px]">
                  Estudio Creativo
                </h3>
                <p className="text-body-md font-body-md text-on-surface-variant mb-5 leading-relaxed">
                  Generación de imágenes fotorrealistas y copys altamente persuasivos adaptados al tono de voz de tu marca comercial.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2 text-on-surface-variant">
                    <MaterialIcon icon="check_circle" className="text-secondary text-[18px]" fill />
                    <span className="text-body-md">Nano Banana 2</span>
                  </li>
                  <li className="flex items-center gap-2 text-on-surface-variant">
                    <MaterialIcon icon="check_circle" className="text-secondary text-[18px]" fill />
                    <span className="text-body-md">A/B Testing creativo infinito</span>
                  </li>
                </ul>
              </GlassCard>
              <GlassCard className="p-8">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0566d9]/20 to-[#25D366]/20 flex items-center justify-center mb-6">
                  <MaterialIcon icon="rocket_launch" className="text-[#0566d9] text-[28px]" />
                </div>
                <h3 className="text-headline-lg font-headline-lg text-on-surface mb-4 text-[20px]">
                  Piloto Automático
                </h3>
                <p className="text-body-md font-body-md text-on-surface-variant mb-5 leading-relaxed">
                  Publicación directa y programada en Meta, Google y TikTok sin intervención manual. La IA optimiza el horario de posteo.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2 text-on-surface-variant">
                    <MaterialIcon icon="check_circle" className="text-secondary text-[18px]" fill />
                    <span className="text-body-md">Gestión multicanal 24/7</span>
                  </li>
                  <li className="flex items-center gap-2 text-on-surface-variant">
                    <MaterialIcon icon="check_circle" className="text-secondary text-[18px]" fill />
                    <span className="text-body-md">Dashboard de métricas unificado</span>
                  </li>
                </ul>
              </GlassCard>
            </div>
          </div>
        </section>

        {/* ===== HOW IT WORKS SECTION ===== */}
        <section id="como-funciona" className="py-24 relative bg-surface-container/50 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-secondary/5 rounded-full blur-[100px]" />
          </div>
          <div className="relative z-10 w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
            <div className="text-center mb-6">
              <h2 className="text-headline-lg font-headline-lg text-on-surface mb-4">
                Un flujo de trabajo diseñado para la velocidad
              </h2>
              <p className="text-body-md font-body-md text-on-surface-variant max-w-2xl mx-auto mb-16">
                Elimina la fricción operativa y escala tu contenido en minutos, no en días.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#ddb7ff] to-[#842bd2] flex items-center justify-center mx-auto mb-6 shadow-lg shadow-[#ddb7ff]/30">
                  <span className="text-on-primary-container text-headline-lg font-headline-lg font-bold">1</span>
                </div>
                <h3 className="text-headline-lg font-headline-lg text-on-surface mb-3 text-[20px]">
                  Envías tu información
                </h3>
                <p className="text-body-md font-body-md text-on-surface-variant leading-relaxed max-w-xs mx-auto">
                  Carga tus catálogos, listas de precios o briefs en cualquier formato digital.
                </p>
              </div>
              <div className="text-center relative">
                <div className="hidden md:block absolute -left-4 top-8 text-on-surface-variant/20 text-[32px]">
                  <MaterialIcon icon="arrow_forward" />
                </div>
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#adc6ff] to-[#0566d9] flex items-center justify-center mx-auto mb-6 shadow-lg shadow-[#adc6ff]/30">
                  <span className="text-on-secondary-container text-headline-lg font-headline-lg font-bold">2</span>
                </div>
                <h3 className="text-headline-lg font-headline-lg text-on-surface mb-3 text-[20px]">
                  Aura genera la magia
                </h3>
                <p className="text-body-md font-body-md text-on-surface-variant leading-relaxed max-w-xs mx-auto">
                  Nuestros algoritmos diseñan artes, redactan textos y programan la pauta ideal.
                </p>
              </div>
              <div className="text-center relative">
                <div className="hidden md:block absolute -left-4 top-8 text-on-surface-variant/20 text-[32px]">
                  <MaterialIcon icon="arrow_forward" />
                </div>
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#25D366] to-[#128C7E] flex items-center justify-center mx-auto mb-6 shadow-lg shadow-[#25D366]/30">
                  <span className="text-white text-headline-lg font-headline-lg font-bold">3</span>
                </div>
                <h3 className="text-headline-lg font-headline-lg text-on-surface mb-3 text-[20px]">
                  Apruebas y listo
                </h3>
                <p className="text-body-md font-body-md text-on-surface-variant leading-relaxed max-w-xs mx-auto">
                  Recibes una notificación en Telegram, das el visto bueno y se publica al instante.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ===== CTA SECTION ===== */}
        <section className="py-24 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#25D366]/5 rounded-full blur-[120px]" />
          </div>
          <div className="relative z-10 w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop text-center">
            <GlassCard className="max-w-2xl mx-auto p-6 sm:p-10 md:p-16">
              <MaterialIcon icon="whatsapp" className="text-[#25D366] text-[48px] mb-6" fill />
              <h2 className="text-headline-lg font-headline-lg text-on-surface mb-4">
                Diseñamos un plan a la medida de tu negocio
              </h2>
              <p className="text-body-md font-body-md text-on-surface-variant mb-8 max-w-lg mx-auto leading-relaxed">
                Contáctanos para conocer nuestros métodos de pago y darte de alta en nuestro portal. Estamos listos para escalar tu facturación con IA.
              </p>
              <a
                href="https://wa.me/5492616177756"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gradient-to-r from-[#ddb7ff] to-[#0566d9] text-[#400071] font-bold px-6 sm:px-10 py-4 rounded-xl hover:brightness-110 hover:shadow-[0_0_20px_4px_rgba(221,183,255,0.3)] active:scale-95 transition-all shadow-lg shadow-[#ddb7ff]/20 inline-flex items-center gap-3 text-body-md"
              >
                <MaterialIcon icon="calendar_today" />
                Agendar llamada por WhatsApp
              </a>
            </GlassCard>
          </div>
        </section>
      </main>

      <Footer onContactClick={() => setIsContactOpen(true)} />

      <ContactModal isOpen={isContactOpen} onClose={() => setIsContactOpen(false)} />
    </div>
  );
}
