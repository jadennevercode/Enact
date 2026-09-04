/**
 * Mention node types the editor and the readonly renderer both understand.
 *
 * `AT_PREFIXED_MENTION_TYPES` is the set that reads as "@Name" — an actor a
 * message addresses. Everything else is rendered by its own chip (issues) or,
 * when the type is one this build no longer knows, as the plain label text.
 *
 * Stored rich text outlives the features that wrote it: a document saved while
 * projects existed can still carry `mention://project/<uuid>`, and the markdown
 * tokenizer accepts any `\w+` type, so such a node still parses. Treating an
 * unknown type as plain text — rather than as an actor, which would prepend a
 * stray "@", or as a chip, which has nothing to resolve — is what keeps that
 * content readable instead of broken.
 */
export const AT_PREFIXED_MENTION_TYPES = new Set(["member", "agent", "squad", "all"]);

export function isAtPrefixedMentionType(type: unknown): boolean {
  return typeof type === "string" && AT_PREFIXED_MENTION_TYPES.has(type);
}
