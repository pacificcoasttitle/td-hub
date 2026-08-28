# CPL — what TD Hub does

Source-derived. Every claim carries `file:line`. No fixes, no recommendations,
no interpretation — this states what the code does so it can be diffed against
the legacy answer line for line.

Commit: `279b673`. Read on 2026-08-28.

**Files involved**

| file | lines |
|---|---:|
| `src/components/shared/action-modals/cpl-modal.tsx` | 487 |
| `src/app/api/vendor-actions/cpl/route.ts` | 122 |
| `src/lib/domain/cpl/service.ts` | 360 |
| `src/lib/integrations/cpl/westcor/payloads.ts` | 612 |
| `src/lib/integrations/cpl/westcor/client.ts` | — |
| `src/lib/integrations/cpl/fnf/client.ts` | 542 |
| `src/lib/integrations/cpl/types.ts` | — |

---

## 1. The full CPL request payload

### 1a. Westcor — Step A, order create/update

`westcor/payloads.ts:239-262`, sent by `createOrUpdateOrder`.

```ts
  const body = {
    tvid: existingTvid ? parseInt(existingTvid, 10) || 0 : 0,
    agentnumber: branch.branchCode,
    agencyname: branch.agencyName,
    agent_file_number: orderDetail.fileNumber,
    email_requestor: 'cpl@pct.com',
    purchase_price: resolvePurchasePrice(orderDetail, input),
    property: buildProperty(orderDetail.property),
    buyers: buildBuyers(orderDetail.buyers),
    sellers: buildSellers(orderDetail.sellers, orderDetail.transactionType),
    lenders: buildLenders(orderDetail, input),
    search: null,
    commitment: null,
    jacket: null,
    sdn: null,
    history: null,
    notes: null as string | null,
    messages: { success: [] as string[], warning: [] as string[], error: [] as string[] },
    actions: ACTIONS_CREATE,
    partnerCode: parseInt(cfg.integrationPartner, 10) || 0,
    cpl: null,
    priors: null,
  };
```

| field | source |
|---|---|
| `tvid` | existing Westcor order id if we hold one, else `0` |
| `agentnumber` | `cpl_branches.branch_code` for the branch the operator picked |
| `agencyname` | `cpl_branches.agency_name` |
| `agent_file_number` | `orders.file_number` |
| `email_requestor` | **hardcoded** `'cpl@pct.com'` (`payloads.ts:244`) |
| `purchase_price` | `resolvePurchasePrice` — see below |
| `property` | `buildProperty` — see 1b |
| `buyers` | `buildBuyers(orderDetail.buyers)` — see §2 |
| `sellers` | `buildSellers` |
| `lenders` | `buildLenders` |
| `search`/`commitment`/`jacket`/`sdn`/`history`/`notes`/`cpl`/`priors` | **always `null`** |
| `messages` | always three empty arrays |
| `actions` | constant `ACTIONS_CREATE` (`payloads.ts:214-227`) |
| `partnerCode` | `WESTCOR_INTEGRATION_PARTNER` env, parsed to int, `0` on failure |

`ACTIONS_CREATE`, `payloads.ts:214-227`:

```ts
const ACTIONS_CREATE = {
  sdn: false,
  update_base: true,
  update_property: true,
  update_lender: true,
  update_buyers: true,
  update_sellers: true,
  update_attorneys: false,
  update_cpls: false,
  update_jacket: false,
  update_search: false,
  update_reinsurance: false,
  update_priors: false,
};
```

`resolvePurchasePrice`, `payloads.ts:98-116` — first non-zero wins, order differs by transaction type:

```ts
  if (txType === 'Purchase') {
    return salesOverride || dbSales || loanOverride || dbLoan || 0;
  }
  if (txType === 'Refinance') {
    return loanOverride || dbLoan || salesOverride || dbSales || 0;
  }
  // Equity, Other, or null — use whichever is nonzero
  return salesOverride || dbSales || loanOverride || dbLoan || 0;
```

`salesOverride` = modal `salesAmount`; `loanOverride` = modal `loanAmount`;
`dbSales` = `orders.sales_price`; `dbLoan` = `orders.loan_amount`.

### 1b. Westcor — entity builders

`buildProperty`, `payloads.ts:120-140`:

```ts
  return [{
    PropertyID: ids?.PropertyID ?? 0,
    tvid: Number(ids?.tvid ?? 0) || 0,
    CountyName: suffixed,
    ShortLegal: null as string | null,
    StreetAddress: prop?.address ?? '',
    City: prop?.city ?? '',
    State: prop?.state ?? 'CA',
    Zip: prop?.zip ?? '',
    PropertyType: 'R',
  }];
```

