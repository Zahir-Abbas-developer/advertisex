import "server-only";

import type { PaymentProvider } from "@/modules/integrations/payments/provider";
import { stripeProvider } from "@/modules/integrations/payments/stripe";

/**
 * The configured payment provider, or null. Live charging is off unless the
 * deployment turns it on explicitly — `STRIPE_ENABLED=true` with both keys —
 * so a key pasted into the environment can't start taking money by itself.
 */
export function paymentProvider(): PaymentProvider | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (process.env.STRIPE_ENABLED !== "true" || !secretKey || !webhookSecret) return null;
  return stripeProvider({ secretKey, webhookSecret });
}

export const onlinePaymentsEnabled = () => paymentProvider() !== null;
