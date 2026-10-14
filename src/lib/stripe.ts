import Stripe from "stripe";

// Server-side Stripe client. Uses the SDK's pinned API version (no override) so
// upgrades are deliberate. Routes that use this must check `stripeConfigured`
// first and fail clearly if the key is missing (e.g. locally without keys).
export const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

let client: Stripe | null = null;

function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set — check `stripeConfigured` before using the Stripe client."
      );
    }
    client = new Stripe(key);
  }
  return client;
}

// LAZY on purpose — do not go back to `new Stripe(...)` at module scope.
// `next build` evaluates route modules during "Collecting page data", and the
// Docker/CI build stage has no STRIPE_SECRET_KEY, so eager construction throws
// "Neither apiKey nor config.authenticator provided" and fails the build
// (it did: /api/cohorts/[id]/checkout). Deferring construction to first property
// access keeps every existing `stripe.checkout...` call site unchanged while
// making the module safe to merely import.
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const real = getStripe();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export default stripe;
