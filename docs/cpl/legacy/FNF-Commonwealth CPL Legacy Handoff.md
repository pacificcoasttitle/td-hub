 FNF / Commonwealth CPL Legacy Handoff

## Purpose
This note defines the minimum legacy material that should be shared when debugging or rebuilding the FNF / Commonwealth CPL flow.

The goal is simple: give the agent only the files that define truth, so it can compare the current `td-hub` implementation against the real legacy behavior instead of guessing.

## Why This Matters
For FNF / Commonwealth, the legacy PHP implementation is the golden path.

Without the actual legacy source, an agent can infer the broad flow from `td-hub`, but it cannot reliably reconstruct:

- the exact SOAP envelopes
- the exact field mappings
- the exact `Create` vs `Edit` branching logic
- the exact response parsing used for `documentId`, PDF content, and downstream handling
- the exact post-processing behavior after CPL generation

That is how teams lose time: the current app looks reasonable, but the missing legacy truth causes repeated guessing.

## Must Share
These are non-negotiable when doing a serious FNF / Commonwealth CPL investigation.

### 1. Legacy PHP: real source of truth
Required files:

- `application/libraries/order/Fnf.php`
- `application/modules/frontend/controllers/order/Common.php`

Why these matter:

- `application/libraries/order/Fnf.php` is the most important file. It defines the actual FNF/Commonwealth CPL implementation in the legacy app.
- `application/modules/frontend/controllers/order/Common.php` shows how the request enters the system, what data is prepared before the library call, and what create/edit route is chosen.

These files should answer:

- what SOAP envelopes were actually sent
- what XML namespaces and `SOAPAction` headers were used
- how form selection worked
- how request fields were mapped from order data
- how the system decided between create and edit/regenerate behavior
- how the response was parsed into PDF/document identifiers
- what happened after CPL generation succeeded

## Must Share If Referenced
If the legacy FNF code pulls values from config or constants, those files are required too.

Share any config/constants file referenced by `Fnf.php` or `Common.php`, especially if it contains:

- API endpoints
- client ids or API keys
- SOAP actions
- namespaces
- environment-specific toggles
- helper constants used in request building or parsing

Examples of what to look for:

- `config/*`
- constants files
- helper files imported directly by the FNF/Commonwealth path

If a value is hardcoded in legacy and not visible in the current repo, that value is part of the source of truth and should be included.

## Nice To Have
These are not required to start, but they dramatically shorten debugging time.

### 2. Sample working request and response logs
If available, share:

- a working SOAP request XML
- a working SOAP response XML

This is extremely valuable because it removes ambiguity around:

- final envelope shape
- exact field names and ordering
- whether optional nodes were omitted or sent empty
- the real response path for PDF/document identifiers

In practice, a good request/response pair is often the fastest way to validate a port.

## Do Not Bother Sharing
These usually do not help unless the legacy FNF flow directly depends on them.

- UI files
- modal files
- React components
- unrelated services
- database schema, unless it is directly used in field mapping

The agent does not need broad app context here. It needs the files that define the integration contract.

## Recommended Handoff Package
When handing this off for analysis, provide exactly this set first:

1. `application/libraries/order/Fnf.php`
2. `application/modules/frontend/controllers/order/Common.php`
3. Any config/constants referenced by those files
4. A working SOAP request XML, if available
5. A working SOAP response XML, if available

That package is enough to compare:

- legacy FNF/Commonwealth truth
- current `td-hub` implementation in `src/lib/integrations/cpl/fnf`
- any gaps in mapping, SOAP construction, parsing, or post-processing

## Current Repo Context
The current FNF/Commonwealth technical reference in this repo is:

- `docs/CPL_FNF_COMMONWEALTH_GENERATION.md`

That document is useful for understanding how `td-hub` currently works.

But if the goal is to validate correctness against legacy behavior, the current-app docs are not enough by themselves. The legacy PHP files above must be included.
