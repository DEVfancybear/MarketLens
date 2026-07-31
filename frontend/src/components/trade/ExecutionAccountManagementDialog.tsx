"use client";

import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle,
  LogOut,
  Trash2,
} from "lucide-react";
import {
  PlatformContentDialog,
  usePlatformDialog,
} from "@/components/ui/PlatformDialog";
import {
  disconnectExecutionAccount,
  getExecutionAccounts,
  removeExecutionAccount,
  type ExecutionPairingToken,
} from "@/services/api/resources/executionApi";
import {
  applyExecutionAccountsAtom,
  selectedExecutionAccountIdAtom,
} from "@/store/executionRegistryStore";
import { setExecutionModeAtom } from "@/store/mt5Store";
import { pushToastAtom } from "@/store/toastStore";
import type { ExecutionAccountSummary } from "@/types/execution";
import { PropRiskGuardCard } from "./PropRiskGuardCard";

export function ExecutionAccountManagementDialog({
  account,
  pairing,
  pairingFailed,
  pairingLoading,
  onClose,
  onGeneratePairingToken,
}: {
  account: ExecutionAccountSummary | null;
  pairing: ExecutionPairingToken | null;
  pairingFailed: boolean;
  pairingLoading: boolean;
  onClose: () => void;
  onGeneratePairingToken: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState<
    "disconnect" | "remove" | null
  >(null);
  const selectedAccountId = useAtomValue(selectedExecutionAccountIdAtom);
  const applyAccounts = useSetAtom(applyExecutionAccountsAtom);
  const setMode = useSetAtom(setExecutionModeAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const { requestConfirm, dialog } = usePlatformDialog();
  if (!account) return null;
  const busy = busyAction !== null;

  const refreshAccounts = async () => {
    const next = await getExecutionAccounts();
    applyAccounts(next);
  };

  const disconnect = async () => {
    const confirmed = await requestConfirm({
      title: "Ngắt kết nối EA?",
      description:
        "Session EA hiện tại sẽ bị thu hồi và các lệnh còn chờ của account này sẽ bị dừng. Lệnh/position đã khớp tại broker không bị đóng.",
      confirmLabel: "Ngắt kết nối",
      cancelLabel: "Giữ kết nối",
    });
    if (!confirmed) return;
    setBusyAction("disconnect");
    try {
      await disconnectExecutionAccount(account.id);
      await refreshAccounts();
      onClose();
      pushToast({
        title: "Đã ngắt kết nối account",
        message: "EA cần một pairing token mới để kết nối lại.",
        variant: "success",
      });
    } catch {
      pushToast({
        title: "Không thể ngắt kết nối",
        message: "Account chưa thay đổi. Vui lòng thử lại.",
        variant: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const remove = async () => {
    const confirmed = await requestConfirm({
      title: "Xóa account khỏi SMC Terminal?",
      description: `Account “${account.label}” sẽ bị ngắt kết nối, xóa copy routing và snapshot đang lưu. Lệnh/position đã mở tại broker vẫn còn nguyên và phải được quản lý trực tiếp trên MT5.`,
      confirmLabel: "Xóa account",
      cancelLabel: "Hủy",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusyAction("remove");
    try {
      await removeExecutionAccount(account.id);
      await refreshAccounts();
      if (selectedAccountId === account.id) setMode("simulator");
      onClose();
      pushToast({
        title: "Đã xóa account",
        message: "Lịch sử lệnh và security audit vẫn được lưu an toàn.",
        variant: "success",
      });
    } catch {
      pushToast({
        title: "Không thể xóa account",
        message: "Account chưa thay đổi. Vui lòng thử lại.",
        variant: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <>
      <PlatformContentDialog
        open
        onClose={busy ? () => undefined : onClose}
        title="Quản lý execution account"
        description={`${account.label} · ${account.server ?? account.externalAccountRef}`}
        closeLabel="Đóng quản lý account"
        footer={
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-10 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink hover:bg-terminal-hover disabled:opacity-60 focus-ring"
          >
            Đóng
          </button>
        }
      >
        <div className="space-y-3">
          <section className="rounded-xl border border-terminal-border bg-terminal-panel-2/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <strong className="block text-xs text-ink">
                  Pairing token mới
                </strong>
                <p className="mt-1 text-[10px] leading-4 text-ink-muted">
                  Token dùng một lần trong 5 phút. Kết nối hiện tại chỉ bị thay
                  thế sau khi EA ghép nối thành công bằng token mới.
                </p>
              </div>
              <button
                type="button"
                disabled={pairingLoading || busy}
                onClick={() => {
                  setCopied(false);
                  void onGeneratePairingToken();
                }}
                className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 text-[10px] font-semibold text-[var(--accent-contrast)] hover:bg-brand-hover disabled:opacity-60 focus-ring"
              >
                {pairingLoading ? (
                  <LoaderCircle size={12} className="animate-spin" />
                ) : (
                  <KeyRound size={12} />
                )}
                Lấy token mới
              </button>
            </div>
            {pairing && (
              <div className="mt-3 rounded-lg border border-bull/25 bg-bull/5 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-semibold text-bull">
                    Hết hạn{" "}
                    {new Date(pairing.expiresAtMs).toLocaleTimeString("vi-VN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(pairing.token)
                        .then(() => setCopied(true))
                        .catch(() => setCopied(false));
                    }}
                    className="inline-flex min-h-7 items-center gap-1 rounded-lg px-2 text-[9px] font-semibold text-bull hover:bg-bull/10 focus-ring"
                  >
                    {copied ? <Check size={11} /> : <Clipboard size={11} />}
                    {copied ? "Đã sao chép" : "Sao chép"}
                  </button>
                </div>
                <code className="mt-2 block break-all rounded-md bg-terminal-bg px-2 py-1.5 text-[9px] text-ink">
                  {pairing.token}
                </code>
              </div>
            )}
            {pairingFailed && (
              <p className="mt-2 text-[10px] text-bear">
                Không thể tạo token. Hãy đăng nhập lại và thử lần nữa.
              </p>
            )}
          </section>

          <PropRiskGuardCard account={account} />

          <section className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void disconnect()}
              className="flex min-h-12 items-center gap-2 rounded-xl border border-terminal-border-strong px-3 text-left text-[11px] font-semibold text-ink hover:bg-terminal-hover disabled:opacity-60 focus-ring"
            >
              {busyAction === "disconnect" ? (
                <LoaderCircle size={15} className="animate-spin text-brand" />
              ) : (
                <LogOut size={15} className="text-brand" />
              )}
              Ngắt kết nối EA
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="flex min-h-12 items-center gap-2 rounded-xl border border-bear/35 px-3 text-left text-[11px] font-semibold text-bear hover:bg-bear/10 disabled:opacity-60 focus-ring"
            >
              {busyAction === "remove" ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Trash2 size={15} />
              )}
              Xóa account
            </button>
          </section>
          <p className="text-[9px] leading-4 text-ink-faint">
            Các thao tác trên không đóng position đang mở tại broker. Hãy kiểm
            tra MT5 trước khi ngắt hoặc xóa account.
          </p>
        </div>
      </PlatformContentDialog>
      {dialog}
    </>
  );
}
