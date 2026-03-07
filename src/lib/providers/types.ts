export type SocialProvider = "instagram" | "x" | "threads" | "tiktok";

export type ProviderPublishInput = {
  provider: SocialProvider;
  providerAccountId?: string;
  accessToken: string;
  refreshToken?: string | null;
  body: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaKind?: "video" | "image" | "thumbnail";
};

export type ProviderPublishResult = {
  ok: boolean;
  providerPostId?: string;
  errorCode?: string;
  providerResponseMasked?: string;
  rotatedAccessToken?: string;
  rotatedRefreshToken?: string | null;
  rotatedExpiresIn?: number;
};

export interface ProviderClient {
  publish(input: ProviderPublishInput): Promise<ProviderPublishResult>;
}
