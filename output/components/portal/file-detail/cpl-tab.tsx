"use client"

import { useState } from "react"
import { Shield, Download, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { EmptyState } from "../empty-state"

interface ExistingCPL {
  filename: string
  underwriter: string
  generatedDate: string
}

const underwriters = [
  { id: "first-american", name: "First American", logo: "FA" },
  { id: "fidelity", name: "Fidelity National", logo: "FN" },
  { id: "old-republic", name: "Old Republic", logo: "OR" },
  { id: "stewart", name: "Stewart Title", logo: "ST" },
]

interface CPLTabProps {
  existingCPL?: ExistingCPL
  className?: string
}

export function CPLTab({ existingCPL, className }: CPLTabProps) {
  const [selectedUnderwriter, setSelectedUnderwriter] = useState<string | null>(null)

  if (existingCPL) {
    return (
      <div className={cn("space-y-6", className)}>
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 p-3 bg-[#D1FAE5] rounded-lg">
              <Shield className="h-6 w-6 text-[#059669]" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-[#1B2A4A] mb-1">
                Closing Protection Letter
              </h3>
              <p className="text-sm text-[#4B5563] mb-3">
                Underwritten by {existingCPL.underwriter}
              </p>
              <div className="flex items-center gap-4 text-sm text-[#6B7280]">
                <span>{existingCPL.filename}</span>
                <span className="w-1 h-1 rounded-full bg-[#D1D5DB]" />
                <span>Generated {existingCPL.generatedDate}</span>
              </div>
            </div>
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
    )
  }

  return (
    <div className={cn("space-y-6", className)}>
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-6">
        <h3 className="font-semibold text-[#1B2A4A] mb-2">
          Generate Closing Protection Letter
        </h3>
        <p className="text-sm text-[#4B5563] mb-6">
          Select an underwriter to generate your CPL
        </p>

        <div className="grid grid-cols-2 gap-4 mb-6">
          {underwriters.map((uw) => (
            <button
              key={uw.id}
              onClick={() => setSelectedUnderwriter(uw.id)}
              className={cn(
                "flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left",
                selectedUnderwriter === uw.id
                  ? "border-[#F26B2B] bg-[#F26B2B]/5"
                  : "border-[#E5E7EB] hover:border-[#D1D5DB]"
              )}
            >
              <div
                className={cn(
                  "w-12 h-12 rounded-lg flex items-center justify-center font-bold text-sm",
                  selectedUnderwriter === uw.id
                    ? "bg-[#1B2A4A] text-white"
                    : "bg-[#F3F4F6] text-[#4B5563]"
                )}
              >
                {uw.logo}
              </div>
              <div className="flex-1">
                <p className="font-medium text-[#1B2A4A]">{uw.name}</p>
              </div>
              {selectedUnderwriter === uw.id && (
                <Check className="h-5 w-5 text-[#F26B2B]" />
              )}
            </button>
          ))}
        </div>

        <Button
          disabled={!selectedUnderwriter}
          className="w-full bg-[#F26B2B] hover:bg-[#E05A1A] text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Shield className="h-4 w-4 mr-2" />
          Generate CPL
        </Button>
      </div>
    </div>
  )
}
