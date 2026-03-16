import { FileText, Shield, Upload, FolderOpen, DollarSign } from "lucide-react"
import { cn } from "@/lib/utils"

export type ActivityType = "file-opened" | "prelim-uploaded" | "cpl-generated" | "document-added" | "fees-updated"

const activityConfig: Record<ActivityType, { icon: typeof FileText; label: string; color: string }> = {
  "file-opened": {
    icon: FolderOpen,
    label: "File opened",
    color: "bg-[#DBEAFE] text-[#1E40AF]",
  },
  "prelim-uploaded": {
    icon: FileText,
    label: "Prelim uploaded",
    color: "bg-[#D1FAE5] text-[#065F46]",
  },
  "cpl-generated": {
    icon: Shield,
    label: "CPL generated",
    color: "bg-[#FEF3C7] text-[#92400E]",
  },
  "document-added": {
    icon: Upload,
    label: "Document added",
    color: "bg-[#E0E7FF] text-[#3730A3]",
  },
  "fees-updated": {
    icon: DollarSign,
    label: "Fees updated",
    color: "bg-[#F3F4F6] text-[#4B5563]",
  },
}

export interface Activity {
  id: string
  type: ActivityType
  fileNumber: string
  propertyAddress: string
  timestamp: string
  description?: string
}

interface ActivityFeedProps {
  activities: Activity[]
  className?: string
}

export function ActivityFeed({ activities, className }: ActivityFeedProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {activities.map((activity) => {
        const config = activityConfig[activity.type]
        const Icon = config.icon

        return (
          <div
            key={activity.id}
            className="flex items-start gap-4 p-4 bg-white rounded-xl border border-[#E5E7EB]"
          >
            <div className={cn("flex-shrink-0 p-2 rounded-lg", config.color)}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#1B2A4A]">
                {config.label}
              </p>
              <p className="text-sm text-[#4B5563] truncate">
                <span className="font-mono text-xs">{activity.fileNumber}</span>
                {" "}&middot;{" "}
                {activity.propertyAddress}
              </p>
            </div>
            <span className="flex-shrink-0 text-xs text-[#6B7280]">
              {activity.timestamp}
            </span>
          </div>
        )
      })}
    </div>
  )
}
