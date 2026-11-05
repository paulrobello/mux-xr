# Hand editing selections

On `AuthoredHandMesh`, the `Edit` vertex groups are binary selection helpers.
`Edit Palm` covers the wrist and palm, while each finger group covers that
entire digit. Each corresponding `Tip` group is a subset starting at the
last finger bone. The outer finger is the little-finger side of this stylized
four-digit hand.

In Edit Mode, deselect the mesh, choose a group in Object Data Properties >
Vertex Groups, and press Select. The original `wrist` and numbered finger
bone groups are rig weights used by the armature. Keep them until the mesh is
ready to be re-rigged. Editing geometry may require updating the selection
groups manually. The hidden `Hand.001` is the original skin-based source.

`setup_edit_groups.py` documents the initial assignment on the current rigged
mesh using geometric cuts. Each group is checked for connectedness, but the
cut positions are specific to this hand and should be reviewed after reshaping.
It is not a general re-rigging tool.
Back up the open file before running it. It does not save the file.
