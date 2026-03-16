import { cn } from "@/lib/utils"

export type FileStatus = "open" | "in-process" | "completed" | "closed"

const statusStyles: Record<FileStatus, { bg: string; text: string; label: string }> = {
  open: {
    bg: "bg-[#DBEAFE]",
    text: "text-[#1E40AF]",
    label: "Open",
  },
  "in-process": {
    bg: "bg-[#FEF3C7]",
    text: "text-[#92400E]",
    label: "In Process",
  },
  completed: {
    bg: "bg-[#D1FAE5]",
    text: "text-[#065F46]",
    label: "Completed",
  },
  closed: {
    bg: "bg-[#F1F5F9]",
    text: "text-[#475569]",
    label: "Closed",
  },
}

interface StatusBadgeProps {
  status: FileStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = statusStyles[status]
  
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium",
        style.bg,
        style.text,
        className
      )}
    >
      {style.label}
    </span>
  )
}