`CountyName` is the county with `" County"` appended unless it already ends
that way (`payloads.ts:125-128`). `State` defaults to `'CA'`. `PropertyType` is
**hardcoded `'R'`**. `ShortLegal` always `null`.

`buildBuyers`, `payloads.ts:142-159`:

```ts
  return names.map((fullName, i) => ({
    NameID: ids?.[i]?.NameID ?? 0,
    Last: '-',
    First: fullName.trim(),
    NameType: 1,
    JoiningPhrase: 'single',
    tvid: Number(ids?.[i]?.tvid ?? 0) || 0,
    Sequence: i + 1,
    City: null, State: null, Zip: null, Address: null,
  }));
```

The whole name goes in `First` (`payloads.ts:149`); `Last` is **hardcoded
`'-'`** (`payloads.ts:148`). `NameType: 1` (`payloads.ts:150`).

`buildSellers`, `payloads.ts:161-184` — identical shape with `NameType: 2`, and
on Refinance drops names matching `/^tbd\b/i` (`payloads.ts:168`).

`buildLenders`, `payloads.ts:186-212`:

```ts
  if (!lender) return [];
  return [{
    Id: ids?.Id ?? 0,
    tvid: Number(ids?.tvid ?? 0) || 0,
    name:    lenderOverrides?.name    ?? lender.name    ?? '',
    city:    lenderOverrides?.city    ?? lender.city    ?? '',
    state:   lenderOverrides?.state   ?? lender.state   ?? '',
    zip:     lenderOverrides?.zip     ?? lender.zip     ?? '',
    address: lenderOverrides?.address ?? lender.address ?? '',
    phone: null, email: null, countyFIPS: null,
    assignment: input.assignmentClause ?? null,
    mortgageType: null,
    amount: 0,
    loan_number: input.loanNumberOverride ?? '',
    vendorInternalID: null,
  }];
```

`amount` is **hardcoded `0`**. `phone`, `email`, `countyFIPS`, `mortgageType`,
`vendorInternalID` always `null`. Operator input wins over the DB party for
every populated field.

### 1c. Westcor — Step C, the CPL entry

`buildCplEntry`, `payloads.ts:343-371`:

```ts
  return {
    ...templateBase,
    TVID: Number(westcorOrderTvid) || 0,
    CPLID: -1,
    FileInformation: null,
    LetterName: selectedFormName,
    LenderID: westcorLenderId,
    PolicyProducingAgentNumber: templateBase.PolicyProducingAgentNumber ?? branch.branchCode,
    PolicyProducingAgentAddressID: branch.branchCode,
    PolicyProducingAgentAddress: branch.address,
    PolicyProducingAgentCity: branch.city,
    PolicyProducingAgentState: branch.state,
    PolicyProducingAgentZip: branch.zip,
    ProtectLender: true,
    ClosingAgentNumber: 'CA1038',
    IsDualCPL: false,
  };
```

`templateBase` is the Westcor-returned CPL template with `Forms` and
`additionalinfo` deleted (`payloads.ts:350-352`). `CPLID: -1`, `ProtectLender:
true`, `IsDualCPL: false` are constants.

Form choice: `selectCplForm(forms, input.cplMode ?? 'single')`,
`westcor/client.ts:191`.

### 1d. FNF — SOAP parameters

`fnf/client.ts:410-430`:

```ts
      const soapParams: FnfGenerateCplParams = {
        fileNumber: orderDetail.fileNumber,
        branch,
        formName,
        onBehalfOfUser: cfg.onBehalfOfUser,
        userToken,
        borrowerVesting,
        lenderName: input.lenderOverrides?.name ?? lender?.name ?? '',
        lenderAttnName: input.lenderContactName ?? '',
        lenderAddress: input.lenderOverrides?.address ?? lender?.address ?? '',
        lenderCity: input.lenderOverrides?.city ?? lender?.city ?? '',
        lenderState: input.lenderOverrides?.state ?? lender?.state ?? '',
        lenderZip: input.lenderOverrides?.zip ?? lender?.zip ?? '',
        lenderAssignmentClause: input.assignmentClause ?? '',
        loanNumber: input.loanNumberOverride ?? '',
        propertyAddress: propAddr,
        propertyCity: propCity,
        propertyState: propState,
        propertyZip: propZip,
        propertyCounty: propCounty,
        documentId: existingDocId,
      };
```

`formName` is **hardcoded by pattern**, `fnf/client.ts:399`:

```ts
      const formName = `Standard CPL_${propState}`;
```

Property values resolve operator-override first, `fnf/client.ts:385-389`:

```ts
      const propAddr   = input.propertyOverrides?.address ?? prop?.address ?? '';
      const propCity   = input.propertyOverrides?.city    ?? prop?.city    ?? '';
      const propState  = input.propertyOverrides?.state   ?? prop?.state   ?? 'CA';
      const propZip    = input.propertyOverrides?.zip     ?? prop?.zip     ?? '';
      const propCounty = input.propertyOverrides?.county  ?? prop?.county  ?? '';
```

