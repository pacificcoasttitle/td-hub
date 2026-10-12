# TitlePoint Tax Report — Element Inventory & Concierge Classification

**Source:** observed `GetResultByID3` results archived at `metadata.resultData` on
`title_point_data` rows with `search_type = 'tax'`. Derived from 1,133 completed /
result-ready rows since 1 August 2026.

**This is not a vendor XSD.** It is what TitlePoint has actually returned to us. A county
we have not yet searched may add tags. A few names below appear on a single row only.

**A key being present does not mean it has a value.** Empty XML tags archive as `""`.
Several names that look like collections — `TaxingAuthorities`, `Exemptions`, `BackTaxes`,
`BillingAddress`, `PropertyAddress` — have only ever been seen as empty strings.

**Regenerate, don't trust this file:** Q7 of
`scripts/audit/entitlement-denied-tax-confirmations.ts`. Per `EVIDENCE_RULES.md`, the
script is the evidence; this document is a summary of one run of it.

**Coverage gap:** no `TaxReport` is returned at all in the 14 counties where PCTXML01 is
denied (Mono, Santa Clara, Monterey, Sonoma, Marin, Trinity, Tuolumne, Yolo, Butte,
Calaveras, Humboldt, Clark NV, Pima AZ, and one more). Any page built on this payload
must be absent — not blank — on those files.

---

## Stored envelope

```
metadata.resultData  =  GetResultReturn.Result
├── ID
├── ResultType
└── TaxReport          ← everything below
```

Note the two naming traps: land and improvements are `LandValuation` /
`ImprovementsValuation` (there is no `LandValue` / `ImprovementsValue`), and there is no
`FirstInstallment` / `SecondInstallment` wrapper — installments are `Installments.Item`
keyed by `Number` = `1st` / `2nd`.

---

## Classification for the Concierge tax page

Concierge is a **courtesy report given to a homeowner or their agent**. It is not a title
report and not an internal document. That audience drives the classification below more
than data availability does.

### Tier 1 — the page (include)

| Element | Why |
|---|---|
| `TaxYear` | Which year the figures describe |
| `Installments.Item` → `Amount`, `DueDate`, `Status`, `Number` | The single most useful thing to a homeowner: what is owed and when |
| `CurrentYearTotalAmount` / `TotalTax` | Annual total |
| `AssessedValuation` | The number the bill is calculated from |
| `LandValuation`, `ImprovementsValuation` | The split homeowners ask about |
| `TaxRate`, `TaxRateArea` | Explains the amount |
| `RunDate` / `IssueDate` | As-of date. Mandatory on a document read weeks later |

### Tier 2 — high value, include with care

| Element | Why | Care |
|---|---|---|
| `MelloRoos`, `Bonds.Item`, `SpecialAssessments.Item` | Explains a bill higher than the base rate. Heaviest in Riverside / San Bernardino — 363 orders | `Bonds.Item.MaturityDate` is genuinely good content ("assessment matures 2031") |
| `HomeOwnerExemption` | Useful and flattering to show | See exemption warning below |
| `TaxingAuthorities`, `TaxingAuthorityDetails` | Where the money goes | Empty in every row sampled — must degrade cleanly |
| `Supplementals.Item` → `TaxYear`, `EffectiveDate`, `TotalValue`, `DueToDescription`, `Installments` | Explains the post-closing reassessment bill escrow fields calls about | Only populated after a sale or new construction; empty for long-time owners |

### Tier 3 — assessor property characteristics (do not take from here)

`YearBuilt`, `Acreage`, `LandSqFootage`, `ImprovementsSqFootage`, `FullBathCount`,
`HalfBathCount`, `StoriesCount`, `GarageStallCount`, `Cooling`, `FirePlace`,
`ExteriorWall`, `RoofComp`, `UseDescription`, `ApartmentUnitCount`, `Parking`,
`BuildingDescription`, `FeaturesDescription`, `ElementarySchool`, `HighSchool`

These are not tax data and **SiteX already supplies them**. Taking them from here breaks
the one-source-per-field rule and would put two bath counts on one document.

Worth using as a **cross-check**, not a display source: a disagreement between the
assessor's bath count and SiteX's is itself a finding.

### Excluded — must never reach a client-facing report

**Financial distress.** `Delinquent`, `TaxDefaulted`, `TaxSales`, `SoldToState`,
`DeedSold`, `DelinquencyInformation`, `DelinquencyInstallments`, `DelinquencyPayments`,
`DelinquencyInstallmentBalance`, `BackTaxes`, `FutureBackTaxDues`, `CountBackTaxes`,
`OpenPriorYears`, `CountOpenPriorYears`, `PriorYears`, `RedemptionSchedules`,
`RedemptionSchedules2`, `NSF`, `PartialPayment`, `HomesteadPenalty`, `Deferral`,
`InstallmentPlan`, `Litigation`, `FeesLiens`, `Liens`, `Resolutions`, `VabPending`,
`TotalBalanceTaxInstallment`, `NonBilledAmounts`

