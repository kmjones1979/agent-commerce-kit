"use client";

import type { ReactNode } from "react";
import { Web3Providers } from "@/lib/web3-providers";
import { AgentSwarmProvider } from "@/lib/agent-swarm";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <Web3Providers>
      <AgentSwarmProvider>{children}</AgentSwarmProvider>
    </Web3Providers>
  );
}
