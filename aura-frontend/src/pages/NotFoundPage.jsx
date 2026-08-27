import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GlassCard from '../components/GlassCard';
import GradientButton from '../components/GradientButton';
import MaterialIcon from '../components/MaterialIcon';

export default function NotFoundPage() {
  const { user, profile } = useAuth();
  const homePath = !user ? '/' : profile?.role === 'admin' ? '/admin' : '/app/connections';

  return (
    <div className="min-h-screen bg-background text-on-background font-body-md flex items-center justify-center px-margin-mobile relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] ai-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-secondary/10 rounded-full blur-[100px] ai-pulse" style={{ animationDelay: '1.5s' }} />
      </div>

      <GlassCard className="relative z-10 max-w-md w-full text-center px-8 py-12" hover={false}>
        <MaterialIcon icon="travel_explore" className="text-primary text-[56px] mb-4" />
        <p className="font-display-lg text-[64px] leading-none bg-gradient-to-r from-[#ddb7ff] to-[#0566d9] bg-clip-text text-transparent mb-2">
          404
        </p>
        <h1 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-3">
          Página no encontrada
        </h1>
        <p className="text-on-surface-variant font-body-md mb-8">
          La página que buscás no existe o fue movida.
        </p>
        <Link to={homePath}>
          <GradientButton className="w-full py-3 px-6">
            Volver al inicio
          </GradientButton>
        </Link>
      </GlassCard>
    </div>
  );
}
