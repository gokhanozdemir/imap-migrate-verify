function folderKey(message) {
  return message.folderKey ?? String(message.folder ?? "").normalize("NFKC").toLowerCase();
}

function chooseCandidate(source, candidates) {
  const sameFolder = candidates.find((candidate) => folderKey(candidate) === folderKey(source));
  return sameFolder ?? candidates[0] ?? null;
}

export function matchInventories(source, destination) {
  const consumed = new Set();
  const sourceIdCounts = new Map();

  for (const item of source) {
    if (item.messageId) sourceIdCounts.set(item.messageId, (sourceIdCounts.get(item.messageId) ?? 0) + 1);
  }
  return source.map((item) => {
    let candidates;
    const idIsUnambiguous = item.messageId && sourceIdCounts.get(item.messageId) === 1;

    if (idIsUnambiguous) {
      candidates = destination.filter(
        (candidate, index) => !consumed.has(index) && candidate.messageId === item.messageId,
      );
    } else {
      candidates = destination.filter(
        (candidate, index) => !consumed.has(index) && candidate.semanticHash === item.semanticHash,
      );
      if (!candidates.length && item.messageId) {
        candidates = destination.filter(
          (candidate, index) => !consumed.has(index)
            && candidate.messageId === item.messageId
            && (!candidate.semanticHash || !item.semanticHash),
        );
      }
    }

    const candidate = chooseCandidate(item, candidates);
    if (!candidate) return { source: item, destination: null, status: "missing" };

    const index = destination.indexOf(candidate);
    consumed.add(index);
    const status = folderKey(candidate) === folderKey(item)
      ? "present"
      : "present-in-other-folder";
    return { source: item, destination: candidate, status };
  });
}

export function finalizeMatches(before, after) {
  return after.map((result, index) => {
    if (result.status === "missing") return { ...result, status: "unresolved" };
    if (before[index]?.status === "missing") return { ...result, status: "copied-and-verified" };
    return result;
  });
}
