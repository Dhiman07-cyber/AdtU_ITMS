import { z } from "zod";

export const mapProviderSchema = z.enum(["guwahati"]);
export const mapThemeSchema = z.enum(["light", "dark"]);

export const mapConfigSchema = z.object({
  provider: mapProviderSchema,
  theme: mapThemeSchema,
  center: z.tuple([z.number(), z.number()]).optional(),
  zoom: z.number().min(0).max(22).optional(),
});

export type MapProvider = z.infer<typeof mapProviderSchema>;
export type MapTheme = z.infer<typeof mapThemeSchema>;
export type MapConfig = z.infer<typeof mapConfigSchema>;

export function sanitizeMapConfigInput(raw: unknown): MapConfig | null {
  const parsed = mapConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

