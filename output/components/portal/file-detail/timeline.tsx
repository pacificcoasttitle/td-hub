import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"

export type MilestoneStatus = "completed" | "in-progress" | "pending"

export interface Milestone {
  id: string
  title: string
  status: MilestoneStatus
  timestamp?: string
  description?: string
  documentLink?: { label: string; href: string }
}

interface FileTimelineProps {
  milestones: Milestone[]
  className?: string
}

export function FileTimeline({ milestones, className }: FileTimelineProps) {
  return (
    <div className={cn("space-y-0", className)}>
      {milestones.map((milestone, index) => {
        const isLast = index === milestones.length - 1

        return (
          <div key={milestone.id} className="relative flex gap-6">
            {/* Vertical line */}
            {!isLast && (
              <div
                className={cn(
                  "absolute left-[19px] top-12 w-0.5 h-[calc(100%-24px)]",
                  milestone.status === "completed" ? "bg-[#1B2A4A]" : "bg-[#E5E7EB]"
                )}
              />
            )}

            {/* Node */}
            <div className="relative flex-shrink-0 z-10">
              {milestone.status === "completed" ? (
                <div className="w-10 h-10 rounded-full bg-[#1B2A4A] flex items-center justify-center">
                  <Check className="h-5 w-5 text-white" />
                </div>
              ) : milestone.status === "in-progress" ? (
                <div className="w-10 h-10 rounded-full border-4 border-[#F26B2B] bg-white flex items-center justify-center animate-pulse">
                  <div className="w-3 h-3 rounded-full bg-[#F26B2B]" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full border-2 border-dashed border-[#D1D5DB] bg-white" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 pb-10">
              <div className="flex items-start justify-between">
                <div>
                  <h4
                    className={cn(
                      "font-medium",
                      milestone.status === "pending"
                        ? "text-[#9CA3AF]"
                        : "text-[#1B2A4A]"
                    )}
                  >
                    {milestone.title}
                  </h4>
                  {milestone.description && (
                    <p className="text-sm text-[#4B5563] mt-1">
                      {milestone.description}
                    </p>
                  )}
                  {milestone.documentLink && milestone.status === "completed" && (
                    <Link
                      href={milestone.documentLink.href}
                      className="inline-flex items-center text-sm text-[#F26B2B] hover:text-[#E05A1A] font-medium mt-2"
                    >
                      {milestone.documentLink.label}
                    </Link>
                  )}
                </div>
                {milestone.timestamp && (
                  <span className="text-sm text-[#6B7280] flex-shrink-0">
                    {milestone.timestamp}
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
