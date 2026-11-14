/**
 * Menus, hands and pointer rays sit on this layer. While a menu is open the scene draws in two
 * passes, this layer last over a cleared depth buffer, so nothing in the room can cover a menu.
 * Raycasters enable it so those objects stay pickable.
 */
export const ON_TOP_LAYER = 30;
