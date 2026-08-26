# Custom Transcript Focus Mode Diagnosis

## Summary

The custom transcript extension's three-state `Ctrl+O` logic is implemented and its unit tests pass, but it is not active in the running Pi editor when `pi-vim` is enabled.

Both `custom-transcript` and `pi-vim` install a custom editor during `session_start`. Pi stores only one editor factory; it does not automatically compose multiple custom editors. Because `pi-vim` installs its `ModalEditor` after `custom-transcript` installs `TranscriptCycleEditor`, `pi-vim` replaces the transcript wrapper. As a result, `Ctrl+O` reaches Pi's built-in `app.tools.expand` handler and behaves as a binary expanded/collapsed toggle. The custom transcript cycle never receives the keypress, so focus mode cannot be activated through `Ctrl+O`.

## Intended Behavior

Repeated activation of the configured `app.tools.expand` action—`Ctrl+O` by default—should cycle through these states:

1. Focus mode off; tool output collapsed.
2. Focus mode off; tool output expanded.
3. Focus mode on; tool output collapsed.
4. Return to state 1.

The former `Ctrl+H` focus binding has intentionally been removed.

## Observed Behavior

In the running Pi session:

- `Ctrl+H` no longer activates focus mode, as intended.
- `Ctrl+O` expands tool output.
- The next `Ctrl+O` collapses tool output.
- Additional presses continue toggling expansion and never visibly activate focus mode.

This exactly matches Pi's built-in binary `app.tools.expand` action, indicating that the custom transcript editor interception is not running.

## Evidence

### The custom transcript extension installs an editor wrapper

`pi_files/agent/extensions/custom-transcript/index.ts:20-28` installs the transcript cycle editor during `session_start`.

The wrapper's input handler in `pi_files/agent/extensions/custom-transcript/transcript-focus.ts:47-52` matches the configured `app.tools.expand` action, advances the three-state cycle, and returns before calling the parent input handler. If this handler were active, Pi's built-in binary toggle would not execute for that keypress.

### pi-vim installs another editor

`pi_files/agent/extensions/pi-vim/index.ts:3590-3622` also handles `session_start` and installs its `ModalEditor` unconditionally.

Pi's editor replacement API retains one editor factory. Installing another factory replaces the previous one rather than composing the two automatically. Lifecycle handlers run in extension order, so the later `pi-vim` installation becomes the active editor.

### The resulting behavior follows Pi's built-in path

With `TranscriptCycleEditor` replaced, `pi-vim`'s `ModalEditor` eventually delegates unhandled `Ctrl+O` input through Pi's standard editor handling. Pi then executes its registered `app.tools.expand` action, which calls the ordinary tool-output expansion toggle.

Relevant installed runtime locations include:

- `dist/modes/interactive/components/custom-editor.js`: standard custom-editor keybinding dispatch.
- `dist/modes/interactive/interactive-mode.js`: editor replacement, `app.tools.expand` registration, and tool-output toggling.
- `dist/core/extensions/runner.js`: extension lifecycle handler execution.

The visible expanded/collapsed behavior therefore confirms that the built-in handler is running instead of the transcript cycle.

## Why the Previous Compatibility Fix Was Insufficient

An earlier issue affected focus rendering after `/reload`: the transcript root could be constructed before the compatibility hook was installed, preventing the root from being recorded. The compatibility layer was updated to recognize already-populated transcript roots during rendering, and regression coverage was added.

That fix remains valid, but it addresses rendering only after focus state has been activated. It cannot help when the active editor never invokes the state-cycle handler.

## Reload Behavior

Running `/reload` does not resolve the conflict. Pi resets extension UI, reloads extensions, and emits `session_start` again. The same extensions reinstall their editors in the same order, and `pi-vim` once again replaces the custom transcript editor.

Thus this is deterministic lifecycle behavior, not stale deployed code.

## Ruled-Out Causes

The investigation found no evidence that the failure is caused by:

- A `Ctrl+O` remapping in `keybindings.json`.
- Duplicate handling of the same key event inside `TranscriptCycleEditor`.
- Key release or repeat events advancing the cycle unexpectedly.
- Repository and deployed custom-transcript copies being different.
- The transcript root fallback itself failing under the current chat structure.
- TypeScript source files not being loadable from the deployed extension directory.

