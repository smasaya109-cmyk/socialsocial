import type { ProviderClient, ProviderPublishInput, ProviderPublishResult } from "@/lib/providers/types";

export class InstagramProviderClient implements ProviderClient {
  async publish(input: ProviderPublishInput): Promise<ProviderPublishResult> {
    void input;
    return {
      ok: false,
      errorCode: "INSTAGRAM_NOT_IMPLEMENTED",
      providerResponseMasked: "instagram_client_not_implemented"
    };
  }
}
