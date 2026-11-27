# Documentation

This folder holds the guides for running, using and testing Mux XR. Start with the [project README](../README.md) for a first run, then pick the guide for your task.

## Guides

| Guide                                 | Read it to                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Workspace guide](WORKSPACE.md)       | Use panes, terminal and hand controls, widgets, pictures, saved commands and worlds                       |
| [Host setup](HOST-SETUP.md)           | Serve the app, run the optional macOS host service, look up its flags and routes, and fix common problems |
| [Testing](TESTING.md)                 | Run the local gates, the browser and streamer checks, and know what each one proves                       |
| [Architecture](ARCHITECTURE.md)       | Find which module owns what, and how data moves between the browser, the streamer and the host service    |
| [Pane bell indicators](pane-bells.md) | Understand how a bell reaches a pane and the bell feed                                                    |

## Records

| Document                                             | Contents                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Verification record](verification.md)               | Dated evidence for shipped batches from November 1 to 12, 2026, in date order                                                                                                                                                                                                            |
| [Core 0.91 review](core-0.91.0-review.md)            | Compatibility of the pinned streamer and daemon, with the earlier [0.90](core-0.90.0-review.md), [0.89](core-0.89-review.md), [0.87](core-0.87-review.md), [0.86](core-0.86-review.md), [0.81](core-0.81-review.md), [0.78](core-0.78-review.md) and [0.77](core-0.77-review.md) reviews |
| [Observatory asset contract](blender-kit-project.md) | Budgets, deliverables and validation for the observatory background                                                                                                                                                                                                                      |
| [Performance reports](performance/)                  | Measured terminal clarity, level-of-detail, frame-trace and bundle-size results                                                                                                                                                                                                          |
| [Audit enhancement plans](fable/)                    | Plans ENH-001 to ENH-007 from the 2026-11-15 audit: scene decomposition, frame timing, paste review, check manifest, headset diagnostics, bundle budget and boundary property tests                                                                                                      |
| [Implementation plans](superpowers/plans/)           | Task-by-task feature implementation plans, currently the agent board pagination and max rows plan                                                                                                                                                                                        |

## Writing guidelines

[The documentation style guide](DOCUMENTATION_STYLE_GUIDE.md) sets the structure and formatting these documents follow. [Design](../DESIGN.md) describes the interaction and visual system, and the [contributor guide](../CLAUDE.md) lists the project commands.
