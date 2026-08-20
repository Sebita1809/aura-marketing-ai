export default function GlassCard({ children, className = '', hover = true }) {
  return (
    <div
      className={`glass-card rounded-2xl ${hover ? 'hover:border-primary/30 hover:-translate-y-1 hover:shadow-[0_10px_30px_-10px_rgba(132,43,210,0.2)]' : ''} transition-all duration-300 ${className}`}
    >
      {children}
    </div>
  );
}
