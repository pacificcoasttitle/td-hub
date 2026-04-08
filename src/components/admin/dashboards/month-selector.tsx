'use client';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTH_NAMES = MONTHS;

const SEL =
  'text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-[#1A1A2E] ' +
  'focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]';

export function MonthSelector({ month, year, onChange }: {
  month: number;
  year: number;
  onChange: (month: number, year: number) => void;
}) {
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  return (
    <div className="flex items-center gap-2">
      <select
        value={month}
        onChange={e => onChange(Number(e.target.value), year)}
        className={SEL}
      >
        {MONTHS.map((name, i) => {
          const m = i + 1;
          const label = m === curMonth && year === curYear ? `${name} (current)` : name;
          return <option key={m} value={m}>{label}</option>;
        })}
      </select>
      <select
        value={year}
        onChange={e => onChange(month, Number(e.target.value))}
        className={SEL}
      >
        <option value={2025}>2025</option>
        <option value={2026}>2026</option>
      </select>
    </div>
  );
}
