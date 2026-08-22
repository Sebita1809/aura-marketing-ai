import { useEffect, useState } from 'react';
import MaterialIcon from './MaterialIcon';

// Fracción de un viewport de scroll necesaria para que el video llegue a
// opacidad 0. El video en sí NO se mueve (queda fixed) -- lo que se mueve
// es el contenido de la página, que va tapando al video por encima.
const FADE_FRACTION = 0.85;

export default function VideoHero({ videoSrc, posterSrc, nextSectionRef }) {
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    const handleScroll = () => {
      const fadeDistance = window.innerHeight * FADE_FRACTION;
      const nextOpacity = Math.min(1, Math.max(0, 1 - window.scrollY / fadeDistance));
      setOpacity(nextOpacity);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleScrollToNext = () => {
    nextSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const isVisible = opacity > 0.02;

  return (
    <>
      {/* Video fijo al viewport: nunca se desplaza, solo se desvanece.
          El contenido real (spacer + main, en flujo normal) es lo que
          se desliza hacia arriba y lo va cubriendo. */}
      <div
        className="fixed inset-0 z-0 overflow-hidden bg-background"
        style={{ opacity, pointerEvents: isVisible ? 'auto' : 'none' }}
        aria-hidden={!isVisible}
      >
        <video
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: 'brightness(0.65)' }}
          src={videoSrc}
          poster={posterSrc}
          autoPlay
          muted
          loop
          playsInline
        />

        {/* Viñeta de neón difuminada: oscurece hacia los bordes y tiñe las
            esquinas con el morado/azul de marca, sin borde ni sombra tipo card. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(ellipse 75% 65% at 50% 45%, transparent 35%, rgba(19,19,19,0.55) 75%, rgba(19,19,19,0.96) 100%),
              radial-gradient(ellipse 55% 45% at 10% 5%, rgba(221,183,255,0.28), transparent 60%),
              radial-gradient(ellipse 55% 45% at 90% 95%, rgba(5,102,217,0.28), transparent 60%)
            `,
          }}
        />

        <button
          type="button"
          onClick={handleScrollToNext}
          aria-label="Bajar al contenido"
          aria-hidden={!isVisible}
          tabIndex={isVisible ? 0 : -1}
          className="absolute bottom-8 md:bottom-10 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1 text-on-surface-variant hover:text-primary transition-colors animate-bounce"
        >
          <span className="text-label-sm font-label-sm uppercase tracking-widest">Descubrí más</span>
          <MaterialIcon icon="keyboard_arrow_down" className="text-[32px]" />
        </button>
      </div>

      {/* Spacer en flujo normal: reserva un viewport de alto para que el
          scroll exista mientras el video (fixed) se desvanece detrás */}
      <div className="h-screen" aria-hidden="true" />
    </>
  );
}
