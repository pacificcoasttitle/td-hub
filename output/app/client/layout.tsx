import { PortalHeader } from "@/components/portal/header"

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <PortalHeader />
      <main className="px-8 py-8">
        {children}
      </main>
    </div>
  )
}
