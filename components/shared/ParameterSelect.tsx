interface ParameterSelectProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  optional?: boolean
}

export default function ParameterSelect({ label, value, onChange, options, optional }: ParameterSelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-slate-400 text-xs font-medium uppercase tracking-wide">
        {label}
        {optional && <span className="text-slate-600 normal-case tracking-normal ml-1">(optional)</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-700 bg-[#0a0a0f] text-white text-sm px-3 py-2 focus:outline-none focus:border-violet-500 transition-colors appearance-none cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}
