import Link from "next/link"
import { Plus, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FileCard, type FileData } from "@/components/portal/file-card"
import { ActivityFeed, type Activity } from "@/components/portal/activity-feed"
import { EmptyState } from "@/components/portal/empty-state"

// Sample data - in production this would come from your database
const sampleFiles: FileData[] = [
  {
    id: "1",
    fileNumber: "PCT-2024-001847",
    propertyAddress: "1842 Ocean View Drive, Malibu, CA 90265",
    status: "in-process",
    transactionType: "Purchase",
    openedDate: "Mar 12, 2024",
  },
  {
    id: "2",
    fileNumber: "PCT-2024-001832",
    propertyAddress: "455 Sunset Boulevard, Los Angeles, CA 90028",
    status: "open",
    transactionType: "Refinance",
    openedDate: "Mar 10, 2024",
  },
  {
    id: "3",
    fileNumber: "PCT-2024-001815",
    propertyAddress: "2901 Pacific Coast Highway, Newport Beach, CA 92663",
    status: "completed",
    transactionType: "Purchase",
    openedDate: "Mar 5, 2024",
  },
  {
    id: "4",
    fileNumber: "PCT-2024-001798",
    propertyAddress: null,
    status: "open",
    transactionType: "Purchase",
    openedDate: "Mar 3, 2024",
  },
  {
    id: "5",
    fileNumber: "PCT-2024-001776",
    propertyAddress: "8750 Wilshire Boulevard, Beverly Hills, CA 90211",
    status: "closed",
    transactionType: "Refinance",
    openedDate: "Feb 28, 2024",
  },
  {
    id: "6",
    fileNumber: "PCT-2024-001752",
    propertyAddress: "321 Harbor View Lane, San Diego, CA 92101",
    status: "in-process",
    transactionType: "Purchase",
    openedDate: "Feb 25, 2024",
  },
]

const sampleActivities: Activity[] = [
  {
    id: "1",
    type: "document-added",
    fileNumber: "PCT-2024-001847",
    propertyAddress: "1842 Ocean View Drive, Malibu",
    timestamp: "2 hours ago",
  },
  {
    id: "2",
    type: "cpl-generated",
    fileNumber: "PCT-2024-001815",
    propertyAddress: "2901 Pacific Coast Highway, Newport Beach",
    timestamp: "Yesterday",
  },
  {
    id: "3",
    type: "prelim-uploaded",
    fileNumber: "PCT-2024-001832",
    propertyAddress: "455 Sunset Boulevard, Los Angeles",
    timestamp: "Yesterday",
  },
  {
    id: "4",
    type: "file-opened",
    fileNumber: "PCT-2024-001847",
    propertyAddress: "1842 Ocean View Drive, Malibu",
    timestamp: "Mar 12",
  },
  {
    id: "5",
    type: "fees-updated",
    fileNumber: "PCT-2024-001776",
    propertyAddress: "8750 Wilshire Boulevard, Beverly Hills",
    timestamp: "Mar 11",
  },
]

const user = {
  firstName: "Sarah",
}

const activeFileCount = sampleFiles.filter(
  (f) => f.status === "open" || f.status === "in-process"
).length

export default function DashboardPage() {
  const hasFiles = sampleFiles.length > 0

  return (
    <div className="max-w-7xl mx-auto">
      {/* Welcome Section */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-semibold text-[#1B2A4A] mb-1">
            Welcome back, {user.firstName}
          </h1>
          <p className="text-[#4B5563]">
            You have {activeFileCount} active {activeFileCount === 1 ? "file" : "files"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            asChild
            variant="outline"
            className="border-[#1B2A4A] text-[#1B2A4A] hover:bg-[#1B2A4A]/5"
          >
            <Link href="/client/orders/new">
              <Upload className="h-4 w-4 mr-2" />
              Upload Document
            </Link>
          </Button>
          <Button asChild className="bg-[#F26B2B] hover:bg-[#E05A1A] text-white">
            <Link href="/client/orders/new">
              <Plus className="h-4 w-4 mr-2" />
              Open New Order
            </Link>
          </Button>
        </div>
      </div>

      {hasFiles ? (
        <>
          {/* File Grid */}
          <section className="mb-12">
            <h2 className="text-lg font-semibold text-[#1B2A4A] mb-6">
              Your Files
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sampleFiles.map((file) => (
                <FileCard key={file.id} file={file} />
              ))}
            </div>
          </section>

          {/* Recent Activity */}
          <section>
            <h2 className="text-lg font-semibold text-[#1B2A4A] mb-6">
              Recent Activity
            </h2>
            <ActivityFeed activities={sampleActivities} />
          </section>
        </>
      ) : (
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm">
          <EmptyState type="no-files" />
        </div>
      )}
    </div>
  )
}
