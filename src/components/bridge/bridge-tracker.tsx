"use client";

import { clsx } from "clsx";
import type { BridgeStep } from "@/hooks/use-bridge";

interface TrackerStep {
  label: string;
  detail?: string;
}

function getSteps(direction: "in" | "out", currentStep: BridgeStep): {
  steps: TrackerStep[];
  activeIndex: number;
} {
  if (direction === "in") {
    const steps: TrackerStep[] = [
      { label: "Send tokens", detail: "Deposit to bridge address" },
      { label: "Cross-chain transfer", detail: "Processing via NEAR Intents" },
    ];
    let activeIndex = 0;
    if (currentStep === "awaiting-deposit") activeIndex = 0;
    else if (currentStep === "awaiting-1click") activeIndex = 1;
    else if (currentStep === "complete") activeIndex = 2;
    return { steps, activeIndex };
  } else {
    const steps: TrackerStep[] = [
      { label: "Sign transaction", detail: "Transfer STRK to bridge" },
      { label: "Confirm on Starknet", detail: "Transaction processing" },
      { label: "Cross-chain delivery", detail: "Processing via NEAR Intents" },
    ];
    let activeIndex = 0;
    if (currentStep === "awaiting-transfer") activeIndex = 0;
    else if (currentStep === "transfer-pending" || currentStep === "notifying-1click") activeIndex = 1;
    else if (currentStep === "awaiting-1click-out") activeIndex = 2;
    else if (currentStep === "complete") activeIndex = 3;
    return { steps, activeIndex };
  }
}

export function BridgeTracker({
  direction,
  currentStep,
  oneClickStatus,
}: {
  direction: "in" | "out";
  currentStep: BridgeStep;
  oneClickStatus: string | null;
}) {
  const { steps, activeIndex } = getSteps(direction, currentStep);

  return (
    <div className="rounded-lg bg-surface-overlay border border-line p-4 space-y-3">
      <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
        Progress
      </p>
      <div className="space-y-0">
        {steps.map((step, i) => {
          const isDone = i < activeIndex;
          const isActive = i === activeIndex;
          const isPending = i > activeIndex;

          return (
            <div key={i} className="flex items-start gap-3 relative">
              {/* Vertical line connecting steps */}
              {i < steps.length - 1 && (
                <div
                  className={clsx(
                    "absolute left-[9px] top-[20px] w-px h-[calc(100%)]",
                    isDone ? "bg-up/40" : "bg-line",
                  )}
                />
              )}

              {/* Step indicator */}
              <div
                className={clsx(
                  "relative z-10 w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 mt-0.5",
                  isDone && "bg-up/15 border border-up/30",
                  isActive && "bg-btc/15 border border-btc/30",
                  isPending && "bg-surface border border-line",
                )}
              >
                {isDone ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3DD68C" strokeWidth="3" strokeLinecap="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : isActive ? (
                  <div className="w-2 h-2 rounded-full bg-btc animate-pulse" />
                ) : (
                  <span className="text-[8px] font-mono text-fg-dim">{i + 1}</span>
                )}
              </div>

              {/* Step text */}
              <div className="pb-4">
                <p
                  className={clsx(
                    "text-[12px] font-mono",
                    isDone && "text-up",
                    isActive && "text-fg",
                    isPending && "text-fg-dim",
                  )}
                >
                  {step.label}
                </p>
                <p className="text-[10px] font-mono text-fg-dim mt-0.5">
                  {isActive && oneClickStatus
                    ? oneClickStatus === "INCOMPLETE_DEPOSIT"
                      ? "Deposit detected — amount slightly off, awaiting resolution..."
                      : oneClickStatus.replace(/_/g, " ").toLowerCase()
                    : step.detail}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
