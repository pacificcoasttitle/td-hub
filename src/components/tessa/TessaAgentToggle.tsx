'use client'

interface Props {
  agentMode: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}

export function TessaAgentToggle({ agentMode, onChange, disabled }: Props) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={agentMode}
        disabled={disabled}
        onClick={() => onChange(!agentMode)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#f26b2b] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed
          ${agentMode ? 'bg-[#f26b2b]' : 'bg-gray-200'}`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out
            ${agentMode ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </button>
      <span className="text-sm text-gray-700">
        <strong>Simplify for Agents</strong>
        <span className="ml-1 text-gray-400 text-xs">(Plain-English mode)</span>
      </span>
    </div>
  )
}
