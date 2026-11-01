# P2: Spatial workspace polish

## Dependencies

P1 qualification and owner review of the usable MVP.

## Tasks

- P2.1: Named headset-local 3D layouts preserving pane references, transforms, physical size, font zoom and background. Restore around a recenterable origin; unavailable panes have placeholders. Verify schema migration/round trips and actual save/reload/restore. Dependencies: P1.
- P2.2: Animated radial command/hierarchy menus, spatial window flyouts and coordinated layout restore. Honor target binding and keep viewpoint under user control. Verify interrupted/reopened animations, controller targeting and readable endpoints in browser and Quest. Dependencies: P1; coordinate shared UI files with P2.1.
- P2.3: Whole-window split composition and expanded panel-capacity benchmark. Preserve independent pop-out panes and explicit sizing policy. Verify against live layout updates and real workload measurements. Dependencies: P1.3, P1.4.

Each task requires `make checkall`, `make checkall-ci`, relevant local browser checks and actual Quest evidence before done, followed by an atomic commit.
