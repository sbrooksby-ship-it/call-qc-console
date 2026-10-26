const encoder = new TextEncoder();

export async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const digest = async (value: string) => new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  const [providedDigest, expectedDigest] = await Promise.all([digest(provided), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= providedDigest[index] ^ expectedDigest[index];
  }
  return difference === 0;
}
