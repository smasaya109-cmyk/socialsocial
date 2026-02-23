import { InstagramProviderClient } from "@/lib/providers/instagram/client";
import { ThreadsProviderClient } from "@/lib/providers/threads/client";
import { TiktokProviderClient } from "@/lib/providers/tiktok/client";
import { XProviderClient } from "@/lib/providers/x/client";
import type { ProviderClient, SocialProvider } from "@/lib/providers/types";

export function resolveProviderClient(provider: SocialProvider): ProviderClient {
  if (provider === "x") return new XProviderClient();
  if (provider === "instagram") return new InstagramProviderClient();
  if (provider === "threads") return new ThreadsProviderClient();
  return new TiktokProviderClient();
}
