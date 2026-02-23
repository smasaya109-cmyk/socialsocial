export type SocialProvider = "instagram" | "x" | "threads" | "tiktok";

export type ProviderPublishInput = {
  provider: SocialProvider;
  accessToken: string;
  body: string;
};

export type ProviderPublishResult = {
  ok: boolean;
  providerPostId?: string;
  errorCode?: string;
  providerResponseMasked?: string;
};

export interface ProviderClient {
  publish(input: ProviderPublishInput): Promise<ProviderPublishResult>;
}
