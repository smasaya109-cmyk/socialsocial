import type { ProviderClient, ProviderPublishInput, ProviderPublishResult } from "@/lib/providers/types";

export class TiktokProviderClient implements ProviderClient {
  async publish(input: ProviderPublishInput): Promise<ProviderPublishResult> {
    void input;
    return {
      ok: false,
      errorCode: "TIKTOK_NOT_IMPLEMENTED",
      providerResponseMasked: "tiktok_client_not_implemented"
    };
  }
}
