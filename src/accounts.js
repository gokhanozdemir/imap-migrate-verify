import { readFile } from "node:fs/promises";

export function parseAccounts(text) {
  const accounts = [];
  const errors = [];

  for (const [index, original] of text.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1;
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;

    const fields = line.split(":");
    if (fields.length !== 3 || fields.some((field) => !field.trim())) {
      errors.push(
        `Line ${lineNumber}: expected exactly email:yandexpass:guzelpass (passwords cannot contain ':')`,
      );
      continue;
    }

    const [email, yandexPassword, guzelPassword] = fields.map((field) => field.trim());
    if (!/^\S+@\S+\.\S+$/u.test(email)) {
      errors.push(`Line ${lineNumber}: invalid email address`);
      continue;
    }

    accounts.push({ email, yandexPassword, guzelPassword, lineNumber });
  }

  if (errors.length) {
    throw new Error(`Invalid accounts file:\n${errors.join("\n")}`);
  }
  if (!accounts.length) {
    throw new Error("The accounts file contains no accounts");
  }
  return accounts;
}

export async function loadAccounts(path) {
  return parseAccounts(await readFile(path, "utf8"));
}
