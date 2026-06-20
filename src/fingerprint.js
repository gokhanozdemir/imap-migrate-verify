import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";

function cleanText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t ]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function addresses(field) {
  return (field?.value ?? [])
    .map(({ address, name }) => ({
      address: String(address ?? "").trim().toLowerCase(),
      name: cleanText(name),
    }))
    .sort((a, b) => `${a.address}\0${a.name}`.localeCompare(`${b.address}\0${b.name}`));
}

export function normalizeMessageId(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^<|>$/gu, "")
    .trim()
    .toLowerCase();
  return normalized || null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function fingerprintMessage(source, metadata = {}) {
  const parsed = await simpleParser(source, {
    skipHtmlToText: true,
    skipTextToHtml: true,
  });

  const attachments = parsed.attachments
    .map((attachment) => ({
      filename: cleanText(attachment.filename),
      contentType: String(attachment.contentType ?? "").toLowerCase(),
      contentId: cleanText(attachment.contentId),
      size: attachment.size ?? attachment.content?.length ?? 0,
      hash: sha256(attachment.content ?? Buffer.alloc(0)),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  const semantic = {
    from: addresses(parsed.from),
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    bcc: addresses(parsed.bcc),
    subject: cleanText(parsed.subject),
    date: parsed.date instanceof Date && !Number.isNaN(parsed.date.valueOf())
      ? parsed.date.toISOString()
      : "",
    text: cleanText(parsed.text),
    html: cleanText(parsed.html),
    attachments,
  };

  return {
    messageId: normalizeMessageId(parsed.messageId ?? metadata.messageId),
    semanticHash: sha256(JSON.stringify(semantic)),
    sender: parsed.from?.text ?? metadata.sender ?? "",
    subject: parsed.subject ?? metadata.subject ?? "",
    sentAt: semantic.date || metadata.sentAt || null,
  };
}
