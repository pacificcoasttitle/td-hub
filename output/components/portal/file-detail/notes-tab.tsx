import { cn } from "@/lib/utils"

export interface Note {
  id: string
  author: string
  content: string
  timestamp: string
}

interface NotesTabProps {
  notes: Note[]
  className?: string
}

export function NotesTab({ notes, className }: NotesTabProps) {
  if (notes.length === 0) {
    return (
      <div className={cn("bg-white rounded-xl border border-[#E5E7EB] p-8 text-center", className)}>
        <p className="text-[#4B5563]">No notes have been added to this file.</p>
      </div>
    )
  }

  return (
    <div className={cn("space-y-4", className)}>
      {notes.map((note) => (
        <div
          key={note.id}
          className="bg-white rounded-xl border border-[#E5E7EB] p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="font-medium text-[#1B2A4A]">{note.author}</span>
            <span className="text-sm text-[#6B7280]">{note.timestamp}</span>
          </div>
          <p className="text-sm text-[#4B5563] leading-relaxed">{note.content}</p>
        </div>
      ))}
    </div>
  )
}
