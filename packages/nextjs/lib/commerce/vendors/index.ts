import type { VendorAdapter, VendorId } from "../types";
import { domino } from "./domino";
import { duffel } from "./duffel";
import { tremendous } from "./tremendous";
import { printful } from "./printful";

export const vendors: Record<VendorId, VendorAdapter> = { domino, duffel, tremendous, printful };
export { domino, duffel, tremendous, printful };
