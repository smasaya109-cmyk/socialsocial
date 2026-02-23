import type { ProviderClient, ProviderPublishInput, ProviderPublishResult } from "@/lib/providers/types";

export class ThreadsProviderClient implements ProviderClient {
  async publish(input: ProviderPublishInput): Promise<ProviderPublishResult> {
    void input;
    return {
      ok: false,
      errorCode: "THREADS_NOT_IMPLEMENTED",
      providerResponseMasked: "threads_client_not_implemented"
    };
  }
}
