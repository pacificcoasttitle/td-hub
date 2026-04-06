'use client'

interface Props {
  summary: string
}

export function TessaSummaryContent({ summary }: Props) {
  if (!summary.trim()) {
    return <p className="text-sm text-gray-500 italic">No summary available.</p>
  }

  // Render each paragraph separated by blank lines
  const paragraphs = summary.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

  return (
    <div className="space-y-3">
      {paragraphs.map((para, i) => (
        <p key={i} className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
          {para}
        </p>
      ))}
    </div>
  )
}
