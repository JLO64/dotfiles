# custom-transcript

Display-only transcript refinements for Pi.

- Normalizes indented `diff` fence markers in assistant output, including streaming and restored messages.
- Collapsed built-in `bash`, `edit`, `find`, `grep`, `ls`, `read`, and `write` rows show only their call/header.
- The configured `app.tools.expand` binding cycles the transcript through: tools collapsed with focus off, tools expanded with focus off, then tools collapsed with focus on. Focus shows only user chat messages and assistant text; it is ephemeral and does not change session history or model context.
- Removes the hidden-thinking label and its whitespace when Pi's **Hide thinking blocks** setting is enabled. Visible thinking is unchanged.

## Compatibility

Diff normalization, collapsed result rendering, terminal input, and the hidden-thinking label use public extension APIs. Strict hidden-thinking spacing, PDF-image suppression while collapsed, and transcript focus use isolated feature-detected compatibility adapters around Pi's interactive component internals. On an unsupported Pi version these adapters fail open: the normal transcript remains usable, though strict spacing, image suppression, or focus filtering may be unavailable.

Only Pi's built-in tools listed above are wrapped. Arbitrary third-party extension tools keep their own renderers and may still show collapsed output. The PDF `read` override is coordinated separately so PDF execution and image delivery to vision models remain unchanged.

Focus filtering is designed for both regular and fullscreen transcript trees, but header and loaded-resource elements are outside the public transcript API and may remain visible on some Pi versions.