`documentId` comes from `getExistingDocumentId(input.orderId)`
(`fnf/client.ts:402`); non-null routes to EditCPL, null to CreateCPL
(`fnf/client.ts:434`). If EditCPL returns empty, it retries CreateCPL with
`documentId = null` (`fnf/client.ts:445-451`).

**FNF sends no buyers or sellers array.** The only party-derived value is
`borrowerVesting`.

---

## 2. The buyer/borrower path, end to end

### 2a. What the modal collects

`cpl-modal.tsx:146`:

```ts
  const [borrower, setBorrower] = useState('');
```

One free-text field. There is no seller field anywhere in the modal.

### 2b. What reaches the server, under what name

`cpl-modal.tsx:271-276` — the request body:

```ts
        orderId, underwriter, branchId, lenderCompany, lenderContact, assignmentClause,
        lenderAddress: lenderAddr, lenderCity, lenderState, lenderZip,
        propertyAddress: propStreet, propertyCity: propCity, propertyState: propState, propertyZip: propZip,
        loanNumber, loanAmount, salesAmount, borrowerNames: borrower,
```

`borrower` → **`borrowerNames`**.

Route schema `route.ts:45`:

```ts
  borrowerNames: z.string().optional(),
```

Route mapping `route.ts:91`:

```ts
      borrowerNamesOverride: parsed.borrowerNames || undefined,
```

`borrowerNames` → **`borrowerNamesOverride`**, typed at `types.ts:33`.

### 2c. What the preflight checks, and against which table and column

`preflightValidate` is called from **exactly one place** —
`westcor/client.ts:182`. **FNF has no preflight.**

`payloads.ts:52-54`:

```ts
  if (orderDetail.buyers.length === 0) {
    errors.push('At least one buyer/borrower is required.');
  }
```

`orderDetail.buyers` is built at `service.ts:194-196`:

```ts
  const buyers = order.parties
    .filter((p) => p.role === 'buyer')
    .map((p) => p.externalName ?? 'Unknown Buyer');
```

**Table: `order_parties`. Column: `role`, compared `=== 'buyer'`. Name column:
`external_name`.** The role `'borrower'` is never tested, despite the error
string naming it.

Sellers, `service.ts:198-200`:

```ts
  const sellers = order.parties
    .filter((p) => p.role === 'seller')
    .map((p) => p.externalName ?? 'Unknown Seller');
```

`buildOrderDetail` takes exactly two override arguments, `service.ts:189-193`:

```ts
function buildOrderDetail(
  order: OrderWithDetail,
  lenderOverrides?: CplGenerateInput['lenderOverrides'],
  propertyOverrides?: CplGenerateInput['propertyOverrides'],
): CplOrderDetail {
```

`borrowerNamesOverride` is not a parameter. Call site `service.ts:74`:

```ts
  const orderDetail = buildOrderDetail(order, input.lenderOverrides, input.propertyOverrides);
```

### 2d. What actually lands in the payload

**Westcor:** `buyers: buildBuyers(orderDetail.buyers)` (`payloads.ts:247`) —
`order_parties` rows only. The operator's `borrowerNames` is absent from the
Westcor payload entirely.

**FNF:** `fnf/client.ts:407`:

```ts
      const borrowerVesting = input.borrowerNamesOverride || buyerNames || '';
```

with `buyerNames = orderDetail.buyers.join('; ')` (`fnf/client.ts:406`). The
operator's value takes precedence and is sent as `borrowerVesting`.

### 2e. Where the operator's answer is dropped

**Line: `src/lib/domain/cpl/service.ts:74`.** `buildOrderDetail` is called with
`lenderOverrides` and `propertyOverrides` and not with `borrowerNamesOverride`,
so `orderDetail.buyers` is populated only from `order_parties`. The preflight at
`payloads.ts:52` then reads that array.

On the Westcor path the value is dropped for both the check and the payload. On
the FNF path it is dropped for the check — which does not run — and used in the
payload.

### 2f. Purchase vs Refinance

The buyer check is identical for both (`payloads.ts:52`). Two checks are
transaction-type specific:

`payloads.ts:59-67`:

```ts
  if (txType === 'Purchase') {
    if (orderDetail.sellers.length === 0) {
      errors.push('Purchase transactions require at least one seller.');
    }
    const price = resolvePurchasePrice(orderDetail, ctx.input);
    if (price <= 0) {
      errors.push('Purchase transactions require a sales amount greater than zero.');
    }
  }
```

`payloads.ts:69-73`:

