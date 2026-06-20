export const SOURCE_SERVER = Object.freeze({
  name: "Yandex",
  host: "imap.yandex.com.tr",
  port: 993,
  secure: true,
});

export const DESTINATION_SERVER = Object.freeze({
  name: "Guzel",
  host: "mail.guzel.net.tr",
  port: 993,
  secure: true,
});

export const DEFAULTS = Object.freeze({
  days: 7,
  concurrency: 3,
  reportDir: "reports",
  destinationLookbackBufferDays: 2,
});
