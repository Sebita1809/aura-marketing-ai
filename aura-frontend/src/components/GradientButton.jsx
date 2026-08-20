export default function GradientButton({
  children,
  onClick,
  className = '',
  type = 'button',
  disabled = false,
  loading = false
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`bg-gradient-to-r from-[#ddb7ff] to-[#0566d9] text-[#400071] font-bold
        rounded-xl hover:brightness-110 active:scale-95 transition-all
        shadow-lg shadow-[#ddb7ff]/20 disabled:opacity-50 disabled:cursor-not-allowed
        flex items-center justify-center gap-2 ${className}`}
    >
      {loading && (
        <span className="material-symbols-outlined animate-spin text-[20px]">autorenew</span>
      )}
      {children}
    </button>
  );
}
