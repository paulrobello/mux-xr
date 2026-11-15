# Slice 2: label update, overlay order, control ids

## Files

Edit: `packages/xr-workspace/src/labels.ts`, `radial-menu.ts`, `wrist-menu-watch.ts`, `tests/helpers/labels.ts`, and the existing tests `tests/xr-labels.test.ts`, `tests/radial-menu.test.ts`, `tests/wrist-menu-watch.test.ts` (add cases only).
Create: `packages/xr-workspace/src/overlay-order.ts`, `packages/xr-workspace/src/control-ids.ts`, `tests/overlay-order.test.ts`, `tests/control-ids.test.ts`.

## 1. Label update is a no-op when the text is unchanged

Consumers compare `mesh.userData.labelText` themselves before calling `updateScalableLabel`, because each call re-typesets the text. Move that check into the function.

In `labels.ts`, `updateScalableLabel(root, label)`: after the existing disposed guard, `if (data.labelText === label) return;`. Signature unchanged.

Before changing it, list every caller in the repo (`grep -rn "updateScalableLabel" src packages scripts tests`) and confirm none relies on a same-text call to force a re-sync, for example after `configureLabelFonts`. If one does, leave that caller correct by adding an explicit optional third parameter `force = false` and passing `true` there. Report what you found.

Mirror the behaviour in `tests/helpers/labels.ts` only if a test needs it.

Test in `tests/xr-labels.test.ts`: a same-text update leaves `userData.labelSyncPromise` identical (same object); a different text replaces it and updates `userData.labelText`.

## 2. `control-ids.ts`

Emulator checks in consumer apps aim at controls by computing their coordinates. Give every interactive object a stable id instead.

```ts
/** Marks an object as a control an automated check can find by id. Also sets `name`. */
export function setControlId<T extends THREE.Object3D>(object: T, id: string): T;
/** First object under `root` (inclusive, depth-first) whose control id is `id`. */
export function findControl(root: THREE.Object3D, id: string): THREE.Object3D | undefined;
/** The control id of `object` or its nearest ancestor that has one, stopping at `root`. */
export function controlIdOf(object: THREE.Object3D, root?: THREE.Object3D): string | null;
```

`setControlId` writes `object.name = id` and `object.userData.controlId = id` and returns the object.

Apply it:

- `labels.ts`: add `name?: string` to `ScalableLabelOptions` ("Stable id for automated checks; sets `name` and `userData.controlId`"). When given, call `setControlId(root, options.name)`.
- `radial-menu.ts`: the sector groups are already named `radial-menu-<action>` and the centre group `radial-menu-cancel`; the footer button is named `footer.name ?? radial-menu-<footer.id>`. Set `userData.controlId` to the same string on each of those three kinds of object. Do not rename anything: Mux XR and its tests look these names up.
- `wrist-menu-watch.ts`: the watch takes a caller-owned button. Give the root, case, strap and update indicator a `controlId` equal to their existing `name`. If the button object has no name, leave it alone (it is the caller's).

Tests in `tests/control-ids.test.ts`: `setControlId` sets both fields; `findControl` finds a nested object and returns undefined for a missing id; `controlIdOf` climbs to the nearest ancestor and stops at `root`. Add one case to `tests/radial-menu.test.ts` asserting `findControl(menu.root, 'radial-menu-<action>')` returns the sector group, and one to the watch test for the root.

## 3. `overlay-order.ts`

Over worlds built from additive, depth-write-off layers, menus drew before those layers and their panels looked nearly transparent. three.js sorts render items by `groupOrder` first. A `THREE.Group`'s `renderOrder` becomes the `groupOrder` of everything under it, and every nested `Group` resets it to its own value. Audio Probe XR therefore sets `renderOrder = 1000` on every Group under its controls root and repeats that whenever it adds rows.

Mux XR solves the same problem with a second pass over `ON_TOP_LAYER` (`render-layers.ts`). This helper is for apps that draw in one pass. It must not change Mux XR.

```ts
export const OVERLAY_RENDER_ORDER = 1000;
/**
 * Draws everything under `root` after the rest of the scene, including objects added later.
 * Returns a function that stops tracking additions; orders already set are left as they are.
 */
export function keepAbove(root: THREE.Object3D, order = OVERLAY_RENDER_ORDER): () => void;
```

Implementation:

- `raise(object)`: traverse `object`; for each node, if `node.isGroup` set `node.renderOrder = order`; add a `childadded` listener to every node (three r186 dispatches `{ type: 'childadded', child }` on the parent inside `Object3D.add`). Keep each `(node, listener)` pair so the disposer can remove them. Use one listener function for all nodes: `(event) => raise(event.child)`.
- Guard against double registration when a subtree is removed and re-added: keep a `WeakSet` of tracked nodes and skip a node already in it (still descend into its children, which may be new).
- The disposer removes every listener and clears the list.

Tests in `tests/overlay-order.test.ts`: nested groups all get the order, and a plain `Mesh` keeps `renderOrder` 0; a group added later to the root is raised; a group added to that later-added group is raised; after the disposer runs, a newly added group keeps `renderOrder` 0; calling `keepAbove` with a custom order uses it.

## Done when

`bunx vitest run tests/xr-labels.test.ts tests/label-batches.test.ts tests/radial-menu.test.ts tests/wrist-menu-watch.test.ts tests/overlay-order.test.ts tests/control-ids.test.ts tests/xr-workspace-package.test.ts` passes, `bunx tsc --noEmit -p .` reports no errors in your files, and `bunx biome check` is clean on them.