```ts
  if (txType === 'Refinance') {
    if (westcorLenderId === 0) {
      errors.push('Refinance transactions require a valid Westcor lender ID. Lender may not have been registered in Westcor.');
    }
  }
```

Refinance also drops `TBD`-prefixed sellers from the payload
(`payloads.ts:168`).

---

## 3. `ClosingAgentNumber`

`payloads.ts:368`:

```ts
    ClosingAgentNumber: 'CA1038',
```

A string literal. It is not derived from the branch, the order, config, or an
environment variable. It is the only occurrence of `CA1038` in `src/`.

`CA1038` is also the value of `cpl_branches.branch_code` for
`Pacific Coast Title - Orange`. Other rows are `CA1038.01` (Glendale),
`CA1038.02` (Oxnard), `CA1038.03` (Concord); 20 rows total.

It sits between `ProtectLender: true` (line 367) and `IsDualCPL: false`
(line 369). The last branch-derived field above it is
`PolicyProducingAgentZip: branch.zip` (line 366).

Not sent on the FNF path — no equivalent field appears in `FnfGenerateCplParams`.

---

## 4. `PolicyProducingAgentNumber`

`payloads.ts:361`:

```ts
    PolicyProducingAgentNumber: templateBase.PolicyProducingAgentNumber ?? branch.branchCode,
```

Two sources, in order:

1. `templateBase.PolicyProducingAgentNumber` — whatever the Westcor CPL
   template returned for the agency, when present and not null/undefined.
2. `branch.branchCode` — `cpl_branches.branch_code` for the operator's branch.

The four sibling fields are unconditionally branch-derived
(`payloads.ts:362-366`): `PolicyProducingAgentAddressID: branch.branchCode`,
then `branch.address` (363), `branch.city` (364), `branch.state` (365),
`branch.zip` (366).

Not sent on the FNF path.

---

## 5. How the underwriter is chosen

Auto-detected client-side, `cpl-modal.tsx:54-63`:

```ts
function detectUnderwriter(order: OrderApiResponse): Underwriter {
  const product = (order.productType ?? '').toLowerCase();
  if (product === 'full alta') return 'fnf';

  const uwName = (order.underwriter?.name ?? '').toUpperCase();
  const uwCode = (order.underwriter?.lookupCode ?? '').toUpperCase();
  if (uwName === 'CW' || uwCode === 'CW') return 'fnf';

  return 'westcor';
}
```

Fields tested: `orders.product_type` (exact match `'full alta'`, lowercased),
then the order's underwriter company name and lookup code (exact match `'CW'`,
uppercased). Everything else → `westcor`.

Initial state before detection is `'westcor'` (`cpl-modal.tsx:120`). The
operator can change it; changing it reloads branches
(`cpl-modal.tsx:159-172`).

The route accepts four values (`route.ts:8`):

```ts
  underwriter: z.enum(['westcor', 'fnf', 'natic', 'doma']),
```

`detectUnderwriter` can only ever return `westcor` or `fnf`.

Adapter dispatch, `service.ts:77`: `const adapter = ADAPTERS[input.underwriter];`

---

## 6. Everything we collect and discard

`borrowerNames` is not the only one.

| collected | reaches the vendor payload? |
|---|---|
| `borrowerNames` (`cpl-modal.tsx:146`) | **FNF only**, as `borrowerVesting` (`fnf/client.ts:407`). Not in the Westcor payload. Not read by the preflight — see §2e. |
| `lenderContact` (`cpl-modal.tsx:128`) | **FNF only**, as `lenderAttnName` (`fnf/client.ts:417`). `buildLenders` (`payloads.ts:186-212`) has no contact field. Stored locally as `cpl_lender_contact` (`service.ts:347`) and on the lender party (`service.ts:325`, `333`). |
| `lenderType` `'existing' \| 'new'` (`cpl-modal.tsx:126`) | **Never sent.** Absent from the request body at `cpl-modal.tsx:271-276`. |
| `txType` (`cpl-modal.tsx:123`) | **Never sent.** Transaction type is re-read server-side from the order. |
| `lenderSearch` / `lenderResults` (`cpl-modal.tsx:134-135`) | **Never sent.** Used to populate the lender fields. |
| `cplMode` | Accepted by the route (`route.ts:10`) and passed to `selectCplForm` (`westcor/client.ts:191`), but **the modal never sends it**, so it is always the `'single'` default. |
| `propertyOverrides.county` | Accepted by the schema (`route.ts:26`) and consumed by FNF (`fnf/client.ts:389`), but **the flat-field builder omits it** (`route.ts:71-79`) and the modal has no county input. County always comes from the DB. |
| `loanAmount` (`cpl-modal.tsx:144`) | Reaches `resolvePurchasePrice` only (`payloads.ts:102`). The Westcor lender `amount` is hardcoded `0` (`payloads.ts:208`). |

