# Phase 7 Report — Invoices, Payments & Financial Overview

*Date: 2026-09-28 · Scope: the founder's Phase 7 prompt (`docs/PHASES.md`) ·
Status: **delivered**. Local only — nothing pushed, nothing deployed.*

## Summary

Advertise X now bills its clients. The founder drafts an invoice (lines can
start from the client's services), sends it, and it takes the next number
(INV-0013, INV-0014…). It is emailed as a branded PDF and appears in the
client's portal. Payments are recorded as they arrive, in full or in part.
Invoices past their due date become Overdue each morning, and the founder
and the client are told once.

A new **Finance** page shows:
- money received, pending, outstanding and overdue;
- MRR and ARR;
- new clients and closed deals;
- revenue by client and by service, and a 12-month trend chart;
- CSV exports.

Every figure reconciles to the cent with the invoices and payments.
`billingtest` (102 checks with Stripe on, 100 with it off) recomputes each
figure from the database and compares.

Money is handled as integer cents throughout. Rounding happens once per line,
by a documented rule. Payment recording is idempotent, and every change is
audit-logged.

**Gate note.** The founder sent the Phase 7 prompt after the Phase 6 report,
without the literal "Phase 6 approved". As at every earlier handover, I
treated that as the go-ahead and recorded it in PHASE_LOG.

## Scope items

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 1 | Invoice model | ✅ Sequential number per organization (taken when sent, never reused, no gaps), client, optional project, line items (service, quantity, rate, amount), currency, issue and due dates, notes. Status Draft → Sent → Partially paid / Paid / Overdue / Void. A branded PDF (dark header band with the gold mark, then a white print-friendly page). Sending emails it with the PDF attached. | `/invoices`, `modules/billing/*` |
| 2 | Payments | ✅ Record a payment (method, date, amount, reference); partial payments; full history with reversals (kept, with who and why). An overdue job runs each morning and on demand ("Check overdue"): it changes the status and notifies the founders and the client's owners once. | invoice detail, `lifecycle.ts` |
| 3 | Financial overview | ✅ New clients, closed deals, MRR and ARR, payments received, invoiced, pending, outstanding, overdue, revenue by client, revenue by service, MRR by service, a 12-month trend (received against invoiced). Four periods. Summary, payments and invoices CSV exports. | `/finance` |
| 4 | Client portal | ✅ Own invoices with statuses and balances, an invoice page (lines, payment history, notes), PDF download. Account owners only; never a draft. A "Pay" button appears only when online payments are on. | `/portal/invoices`, `/portal/invoices/[id]` |
| 5 | Money handling | ✅ Integer cents (quantities in thousandths), parsed from text without floats, BigInt where products could overflow, rounding half away from zero once per line, largest-remainder allocation. Idempotent payment recording (replays and simultaneous duplicates record once). Invoice, InvoiceLine and Payment are audited. Tests cover totals, partial payments and overdue transitions. | `money.ts`, `domain.ts`, `docs/METRICS.md` |
| 6 | Stripe | ✅ A payments-provider interface with a Stripe adapter (Checkout Sessions over REST) and a verified webhook (HMAC signature, 5-minute replay window, idempotent by event id). Off unless `STRIPE_ENABLED=true` with both keys; when off, the webhook and pay routes answer 404 and no button shows. | `modules/integrations/payments`, `/api/webhooks/stripe` |

Also: Settings → **Billing** (number prefix, currency, payment terms, the
address and email printed on invoices; the next number is shown, never
editable). Invoices also appear on the client profile's "Services & billing"
tab, with a "New invoice" shortcut.

## How to test it

Run `npm run dev` and open http://localhost:3000.

- **As the founder** (`coachd@bwm.local`):
  - *Finance*: the demo's six months of invoices and payments. Switch the period, and download the CSVs.
  - *Invoices*: Osteria Nonna's INV-0012 is part-paid and Bao Society's INV-0011 is overdue. INV-0007 is void, and Grind Coffee has a draft.
  - *New invoice*: pick a client and its services fill the lines. Try a quantity of 1.5, or a negative rate for a discount. *Save and send*, then *Record payment* for part of it, then the rest.
  - *PDF* downloads the branded invoice.
  - *Settings → Billing* sets your address and prefix.
- **As the client** (`marco@osterianonna.example`): *Invoices* lists them with balances. Open one for its lines and payment history, and download the PDF.
- **Automated:** `SMOKE_BASE=http://localhost:3000 npm run billingtest`.

## Acceptance

- **Financial numbers reconcile across invoices, payments and dashboards
  (tests).** `billingtest` recomputes the following from the database and
  compares each with the Finance API, for both this month and 12 months:
  - every invoice's paid total against its live payments;
  - payments received, invoiced, pending, overdue and outstanding
    (outstanding must equal pending plus overdue);
  - revenue by client and by service, which must each sum to payments
    received;
  - the 12-month trend and MRR/ARR;
  - the CSV export.

  Unit tests prove the same with fixed data (`tests/billing-domain.test.ts`, 16).
- **A client sees only its own billing (tests).**
  - Client A never sees B's invoice in its list. Its detail and PDF return
    404, and the portal page shows "not available" with nothing of B in it.
    The same holds the other way.
  - A member (not the owner) sees no invoices, details or PDFs.
  - Clients, managers and employees are refused every staff billing API
    (list, detail, PDF, overview, export, payments, sweep, create).
  - Managers can't open `/finance` or `/invoices`.

  Unit tests cover the permission matrix and tenancy scoping of the three
  new models.
- **MRR and revenue formulas documented.** `docs/METRICS.md` → "Money" and
  "The financial overview".
- **Totals, partial payments and overdue transitions tested.**
  - Totals: 1.5 × 1,000.01 rounds to 1,500.02, a discount line counts, and
    fractions of a cent are refused.
  - Partial payments: part → Partially paid → exact balance → Paid. One cent
    over is refused.
  - Idempotency: replays and five simultaneous identical requests record one
    payment.
  - Reversals: a reversed payment reopens the balance.
  - Overdue: due today is not overdue, three days past is. A second run
    notifies no one again. Part-paying an overdue invoice leaves it Overdue.
  - Numbering: concurrent sends get consecutive numbers, and a duplicated
    send takes none.

## The gate

| Check | Result |
| --- | --- |
| `tsc` | ✓ |
| `lint` | ✓ |
| Unit tests | **888/888**. New: money and invoice rules (16), Stripe webhook signatures (4), billing permissions (3), billing tenancy scoping (1). The server-only boundary test now covers the billing modules and the payment provider. |
| `build` | ✓ |
| `bundlescan` | ✓. It now also proves the payment provider and the PDF engine never reach the browser. |
| `smoke` | ✓ (143) |
| `smoke:empty` | ✓ (134) |
| `permtest` | ✓ (392) |
| `leaks` | ✓ |
| `fieldtest` · `journeytest` · `shelltest` · `tenanttest` · `daytest` · `leadtest` · `outreachtest` · `projecttest` · `assigntest` | ✓ (45 · 81 · 72 · 24 · 28 · 40 · 36 · 65 · 35) |
| `portaltest` | ✓ (103). One Phase 6 check assumed there were no invoices yet ("none until billing"). It now checks that every invoice a client sees is its own account's. |
| **`billingtest`** | ✓. 100 checks with Stripe off, as shipped. 102 with it switched on against a test webhook secret, where a signed event is recorded once and a forged one records nothing. |

`billingtest` is in CI. All harnesses ran in sequence on a freshly seeded database with nothing else loading the server. Every one passed on the first sequential run; `projecttest`'s Phase 6 hiccup didn't recur.

**Browser check.** I checked 9 screens at 375, 768 and 1280, as the founder and as the client. Founder: Finance, Invoices, New invoice, an overdue and a part-paid invoice, Settings → Billing, and the client profile. Client: the portal invoices list and an invoice. The check found one real problem, now fixed: at 375 the invoice detail's line table stretched the page 167px sideways. It now scrolls inside its card, and the four figures sit two across on phones. After the fix, all 27 checks are clean, with no overflow and no console errors. I also rendered the PDF and reviewed it; two character-encoding issues found there were fixed (address line breaks, and the minus sign on "Paid").

## Changed behaviour (said out loud)

- **New navigation** for the founder: *Finance* and *Invoices*. Settings gains *Billing*.
- **The morning job** also moves overdue invoices and notifies.
- **The portal's Invoices page** now lists real invoices. It remains owner-only, as in Phase 6.
- **Client profile:** "Services & billing" now includes the client's invoices (founder only).
- **Demo seed:** six months of invoices and payments for the three restaurants, and a seller address on the organization (only if none was set). It is added once, and skipped if any invoice exists.
- **New dependency: `pdf-lib` 1.17.1**, pure JavaScript (ADR-016).
- **`npm audit`** reports 5 advisories in next, next-auth, nodemailer, postcss and uuid. All were there before this phase, and pdf-lib adds none. Clearing them means major upgrades (Next 16), which is a separate decision.

## Needs your decision

1. **Your billing details:** set the address and billing email in Settings → Billing before the first real invoice. The demo address is a placeholder.
2. **Email:** invoices are emailed only when SMTP is set up (carried from Phase 6). Otherwise the invoice is still sent to the portal, and you can download the PDF.
3. **Online payments:** to take cards, create a Stripe account, set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, point a webhook at `/api/webhooks/stripe` (`checkout.session.completed`), then set `STRIPE_ENABLED=true`.
4. **Tax:** invoices carry no tax lines yet. If you charge sales tax, tell me the rule (per client or per service, and the rates).
5. **Carried:** Phase 6's email provider and who may share with clients; Phase 5's AI key; Phase 4's `VAULT_KEY`, storage bucket, legacy retainers and stage mapping.

## Known limitations

- **No tax, credits or refunds** in this phase. Over-payment is refused, and a refund is recorded by reversing the payment.
- **One currency per figure.** The overview reports in the organization's currency; invoices in others are counted and flagged, never converted.
- **Recurring invoices** aren't generated automatically. "New invoice" starts from the client's active services, which is one click per client per month.
- **The legacy "Collections" card** on the dashboard belongs to the parked retainer module (off by default). It still reads retainer cycles, not invoices.
- **The test suite consumes invoice numbers** when run against a working database: it cleans up its invoices, but numbers are never reused.
- **Carried:** `smoke:browser` and the Neon backup before the first deploy.

## Readiness for Phase 8

Ready. Billing, the overview and the portal share one money model with
tested formulas. Automated reports can read the same overview, and
`modules/integrations` now has its first real adapter pattern for the
Google and Meta integrations.
