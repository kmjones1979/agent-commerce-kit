"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  baseAccount,
  metaMaskWallet,
  rainbowWallet,
  safeWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { rainbowkitBurnerWallet } from "burner-connector";
import { getActiveNetwork, targetNetwork } from "./networks";
import {
  bsc,
  base,
  baseSepolia,
  hardhat,
  mainnet,
  polygon,
  sepolia,
} from "wagmi/chains";

const DEFAULT_REOWN_PROJECT_ID = "ef4aa705a4612c41fc51003cc1f6d387" as const;

const projectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "").trim();

/**
 * Burner wallet only when targetNetwork is localhost (scaffold.config.ts).
 * @see https://github.com/scaffold-eth/scaffold-eth-2
 * @see https://github.com/scaffold-eth/burner-connector
 */
const showBurnerWallet = targetNetwork === "localhost";

if (showBurnerWallet) {
  const local = getActiveNetwork();
  rainbowkitBurnerWallet.rpcUrls = {
    [hardhat.id]: local.rpcUrl,
  };
}

const popularWallets = [
  safeWallet,
  rainbowWallet,
  baseAccount,
  metaMaskWallet,
  walletConnectWallet,
];

/**
 * Reown / WalletConnect Cloud project id.
 * If unset in .env, uses the scaffold default; override with
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (Next) or VITE_WALLETCONNECT_PROJECT_ID (Vite).
 * @see https://cloud.walletconnect.com
 */
export const wagmiConfig = getDefaultConfig({
  appName: "agent-commerce-kit",
  projectId: projectId || DEFAULT_REOWN_PROJECT_ID,
  chains: [hardhat, sepolia, baseSepolia, base, mainnet, polygon, bsc],
  ssr: true,
  wallets: [
    {
      groupName: "Popular",
      wallets: showBurnerWallet
        ? [rainbowkitBurnerWallet, ...popularWallets]
        : popularWallets,
    },
  ],
});
