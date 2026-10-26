/**
 * Custom inline SVG illustrations for the three "How it works" steps, in brand colours
 * (Teal #00796E, Deep Ink #15343E, Mint #DCEEE4, a single Harvest Gold #D9B36A highlight).
 * Decorative: hidden from assistive tech; the step text carries the meaning.
 */
const TEAL = "#00796E";
const INK = "#15343E";
const MINT = "#DCEEE4";
const MIST = "#F1F7F3";
const GOLD = "#D9B36A";
const LINE = "#DCE3E1";

export function CompareIllustration({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 240 160" className={className} fill="none">
      <rect x="0" y="0" width="240" height="160" rx="20" fill={MIST} />
      <rect x="26" y="30" width="86" height="104" rx="12" fill="#fff" stroke={LINE} />
      <rect x="128" y="30" width="86" height="104" rx="12" fill="#fff" stroke={TEAL} strokeWidth="2" />
      <rect x="38" y="44" width="34" height="8" rx="4" fill={MINT} />
      <rect x="140" y="44" width="34" height="8" rx="4" fill={MINT} />
      <rect x="38" y="62" width="62" height="6" rx="3" fill={LINE} />
      <rect x="38" y="76" width="50" height="6" rx="3" fill={LINE} />
      <rect x="38" y="90" width="56" height="6" rx="3" fill={LINE} />
      <rect x="140" y="62" width="62" height="6" rx="3" fill={LINE} />
      <rect x="140" y="76" width="50" height="6" rx="3" fill={LINE} />
      <rect x="140" y="90" width="56" height="6" rx="3" fill={LINE} />
      <rect x="38" y="110" width="40" height="12" rx="6" fill={INK} opacity="0.85" />
      <rect x="140" y="110" width="40" height="12" rx="6" fill={TEAL} />
      <circle cx="196" cy="44" r="12" fill={TEAL} />
      <path d="M190 44l4.5 4.5L203 39" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="120" cy="82" r="14" fill="#fff" stroke={LINE} />
      <path d="M114 82h12M120 76l6 6-6 6" stroke={GOLD} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PayIllustration({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 240 160" className={className} fill="none">
      <rect x="0" y="0" width="240" height="160" rx="20" fill={MIST} />
      <rect x="84" y="18" width="72" height="130" rx="14" fill={INK} />
      <rect x="90" y="26" width="60" height="114" rx="10" fill="#fff" />
      <rect x="110" y="30" width="20" height="4" rx="2" fill={INK} />
      <rect x="98" y="44" width="44" height="26" rx="8" fill={TEAL} />
      <rect x="104" y="52" width="22" height="4" rx="2" fill="#fff" opacity="0.8" />
      <rect x="104" y="60" width="14" height="4" rx="2" fill="#fff" opacity="0.5" />
      <rect x="98" y="78" width="44" height="8" rx="4" fill={MINT} />
      <rect x="98" y="92" width="30" height="6" rx="3" fill={LINE} />
      <circle cx="120" cy="118" r="12" fill={TEAL} />
      <path d="M114 118l4.5 4.5L127 113" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="18" y="56" width="52" height="34" rx="8" fill="#fff" stroke={LINE} />
      <rect x="24" y="64" width="18" height="12" rx="3" fill={GOLD} />
      <rect x="24" y="80" width="40" height="4" rx="2" fill={LINE} />
      <rect x="170" y="56" width="52" height="34" rx="8" fill="#fff" stroke={LINE} />
      <rect x="176" y="64" width="40" height="6" rx="3" fill={MINT} />
      <rect x="176" y="76" width="26" height="6" rx="3" fill={TEAL} />
      <path d="M70 73h14M156 73h14" stroke={TEAL} strokeWidth="2" strokeDasharray="3 3" strokeLinecap="round" />
    </svg>
  );
}

export function PolicyIllustration({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 240 160" className={className} fill="none">
      <rect x="0" y="0" width="240" height="160" rx="20" fill={MIST} />
      <rect x="54" y="22" width="132" height="116" rx="12" fill="#fff" stroke={LINE} />
      <rect x="54" y="22" width="132" height="22" rx="12" fill={TEAL} />
      <rect x="54" y="34" width="132" height="10" fill={TEAL} />
      <rect x="66" y="30" width="44" height="6" rx="3" fill="#fff" opacity="0.9" />
      <rect x="66" y="56" width="70" height="6" rx="3" fill={INK} opacity="0.8" />
      <rect x="66" y="68" width="54" height="5" rx="2.5" fill={LINE} />
      <rect x="66" y="80" width="62" height="5" rx="2.5" fill={LINE} />
      <rect x="66" y="92" width="44" height="5" rx="2.5" fill={LINE} />
      <rect x="66" y="112" width="40" height="12" rx="6" fill={MINT} />
      <g transform="translate(142 56)">
        <rect width="32" height="32" rx="4" fill="#fff" stroke={INK} />
        <rect x="4" y="4" width="8" height="8" fill={INK} />
        <rect x="20" y="4" width="8" height="8" fill={INK} />
        <rect x="4" y="20" width="8" height="8" fill={INK} />
        <rect x="16" y="16" width="4" height="4" fill={INK} />
        <rect x="22" y="20" width="4" height="4" fill={INK} />
        <rect x="16" y="24" width="4" height="4" fill={INK} />
        <rect x="24" y="26" width="4" height="4" fill={TEAL} />
      </g>
      <circle cx="166" cy="116" r="14" fill={GOLD} />
      <path d="M160 116l4.5 4.5L173 111" stroke={INK} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M26 60c6-10 14-10 20 0s14 10 20 0" stroke={TEAL} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <path d="M196 100c6-10 14-10 20 0" stroke={TEAL} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}
