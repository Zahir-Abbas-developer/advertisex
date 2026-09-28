/**
 * The payments seam (Phase 7 scope 6). A provider takes an invoice's balance
 * online and tells us, through a verified webhook, that money arrived. The
 * rest of the product knows only this interface: the portal asks for a
 * checkout link, and the webhook route hands a verified event to billing,
 * which records it like any other payment (idempotently).
 */

export type CheckoutInput = {
  invoiceId: string;
  organizationId: string;
  numberLabel: string;
  amountMinor: number;
  currency: string;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
};

/** A payment the provider confirms, normalized. */
export type ProviderPayment = {
  /** The provider's event id — becomes the payment's idempotency key. */
  eventId: string;
  invoiceId: string;
  organizationId: string;
  amountMinor: number;
  currency: string;
  providerRef: string | null;
  paidAt: Date;
};

export type WebhookResult =
  | { ok: false; reason: string }
  | { ok: true; payment: ProviderPayment | null; type: string };

export type PaymentProvider = {
  id: "stripe";
  createCheckout(input: CheckoutInput): Promise<{ url: string; sessionId: string }>;
  /** Verifies the signature over the raw body and normalizes the event. */
  parseWebhook(rawBody: string, headers: Headers, now?: Date): WebhookResult;
};
