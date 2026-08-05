/**
 * Official HEXA'S Education product identity.
 * Uses the user-supplied transparent logo asset and keeps the product label separate.
 */
import React from 'react';
import { Mic2 } from 'lucide-react';

type HexasBrandProps = {
  compact?: boolean;
  inverse?: boolean;
  showProduct?: boolean;
  className?: string;
};

export const HexasBrand: React.FC<HexasBrandProps> = ({
  compact = false,
  inverse = false,
  showProduct = true,
  className = '',
}) => {
  return (
    <div className={`flex items-center ${compact ? 'gap-2.5' : 'gap-3.5'} ${className}`} aria-label="HEXA'S Education Speaking AI">
      <img
        src="/hexas-education-logo.png"
        alt="HEXA'S Education"
        className={`${compact ? 'h-9 w-auto' : 'h-12 w-auto'} object-contain shrink-0`}
        draggable={false}
      />

      {showProduct && (
        <>
          <span className={`h-9 w-px ${inverse ? 'bg-white/25' : 'bg-slate-200'}`} aria-hidden="true" />
          <div className="leading-tight min-w-0">
            <div className={`flex items-center gap-1.5 font-extrabold ${compact ? 'text-xs' : 'text-sm'} ${inverse ? 'text-white' : 'text-slate-950'}`}>
              <Mic2 size={compact ? 12 : 14} className="text-[var(--hexa-red)] shrink-0" />
              <span className="truncate">Speaking AI</span>
            </div>
            <div className={`${compact ? 'text-[8px]' : 'text-[9px]'} font-bold uppercase tracking-[0.16em] ${inverse ? 'text-white/60' : 'text-slate-400'}`}>
              IELTS Practice Lab
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default HexasBrand;
