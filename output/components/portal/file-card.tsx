import Link from "next/link"
import { Eye, FileText, Shield, FileCheck, DollarSign } from "lucide-react"
import { StatusBadge, type FileStatus } from "./status-badge"
import { cn } from "@/lib/utils"

export interface FileData {
  id: string
  fileNumber: string
  propertyAddress: string | null
  status: FileStatus
  transactionType: string
  openedDate: string
}

interface FileCardProps {
  file: FileData
  className?: string
}

const quickActions = [
  { icon: Eye, label: "View", href: (id: string) => `/client/orders/${id}` },
  { icon: FileText, label: "Docs", href: (id: string) => `/client/orders/${id}?tab=documents` },
  { icon: Shield, label: "CPL", href: (id: string) => `/client/orders/${id}?tab=cpl` },
  { icon: FileCheck, label: "Prelim", href: (id: string) => `/client/orders/${id}?tab=prelim` },
  { icon: DollarSign, label: "Fees", href: (id: string) => `/client/orders/${id}?tab=fees` },
]

export function FileCard({ file, className }: FileCardProps) {
  return (
    <div 
      className={cn(
        "bg-white rounded-xl border border-[#E5E7EB] shadow-sm hover:shadow-md transition-shadow p-6",
        className
      )}
    >
      {/* Header with file number and status */}
      <div className="flex items-start justify-between mb-4">
        <span className="font-mono text-sm text-[#4B5563] tracking-wide">
          {file.fileNumber}
        </span>
        <StatusBadge status={file.status} />
      </div>

      {/* Property address */}
      <div className="mb-4">
        {file.propertyAddress ? (
          <h3 className="text-lg font-semibold text-[#1B2A4A] leading-snug">
            {file.propertyAddress}
          </h3>
        ) : (
          <p className="text-base text-[#4B5563] italic">
            Property details pending
          </p>
        )}
      </div>

      {/* Metadata */}
      <div className="flex items-center gap-4 text-sm text-[#4B5563] mb-6">
        <span>{file.transactionType}</span>
        <span className="w-1 h-1 rounded-full bg-[#D1D5DB]" />
        <span>Opened {file.openedDate}</span>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-1 pt-4 border-t border-[#E5E7EB]">
        {quickActions.map((action) => (
          <Link
            key={action.label}
            href={action.href(file.id)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#4B5563] rounded-lg hover:bg-[#F3F4F6] hover:text-[#1B2A4A] transition-colors"
          >
            <action.icon className="h-4 w-4" />
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
