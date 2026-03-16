import { FileText, Download, Eye } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { EmptyState } from "../empty-state"

interface PrelimReport {
  filename: string
  receivedDate: string
  highlights?: string[]
}

interface PrelimTabProps {
  prelim?: PrelimReport
  className?: string
}

export function PrelimTab({ prelim, className }: PrelimTabProps) {
  if (!prelim) {
    return (
      <div className={cn("bg-white rounded-xl border border-[#E5E7EB]", className)}>
        <EmptyState type="no-prelim" />
      </div>
    )
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Main prelim card */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 p-3 bg-[#DBEAFE] rounded-lg">
            <FileText className="h-6 w-6 text-[#1E40AF]" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-[#1B2A4A] mb-1">
              Preliminary Title Report
            </h3>
            <div className="flex items-center gap-4 text-sm text-[#6B7280] mb-4">
              <span>{prelim.filename}</span>
              <span className="w-1 h-1 rounded-full bg-[#D1D5DB]" />
              <span>Received {prelim.receivedDate}</span>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                className="border-[#1B2A4A] text-[#1B2A4A] hover:bg-[#1B2A4A]/5"
              >
                <Eye className="h-4 w-4 mr-2" />
                View Report
              </Button>
              <Button
                variant="outline"
                className="border-[#F26B2B] text-[#F26B2B] hover:bg-[#F26B2B]/5"
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Highlights card */}
      {prelim.highlights && prelim.highlights.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-6">
          <h4 className="font-medium text-[#1B2A4A] mb-4">Key Highlights</h4>
          <ul className="space-y-2">
            {prelim.highlights.map((highlight, index) => (
              <li key={index} className="flex items-start gap-3 text-sm text-[#4B5563]">
                <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-[#F26B2B] mt-2" />
                {highlight}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