Fields sent to the vendor as constants regardless of order data:
`email_requestor: 'cpl@pct.com'` (`payloads.ts:244`), `PropertyType: 'R'`
(`payloads.ts:138`), `Last: '-'` on every buyer and seller (`payloads.ts:148`,
`173`), `JoiningPhrase: 'single'` (`payloads.ts:151`, `176`), `amount: 0`
(`payloads.ts:208`), `CPLID: -1` (`payloads.ts:357`), `ProtectLender: true`
(`payloads.ts:367`), `IsDualCPL: false` (`payloads.ts:369`),
`ClosingAgentNumber: 'CA1038'` (`payloads.ts:368`).

---

## Every pre-submit check we run

### Client-side, in the modal

`cpl-modal.tsx:216-219`, inside `generate()`:

```ts
    if (!branchId) return;
    if (!lenderCompany.trim()) { setResult({ ok: false, error: 'Lender company name is required to generate a CPL.' }); return; }
    if (!propStreet.trim()) { setResult({ ok: false, error: 'Property address is required to generate a CPL.' }); return; }
```

| check | blocks on | operator sees |
|---|---|---|
| `!branchId` | no branch selected | **nothing** — silent `return`, no message |
| `!lenderCompany.trim()` | empty lender company | red box, "Lender company name is required to generate a CPL." |
| `!propStreet.trim()` | empty property street | red box, "Property address is required to generate a CPL." |

Also rendered, not blocking: if no branches are configured for the chosen
underwriter, `cpl-modal.tsx:338` shows "No branches configured for … Contact
admin."

### Server-side, in the service

`service.ts:68-70`:

```ts
  if (!branch) {
    return { success: false, errors: ['CPL branch not found or inactive'] };
  }
```

Blocks on the branch id not matching an `is_active = true` row in
`cpl_branches` (`service.ts:58-67`).

### Server-side preflight — Westcor only

`westcor/client.ts:182`. Not called on the FNF path. All errors are collected
and returned together (`payloads.ts:44-75`).

| # | check | line | message |
|---|---|---|---|
| 1 | `!orderDetail.property?.address` | `payloads.ts:50` | Property address is required. |
| 2 | `orderDetail.buyers.length === 0` | `payloads.ts:52` | At least one buyer/borrower is required. |
| 3 | `!orderDetail.lender?.name` | `payloads.ts:55` | Lender company name is required to generate a CPL. |
| 4 | Purchase and `sellers.length === 0` | `payloads.ts:60` | Purchase transactions require at least one seller. |
| 5 | Purchase and `resolvePurchasePrice(...) <= 0` | `payloads.ts:64` | Purchase transactions require a sales amount greater than zero. |
| 6 | Refinance and `westcorLenderId === 0` | `payloads.ts:70` | Refinance transactions require a valid Westcor lender ID. Lender may not have been registered in Westcor. |

Checks 1 and 3 can be satisfied by operator input, because `lenderOverrides`
and `propertyOverrides` feed `buildOrderDetail` (`service.ts:74`). Check 5 can
be satisfied by the modal's `salesAmount`. Checks 2 and 4 read `order_parties`
and have no override path.

### Measured pass rate

Against all 8,047 orders on 2026-08-28, assuming the operator supplies lender,
property and sales amount — so only checks 2 and 4 can fail:

| transaction type | orders | would pass | no buyer row | no seller row |
|---|---:|---:|---:|---:|
| Refinance | 3,834 | 2,533 (66.1%) | 1,301 | — |
| Purchase | 3,820 | 1,076 (28.2%) | 2,248 | 1,359 |
| Other | 165 | 11 (6.7%) | 154 | — |
| (null) | 228 | 55 (24.1%) | 173 | — |
| **total** | **8,047** | **3,675 (45.7%)** | 3,876 | — |

`order_parties` holds **0 rows** with role `'borrower'` across all 8,047 orders.

By origin: `softpro_sync` 3,667 of 8,039 (45.6%); `manual_entry` 8 of 8 (100%).

---

## 8. Checked against `docs/cpl/legacy/`

Added after the fact, on request. Stated separately from the sections above so
the "what we do" half stays clean.

### What that folder actually contains

| file | what it is |
|---|---|
| `Common.php` (4,110 lines) | **legacy source** |
| `Fnf.php` (669 lines) | **legacy source** |
| `CPL_WESTCOR_GENERATION.md` | **describes OUR code.** Header, line 5: "Source of truth: This document reflects the actual code in `src/lib/integrations/cpl/westcor/`." Dated 2026-03-26. |
| `CPL_FNF_COMMONWEALTH_GENERATION.md` | same kind of document |
| `FNF-Commonwealth CPL Legacy Handoff.md`, `FNF_LIVE_TEST_CHECKLIST.md` | handoff and test notes |

