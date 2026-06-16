"use client";

import Link from "next/link";
import { LocalFaucetButton } from "@/components/LocalFaucetButton";
import { SwarmAgentPicker } from "@/lib/agent-swarm";
import { useChat } from "ai/react";
import { useEffect, useRef } from "react";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CommerceStatusStrip } from "@/components/CommerceStatusStrip";
import { SendHorizontal, Bot, User, BadgeCheck, Info, Wallet, Users, Bug, ShoppingBag, ScrollText, Lock } from "lucide-react";

export default function Home() {
  const { messages, input, setInput, handleInputChange, handleSubmit, isLoading, error } =
    useChat({
      onError(err) {
        console.error("Chat error:", err);
      },
    });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Prefill the input from a ?prompt= query param (used by /commerce "Try it").
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("prompt");
    if (p) setInput(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="flex flex-col h-screen">
      <header
        className="border-b border-border px-6 py-4 flex items-center gap-3"
        role="banner"
      >
        <div className="h-8 w-8 rounded-lg brand-gradient flex items-center justify-center shrink-0 brand-ring">
          <Bot className="h-4 w-4 text-white" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold tracking-tight">
            Agent <span className="brand-text">Commerce</span> Kit
          </h1>
          <p className="text-xs text-muted-foreground">Onchain agent · Ampersend policy · 1Claw vault</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1">
        <LocalFaucetButton />
        <Link
          href="/balances"
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
          )}
          title="Balances"
          aria-label="Balances"
        >
          <Wallet className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/ens"
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
          )}
          title="ENS name for your agent"
          aria-label="ENS name for your agent"
        >
          <BadgeCheck className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/identity"
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
          )}
          title="Agent identity (ERC-8004)"
          aria-label="Agent identity (ERC-8004)"
        >
          <Info className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/swarm"
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
          )}
          title="Swarm agents"
          aria-label="Swarm agents"
        >
          <Users className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/debug"
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
          )}
          title="Debug contracts"
          aria-label="Debug contracts"
        >
          <Bug className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/commerce"
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
          )}
          title="Commerce vendors"
          aria-label="Commerce vendors"
        >
          <ShoppingBag className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/audit"
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
          )}
          title="Commerce audit log"
          aria-label="Commerce audit log"
        >
          <ScrollText className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/vault"
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
          )}
          title="1Claw vault status"
          aria-label="1Claw vault status"
        >
          <Lock className="h-4 w-4" aria-hidden />
        </Link></div>
          <SwarmAgentPicker className="hidden sm:flex shrink-0" />
          <ConnectWalletButton />
        </div>
      </header>

      <CommerceStatusStrip />

      {error &&
        (() => {
          const raw = error.message;
          let display = raw;
          const i = raw.indexOf("{");
          if (i >= 0) {
            try {
              const j = JSON.parse(raw.slice(i)) as { error?: string };
              if (j && typeof j.error === "string") display = j.error;
            } catch {
              /* keep display */
            }
          }
          const t = display.toLowerCase();
          const shroudHttpErr = /^shrouds+d{3}/i.test(display.trim());
          const geminiOrQuota =
            /quota|429|resource_exhausted|gemini|google|generativelanguage/.test(t);
          const oneclawish = /oneclaw|shroud|oneclaw_agent|x-shroud/.test(t);
          return (
            <div
              className="px-6 py-3 text-sm text-destructive bg-destructive/10 border-b border-border space-y-2"
              role="alert"
            >
              <p className="whitespace-pre-wrap font-medium">{display}</p>
              {shroudHttpErr &&
              (/unrecognized request url|generatecontent|stripe.com/.test(t) ||
                /gemini/.test(t)) ? (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Shroud with <strong className="text-foreground">LLM token billing</strong> routes models
                  through Stripe&apos;s AI gateway. Set{" "}
                  <code className="rounded bg-muted px-1">SHROUD_DEFAULT_MODEL</code> to override (e.g.{" "}
                  <code className="rounded bg-muted px-1">gemini-2.5-flash</code>,{" "}
                  <code className="rounded bg-muted px-1">gemini-3.5-flash</code>). See{" "}
                  <a
                    href="https://docs.1claw.xyz/docs/guides/shroud"
                    className="underline hover:text-foreground"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Shroud docs
                  </a>
                  ) and check agent <code className="rounded bg-muted px-1">allowed_models</code> on
                  1claw.xyz.
                </p>
              ) : geminiOrQuota ? (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  For Google Gemini (direct API / BYOK): check{" "}
                  <a
                    href="https://ai.google.dev/gemini-api/docs/rate-limits"
                    className="underline hover:text-foreground"
                    target="_blank"
                    rel="noreferrer"
                  >
                    rate limits and billing
                  </a>
                  , set <code className="rounded bg-muted px-1">GOOGLE_GENERATIVE_AI_API_KEY</code>, and
                  optionally <code className="rounded bg-muted px-1">GOOGLE_GENERATIVE_AI_MODEL</code>.
                </p>
              ) : oneclawish ? (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Fix <code className="rounded bg-muted px-1">.env</code> (or encrypted secrets), then restart{" "}
                  <code className="rounded bg-muted px-1">next dev</code>.{" "}
                  <code className="rounded bg-muted px-1">ONECLAW_AGENT_ID</code> is the 1Claw agent UUID — not{" "}
                  <code className="rounded bg-muted px-1">AGENT_ADDRESS</code>.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Check LLM API keys and provider settings in{" "}
                  <code className="rounded bg-muted px-1">.env</code> (or{" "}
                  <code className="rounded bg-muted px-1">.env.secrets.encrypted</code>), then restart{" "}
                  <code className="rounded bg-muted px-1">next dev</code>. Open the Network tab if the chat
                  request returns 4xx/5xx.
                </p>
              )}
            </div>
          );
        })()}

      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6"
        aria-label="Chat conversation"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
              <Bot className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">How can I help you?</p>
              <p className="text-sm text-muted-foreground mt-1">Send a message to start chatting with your agent.</p>
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role !== "user" && (
              <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
            </div>
            {m.role === "user" && (
              <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
            )}
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-3 justify-start" aria-live="polite" aria-busy="true">
            <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            </div>
            <div className="bg-muted rounded-2xl px-4 py-3">
              <div className="flex space-x-1.5" aria-label="Assistant is typing">
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      </main>

      <form
        onSubmit={handleSubmit}
        className="border-t border-border p-4 flex gap-3"
        aria-label="Send a message to the agent"
      >
        <Input
          value={input}
          onChange={handleInputChange}
          placeholder="Send a message…"
          className="flex-1"
          disabled={isLoading}
          autoFocus
          name="message"
          aria-label="Message text"
        />
        <Button
          type="submit"
          variant="brand"
          size="icon"
          disabled={isLoading || !input.trim()}
          aria-label="Send message"
        >
          <SendHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      </form>
    </div>
  );
}