This is title-clearance work and it is highly valuable **internally**. It does not belong
on a courtesy document — especially one an agent may request about a property whose owner
never asked for it. Printing another person's tax delinquency is disclosing financial
hardship about a third party.

**Protected-characteristic exemptions.** `SeniorExemption`, `SeniorFreezeExemption`,
`DisabledExemption`, `DisabledVetExemption`, `VetReturnExemption`, `WidowExemption`,
`LTOccupantExemption`, `AdditionalHomesteadExemption`, `HomeSteadExemption`,
`GovernmentExemption`, `AllOtherExemption`

Each of these names discloses age, disability, veteran status, or bereavement about the
owner. If exemptions are shown at all, show **`HomeOwnerExemption` only**, or a single
total exemption amount with no category named.

**Leaks our own business.** `RelatedOpenOrders` — other PCT orders on the same parcel.
Must never reach a template.

**Internal plumbing / vendor noise.** `PathSpec`, `PlantName`, `PropertyId`, `TractId`,
`SearchAsPointers`, `SearchAsCollection`, `UnderlyingPropertyXrefs`, `UnderlyingParcels`,
`UnderlyingLegalInfos`, `Messages`, `OutputMessage`, `DocumentSearchType`,
`DocumentInformation`, `Image`, `PropertyImages`, `PropertyImageTypes`, `IsCorrectedBill`,
`ValidForCurrentYear`, `IsInterim`, `AppraisalCorrection`, `RollCorrections`,
`ParcelChanged`, `SplitCombine`, `DoNotIssueCTD`, `TaxAdjustment`, `Comments`,
`YearLastModified`, `Volume`, `ApplyAuditorTaxRate`, `Precision`, `RoundingRule`

---

## Complete element list — `TaxReport` root (159)

Acreage, AdditionalHomesteadExemption, Additionals, AllOtherExemption,
ApartmentUnitCount, APN, ApplyAuditorTaxRate, AppraisalCorrection, AssessedOwners,
AssessedValuation, AssessedValuation2, AuditorTaxRate, BackTaxes, BillingAddress,
BillNumber, BondCount, Bonds, BuildingDescription, CalculatedTaxRate, City, Comments,
ConveyanceDate, ConveyingInstrument, Cooling, CountAdditional, CountBackTaxes,
CountOpenPriorYears, CountSpecialAssessments, CurrentYearTotalAmount, DeedSold, Deferral,
DelinquencyInformation, DelinquencyInstallmentBalance, DelinquencyInstallments,
DelinquencyPayments, Delinquent, Description, DisabledExemption, DisabledVetExemption,
DocumentInformation, DocumentSearchType, DoNotIssueCTD, ElementarySchool, Exemption,
Exemptions, ExteriorWall, FeaturesDescription, FeesLiens, FirePlace, FixturesValuation,
FloodZone, FullBathCount, FutureBackTaxDues, FutureDues, FutureParcels, GarageStallCount,
GovernmentExemption, HalfBathCount, HighSchool, HomeOwnerExemption, HomeSteadExemption,
HomesteadPenalty, Image, ImprovementsFCV2, ImprovementsSqFootage, ImprovementsValuation,
InstallmentPlan, Installments, IsCorrectedBill, IsExempt, IsInterim, IssueDate, LandFCV,
LandFCV2, LandSqFootage, LandValuation, LandValuation2, LastYearTotalAmount, LegalInfos,
Liens, Litigation, LTOccupantExemption, MailingNames, MarketValuation, MelloRoos,
Messages, NetTaxableValue, NonBilledAmounts, NSF, OpenPriorYears, OutputMessage,
ParcelChanged, Parcels, ParcelStatus, Parking, PartialPayment, PaymentAsOf, PaymentDate,
PriorYears, PropertyAddress, PropertyImages, PropertyImageTypes, PropertyStatus,
PropertyValuation, PublicLand, RecordingInformation, RedemptionSchedules,
RedemptionSchedules2, RegionCode, RelatedOpenOrders, RelatedParcels, Resolutions,
RollCorrections, RoofComp, RunDate, SearchAsCollection, SearchAsPointers, SeniorExemption,
SeniorFreezeExemption, SoldToState, SpecialAssessments, SpecialFeaturesValuation,
SplitCombine, StateCodeAndCountyFips, Status, StoriesCount, Supplementals,
TaxabilityCode, TaxableValuation, TaxableValuation2, TaxAdjustment, TaxDefaulted,
TaxingAuthorities, TaxingAuthoritiesBilled, TaxingAuthoritiesNonBilled,
TaxingAuthorityDetails, TaxRate, TaxRateArea, TaxRateSecondary, TaxSales, TaxYear,
TotalBalanceTaxInstallment, TotalDueNoExemption, TotalTax, TransferOwners,
UnderlyingLegalInfos, UnderlyingParcels, UnderlyingPropertyXrefs, UseCode, UseDescription,
VabPending, ValidForCurrentYear, Vesting, VetReturnExemption, Volume, WidowExemption,
YearBuilt, YearLastModified, ZoningCode

