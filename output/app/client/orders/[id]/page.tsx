"use client"

import { useSearchParams } from "next/navigation"
import { useState, useEffect, use } from "react"
import { ArrowLeft, Calendar, MapPin } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { StatusBadge, type FileStatus } from "@/components/portal/status-badge"
import { FileTimeline, type Milestone } from "@/components/portal/file-detail/timeline"
import { DocumentsTab, type Document } from "@/components/portal/file-detail/documents-tab"
import { CPLTab } from "@/components/portal/file-detail/cpl-tab"
import { PrelimTab } from "@/components/portal/file-detail/prelim-tab"
import { FeesTab, type FeeItem } from "@/components/portal/file-detail/fees-tab"
import { NotesTab, type Note } from "@/components/portal/file-detail/notes-tab"

const tabs = [
  { id: "timeline", label: "Timeline" },
  { id: "documents", label: "Documents" },
  { id: "cpl", label: "CPL" },
  { id: "prelim", label: "Prelim" },
  { id: "fees", label: "Fees" },
  { id: "notes", label: "Notes" },
]

// Sample file data
const fileData = {
  id: "1",
  fileNumber: "PCT-2024-001847",
  propertyAddress: "1842 Ocean View Drive, Malibu, CA 90265",
  status: "in-process" as FileStatus,
  transactionType: "Purchase",
  openedDate: "March 12, 2024",
  buyer: "Sarah & Michael Chen",
  seller: "The Whitmore Family Trust",
}

const milestones: Milestone[] = [
  {
    id: "1",
    title: "Order Opened",
    status: "completed",
    timestamp: "Mar 12, 2024",
    description: "Purchase order initiated by Sarah Chen",
  },
  {
    id: "2",
    title: "Prelim Received",
    status: "completed",
    timestamp: "Mar 14, 2024",
    description: "Preliminary title report completed",
    documentLink: { label: "View Prelim Report", href: "#" },
  },
  {
    id: "3",
    title: "Title Search",
    status: "completed",
    timestamp: "Mar 15, 2024",
    description: "Full title examination completed",
  },
  {
    id: "4",
    title: "CPL Generated",
    status: "in-progress",
    description: "Closing protection letter pending",
  },
  {
    id: "5",
    title: "Policy Issued",
    status: "pending",
  },
  {
    id: "6",
    title: "Recording",
    status: "pending",
  },
  {
    id: "7",
    title: "Closed",
    status: "pending",
  },
]

const documents: Document[] = [
  {
    id: "1",
    filename: "Purchase_Agreement_Chen.pdf",
    category: "general",
    type: "Purchase Agreement",
    dateAdded: "Mar 12, 2024",
  },
  {
    id: "2",
    filename: "Deed_of_Trust_1842_Ocean_View.pdf",
    category: "general",
    type: "Deed of Trust",
    dateAdded: "Mar 13, 2024",
  },
  {
    id: "3",
    filename: "Title_Clearance_Letter.pdf",
    category: "curative",
    type: "Clearance Letter",
    dateAdded: "Mar 15, 2024",
  },
  {
    id: "4",
    filename: "HOA_Docs_Ocean_View_HOA.pdf",
    category: "supporting",
    type: "HOA Documents",
    dateAdded: "Mar 14, 2024",
  },
]

const prelim = {
  filename: "Prelim_Report_PCT-2024-001847.pdf",
  receivedDate: "March 14, 2024",
  highlights: [
    "Property is subject to CC&Rs recorded March 2001",
    "Existing mortgage with First National Bank to be paid at closing",
    "No liens or judgments against current owners",
    "Property taxes current through 2024",
  ],
}

const fees: FeeItem[] = [
  { id: "1", label: "Owner's Title Insurance Premium", amount: 2850.0 },
  { id: "2", label: "Lender's Title Insurance Premium", amount: 1425.0 },
  { id: "3", label: "Escrow Fee", amount: 1500.0 },
  { id: "4", label: "Recording Fees", amount: 175.0 },
  { id: "5", label: "Notary Fees", amount: 150.0 },
  { id: "6", label: "Wire Transfer Fee", amount: 35.0 },
  { id: "7", label: "Document Preparation", amount: 250.0 },
]

const notes: Note[] = [
  {
    id: "1",
    author: "Jessica Martinez, Escrow Officer",
    content: "Received preliminary title report. All looks clear except for standard CC&Rs. Will proceed with title search.",
    timestamp: "Mar 14, 2024",
  },
  {
    id: "2",
    author: "David Kim, Title Examiner",
    content: "Completed full title examination. Property has clean chain of title going back 50 years. Ready to proceed with CPL generation.",
    timestamp: "Mar 15, 2024",
  },
]

export default function FileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const searchParams = useSearchParams()
  const tabFromUrl = searchParams.get("tab")
  const [activeTab, setActiveTab] = useState(tabFromUrl || "timeline")

  useEffect(() => {
    if (tabFromUrl && tabs.some((t) => t.id === tabFromUrl)) {
      setActiveTab(tabFromUrl)
    }
  }, [tabFromUrl])

  return (
    <div className="max-w-5xl mx-auto">
      {/* Back link */}
      <Link
        href="/client/dashboard"
        className="inline-flex items-center gap-2 text-sm text-[#4B5563] hover:text-[#1B2A4A] mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Files
      </Link>

      {/* File header */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <span className="font-mono text-sm text-[#4B5563] tracking-wide">
              {fileData.fileNumber}
            </span>
            <h1 className="text-2xl font-semibold text-[#1B2A4A] mt-1">
              {fileData.propertyAddress}
            </h1>
          </div>
          <StatusBadge status={fileData.status} className="text-sm px-3 py-1.5" />
        </div>

        <div className="flex flex-wrap items-center gap-6 text-sm text-[#4B5563]">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[#1B2A4A]">{fileData.transactionType}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Opened {fileData.openedDate}
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-[#F3F4F6] rounded-lg">
            <span className="text-[#6B7280]">Buyer:</span>
            <span className="font-medium text-[#1B2A4A]">{fileData.buyer}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-[#F3F4F6] rounded-lg">
            <span className="text-[#6B7280]">Seller:</span>
            <span className="font-medium text-[#1B2A4A]">{fileData.seller}</span>
          </div>
        </div>
      </div>

      {/* Tabs navigation */}
      <div className="border-b border-[#E5E7EB] mb-6">
        <nav className="flex items-center gap-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative pb-4 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "text-[#F26B2B]"
                  : "text-[#4B5563] hover:text-[#1B2A4A]"
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#F26B2B]" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="pb-12">
        {activeTab === "timeline" && (
          <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-8">
            <FileTimeline milestones={milestones} />
          </div>
        )}
        {activeTab === "documents" && <DocumentsTab documents={documents} />}
        {activeTab === "cpl" && <CPLTab />}
        {activeTab === "prelim" && <PrelimTab prelim={prelim} />}
        {activeTab === "fees" && <FeesTab fees={fees} />}
        {activeTab === "notes" && <NotesTab notes={notes} />}
      </div>
    </div>
  )
}