The deployed extension entrypoint is `~/.pi/agent/extensions/custom-transcript/index.ts`, discovered and loaded by Pi through its extension package loader.

## Upstream and API Findings

Pi's custom editor documentation describes `setEditorComponent()` and `getEditorComponent()`, including explicit wrapping when extensions need to compose editor behavior. Composition is not automatic.

Relevant primary sources:

- Pi extension documentation: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#custom-editor>
- Pi keybinding documentation: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/keybindings.md>
- Custom editor dispatch implementation: <https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/modes/interactive/components/custom-editor.ts>
- Interactive mode implementation: <https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/modes/interactive/interactive-mode.ts>
- Multiple-editor composition issue: <https://github.com/earendil-works/pi/issues/3935>
- Reload/editor restoration fix: <https://github.com/badlogic/pi-mono/pull/949>
- Custom-editor shortcut lifecycle fix: <https://github.com/badlogic/pi-mono/pull/947>
- Raw terminal input discussion: <https://github.com/earendil-works/pi/issues/1286>

The documented and source-supported conclusions are:

1. A custom editor should intercept an action before calling `super.handleInput()` when overriding built-in behavior.
2. `app.tools.expand` should be matched through configured keybindings rather than hardcoding the raw `Ctrl+O` byte sequence.
3. Extension shortcuts are not an appropriate way to override this reserved built-in binding.
4. Raw terminal listeners are global and could break `Ctrl+O` behavior in `/tree` or other selectors.
5. Multiple extensions replacing the editor must explicitly cooperate.

## Recommended Fix

The most robust approach is to make `pi-vim`'s `ModalEditor`—the actual active main editor—handle the transcript cycle while retaining focus state and transcript rendering in the custom transcript extension.

A suitable implementation should:

1. Expose a small shared transcript-cycle interface or action from `custom-transcript`.
2. Match the configured `app.tools.expand` action inside `pi-vim`'s active editor.
3. Advance the cycle and consume the input before Pi's built-in action handler runs.
4. Preserve delegation for all unrelated input.
5. Keep `/tree` and modal selector behavior unchanged by limiting interception to the main editor.
6. Remove the ineffective independent editor installation from `custom-transcript`.
7. Add integration coverage with both extensions loaded, asserting that the final active editor advances all three states.
8. Synchronize both extensions to their corresponding locations under `~/.pi`.

An alternative is explicit custom-editor composition using `getEditorComponent()` and `setEditorComponent()`. However, this must preserve `pi-vim`'s modal editor rather than replacing it with a plain custom editor. Relying solely on extension discovery order or asynchronous installation would be fragile.

## Suggested Runtime Verification

After implementing the integration:

1. Reload Pi with `/reload`.
2. Confirm the initial state is focus off with tools collapsed.
3. Press `Ctrl+O` once and confirm tool results expand.
4. Press `Ctrl+O` again and confirm tool results collapse while the footer shows `focus transcript` and non-message transcript rows disappear.
5. Press `Ctrl+O` a third time and confirm focus mode turns off while tools remain collapsed.
6. Open `/tree` and confirm its `Ctrl+O` filter behavior remains unchanged.
7. Repeat the cycle after another `/reload`.
8. Run an integration test with both `pi-vim` and `custom-transcript` enabled to prevent recurrence of editor replacement conflicts.

## Current Status

The cross-extension integration has now been implemented. `custom-transcript` publishes its cycle callback through Pi's shared extension event bus, and `pi-vim`'s active `ModalEditor` invokes that callback when it handles the configured `app.tools.expand` action. The ineffective competing editor installation was removed from `custom-transcript`.

Integration coverage verifies the behavior with both extensions present. The implementation has passed the combined custom-transcript and pi-vim test suites and targeted TypeScript validation, and both extension directories have been synchronized to `~/.pi/agent/extensions/`.

The related collapsed-output issue for the built-in `edit` tool has also been fixed: its call header remains visible while its preview diff is hidden when collapsed and restored when expanded.