**There is no legacy Westcor source in this repo.** `Common.php` and `Fnf.php`
are the FNF path. `grep -n "CA1038\|ClosingAgentNumber\|cpl@pct" Common.php
Fnf.php` returns nothing.

So every statement below about legacy WESTCOR behaviour is unverifiable from
the files present, and is attributed to `CPL_WESTCOR_GENERATION.md`, which is a
document about our own code containing a "Legacy" column of unknown provenance.
Legacy FNF behaviour IS verifiable and is cited to the PHP.

### 8a. Legacy has no preflight

`grep -nE "required|is required|validate|error\[|throw new" Fnf.php` returns
**no matches**. There is no equivalent of `preflightValidate` on the legacy FNF
path — no buyer check, no seller check, no lender check, no price check.

All six checks listed above are ours.

### 8b. Legacy's borrower is a form field on the order, not a party row

`Fnf.php:331` and `Fnf.php:510`, in both CPL builders:

```php
        $borrower = $orderDetails['borrowers_vesting'];
```

Captured from the submitted form, `Common.php:1688`:

```php
        $borrowers_vesting = $this->input->post('borrowers_vesting');
```

and persisted on the order, `Common.php:1753`:

```php
            'borrowers_vesting' => trim($borrowers_vesting),
```

With a fallback chain when it is empty, `Common.php:2167-2180`:

```php
        if (!empty($orderDetails['borrowers_vesting'])) {
            $orderDetails['borrowers_vesting'] = $orderDetails['borrowers_vesting'];
        } else {
            if (!empty($orderDetails['primary_owner_name'])) {
                $orderDetails['borrowers_vesting'] = $orderDetails['primary_owner_name'];
            }

            if (!empty($orderDetails['secondary_owner_name'])) {
                $orderDetails['borrowers_vesting'] .= " " . $orderDetails['secondary_owner_name'];
            }

            if (!empty($orderDetails['vesting'])) {
                $orderDetails['borrowers_vesting'] .= " " . $orderDetails['vesting'];
            }
        }
```

Legacy never reads a party table for the borrower. It reads one order column,
and falls back to the property's owner names plus the vesting string.

### 8b-2. Legacy has the same defect, unguarded, in two places

Checked because we were about to copy the chain. We did not.

The fallback at `Common.php:2167-2180` has **no transaction-type guard**. It
falls back to `primary_owner_name` whatever kind of transaction the order is.
The identical block appears a second time at `Common.php:2903-2918`.

And nothing requires the operator to fill the field first: searching
`Common.php` for a required-rule on `borrowers_vesting` returns none, and
searching `Fnf.php` for `required|validate|throw new` returns nothing at all.
So the fallback is reachable in ordinary use, not a dead branch.

**On a purchase the owner of record is the seller.** Measured on our book,
comparing `order_properties.primary_owner` against the order's parties by token
set, over every order carrying both:

| | comparable | matches SELLER | matches BUYER |
|---|---:|---:|---:|
| Refinance | 2,057 | 0% | 74% |
| Purchase | 2,298 | **39%** | 21% |

On a refinance the owner is the borrower and legacy's fallback is right. On a
purchase it is the seller — nearly two to one against being the buyer.

So legacy has been capable of printing **the seller's name as the borrower on a
closing protection letter** for as long as that code has run. A CPL is the
underwriter's indemnity to the lender for a named party; the borrower is not a
label.

This is recorded because it is the one place where copying legacy exactly would
have carried a defect across. The chain shipped here is type-dependent: the
owner fallback applies to everything EXCEPT a purchase, and on a purchase an
absent borrower is reported rather than substituted. See
`src/lib/domain/cpl/borrower-resolution.ts`.

Order 8051 — the first real CPL attempt — is the case in miniature: seller
"Kevin Dell", `primary_owner` "DELL KEVIN", no buyer party. Legacy's chain
would have named the seller.

### 8c. The same column exists in our schema and is empty

`order_properties.borrowers_vesting` exists. Measured 2026-08-28:

```
order_properties.borrowers_vesting: 0 populated of 8047 rows
```

Nothing in `src/` writes it. The only references are in proposed-insured
prefill code and its tests (`route.ts:78` of
`src/app/api/orders/batch/proposed-insured/`).

The legacy fallback columns have no equivalent at all: a schema search for
`%vesting%` and `%owner_name%` across every table in `public` returns exactly
one column — `order_properties.borrowers_vesting`. There is no
`primary_owner_name`, no `secondary_owner_name`, no `vesting`.

### 8d. Where our buyer requirement came from

Legacy: one order column, operator-supplied, with a fallback.
Ours: `order_parties` rows with `role = 'buyer'` (`service.ts:194`), required
by `payloads.ts:52` on the Westcor path, with no override.

