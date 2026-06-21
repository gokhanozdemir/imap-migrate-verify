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
  // This server advertises capabilities in its greeting but rejects the
  // standard pre-auth CAPABILITY command, so it needs a legacy bootstrap.
  legacyGreetingCapabilities: true,
  // Despite advertising AUTH=PLAIN and AUTH=LOGIN, both SASL mechanisms are
  // rejected. The classic IMAP LOGIN command succeeds over implicit TLS.
  loginMethod: "LOGIN",
});

export const DEFAULTS = Object.freeze({
  days: null,
  concurrency: 3,
  reportDir: "reports",
  destinationLookbackBufferDays: 2,
});
