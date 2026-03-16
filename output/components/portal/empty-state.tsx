import Link from "next/link"
import { FolderOpen, FileText, Shield, CloudUpload } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export type EmptyStateType = "no-files" | "no-documents" | "no-cpl" | "no-prelim"

const emptyStateConfig: Record<
  EmptyStateType,
  {
    icon: typeof FolderOpen
    title: string
    description: string
    action?: { label: string; href: string }
  }
> = {
  "no-files": {
    icon: FolderOpen,
    title: "No files yet",
    description: "Your first order is just a click away",
    action: { label: "Open New Order", href: "/client/orders/new" },
  },
  "no-documents": {
    icon: CloudUpload,
    title: "No documents yet",
    description: "Upload documents to get started with this file",
  },
  "no-cpl": {
    icon: Shield,
    title: "No CPL generated",
    description: "Generate your Closing Protection Letter when ready",
  },
  "no-prelim": {
    icon: FileText,
    title: "No prelim report",
    description: "The preliminary report will appear here once received",
  },
}

interface EmptyStateProps {
  type: EmptyStateType
  className?: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ type, className, action }: EmptyStateProps) {
  const config = emptyStateConfig[type]
  const Icon = config.icon

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-8 text-center",
        className
      )}
    >
      <div className="mb-6 p-4 rounded-full bg-[#F3F4F6]">
        <Icon className="h-8 w-8 text-[#4B5563]" />
      </div>
      <h3 className="text-lg font-semibold text-[#1B2A4A] mb-2">
        {config.title}
      </h3>
      <p className="text-sm text-[#4B5563] max-w-sm mb-6">
        {config.description}
      </p>
      {config.action && (
        <Button asChild className="bg-[#F26B2B] hover:bg-[#E05A1A] text-white">
          <Link href={config.action.href}>{config.action.label}</Link>
        </Button>
      )}
      {action && (
        <Button 
          onClick={action.onClick}
          className="bg-[#F26B2B] hover:bg-[#E05A1A] text-white"
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}
