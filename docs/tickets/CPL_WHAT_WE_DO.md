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
