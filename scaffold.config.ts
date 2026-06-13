/**
 * Active network for this monorepo. Edit `targetNetwork` to switch chains.
 * Optional `rpcOverrides`: keys are chainId as string (e.g. "31337") or network id.
 */
export const targetNetwork = "localhost" as const;

export type TargetNetwork = typeof targetNetwork;

export const rpcOverrides: Record<string, string> = {};
