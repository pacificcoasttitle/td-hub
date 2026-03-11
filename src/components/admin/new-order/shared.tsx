export function StepHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-lg font-semibold text-[#1A1A2E]">{title}</h3>
      <p className="text-sm text-[#6B7280] mt-0.5">{sub}</p>
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-[#6B7280] mb-1">{children}</label>;
}

export function StepNav({
  onPrev, onNext, nextDisabled, nextLabel,
}: {
  onPrev?: () => void; onNext?: () => void; nextDisabled?: boolean; nextLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
      {onPrev ? (
        <button onClick={onPrev} className="px-4 py-2 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors">
          ← Back
        </button>
      ) : <div />}
      {onNext && (
        <button
          onClick={onNext}
          disabled={nextDisabled}
          className="px-5 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {nextLabel ?? 'Continue →'}
        </button>
      )}
    </div>
  );
}
