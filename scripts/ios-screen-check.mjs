// Fresh simulator pairing must render the actual heading and form labels.
export function hasPairingScreen(lines) {
  const text = lines.join(" ").toLowerCase().replace(/\s+/g, " ");
  return [
    "bring your workspace along",
    "device name",
    "pairing link from your pc",
  ].every((label) => text.includes(label));
}
