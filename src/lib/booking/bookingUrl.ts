import { appUrl } from "@/lib/drip/engine";
import { getSecret } from "@/lib/secrets";

import {
  ensureBookingToken,
  ensureContactPublicToken,
} from "./leadBooking";

export async function bookingUrlForContact(contactId: string): Promise<string | null> {
  const closerId = (await getSecret("BOOKING_DEFAULT_CLOSER_ID"))?.trim();
  if (!closerId) return null;

  const [bookingToken, publicToken] = await Promise.all([
    ensureBookingToken(closerId),
    ensureContactPublicToken(contactId),
  ]);
  return `${appUrl()}/book/${bookingToken}?c=${publicToken}`;
}
