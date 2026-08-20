export default function MaterialIcon({ icon, className = '', fill = false, size = 'text-[24px]' }) {
  return (
    <span
      className={`material-symbols-outlined ${size} ${className}`}
      style={{ fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24` }}
    >
      {icon}
    </span>
  );
}
