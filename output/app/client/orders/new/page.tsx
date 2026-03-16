"use client"

import { useState } from "react"
import { ArrowLeft, ArrowRight, Check, MapPin, Building, User, Users, FileText, ClipboardList } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const steps = [
  { id: 1, label: "Order Type", icon: FileText },
  { id: 2, label: "Property", icon: Building },
  { id: 3, label: "Parties", icon: Users },
  { id: 4, label: "Transaction", icon: ClipboardList },
  { id: 5, label: "Contacts", icon: User },
  { id: 6, label: "Review", icon: Check },
]

const orderTypes = [
  { id: "purchase", label: "Purchase", description: "Standard property purchase transaction" },
  { id: "refinance", label: "Refinance", description: "Refinancing an existing mortgage" },
  { id: "sale", label: "Sale", description: "Property sale transaction" },
  { id: "equity", label: "Home Equity", description: "Home equity loan or line of credit" },
]

export default function NewOrderPage() {
  const [currentStep, setCurrentStep] = useState(1)
  const [formData, setFormData] = useState({
    orderType: "",
    propertyAddress: "",
    propertyCity: "",
    propertyState: "CA",
    propertyZip: "",
    propertyCounty: "",
    propertyType: "",
    apn: "",
    buyerFirstName: "",
    buyerLastName: "",
    buyerEmail: "",
    buyerPhone: "",
    sellerFirstName: "",
    sellerLastName: "",
    sellerEmail: "",
    purchasePrice: "",
    loanAmount: "",
    closingDate: "",
    lenderName: "",
    lenderEmail: "",
    lenderPhone: "",
    agentName: "",
    agentEmail: "",
    agentPhone: "",
  })

  const updateFormData = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const nextStep = () => {
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1)
    }
  }

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const goToStep = (step: number) => {
    if (step <= currentStep) {
      setCurrentStep(step)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back link */}
      <Link
        href="/client/dashboard"
        className="inline-flex items-center gap-2 text-sm text-[#4B5563] hover:text-[#1B2A4A] mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-[#1B2A4A] mb-2">
          Open New Order
        </h1>
        <p className="text-[#4B5563]">
          Complete the form below to submit your title order
        </p>
      </div>

      {/* Progress steps */}
      <div className="mb-10">
        <div className="flex items-center justify-between">
          {steps.map((step, index) => {
            const isCompleted = currentStep > step.id
            const isCurrent = currentStep === step.id
            const Icon = step.icon

            return (
              <div key={step.id} className="flex items-center">
                <button
                  onClick={() => goToStep(step.id)}
                  disabled={step.id > currentStep}
                  className={cn(
                    "flex flex-col items-center gap-2 transition-all",
                    step.id <= currentStep ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                  )}
                >
                  <div
                    className={cn(
                      "w-12 h-12 rounded-full flex items-center justify-center transition-all",
                      isCompleted
                        ? "bg-[#1B2A4A] text-white"
                        : isCurrent
                        ? "bg-[#F26B2B] text-white"
                        : "bg-[#F3F4F6] text-[#9CA3AF]"
                    )}
                  >
                    {isCompleted ? (
                      <Check className="h-5 w-5" />
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium",
                      isCurrent ? "text-[#F26B2B]" : "text-[#4B5563]"
                    )}
                  >
                    {step.label}
                  </span>
                </button>
                {index < steps.length - 1 && (
                  <div
                    className={cn(
                      "w-16 h-0.5 mx-2",
                      currentStep > step.id ? "bg-[#1B2A4A]" : "bg-[#E5E7EB]"
                    )}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Form content */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-8">
        {/* Step 1: Order Type */}
        {currentStep === 1 && (
          <div>
            <h2 className="text-xl font-semibold text-[#1B2A4A] mb-2">
              Select Order Type
            </h2>
            <p className="text-[#4B5563] mb-6">
              Choose the type of transaction for this order
            </p>

            <div className="grid grid-cols-2 gap-4">
              {orderTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => updateFormData("orderType", type.id)}
                  className={cn(
                    "p-6 rounded-xl border-2 text-left transition-all",
                    formData.orderType === type.id
                      ? "border-[#F26B2B] bg-[#F26B2B]/5"
                      : "border-[#E5E7EB] hover:border-[#D1D5DB]"
                  )}
                >
                  <h3 className="font-semibold text-[#1B2A4A] mb-1">
                    {type.label}
                  </h3>
                  <p className="text-sm text-[#4B5563]">{type.description}</p>
                  {formData.orderType === type.id && (
                    <div className="mt-3">
                      <Check className="h-5 w-5 text-[#F26B2B]" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Property */}
        {currentStep === 2 && (
          <div>
            <h2 className="text-xl font-semibold text-[#1B2A4A] mb-2">
              Property Information
            </h2>
            <p className="text-[#4B5563] mb-6">
              Enter the property details for this transaction
            </p>

            <div className="space-y-6">
              {/* Address with map preview placeholder */}
              <div className="grid grid-cols-3 gap-6">
                <div className="col-span-2 space-y-4">
                  <div>
                    <Label htmlFor="propertyAddress" className="text-[#1B2A4A] font-medium">
                      Street Address
                    </Label>
                    <div className="relative mt-1.5">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-[#9CA3AF]" />
                      <Input
                        id="propertyAddress"
                        placeholder="123 Main Street"
                        value={formData.propertyAddress}
                        onChange={(e) => updateFormData("propertyAddress", e.target.value)}
                        className="h-12 pl-10 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="propertyCity" className="text-[#1B2A4A] font-medium">
                        City
                      </Label>
                      <Input
                        id="propertyCity"
                        placeholder="Los Angeles"
                        value={formData.propertyCity}
                        onChange={(e) => updateFormData("propertyCity", e.target.value)}
                        className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                      />
                    </div>
                    <div>
                      <Label htmlFor="propertyState" className="text-[#1B2A4A] font-medium">
                        State
                      </Label>
                      <Input
                        id="propertyState"
                        value={formData.propertyState}
                        onChange={(e) => updateFormData("propertyState", e.target.value)}
                        className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                      />
                    </div>
                    <div>
                      <Label htmlFor="propertyZip" className="text-[#1B2A4A] font-medium">
                        ZIP Code
                      </Label>
                      <Input
                        id="propertyZip"
                        placeholder="90210"
                        value={formData.propertyZip}
                        onChange={(e) => updateFormData("propertyZip", e.target.value)}
                        className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="propertyCounty" className="text-[#1B2A4A] font-medium">
                        County
                      </Label>
                      <Input
                        id="propertyCounty"
                        placeholder="Los Angeles County"
                        value={formData.propertyCounty}
                        onChange={(e) => updateFormData("propertyCounty", e.target.value)}
                        className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                      />
                    </div>
                    <div>
                      <Label htmlFor="apn" className="text-[#1B2A4A] font-medium">
                        APN (Optional)
                      </Label>
                      <Input
                        id="apn"
                        placeholder="1234-567-890"
                        value={formData.apn}
                        onChange={(e) => updateFormData("apn", e.target.value)}
                        className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                      />
                    </div>
                  </div>
                </div>

                {/* Map preview area */}
                <div className="bg-[#F3F4F6] rounded-xl flex items-center justify-center border border-[#E5E7EB]">
                  <div className="text-center p-6">
                    <MapPin className="h-10 w-10 text-[#9CA3AF] mx-auto mb-3" />
                    <p className="text-sm text-[#4B5563]">
                      Map preview will appear here
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Parties */}
        {currentStep === 3 && (
          <div>
            <h2 className="text-xl font-semibold text-[#1B2A4A] mb-2">
              Party Information
            </h2>
            <p className="text-[#4B5563] mb-6">
              Enter the buyer and seller details
            </p>

            <div className="space-y-8">
              {/* Buyer section */}
              <div>
                <h3 className="font-medium text-[#1B2A4A] mb-4 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#DBEAFE] flex items-center justify-center">
                    <User className="h-3.5 w-3.5 text-[#1E40AF]" />
                  </div>
                  Buyer Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="buyerFirstName" className="text-[#1B2A4A] font-medium">
                      First Name
                    </Label>
                    <Input
                      id="buyerFirstName"
                      placeholder="John"
                      value={formData.buyerFirstName}
                      onChange={(e) => updateFormData("buyerFirstName", e.target.value)}
                      className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                  <div>
                    <Label htmlFor="buyerLastName" className="text-[#1B2A4A] font-medium">
                      Last Name
                    </Label>
                    <Input
                      id="buyerLastName"
                      placeholder="Smith"
                      value={formData.buyerLastName}
                      onChange={(e) => updateFormData("buyerLastName", e.target.value)}
                      className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                  <div>
                    <Label htmlFor="buyerEmail" className="text-[#1B2A4A] font-medium">
                      Email Address
                    </Label>
                    <Input
                      id="buyerEmail"
                      type="email"
                      placeholder="john@example.com"
                      value={formData.buyerEmail}
                      onChange={(e) => updateFormData("buyerEmail", e.target.value)}
                      className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                  <div>
                    <Label htmlFor="buyerPhone" className="text-[#1B2A4A] font-medium">
                      Phone Number
                    </Label>
                    <Input
                      id="buyerPhone"
                      type="tel"
                      placeholder="(555) 123-4567"
                      value={formData.buyerPhone}
                      onChange={(e) => updateFormData("buyerPhone", e.target.value)}
                      className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                </div>
              </div>

              {/* Seller section */}
              <div>
                <h3 className="font-medium text-[#1B2A4A] mb-4 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#FEF3C7] flex items-center justify-center">
                    <User className="h-3.5 w-3.5 text-[#92400E]" />
                  </div>
                  Seller Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="sellerFirstName" className="text-[#1B2A4A] font-medium">
                      First Name
                    </Label>
                    <Input
                      id="sellerFirstName"
                      placeholder="Jane"
                      value={formData.sellerFirstName}
                      onChange={(e) => updateFormData("sellerFirstName", e.target.value)}
                      className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                  <div>
                    <Label htmlFor="sellerLastName" className="text-[#1B2A4A] font-medium">
                      Last Name
                    </Label>
                    <Input
                      id="sellerLastName"
                      placeholder="Doe"
                      value={formData.sellerLastName}
                      onChange={(e) => updateFormData("sellerLastName", e.target.value)}
                      className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="sellerEmail" className="text-[#1B2A4A] font-medium">
                      Email Address
                    </Label>
                    <Input
                      id="sellerEmail"
                      type="email"
                      placeholder="jane@example.com"
                      value={formData.sellerEmail}
                      onChange={(e) => updateFormData("sellerEmail", e.target.value)}
                      className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Transaction */}
        {currentStep === 4 && (
          <div>
            <h2 className="text-xl font-semibold text-[#1B2A4A] mb-2">
              Transaction Details
            </h2>
            <p className="text-[#4B5563] mb-6">
              Enter the financial details of this transaction
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="purchasePrice" className="text-[#1B2A4A] font-medium">
                    Purchase Price
                  </Label>
                  <div className="relative mt-1.5">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]">$</span>
                    <Input
                      id="purchasePrice"
                      placeholder="1,250,000"
                      value={formData.purchasePrice}
                      onChange={(e) => updateFormData("purchasePrice", e.target.value)}
                      className="h-12 pl-8 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="loanAmount" className="text-[#1B2A4A] font-medium">
                    Loan Amount
                  </Label>
                  <div className="relative mt-1.5">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]">$</span>
                    <Input
                      id="loanAmount"
                      placeholder="1,000,000"
                      value={formData.loanAmount}
                      onChange={(e) => updateFormData("loanAmount", e.target.value)}
                      className="h-12 pl-8 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                </div>
              </div>
              <div>
                <Label htmlFor="closingDate" className="text-[#1B2A4A] font-medium">
                  Estimated Closing Date
                </Label>
                <Input
                  id="closingDate"
                  type="date"
                  value={formData.closingDate}
                  onChange={(e) => updateFormData("closingDate", e.target.value)}
                  className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Contacts */}
        {currentStep === 5 && (
          <div>
            <h2 className="text-xl font-semibold text-[#1B2A4A] mb-2">
              Additional Contacts
            </h2>
            <p className="text-[#4B5563] mb-6">
              Add lender and agent contact information
            </p>

            <div className="space-y-8">
              {/* Lender section */}
              <div>
                <h3 className="font-medium text-[#1B2A4A] mb-4 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#D1FAE5] flex items-center justify-center">
                    <Building className="h-3.5 w-3.5 text-[#065F46]" />
                  </div>
                  Lender Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label htmlFor="lenderName" className="text-[#1B2A4A] font-medium">
                      Lender / Institution Name
                    </Label>
                    <Input
                      id="lenderName"
                      placeholder="First National Bank"
                      value={formData.lenderName}
                      onChange={(e) => updateFormData("lenderName", e.target.value)}
                      className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                  <div>
                    <Label htmlFor="lenderEmail" className="text-[#1B2A4A] font-medium">
                      Lender Email
                    </Label>
                    <Input
                      id="lenderEmail"
                      type="email"
                      placeholder="loans@firstnational.com"
                      value={formData.lenderEmail}
                      onChange={(e) => updateFormData("lenderEmail", e.target.value)}
                      className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                  <div>
                    <Label htmlFor="lenderPhone" className="text-[#1B2A4A] font-medium">
                      Lender Phone
                    </Label>
                    <Input
                      id="lenderPhone"
                      type="tel"
                      placeholder="(555) 987-6543"
                      value={formData.lenderPhone}
                      onChange={(e) => updateFormData("lenderPhone", e.target.value)}
                      className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                </div>
              </div>

              {/* Agent section */}
              <div>
                <h3 className="font-medium text-[#1B2A4A] mb-4 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#E0E7FF] flex items-center justify-center">
                    <User className="h-3.5 w-3.5 text-[#3730A3]" />
                  </div>
                  Real Estate Agent (Optional)
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label htmlFor="agentName" className="text-[#1B2A4A] font-medium">
                      Agent Name
                    </Label>
                    <Input
                      id="agentName"
                      placeholder="Michael Johnson"
                      value={formData.agentName}
                      onChange={(e) => updateFormData("agentName", e.target.value)}
                      className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                  <div>
                    <Label htmlFor="agentEmail" className="text-[#1B2A4A] font-medium">
                      Agent Email
                    </Label>
                    <Input
                      id="agentEmail"
                      type="email"
                      placeholder="michael@realty.com"
                      value={formData.agentEmail}
                      onChange={(e) => updateFormData("agentEmail", e.target.value)}
                      className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                  <div>
                    <Label htmlFor="agentPhone" className="text-[#1B2A4A] font-medium">
                      Agent Phone
                    </Label>
                    <Input
                      id="agentPhone"
                      type="tel"
                      placeholder="(555) 456-7890"
                      value={formData.agentPhone}
                      onChange={(e) => updateFormData("agentPhone", e.target.value)}
                      className="h-12 mt-1.5 rounded-lg border-[#E5E7EB] focus:border-[#F26B2B] focus:ring-[#F26B2B]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 6: Review */}
        {currentStep === 6 && (
          <div>
            <h2 className="text-xl font-semibold text-[#1B2A4A] mb-2">
              Review Your Order
            </h2>
            <p className="text-[#4B5563] mb-6">
              Please review all information before submitting
            </p>

            <div className="space-y-6">
              {/* Order Type Summary */}
              <div className="p-4 bg-[#FAFAFA] rounded-xl border border-[#E5E7EB]">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-[#1B2A4A]">Order Type</h4>
                  <button
                    onClick={() => setCurrentStep(1)}
                    className="text-sm text-[#F26B2B] hover:text-[#E05A1A]"
                  >
                    Edit
                  </button>
                </div>
                <p className="text-[#4B5563] capitalize">{formData.orderType || "Not selected"}</p>
              </div>

              {/* Property Summary */}
              <div className="p-4 bg-[#FAFAFA] rounded-xl border border-[#E5E7EB]">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-[#1B2A4A]">Property</h4>
                  <button
                    onClick={() => setCurrentStep(2)}
                    className="text-sm text-[#F26B2B] hover:text-[#E05A1A]"
                  >
                    Edit
                  </button>
                </div>
                <p className="text-[#4B5563]">
                  {formData.propertyAddress
                    ? `${formData.propertyAddress}, ${formData.propertyCity}, ${formData.propertyState} ${formData.propertyZip}`
                    : "Not provided"}
                </p>
              </div>

              {/* Parties Summary */}
              <div className="p-4 bg-[#FAFAFA] rounded-xl border border-[#E5E7EB]">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-[#1B2A4A]">Parties</h4>
                  <button
                    onClick={() => setCurrentStep(3)}
                    className="text-sm text-[#F26B2B] hover:text-[#E05A1A]"
                  >
                    Edit
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-[#6B7280]">Buyer: </span>
                    <span className="text-[#4B5563]">
                      {formData.buyerFirstName && formData.buyerLastName
                        ? `${formData.buyerFirstName} ${formData.buyerLastName}`
                        : "Not provided"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#6B7280]">Seller: </span>
                    <span className="text-[#4B5563]">
                      {formData.sellerFirstName && formData.sellerLastName
                        ? `${formData.sellerFirstName} ${formData.sellerLastName}`
                        : "Not provided"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Transaction Summary */}
              <div className="p-4 bg-[#FAFAFA] rounded-xl border border-[#E5E7EB]">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-[#1B2A4A]">Transaction</h4>
                  <button
                    onClick={() => setCurrentStep(4)}
                    className="text-sm text-[#F26B2B] hover:text-[#E05A1A]"
                  >
                    Edit
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-[#6B7280]">Purchase Price: </span>
                    <span className="text-[#4B5563]">
                      {formData.purchasePrice ? `$${formData.purchasePrice}` : "Not provided"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#6B7280]">Loan Amount: </span>
                    <span className="text-[#4B5563]">
                      {formData.loanAmount ? `$${formData.loanAmount}` : "Not provided"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-[#E5E7EB]">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={currentStep === 1}
            className="border-[#1B2A4A] text-[#1B2A4A] hover:bg-[#1B2A4A]/5 disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          {currentStep < steps.length ? (
            <Button
              onClick={nextStep}
              className="bg-[#F26B2B] hover:bg-[#E05A1A] text-white"
            >
              Continue
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button className="bg-[#F26B2B] hover:bg-[#E05A1A] text-white px-8">
              Submit Your Order
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
