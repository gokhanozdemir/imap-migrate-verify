import { useEffect, useRef } from "preact/hooks";

interface LogLine {
  timestamp: string;
  message: string;
}

interface Props {
  lines: LogLine[];
  maxHeight?: string;
}

function classify(msg: string): string {
  if (/copied|verified/i.test(msg)) return "msg-copy";
  if (/pass|success/i.test(msg))    return "msg-pass";
  if (/fail|error|unresolved/i.test(msg)) return "msg-fail";
  if (/warn|quota|retry/i.test(msg)) return "msg-warn";
  return "";
}

export function LogPanel({ lines, maxHeight = "200px" }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length]);

  return (
    <div class="log-panel" style={{ maxHeight }}>
      {lines.length === 0 && (
        <div class="text-dim" style="font-style:italic;">— no output yet —</div>
      )}
      {lines.map((l, i) => (
        <div key={i} class="log-line">
          <span class="ts">{l.timestamp.slice(11, 19)}</span>
          <span class={classify(l.message)}>{l.message}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
