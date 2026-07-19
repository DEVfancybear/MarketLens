"use client";
import {
  connectMt5Atom,
  disconnectMt5Atom,
  mt5AccountAtom,
  mt5BridgeUrlAtom,
  mt5EnabledAtom,
  mt5ExecutionBlockReasonAtom,
  mt5LastErrorAtom,
  mt5LastHeartbeatAtom,
  mt5StatusAtom,
} from "@/store/mt5Store";
import { fmtMoney } from "@/utils/format";
import { cn } from "@/utils/cn";
import { useAtomValue, useSetAtom } from "jotai";
import { Plug, PlugZap, WifiOff } from "lucide-react";

const STATUS_STYLE: Record<string, string> = {
  disabled: "bg-terminal-hover text-ink-faint",
  disconnected: "bg-terminal-hover text-ink-muted",
  connecting: "bg-choch/15 text-choch",
  authenticating: "bg-choch/15 text-choch",
  connected: "bg-bull/15 text-bull",
  reconnecting: "bg-choch/15 text-choch",
  stale: "bg-bear/15 text-bear",
  error: "bg-bear/15 text-bear",
  mismatch: "bg-bear/15 text-bear",
};

export function Mt5ConnectionPanel() {
  const enabled = useAtomValue(mt5EnabledAtom);
  const status = useAtomValue(mt5StatusAtom);
  const accessReason = useAtomValue(mt5ExecutionBlockReasonAtom);
  const account = useAtomValue(mt5AccountAtom);
  const url = useAtomValue(mt5BridgeUrlAtom);
  const lastError = useAtomValue(mt5LastErrorAtom);
  const lastHeartbeat = useAtomValue(mt5LastHeartbeatAtom);
  const connect = useSetAtom(connectMt5Atom);
  const disconnect = useSetAtom(disconnectMt5Atom);

  if (!enabled) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-[10px] text-ink-faint">
        <WifiOff size={12} />
        <span>MT5 disabled</span>
      </div>
    );
  }

  const heartbeatAge =
    lastHeartbeat != null ? Math.max(0, Math.round((Date.now() - lastHeartbeat) / 1000)) : null;
  const displayStatus = status === "connected" && accessReason ? "mismatch" : status;

  return (
    <div className="flex min-w-0 items-center gap-2 text-[10px]">
      <span
        className={cn(
          "rounded px-1.5 py-0.5 font-semibold uppercase",
          STATUS_STYLE[displayStatus] ?? STATUS_STYLE.disconnected,
        )}
        title={accessReason || lastError || url}
        role="status"
        aria-live="polite"
      >
        {displayStatus}
      </span>
      {account && (
        <>
          <span className="text-ink-faint">{account.mode.toUpperCase()}</span>
          <span className="tabular font-semibold text-ink">
            {fmtMoney(account.equity)}
          </span>
          <span className="text-ink-faint">{account.server}</span>
        </>
      )}
      {heartbeatAge != null && (
        <span className="text-ink-faint">hb {heartbeatAge}s</span>
      )}
      <button
        onClick={connect}
        className="ml-1 rounded p-1 text-ink-muted hover:bg-terminal-hover hover:text-bull focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        title="Connect MT5 bridge"
        aria-label="Connect MT5 bridge"
      >
        <PlugZap size={13} />
      </button>
      <button
        onClick={disconnect}
        className="rounded p-1 text-ink-muted hover:bg-terminal-hover hover:text-bear focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        title="Disconnect MT5 bridge"
        aria-label="Disconnect MT5 bridge"
      >
        <Plug size={13} />
      </button>
    </div>
  );
}
