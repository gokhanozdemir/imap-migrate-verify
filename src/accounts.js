import { readFile } from "node:fs/promises";

function validateAccount(account, index) {
  const label = `Account ${index + 1}`;
  if (!account || typeof account !== "object" || Array.isArray(account)) {
    throw new Error(`${label}: expected an object`);
  }
  const { email, sourcePassword, destinationPassword } = account;
  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/u.test(email)) {
    throw new Error(`${label}: invalid email address`);
  }
  if (typeof sourcePassword !== "string" || !sourcePassword) {
    throw new Error(`${label}: sourcePassword is required`);
  }
  if (typeof destinationPassword !== "string" || !destinationPassword) {
    throw new Error(`${label}: destinationPassword is required`);
  }
  return { email, sourcePassword, destinationPassword };
}

export function parseAccountsJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid accounts JSON: ${error.message}`);
  }
  if (!Array.isArray(value) || !value.length) {
    throw new Error("Accounts JSON must be a non-empty array");
  }
  const errors = [];
  const accounts = value.map((account, index) => {
    try {
      return validateAccount(account, index);
    } catch (error) {
      errors.push(error.message);
      return null;
    }
  });
  if (errors.length) throw new Error(`Invalid accounts file:\n${errors.join("\n")}`);
  return accounts;
}

// Kept for one release so existing private account files can be migrated safely.
export function parseAccounts(text) {
  const accounts = [];
  const errors = [];
  for (const [index, original] of text.split(/\r?\n/u).entries()) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(":");
    if (fields.length !== 3 || fields.some((field) => !field.trim())) {
      errors.push(`Line ${index + 1}: expected exactly email:yandexpass:guzelpass (passwords cannot contain ':')`);
      continue;
    }
    const [email, sourcePassword, destinationPassword] = fields.map((field) => field.trim());
    try {
      accounts.push(validateAccount({ email, sourcePassword, destinationPassword }, accounts.length));
    } catch (error) {
      errors.push(`Line ${index + 1}: ${error.message.replace(/^Account \d+: /u, "")}`);
    }
  }
  if (errors.length) throw new Error(`Invalid accounts file:\n${errors.join("\n")}`);
  if (!accounts.length) throw new Error("The accounts file contains no accounts");
  return accounts;
}

export async function loadAccounts(path) {
  const text = await readFile(path, "utf8");
  return path.toLowerCase().endsWith(".json") ? parseAccountsJson(text) : parseAccounts(text);
}
