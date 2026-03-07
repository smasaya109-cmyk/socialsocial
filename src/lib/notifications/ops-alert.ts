type CreditsDepletedAlertInput = {
  brandId: string;
  scheduledPostId: string;
  provider: string;
  errorCode: string;
};

export async function notifyCreditsDepleted(input: CreditsDepletedAlertInput): Promise<void> {
  const webhookUrl = process.env.OPS_ALERT_WEBHOOK_URL;
  const payload = {
    event: "credits_depleted",
    provider: input.provider,
    errorCode: input.errorCode,
    brandId: input.brandId,
    scheduledPostId: input.scheduledPostId,
    at: new Date().toISOString()
  };

  if (!webhookUrl) {
    console.warn("[ops-alert] webhook not configured", payload);
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("[ops-alert] webhook failed", {
        status: response.status,
        body: text.slice(0, 200)
      });
    }
  } catch (error) {
    const err = error as { message?: string } | undefined;
    console.error("[ops-alert] webhook error", { message: err?.message ?? "unknown_error" });
  }
}

