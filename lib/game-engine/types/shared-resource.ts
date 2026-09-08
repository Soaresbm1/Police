import type { PersonId } from "./person";

export type SharedResourceKind = "phone" | "vehicle" | "wifi" | "bank_account";

/**
 * A device/vehicle/account genuinely used by more than one person. Evidence
 * tied to a shared resource must list every sharer in `relatedPersonIds`
 * (see the validator's checkSharedResources) — this is what creates real
 * ambiguity ("the car was seen, but three people drive it") without making
 * the underlying evidence meaningless: it still narrows the field, just not
 * to a single name.
 */
export interface SharedResource {
  id: string;
  kind: SharedResourceKind;
  ownerPersonIds: PersonId[];
  label: string;
}