The two systems do not read the same thing, and legacy imposes no requirement.

### 8e. `ClosingAgentNumber` — what the prior document claims

`CPL_WESTCOR_GENERATION.md:291`:

```
  ClosingAgentNumber: "CA1038",            // Hardcoded PCT closing agent
```

and its parity table, line 430:

```
| `ClosingAgentNumber: "CA1038"` | Hardcoded | Same | Matched |
```

Line 452 adds: "Matches legacy. Could be moved to branch data if PCT gets
multiple closing agent numbers."

The same document, line 285, records `PolicyProducingAgentAddressID: "CA1038"`
as a literal, where our current code uses `branch.branchCode`
(`payloads.ts:362`).

**None of this is verifiable from the files in the folder** — the legacy
Westcor source is not present. It is recorded here as a claim with its
citation, not as a fact.

---

## 9. `loan_amount` is the one field the sweep detects and does not apply

**A correction to an earlier version of this section, which claimed the
lookback sweep was observational. It is not.** `lookback-sync.ts:284` calls
`processOrderDetail`, which writes four tables. The claim was made from
`fieldChanges` being tallied and never applied, without checking whether a
different writer existed. One did.

### What the detector watches — the whole list is two fields

`diffOrder` (`lookback-diff.ts:124-141`) records exactly two non-status
changes, plus the status itself:

| field | detected | applied | where |
|---|---|---|---|
| `operationalStatus` | yes | **yes** | `process-detail.ts:304` |
| `salesPrice` | yes | **yes** | `process-detail.ts:309` |
| `loanAmount` | yes | **no** | `loanAmount` appears **0 times** in `process-detail.ts` |

`fieldChanges` is reporting-only *by design*, and says so at
`lookback-diff.ts:87-88`: "Reporting only — the actual write is
processOrderDetail's, and it may legitimately update more." That is accurate.
`processOrderDetail` also writes `transactionType`, `productType`, `orderType`,
`marketingSource`, `salesRepId`, `titleOfficerId`, `escrowOfficerId`,
`openedAt` and `completedAt`.

So this is **one unapplied field, not a design gap.**

### Why that one is unapplied, in its own words

`lookback-diff.ts:131-133`:

```ts
  // LoanAmount is not in the GetOrderDetails contract yet (Aashima's team is
  // adding it). Reading it defensively means the day it ships, this job starts
  // reporting it with no code change.
```

The detector reads a field the vendor does not send yet. It is a placeholder
waiting on a contract change, not a dropped write — which is why
`process-detail.ts` has no mapping for it either.

**This makes the vendor-side question decisive.** If `LoanAmount` is on the
wire today, the comment is stale and the work is: model it in
`softpro/types.ts`, map it in `processOrderDetail`, done — the detector already
watches it. If it is genuinely absent, there is nothing to sync and
`orders.loan_amount` can only ever be populated by the hub's own create path.

### The measured state either way

| | |
|---|---:|
| `orders.loan_amount > 0` | **2** of 8,062 |
| of which `softpro_sync` (8,054 orders) | 1 |
| of which `manual_entry` (8 orders) | 1 |

One of the two is order 51, the March test order, carrying `2322323.00`. Every
one of the 15 orders created on 2026-08-28 — 7 of them refinances — carries
`loan_amount = NULL`, because all 15 arrived through `softpro_sync`.

Corroborating that `salesPrice` really is applied: purchase orders carrying a
non-zero sales price rise from 64% at 0-1 days old to 98% at 121+ days. The
sweep is doing its job on the field it maps.

### What it costs on the CPL path

`resolvePurchasePrice` for a refinance (`payloads.ts:97-99`) reads
`loanOverride || dbLoan || salesOverride || dbSales`. Of 3,841 refinances,
**1** has `loan_amount > 0` and **2** have `sales_price > 0` — so on 3,839 of
them every database term is empty and the amount is whatever the operator
types.

Until 2026-08-28 the preflight's price check applied to Purchase only, so a
refinance with nothing typed sent `purchase_price: 0` and nothing stopped it.
That check is now unconditional; see §7.

---

## 10. SoftPro does not have the buyer on a purchase, at any age

The question was whether the 41% borrower resolution on purchases is a sync gap
(SoftPro holds a buyer we fail to store) or a SoftPro gap (nobody has it).

`GetOrderContacts`, live, on purchases carrying no buyer party:

| sample | orders | SoftPro HAS a buyer | SoftPro has none | failed |
|---|---:|---:|---:|---:|
| fresh, 0–1 days old | 8 | 0 | 8 | 0 |
| aged, 45–200 days old | 10 | 0 | **10** | 0 |
| **combined** | **18** | **0** | **18** | **0** |

