"use client";

import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  Link2,
  ListChecks,
  MonitorUp,
  Route,
  ShieldCheck,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/utils/cn";

type CopierWorkflow = "continuous" | "oneShot";

export function CopierGuidePanel({
  onOpenMode,
}: {
  onOpenMode: (mode: CopierWorkflow) => void;
}) {
  const { t } = useI18n();
  const prerequisites = [
    {
      icon: <MonitorUp size={16} aria-hidden="true" />,
      title: t("copier.guide.prerequisite.terminals.title"),
      description: t("copier.guide.prerequisite.terminals.description"),
    },
    {
      icon: <CheckCircle2 size={16} aria-hidden="true" />,
      title: t("copier.guide.prerequisite.accounts.title"),
      description: t("copier.guide.prerequisite.accounts.description"),
    },
    {
      icon: <Route size={16} aria-hidden="true" />,
      title: t("copier.guide.prerequisite.symbols.title"),
      description: t("copier.guide.prerequisite.symbols.description"),
    },
    {
      icon: <ShieldCheck size={16} aria-hidden="true" />,
      title: t("copier.guide.prerequisite.demo.title"),
      description: t("copier.guide.prerequisite.demo.description"),
    },
  ];
  const steps = [
    {
      title: t("copier.guide.step1.title"),
      description: t("copier.guide.step1.description"),
    },
    {
      title: t("copier.guide.step2.title"),
      description: t("copier.guide.step2.description"),
    },
    {
      title: t("copier.guide.step3.title"),
      description: t("copier.guide.step3.description"),
    },
    {
      title: t("copier.guide.step4.title"),
      description: t("copier.guide.step4.description"),
    },
    {
      title: t("copier.guide.step5.title"),
      description: t("copier.guide.step5.description"),
    },
  ];
  const statuses = [
    {
      label: t("copier.guide.status.ready"),
      description: t("copier.guide.status.readyDescription"),
      tone: "bg-bull/10 text-bull border-bull/25",
    },
    {
      label: t("copier.guide.status.waiting"),
      description: t("copier.guide.status.waitingDescription"),
      tone: "bg-amber-500/10 text-amber-300 border-amber-500/25",
    },
    {
      label: t("copier.guide.status.inactive"),
      description: t("copier.guide.status.inactiveDescription"),
      tone: "bg-terminal-hover text-ink-muted border-terminal-border-strong",
    },
    {
      label: t("copier.guide.status.error"),
      description: t("copier.guide.status.errorDescription"),
      tone: "bg-bear/10 text-bear border-bear/25",
    },
  ];

  return (
    <div className="h-full min-h-0 overflow-auto p-3 sm:p-5">
      <div className="mx-auto max-w-5xl space-y-5 pb-4">
        <header className="overflow-hidden rounded-2xl border border-brand/25 bg-linear-to-br from-brand/15 via-terminal-panel-2 to-terminal-panel p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-brand/25 bg-brand/15 text-brand">
              <ListChecks size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-brand">
                {t("copier.guide.kicker")}
              </span>
              <h2 className="mt-1 text-base font-bold text-ink sm:text-lg">
                {t("copier.guide.title")}
              </h2>
              <p className="mt-1.5 max-w-3xl text-[10px] leading-5 text-ink-muted sm:text-[11px]">
                {t("copier.guide.description")}
              </p>
            </div>
          </div>
        </header>

        <section aria-labelledby="copier-guide-mode-title">
          <h3 id="copier-guide-mode-title" className="text-xs font-bold text-ink">
            {t("copier.guide.choose.title")}
          </h3>
          <p className="mt-1 text-[9px] leading-4 text-ink-faint">
            {t("copier.guide.choose.description")}
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <WorkflowCard
              icon={<Link2 size={18} aria-hidden="true" />}
              badge={t("copier.guide.continuous.badge")}
              title={t("copier.guide.continuous.title")}
              description={t("copier.guide.continuous.description")}
              features={[
                t("copier.guide.continuous.feature1"),
                t("copier.guide.continuous.feature2"),
              ]}
              action={t("copier.guide.continuous.cta")}
              onClick={() => onOpenMode("continuous")}
              emphasized
            />
            <WorkflowCard
              icon={<Copy size={18} aria-hidden="true" />}
              badge={t("copier.guide.oneShot.badge")}
              title={t("copier.guide.oneShot.title")}
              description={t("copier.guide.oneShot.description")}
              features={[
                t("copier.guide.oneShot.feature1"),
                t("copier.guide.oneShot.feature2"),
              ]}
              action={t("copier.guide.oneShot.cta")}
              onClick={() => onOpenMode("oneShot")}
            />
          </div>
        </section>

        <section
          aria-labelledby="copier-guide-prerequisites-title"
          className="rounded-2xl border border-terminal-border bg-terminal-panel-2/35 p-4"
        >
          <h3 id="copier-guide-prerequisites-title" className="text-xs font-bold text-ink">
            {t("copier.guide.prerequisites.title")}
          </h3>
          <p className="mt-1 text-[9px] leading-4 text-ink-faint">
            {t("copier.guide.prerequisites.description")}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {prerequisites.map((item) => (
              <div
                key={item.title}
                className="flex min-h-[104px] gap-2.5 rounded-xl border border-terminal-border bg-terminal-panel/55 p-3"
              >
                <span className="mt-0.5 text-brand">{item.icon}</span>
                <span>
                  <strong className="block text-[10px] text-ink">{item.title}</strong>
                  <span className="mt-1 block text-[9px] leading-4 text-ink-faint">
                    {item.description}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <section
            aria-labelledby="copier-guide-steps-title"
            className="rounded-2xl border border-terminal-border bg-terminal-panel-2/35 p-4"
          >
            <h3 id="copier-guide-steps-title" className="text-xs font-bold text-ink">
              {t("copier.guide.steps.title")}
            </h3>
            <p className="mt-1 text-[9px] leading-4 text-ink-faint">
              {t("copier.guide.steps.description")}
            </p>
            <ol className="mt-3 space-y-2">
              {steps.map((step, index) => (
                <li
                  key={step.title}
                  className="grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 rounded-xl border border-terminal-border bg-terminal-panel/55 p-3"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/12 text-[10px] font-bold text-brand">
                    {index + 1}
                  </span>
                  <span>
                    <strong className="block text-[10px] text-ink">{step.title}</strong>
                    <span className="mt-0.5 block text-[9px] leading-4 text-ink-faint">
                      {step.description}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <div className="space-y-4">
            <section
              aria-labelledby="copier-guide-status-title"
              className="rounded-2xl border border-terminal-border bg-terminal-panel-2/35 p-4"
            >
              <h3 id="copier-guide-status-title" className="text-xs font-bold text-ink">
                {t("copier.guide.status.title")}
              </h3>
              <div className="mt-3 space-y-2">
                {statuses.map((status) => (
                  <div key={status.label} className="rounded-xl border border-terminal-border bg-terminal-panel/55 p-2.5">
                    <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide", status.tone)}>
                      {status.label}
                    </span>
                    <p className="mt-1.5 text-[9px] leading-4 text-ink-faint">
                      {status.description}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <div role="note" className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex gap-2.5">
                <CircleAlert size={16} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
                <div>
                  <strong className="text-[10px] text-ink">
                    {t("copier.guide.safety.title")}
                  </strong>
                  <p className="mt-1 text-[9px] leading-4 text-ink-muted">
                    {t("copier.guide.safety.description")}
                  </p>
                </div>
              </div>
            </div>

            <div role="note" className="rounded-2xl border border-sky-500/25 bg-sky-500/5 p-4">
              <div className="flex gap-2.5">
                <Clock3 size={16} className="mt-0.5 shrink-0 text-sky-400" aria-hidden="true" />
                <div>
                  <strong className="text-[10px] text-ink">
                    {t("copier.guide.offline.title")}
                  </strong>
                  <p className="mt-1 text-[9px] leading-4 text-ink-muted">
                    {t("copier.guide.offline.description")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowCard({
  icon,
  badge,
  title,
  description,
  features,
  action,
  onClick,
  emphasized,
}: {
  icon: React.ReactNode;
  badge: string;
  title: string;
  description: string;
  features: string[];
  action: string;
  onClick: () => void;
  emphasized?: boolean;
}) {
  return (
    <article
      className={cn(
        "flex min-h-[260px] flex-col rounded-2xl border p-4",
        emphasized
          ? "border-brand/35 bg-brand/5"
          : "border-terminal-border bg-terminal-panel-2/35",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={cn("grid h-9 w-9 place-items-center rounded-xl", emphasized ? "bg-brand/15 text-brand" : "bg-terminal-hover text-ink-muted")}>
          {icon}
        </span>
        <span className={cn("rounded-md border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide", emphasized ? "border-brand/25 bg-brand/10 text-brand" : "border-terminal-border-strong text-ink-faint")}>
          {badge}
        </span>
      </div>
      <h4 className="mt-3 text-sm font-bold text-ink">{title}</h4>
      <p className="mt-1.5 text-[10px] leading-5 text-ink-muted">{description}</p>
      <ul className="mt-3 space-y-1.5">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2 text-[9px] leading-4 text-ink-faint">
            <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "mt-auto inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 pt-0 text-[10px] font-semibold focus-ring sm:min-h-9",
          emphasized
            ? "bg-brand text-white hover:opacity-90"
            : "border border-terminal-border-strong text-ink-muted hover:border-brand/45 hover:text-brand",
        )}
      >
        {action}
        <ArrowRight size={12} aria-hidden="true" />
      </button>
    </article>
  );
}
