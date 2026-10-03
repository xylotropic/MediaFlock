import { getConfig } from "../domain/config";
import { resolveIntegration } from "../domain/integrations";
import { DeterministicDemoProvider } from "./demo";
import { PostForMeProvider } from "./postforme";
import { ProviderError } from "./provider";
export async function publishingProvider(workspaceId: string) {
  if (getConfig().mode === "demo") return new DeterministicDemoProvider();
  const configuration = await resolveIntegration(workspaceId, "postforme");
  if (!configuration.key || !configuration.enabled)
    throw new ProviderError(
      "unavailable",
      "Configure and enable Post for Me in Administration.",
    );
  return new PostForMeProvider(fetch, configuration.key);
}
export * from "./provider";
