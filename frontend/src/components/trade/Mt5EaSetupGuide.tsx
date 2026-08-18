"use client";

import { useState, type ReactNode } from "react";
import {
  BookOpenCheck,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  FileCheck2,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  MonitorCheck,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { PlatformContentDialog } from "@/components/ui/PlatformDialog";
import type { ExecutionPairingToken } from "@/services/api/resources/executionApi";
import { cn } from "@/utils/cn";

type CopiedField = "gateway" | "origin" | "token" | null;

export function Mt5EaSetupGuide({
  open,
  onClose,
  downloadUrl,
  checksumUrl,
  gatewayUrl,
  webRequestOrigin,
  pairing,
  pairingLoading,
  pairingFailed,
  onGeneratePairingToken,
}: {
  open: boolean;
  onClose: () => void;
  downloadUrl: string;
  checksumUrl: string;
  gatewayUrl: string;
  webRequestOrigin: string;
  pairing: ExecutionPairingToken | null;
  pairingLoading: boolean;
  pairingFailed: boolean;
  onGeneratePairingToken: () => Promise<void>;
}) {
  const [copiedField, setCopiedField] = useState<CopiedField>(null);

  const copy = async (field: Exclude<CopiedField, null>, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
    } catch {
      setCopiedField(null);
    }
  };

  return (
    <PlatformContentDialog
      open={open}
      onClose={onClose}
      size="large"
      title="Hướng dẫn cài MarketLensExecutionEA"
      description="Một EA dùng chung cho FTMO, Exness và các broker MT5. Hoàn tất khoảng 5 phút."
      closeLabel="Đóng hướng dẫn cài EA"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 rounded-xl border border-brand bg-brand px-4 text-sm font-semibold text-(--accent-contrast) transition-colors hover:bg-brand-hover focus-ring"
        >
          Đã hiểu
        </button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/25 bg-brand/5 px-3 py-2 text-[11px] text-ink-muted">
          <ShieldCheck size={15} className="text-brand" aria-hidden="true" />
          <strong className="text-ink">EA chính thức đã được kiểm tra SHA-256.</strong>
          <span>Demo và Live sử dụng cùng một quy trình.</span>
        </div>

        <div
          role="note"
          className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-[10px] leading-4 text-ink-muted"
        >
          <MonitorCheck
            size={16}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-amber-400"
          />
          <div>
            <strong className="block text-[11px] text-ink">
              Mỗi account cần một terminal MT5 riêng đang chạy
            </strong>
            <p className="mt-1">
              Để copy FTMO → Exness, cài hai terminal vào hai thư mục khác
              nhau, đăng nhập mỗi account ở một terminal và gắn EA riêng cho
              từng terminal. Nếu Exness offline lúc gửi lệnh, server chờ tối đa
              5 phút; mở terminal Exness trong thời gian đó để hệ thống kiểm tra
              lại và giao lệnh. Quá hạn, lệnh chờ tự hủy.
            </p>
          </div>
        </div>

        <GuideStep
          number={1}
          icon={<Download size={16} />}
          title="Tải EA chính thức"
        >
          <p>
            Tải file đã compile; user không cần truy cập source hoặc tự dùng
            MetaEditor.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={downloadUrl}
              download="MarketLensExecutionEA.ex5"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[11px] font-semibold text-(--accent-contrast) hover:bg-brand-hover focus-ring"
            >
              <Download size={13} aria-hidden="true" />
              Tải MarketLensExecutionEA.ex5
            </a>
            <a
              href={checksumUrl}
              download="MarketLensExecutionEA.sha256.txt"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-terminal-border-strong px-3 text-[11px] font-semibold text-ink hover:bg-terminal-hover focus-ring"
            >
              <FileCheck2 size={13} aria-hidden="true" />
              Tải SHA-256
            </a>
          </div>
        </GuideStep>

        <GuideStep
          number={2}
          icon={<FolderOpen size={16} />}
          title="Chép EA vào MT5"
        >
          <ol className="list-decimal space-y-1 pl-4">
            <li>Trong MT5 chọn File → Open Data Folder.</li>
            <li>
              Chép file vào{" "}
              <InlineCode>MQL5\Experts\SMC\MarketLensExecutionEA.ex5</InlineCode>.
            </li>
            <li>
              Mở Navigator → Expert Advisors, bấm chuột phải → Refresh. Nếu
              chưa thấy EA, hãy khởi động lại MT5.
            </li>
          </ol>
        </GuideStep>

        <GuideStep
          number={3}
          icon={<ShieldCheck size={16} />}
          title="Cho phép WebRequest"
        >
          <p>
            Mở Tools → Options → Expert Advisors, bật Allow algorithmic trading
            và Allow WebRequest for listed URL.
          </p>
          <CopyValue
            label="URL thêm vào WebRequest allow-list"
            value={webRequestOrigin}
            copied={copiedField === "origin"}
            onCopy={() => void copy("origin", webRequestOrigin)}
          />
          <p className="mt-2 text-[10px] text-ink-faint">
            Chỉ thêm origin ở trên vào allow-list. Full URL có đuôi
            /execution-ea sẽ được nhập vào GatewayUrl ở bước 5.
          </p>
        </GuideStep>

        <GuideStep
          number={4}
          icon={<KeyRound size={16} />}
          title="Tạo pairing token"
        >
          <p>
            Token chỉ dùng một lần và hết hạn sau 5 phút. Hãy tạo token ngay
            trước khi kéo EA vào chart.
          </p>
          {pairing ? (
            <div className="mt-3 rounded-xl border border-bull/25 bg-bull/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-bull">
                  <CheckCircle2 size={14} aria-hidden="true" />
                  Token sẵn sàng · hết hạn{" "}
                  {new Date(pairing.expiresAtMs).toLocaleTimeString("vi-VN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <CopyButton
                  copied={copiedField === "token"}
                  label="Sao chép pairing token"
                  onClick={() => void copy("token", pairing.token)}
                />
              </div>
              <code className="mt-2 block break-all rounded-lg bg-terminal-bg px-2.5 py-2 text-[10px] text-ink">
                {pairing.token}
              </code>
              <button
                type="button"
                disabled={pairingLoading}
                onClick={() => void onGeneratePairingToken()}
                className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-bull/30 px-2.5 text-[10px] font-semibold text-bull hover:bg-bull/10 disabled:cursor-not-allowed disabled:opacity-60 focus-ring"
              >
                {pairingLoading ? (
                  <LoaderCircle size={12} className="animate-spin" />
                ) : (
                  <KeyRound size={12} />
                )}
                Tạo token mới
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={pairingLoading}
              onClick={() => void onGeneratePairingToken()}
              className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[11px] font-semibold text-(--accent-contrast) hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60 focus-ring"
            >
              {pairingLoading ? (
                <LoaderCircle size={13} className="animate-spin" />
              ) : (
                <KeyRound size={13} />
              )}
              Tạo token 5 phút
            </button>
          )}
          {pairingFailed && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-bear">
              <TriangleAlert size={12} aria-hidden="true" />
              Không thể tạo token. Hãy đăng nhập lại và thử lần nữa.
            </p>
          )}
        </GuideStep>

        <GuideStep
          number={5}
          icon={<MonitorCheck size={16} />}
          title="Gắn EA vào chart và kết nối"
        >
          <ol className="list-decimal space-y-1 pl-4">
            <li>Kéo MarketLensExecutionEA vào đúng một chart trong terminal.</li>
            <li>
              Trong tab Inputs, nhập các giá trị dưới đây. Giữ nguyên các thông
              số còn lại.
            </li>
          </ol>
          <div className="mt-3 overflow-hidden rounded-xl border border-terminal-border">
            <GuideInputRow
              label="GatewayUrl"
              value={gatewayUrl}
              copied={copiedField === "gateway"}
              onCopy={() => void copy("gateway", gatewayUrl)}
            />
            <GuideInputRow
              label="PairingToken"
              value={pairing?.token ?? "Token được tạo ở bước 4"}
              muted={!pairing}
              copied={copiedField === "token"}
              onCopy={
                pairing
                  ? () => void copy("token", pairing.token)
                  : undefined
              }
            />
            <GuideInputRow label="PollIntervalMs" value="750" />
            <GuideInputRow label="HttpTimeoutMs" value="5000" />
            <GuideInputRow label="MagicNumber" value="26072026" />
          </div>
          <ul className="mt-3 space-y-1">
            <CheckLine>Bật Allow Algo Trading trong tab Common.</CheckLine>
            <CheckLine>Bật nút Algo Trading trên thanh công cụ MT5.</CheckLine>
            <CheckLine>
              Thành công khi account xuất hiện trên web và tab Experts báo
              “paired account”.
            </CheckLine>
          </ul>
        </GuideStep>

        <div className="grid gap-3 sm:grid-cols-2">
          <aside className="rounded-xl border border-terminal-border bg-terminal-panel-2/45 p-3">
            <strong className="flex items-center gap-1.5 text-[11px] text-ink">
              <BookOpenCheck size={14} className="text-brand" />
              Dùng nhiều tài khoản
            </strong>
            <p className="mt-1.5 text-[10px] leading-4 text-ink-muted">
              Mỗi account cần một terminal MT5 riêng, một instance EA trên một
              chart và một token mới. Không gắn nhiều EA trong cùng terminal.
            </p>
          </aside>
          <aside className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
            <strong className="flex items-center gap-1.5 text-[11px] text-ink">
              <TriangleAlert size={14} className="text-amber-400" />
              Nếu chưa kết nối
            </strong>
            <p className="mt-1.5 text-[10px] leading-4 text-ink-muted">
              Kiểm tra tab Experts/Journal, WebRequest allow-list, token còn hạn
              và GatewayUrl production phải dùng HTTPS.
            </p>
          </aside>
        </div>
      </div>
    </PlatformContentDialog>
  );
}

function GuideStep({
  number,
  icon,
  title,
  children,
}: {
  number: number;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-terminal-border bg-terminal-panel-2/30 p-3 sm:p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          {icon}
        </span>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[9px] font-bold text-(--accent-contrast)">
          {number}
        </span>
        <h3 className="text-xs font-bold text-ink sm:text-[13px]">{title}</h3>
      </div>
      <div className="mt-3 text-[11px] leading-5 text-ink-muted">{children}</div>
    </section>
  );
}

function CopyValue({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-terminal-border bg-terminal-bg p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
          {label}
        </span>
        <CopyButton copied={copied} label={`Sao chép ${label}`} onClick={onCopy} />
      </div>
      <code className="mt-1.5 block break-all text-[10px] text-brand">
        {value}
      </code>
    </div>
  );
}

function CopyButton({
  copied,
  label,
  onClick,
}: {
  copied: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "inline-flex min-h-7 items-center gap-1 rounded-lg px-2 text-[9px] font-semibold focus-ring",
        copied
          ? "bg-bull/10 text-bull"
          : "bg-brand/10 text-brand hover:bg-brand/15",
      )}
    >
      {copied ? <Check size={11} /> : <Clipboard size={11} />}
      {copied ? "Đã sao chép" : "Sao chép"}
    </button>
  );
}

function GuideInputRow({
  label,
  value,
  muted = false,
  copied = false,
  onCopy,
}: {
  label: string;
  value: string;
  muted?: boolean;
  copied?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="grid grid-cols-[105px_minmax(0,1fr)_auto] items-center gap-2 border-b border-terminal-border px-2.5 py-2 last:border-b-0 sm:grid-cols-[130px_minmax(0,1fr)_auto]">
      <strong className="text-[9px] text-ink">{label}</strong>
      <code
        className={cn(
          "min-w-0 break-all text-[9px]",
          muted ? "text-ink-faint" : "text-brand",
        )}
      >
        {value}
      </code>
      {onCopy ? (
        <CopyButton
          copied={copied}
          label={`Sao chép ${label}`}
          onClick={onCopy}
        />
      ) : (
        <span className="w-0" aria-hidden="true" />
      )}
    </div>
  );
}

function CheckLine({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 text-[10px] leading-4 text-ink-muted">
      <CheckCircle2
        size={12}
        className="mt-0.5 shrink-0 text-bull"
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm bg-terminal-bg px-1 py-0.5 text-[10px] text-brand">
      {children}
    </code>
  );
}
