'use client';

import { useEffect, useState } from 'react';

const MESSAGES = [
  'Creating your order…',
  'Sending to SoftPro…',
  'Generating documents…',
  'Almost there…',
];

const ROTATE_MS = 3000;

export function OrderSubmitOverlay({ visible }: { visible: boolean }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!visible) {
      setIdx(0);
      return;
    }
    const id = setInterval(() => setIdx((i) => (i + 1) % MESSAGES.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm">
      {/* CSS spinner */}
      <div className="h-12 w-12 rounded-full border-[3px] border-[#F26B2B]/20 border-t-[#F26B2B] animate-spin" />

      {/* Rotating message with crossfade */}
      <div className="mt-6 h-7 relative w-72 text-center">
        {MESSAGES.map((msg, i) => (
          <span
            key={msg}
            className={`absolute inset-0 flex items-center justify-center text-lg font-medium text-[#1A1A2E] transition-opacity duration-500 ${
              i === idx ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {msg}
          </span>
        ))}
      </div>
    </div>
  );
}
