import { loadStripe, type Stripe } from "@stripe/stripe-js";

const STRIPE_PUBLIC_KEY = import.meta.env.VITE_STRIPE_PUBLIC_KEY;

if (!STRIPE_PUBLIC_KEY) {
  console.error("❌ Missing environment variable VITE_STRIPE_PUBLIC_KEY");
}

export const stripePromise = STRIPE_PUBLIC_KEY
  ? loadStripe(STRIPE_PUBLIC_KEY)
  : null;

export interface StripeConfig {
  publishableKey: string;
  supportedPaymentMethods: string[];
  currency: string;
}

export const defaultStripeConfig: StripeConfig = {
  publishableKey: STRIPE_PUBLIC_KEY || "",
  supportedPaymentMethods: ["card"],
  currency: "usd",
};

export const validateStripeSetup = (): boolean => {
  if (!STRIPE_PUBLIC_KEY) {
    console.warn("⚠️ Stripe public key not configured, payment functionality unavailable");
    return false;
  }

  if (!STRIPE_PUBLIC_KEY.startsWith("pk_")) {
    console.error("❌ Invalid Stripe public key format, should start with pk_");
    return false;
  }

  return true;
};

export const getStripeInstance = async (): Promise<Stripe | null> => {
  if (!validateStripeSetup()) {
    return null;
  }

  try {
    const stripe = await stripePromise;
    if (!stripe) {
      throw new Error("Stripe initialization failed");
    }
    return stripe;
  } catch (error) {
    console.error("Stripe loading failed:", error);
    return null;
  }
};
