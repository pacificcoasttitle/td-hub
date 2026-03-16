import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

export interface FeeItem {
  id: string
  label: string
  amount: number
}

interface FeesTabProps {
  fees: FeeItem[]
  isEstimate?: boolean
  className?: string
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

export function FeesTab({ fees, isEstimate = true, className }: FeesTabProps) {
  const total = fees.reduce((sum, fee) => sum + fee.amount, 0)

  return (
    <div className={cn("space-y-6", className)}>
      {/* Estimate disclaimer */}
      {isEstimate && (
        <div className="flex items-start gap-3 p-4 bg-[#FEF3C7] rounded-xl border border-[#FCD34D]">
          <AlertTriangle className="h-5 w-5 text-[#D97706] flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-[#92400E] text-sm">
              Fee Estimate Notice
            </p>
            <p className="text-sm text-[#92400E]/80 mt-1">
              These fees are estimates and may change based on final transaction details. 
              Final fees will be confirmed at closing.
            </p>
          </div>
        </div>
      )}

      {/* Fees table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E5E7EB]">
              <th className="text-left px-6 py-4 text-sm font-medium text-[#4B5563]">
                Description
              </th>
              <th className="text-right px-6 py-4 text-sm font-medium text-[#4B5563]">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {fees.map((fee, index) => (
              <tr
                key={fee.id}
                className={cn(
                  index % 2 === 1 && "bg-[#FAFAFA]"
                )}
              >
                <td className="px-6 py-4 text-sm text-[#1B2A4A]">
                  {fee.label}
                </td>
                <td className="px-6 py-4 text-sm text-[#1B2A4A] text-right font-mono">
                  {formatCurrency(fee.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Total */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#1B2A4A]">
          <span className="font-semibold text-white">Total Estimated Fees</span>
          <span className="font-bold text-white text-lg font-mono">
            {formatCurrency(total)}
          </span>
        </div>
      </div>
    </div>
  )
}
