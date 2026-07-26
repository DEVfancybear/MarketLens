"use client";

import { useCallback, useState } from "react";
import {
  issueExecutionPairingToken,
  type ExecutionPairingToken,
} from "@/services/api/resources/executionApi";

export function useExecutionPairingToken() {
  const [pairing, setPairing] = useState<ExecutionPairingToken | null>(null);
  const [pairingFailed, setPairingFailed] = useState(false);
  const [pairingLoading, setPairingLoading] = useState(false);

  const createPairingToken = useCallback(async () => {
    setPairingLoading(true);
    setPairingFailed(false);
    try {
      setPairing(await issueExecutionPairingToken());
    } catch {
      setPairing(null);
      setPairingFailed(true);
    } finally {
      setPairingLoading(false);
    }
  }, []);

  return {
    pairing,
    pairingFailed,
    pairingLoading,
    createPairingToken,
  };
}
