"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronDown, User } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

const navItems = [
  { label: "My Files", href: "/client/dashboard" },
  { label: "Open New Order", href: "/client/orders/new" },
]

export function PortalHeader() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-[#E5E7EB]">
      {/* Top header bar */}
      <div className="flex items-center justify-between px-8 py-4">
        {/* Logo */}
        <Link href="/client/dashboard" className="flex items-center gap-2">
          <span className="text-xl font-semibold tracking-tight text-[#1B2A4A]">
            Pacific Coast Title
          </span>
        </Link>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#F3F4F6] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F26B2B]">
            <Avatar className="h-9 w-9 border border-[#E5E7EB]">
              <AvatarFallback className="bg-[#1B2A4A] text-white text-sm font-medium">
                SC
              </AvatarFallback>
            </Avatar>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[#1B2A4A]">Sarah Chen</span>
              <ChevronDown className="h-4 w-4 text-[#4B5563]" />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem className="flex items-center gap-2">
              <User className="h-4 w-4" />
              My Account
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-[#DC2626]">
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Navigation bar */}
      <nav className="flex items-center gap-8 px-8 pb-0">
        {navItems.map((item) => {
          const isActive = pathname === item.href || 
            (item.href === "/client/dashboard" && pathname.startsWith("/client/orders/") && !pathname.includes("/new"))
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative pb-4 text-sm font-medium transition-colors",
                isActive 
                  ? "text-[#1B2A4A]" 
                  : "text-[#4B5563] hover:text-[#1B2A4A]"
              )}
            >
              {item.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#F26B2B]" />
              )}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
