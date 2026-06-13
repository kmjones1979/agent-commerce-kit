"use client";

/** When targetNetwork is localhost, connect Burner Wallet once on load (SE-2 dev UX). */
import { useEffect, useRef } from "react";
import { hardhat } from "wagmi/chains";
import { useAccount, useConnect } from "wagmi";
import { targetNetwork } from "./networks";

export function BurnerAutoConnect() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const attempted = useRef(false);

  useEffect(() => {
    if (targetNetwork !== "localhost") return;
    if (attempted.current || isConnected) return;
    const burner = connectors.find((c) => c.id === "burnerWallet");
    if (!burner) return;
    attempted.current = true;
    connect({ connector: burner, chainId: hardhat.id });
  }, [isConnected, connect, connectors]);

  return null;
}
