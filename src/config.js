import { readFile } from "node:fs/promises";

export const DEFAULTS = Object.freeze({
  days: null,
  concurrency: 3,
  reportDir: "reports",
  destinationLookbackBufferDays: 2,
});

function resolveProvider(value, role) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${role} must be a provider object`);
  }
  const provider = { ...value };
  provider.name ??= role === "source" ? "Source" : "Destination";
  if (typeof provider.name !== "string" || !provider.name.trim()) {
    throw new Error(`${role}.name must be a non-empty string`);
  }
  if (typeof provider.host !== "string" || !provider.host.trim()) {
    throw new Error(`${role}.host must be a non-empty string`);
  }
  if (!Number.isSafeInteger(provider.port) || provider.port < 1 || provider.port > 65535) {
    throw new Error(`${role}.port must be an integer between 1 and 65535`);
  }
  if (typeof provider.secure !== "boolean") {
    throw new Error(`${role}.secure must be true or false`);
  }
  for (const key of ["legacyGreetingCapabilities"]) {
    if (provider[key] != null && typeof provider[key] !== "boolean") {
      throw new Error(`${role}.${key} must be true or false`);
    }
  }
  for (const key of ["loginMethod", "authMechanism"]) {
    if (provider[key] != null && typeof provider[key] !== "string") {
      throw new Error(`${role}.${key} must be a string`);
    }
  }
  return Object.freeze(provider);
}

export function parseMigrationConfig(text) {
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid migration config JSON: ${error.message}`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Migration config must be a JSON object");
  }
  return Object.freeze({
    source: resolveProvider(config.source, "source"),
    destination: resolveProvider(config.destination, "destination"),
  });
}

export async function loadMigrationConfig(path) {
  return parseMigrationConfig(await readFile(path, "utf8"));
}
