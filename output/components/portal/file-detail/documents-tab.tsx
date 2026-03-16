"use client"

import { useState } from "react"
import { CloudUpload, FileText, Download } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { EmptyState } from "../empty-state"

export interface Document {
  id: string
  filename: string
  category: "general" | "curative" | "supporting"
  type: string
  dateAdded: string
}

const categoryStyles = {
  general: "bg-[#DBEAFE] text-[#1E40AF]",
  curative: "bg-[#FEE2E2] text-[#991B1B]",
  supporting: "bg-[#F3F4F6] text-[#4B5563]",
}

interface DocumentsTabProps {
  documents: Document[]
  className?: string
}

export function DocumentsTab({ documents, className }: DocumentsTabProps) {
  const [dragActive, setDragActive] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const categories = ["General", "Curative", "Supporting"]

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    // Handle file upload logic here
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Upload area */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center transition-colors",
          dragActive
            ? "border-[#F26B2B] bg-[#F26B2B]/5"
            : "border-[#D1D5DB] hover:border-[#9CA3AF]"
        )}
      >
        <CloudUpload className="h-10 w-10 text-[#9CA3AF] mx-auto mb-4" />
        <p className="text-[#4B5563] mb-2">
          Drag and drop files here, or click to browse
        </p>
        <div className="flex items-center justify-center gap-2 mb-4">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-full transition-colors",
                selectedCategory === cat
                  ? "bg-[#1B2A4A] text-white"
                  : "bg-[#F3F4F6] text-[#4B5563] hover:bg-[#E5E7EB]"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          className="border-[#F26B2B] text-[#F26B2B] hover:bg-[#F26B2B]/5"
        >
          Browse Files
        </Button>
      </div>

      {/* Document list */}
      {documents.length > 0 ? (
        <div className="space-y-3">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-4 p-4 bg-white rounded-xl border border-[#E5E7EB]"
            >
              <div className="flex-shrink-0 p-2 bg-[#F3F4F6] rounded-lg">
                <FileText className="h-5 w-5 text-[#4B5563]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[#1B2A4A] truncate">
                  {doc.filename}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={cn(
                      "inline-flex px-2 py-0.5 text-xs font-medium rounded-full",
                      categoryStyles[doc.category]
                    )}
                  >
                    {doc.category.charAt(0).toUpperCase() + doc.category.slice(1)}
                  </span>
                  <span className="text-xs text-[#6B7280]">{doc.type}</span>
                  <span className="text-xs text-[#6B7280]">{doc.dateAdded}</span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-[#F26B2B] text-[#F26B2B] hover:bg-[#F26B2B]/5"
              >
                <Download className="h-4 w-4 mr-1" />
                Download
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#E5E7EB]">
          <EmptyState type="no-documents" />
        </div>
      )}
    </div>
  )
}
