const paths = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7"/>
      <rect x="14" y="3" width="7" height="4"/>
      <rect x="14" y="10" width="7" height="11"/>
      <rect x="3" y="14" width="7" height="7"/>
    </>
  ),
  customers: (
    <>
      <circle cx="12" cy="8" r="4"/>
      <path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>
    </>
  ),
  jobs: (
    <>
      <rect x="6" y="4" width="12" height="16" rx="2"/>
      <path d="M9 4h6v4H9z"/>
      <line x1="9" y1="12" x2="15" y2="12"/>
      <line x1="9" y1="16" x2="15" y2="16"/>
    </>
  ),
  inquiries: (
    <>
      <path d="M4 5h16v11H8l-4 4z"/>
      <line x1="8" y1="9" x2="16" y2="9"/>
      <line x1="8" y1="13" x2="14" y2="13"/>
    </>
  ),
  tasks: (
    <>
      <polyline points="9 11 12 14 22 4"/>
      <line x1="2" y1="6" x2="6" y2="6"/>
      <line x1="2" y1="12" x2="6" y2="12"/>
      <line x1="2" y1="18" x2="6" y2="18"/>
    </>
  ),
  tools: (
    <>
      <rect x="3" y="9" width="18" height="10" rx="2"/>
      <path d="M9 9V7a3 3 0 0 1 6 0v2"/>
      <line x1="3" y1="13" x2="21" y2="13"/>
    </>
  ),
  scheduling: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <line x1="8" y1="3" x2="8" y2="7"/>
      <line x1="16" y1="3" x2="16" y2="7"/>
      <circle cx="8" cy="14" r="1" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="14" r="1" fill="currentColor" stroke="none"/>
      <circle cx="16" cy="14" r="1" fill="currentColor" stroke="none"/>
    </>
  ),
};

export default function NavIcon({ name, size = 22, color = "currentColor" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
    >
      {paths[name]}
    </svg>
  );
}