---

## Nested elements

Repeating groups are `Parent.Item`.

**Installments.Item** — Amount, AmountPaid, Balance, DueDate, InterestAmount, Number
(`1st` / `2nd`), PaymentDate, Penalty, Status, TaxYear

**Bonds.Item** — Act, AssessmentYear, BookPage, City, County, FiledOnDate,
FurtherInfoCharge, InterestRate, IssuedFor, LienIssuedDate, MaturityDate, PayableTo,
PremiumRate, Series, SeriesAmount, Status, TotalInstallmentCount, TotalNumberOfYears,
WarrantDate

**DelinquencyInformation** — Available, SaleNumber

**DelinquencyInstallments.Item** — AccumulatedInterest, Amount, BillType, Cost, DueDate,
InstallmentNumber, PaymentStatus, Penalty, SupplBill, TaxYear, Underlying

**DelinquencyPayments.Item** — Amount, Description, PaymentDate

**FutureBackTaxDues.Item** — Amount, AmountPaid, Balance, InterestAmount, Penalty, TaxYear

**FutureDues.Item** — Amount, AmountPaid, Balance, DueDate, InterestAmount, Penalty,
TaxYear

**Image** — DocInfo, SubType, Type

**LegalInfos.Item** — ArbTract, Block, Book, Building, CommonLot, County,
ExtraPropertyInfo, FullName, FullNarrative, GoodLegal, HasError, IsAllTract, LegalNVC,
Lot, MajorLegalName, MajorLegalValue, Map, MapBookPage, MapCode, MapDate, NGTPLegal,
Narrative, PI2Property, PI2Tract, Page, Parcel, PathSpec, Phase, PlantName, PlatDocument,
PropertyId, SearchByAPN, ThruPage, Tract, TractId, Unit

**Liens.Item** — Account, Amount, Description, IsMelloRoos, Rate

**Messages.Item** — MessageLevel, MessageText

**OpenPriorYears.Item** — Amount, Balance, InstallmentNumber, Status, Type, Year

**Parcels.Item** — ConveyanceBookNumber, ConveyancePageNumber, ConveyanceRecordedDate,
PropertyUseCode

**PropertyImages.Item** — AllTractImage, Fips, ImageKey, PropertyID, PropertyImageId,
PropertyImageTypeId, RetrievalImageSubType, RetrievalImageType

**PropertyImageTypes.Item** — Abbreviation, Description, IsBackplantImageType,
PropertyImageTypeId, SortOrder, Subcode, Subsubtype, Subtype, Type

**RecordingInformation** — Book, Document, Page, RecordingDate

**RedemptionSchedules.Item** — BaseAmount, InterestStartDate, Precision, RoundingRule,
SimpleInterest, StartDate, Type

**RollCorrections.Item** — ChangeYear, Comment, Index, RevenueAndTaxationCode

**SearchAsCollection** — Book, Lot, Page, Range, Section, Source, Township

**SpecialAssessments.Item** — City, Year

**Supplementals.Item** — AssessedOwners, BillNumber, DueToDescription, EffectiveDate,
ExtendedYear, Installments, IssueDate, RecordingInformation, Remark, SitusAddress,
TaxYear, TotalInstallmentBalance, TotalValue, Type, ValueImprovements, ValueLand

**UnderlyingLegalInfos.Item** — Arb, ArbTract, Block, Book, Case, CaseNumber, CommonLot,
County, ExtraPropertyInfo, FullName, FullNarrative, GoodLegal, HasError, IsAllTract,
LegalNVC, Lot, MajorLegalName, MajorLegalValue, Map, MapBookPage, MapCode, MapDate,
Meridian, NGTPLegal, Narrative, Other, PI2Property, PI2Tract, Page, Parcel, PathSpec,
Phase, PlantName, PlatDocument, PropertyId, Range, SearchByAPN, Section, ThruPage,
Township, Tract, TractId, Unit

**UnderlyingPropertyXrefs.Item** — CountyId, Id, MainPropertyId, OtherPropertyId,
ReferenceType, Remarks, SourceId

### Objects present but with no child keys in this sample

`AssessedOwners`, `DocumentInformation`, `MailingNames`, `RelatedParcels`,
`SearchAsPointers`, `TransferOwners`, `UnderlyingParcels`

---

## What the confirmation email reads today

`src/lib/domain/notifications/tax-result-data.ts` — `parseTaxResultData()`:
TaxRateArea, UseCode, RegionCode, FloodZone, ZoningCode, TaxabilityCode, TaxRate,
IssueDate, LandValuation, ImprovementsValuation, and `Installments.Item` for 1st / 2nd.

Archived and read by nothing: AssessedValuation, TaxableValuation, MarketValuation,
NetTaxableValue, CurrentYearTotalAmount, TotalTax, CalculatedTaxRate, AuditorTaxRate,
Bonds, MelloRoos, Supplementals, LegalInfos, delinquencies, back taxes, exemptions.
