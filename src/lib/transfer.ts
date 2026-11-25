import { rbx } from "./ipc";
import { t } from "./i18n";

/*
 * Roblox's own Robux transfer (Roblox Plus members can send Robux to people). Same calls the
 * Roblox site makes: check your limit, start a transfer to someone, then send the amount.
 * Nothing is created until you confirm; Roblox may ask you to verify or need a parent's OK.
 */
const BASE = "https://apis.roblox.com/transfer/v1/robux-transfer";

export type TransferLimit = { perTransferLimit?: number; remainingLimit?: number; dailyLimit?: number } & Record<string, unknown>;

export const transferLimit = () => rbx<TransferLimit>(`${BASE}/user-transfer-limit`);

export type TransferResult = { ok: true } | { ok: false; parentConsent: boolean; transferId: string; message: string };

export async function sendRobux(recipientId: number, robuxAmount: number): Promise<TransferResult> {
  const start = await rbx<{ transferRequestId?: string }>(`${BASE}/initiate-transfer`, { method: "POST", body: { transferOrigin: 1, recipientId } });
  const id = start.transferRequestId;
  if (!id) throw new Error(t("Roblox didn't start the transfer."));
  try {
    await rbx(`${BASE}/process-transfer/${encodeURIComponent(id)}`, { method: "POST", body: { robuxAmount } });
    return { ok: true };
  } catch (e) {
    const data = (e as { data?: { ampRecourseActions?: string[]; failureReason?: string; errorMessage?: string } }).data;
    if (data?.ampRecourseActions?.includes("ParentConsentRecourse")) {
      return { ok: false, parentConsent: true, transferId: id, message: "This account needs a parent's OK to send Robux." };
    }
    throw new Error(data?.errorMessage || (e instanceof Error ? e.message : t("The transfer didn't go through.")));
  }
}

/** Sends the transfer to your parents for approval (child accounts). */
export const askParentForTransfer = (transferId: string, robuxAmount: number) =>
  rbx("https://apis.roblox.com/child-requests-api/v1/send-request-to-all-parents", {
    method: "POST",
    body: { requestType: "SendTransfer", requestDetails: { transferType: "Robux", transferId: transferId.replace("RXT-", ""), robuxTransferAmount: robuxAmount } },
  });
