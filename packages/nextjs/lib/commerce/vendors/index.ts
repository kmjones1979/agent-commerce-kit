import type { VendorAdapter, VendorId } from "../types";
import { domino } from "./domino";
import { duffel } from "./duffel";
import { tremendous } from "./tremendous";

export const vendors: Record<VendorId, VendorAdapter> = { domino, duffel, tremendous };
export { domino, duffel, tremendous };
