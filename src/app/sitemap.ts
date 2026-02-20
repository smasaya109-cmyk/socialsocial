import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://example.com";
  const routes = ["/", "/legal/privacy", "/legal/terms", "/legal/data-deletion", "/contact"];
  const now = new Date();

  return routes.map((route) => ({
    url: `${base}${route}`,
    lastModified: now
  }));
}