The aged sample is the one that settles it. A brand-new purchase having no
buyer proves nothing — that is simply too early. A 186-day-old purchase with no
buyer in SoftPro means **the buyer is not recorded there and never becomes
recorded there.**

`buyer` came back absent on 10 of the 18 and present-but-blank on 8. Either way
there is no name.

**So this is a SoftPro gap, not a sync gap.** No amount of syncing, enriching or
refreshing will produce a buyer on a purchase, because the data does not exist
upstream to fetch. The 41% is a form design problem: the operator is the only
source, and the interface has to be built around that rather than around
retrieving something that is not there.

This is also why the owner-of-record fallback stays refused on purchases (§8b-2)
— with no buyer anywhere, substituting the seller would be the only thing that
ever filled the field.

### A correction on read latency

An earlier version of this section reported that SoftPro reads are slow enough
to rule out refreshing on modal open, citing two sampling runs that outlived a
ten-minute timeout.

**That was wrong, and the diagnosis was wrong.** Those two runs were hung in our
own client path — they never emitted their first line, before any vendor call.
Re-run as direct `fetch` calls, the same endpoints answer in seconds: ten
`GetOrderContacts` reads and twelve `GetOrderDetails` reads each completed well
inside a single foreground timeout, with zero failures.

The decision to drop refresh-on-modal-open still stands, but on the measurement
that actually supports it: buyer presence is flat with order age (53.9% at 0–1
days, 54.9% at 61+), and per the table above SoftPro has no buyer to give. A
refresh would be fast and would find nothing.

There is a separate, real finding buried in that mistake: **something in the
typed SoftPro client hangs indefinitely on these read paths** where a plain
`fetch` to the same URL returns immediately. Not chased here, and worth its own
look — a client that hangs rather than timing out will eventually hang a
request path that matters.

## 11. `LoanAmount` is on the wire — the comment was stale

Confirmed 2026-08-28 by a direct `GetOrderDetails` call on live refinance
`20021587-OCT`, opened two days earlier. **23 keys returned:**

```
Address, City, CompletedDate, Country, LoanAmount, LoanNumber, MarketingRep,
MarketingSource, ModifiedDate, OrderNumber, OrderStatus, OrderType,
PrimaryContact, ProductType, ReceivedDate, SalesPrice, SalesRepContact,
SettlementType, State, TitleOfficer, TitleOfficerContact, TransactionType, Zip
```

```
LoanAmount = 950000
LoanNumber = "26081931"
SalesPrice = "0"
```

**The two money fields do not share a type.** `LoanAmount` is a NUMBER,
`SalesPrice` is a STRING. Passing the number to the old string-only
`parseSalesPrice` threw on `.trim()`, which is why `parseMoney` accepts both.

### What was actually wrong

Not the vendor. `lookback-diff.ts:131` carried a note saying LoanAmount was
"not in the GetOrderDetails contract yet (Aashima's team is adding it)". That
note outlived the fact, and it is the reason nobody revisited this: the sweep
detected a loanAmount difference on every pass, `process-detail.ts` had no
mapping for it, and the comment explained the gap away.

A stale "not supported yet" comment is worse than no comment. It converts an
open question into a settled one.

### The fix

| part | file |
|---|---|
| model the field | `softpro/types.ts` — `LoanAmount?: string \| number \| null` |
| parse both shapes | `process-detail.ts` — `parseMoney` |
| write it | `process-detail.ts` — `loanAmount: loanAmount ?? undefined` |
| correct the comment | `lookback-diff.ts` |

`undefined` omits the column, so a response without `LoanAmount` leaves the
existing value rather than erasing it — the same `preserveExistingOnEmpty`
contract `salesPrice` already had.

### Measured fill rate

12 refinances currently holding `loan_amount = NULL`, sampled at random and
queried live:

| | |
|---|---:|
| SoftPro has a usable `LoanAmount` | **10 of 12 (83%)** |
| returned `0`, which normalises to null and will not overwrite | 2 |
| call failed | 0 |

The active sweep window is 30–90 days (`LOOKBACK_MIN_AGE_DAYS` = 30,
`LOOKBACK_MAX_AGE_DAYS` = 90). **1,037 refinances sit in it, all 1,037 with
`loan_amount` NULL**, so at the measured rate roughly **864** gain a value on
the next full sweep. A further 2,577 refinances fall in the phase-2 window
(30–180 days) if that is ever run.

**One thing the sample surfaced that the fill rate hides:** two of the ten
usable values were `LoanAmount = 10`. A ten-dollar loan is not a real figure.
The field being present does not make it sane, and the CPL price check added in
§7 blocks zero but not ten. Worth a look before anyone treats
`orders.loan_amount` as trustworthy for anything beyond "is there a number
here".
