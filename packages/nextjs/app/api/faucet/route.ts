import { createWalletClient, http, parseEther, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { getActiveNetwork, targetNetwork } from "@/lib/networks";

/** Anvil / Hardhat node default account #0 (public dev key). */
const LOCAL_DEV_ACCT0_PK =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const FAUCET_AMOUNT_ETH = "10";

export async function POST(req: Request) {
  try {
    if (targetNetwork !== "localhost") {
      return Response.json(
        { error: "Faucet is only enabled when targetNetwork is localhost in scaffold.config.ts" },
        { status: 403 },
      );
    }

    const net = getActiveNetwork();
    if (net.chainId !== hardhat.id) {
      return Response.json({ error: "Active network is not local chain 31337" }, { status: 403 });
    }

    const body = await req.json();
    const addr = body?.address;
    const chainId = Number(body?.chainId);

    if (typeof addr !== "string" || !/^0x[a-fA-F0-9]{40}$/i.test(addr)) {
      return Response.json({ error: "Invalid address" }, { status: 400 });
    }
    if (!Number.isFinite(chainId) || chainId !== hardhat.id) {
      return Response.json(
        { error: "chainId must be 31337 (local Hardhat / Anvil)" },
        { status: 400 },
      );
    }

    const chain = defineChain({
      id: net.chainId,
      name: net.name,
      nativeCurrency: net.nativeCurrency,
      rpcUrls: { default: { http: [net.rpcUrl] } },
    });

    const account = privateKeyToAccount(LOCAL_DEV_ACCT0_PK);
    const client = createWalletClient({
      account,
      chain,
      transport: http(net.rpcUrl),
    });

    const hash = await client.sendTransaction({
      to: addr as `0x${string}`,
      value: parseEther(FAUCET_AMOUNT_ETH),
    });

    return Response.json({
      ok: true,
      hash,
      amount: FAUCET_AMOUNT_ETH,
      symbol: net.nativeCurrency.symbol,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/faucet]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
