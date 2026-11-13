# Mux XR

Mux XR is a LAN workspace for monitoring par-mux terminals and sending commands from a browser or Meta Quest 3. Open individual panes as flat terminals on the desktop or arrange them around you in XR. Use controllers, tracked hands, a virtual keyboard, or a paired physical keyboard to work with the selected pane.

## Quick start

Install the dependencies with Bun 1.4.4, then start Vite.

```sh
bun install --frozen-lockfile
make dev
```

Open [localhost:4240](http://localhost:4240). If another listener owns 4240, use `bun run dev --port <free-port>` and open that port. Choose **Demo** to try synthetic panes without a streamer. Choose **3D preview** to inspect the spatial workspace from the desktop.

## Connect Real Panes

1. Start a mux-enabled `par-term-streamer` against your par-mux daemon. See the [host setup guide](docs/HOST-SETUP.md#serve-the-built-app) for build and TLS instructions.
2. Open Mux XR. The **Streamer endpoint** defaults to the page origin. Enter the streamer address if it is served elsewhere, then connect.
3. Open a pane from the workspace tree. Select its terminal panel before using **Keyboard** or **Commands**. Check the target caption before sending input.

**Close view** removes the panel and detaches its viewer while the shell keeps running. **Disconnect** keeps the panel and last image for inspection. **Reconnect** resumes viewing the same pane. Local text zoom and physical panel size are independent of the remote terminal grid. Use **Apply** in the selected terminal's grid settings to resize it.

## Quest and LAN HTTPS

Open the HTTPS frontend on Quest Browser using a certificate the headset trusts. Choose **Enter XR** or **Enter VR** if immersion does not start automatically. For mixed reality, open Workspace Settings and choose **Enter passthrough** or **Enter with desk window**. See [Quest setup](docs/HOST-SETUP.md#quest-and-lan-https).

## Spatial controls

- Press **A** on the right controller, or touch the right wrist watch with your left hand, to open the radial menu.
- Point and press the trigger or pinch index finger to thumb to select. Grip or pinch middle finger to thumb to move a surface. Grab with both hands to scale it.
- Open **Panes** to attach a terminal. Open **Keyboard** or **Commands** to send input. **Gaze input** is optional and defaults off.
- Press **B** to toggle Focus on the aimed or selected terminal. Use **Layout** for arrangements and recovery. With both grips released, hold both stick clicks for one second to recenter.

See the [workspace guide](docs/WORKSPACE.md) for hand input, Keyborb, window controls, saved commands, widgets, and pictures. Hand tracking still needs physical Quest acceptance.

## Documentation

| Guide | Covers |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Browser, XR, terminal streaming, persistence, and host-service boundaries |
| [Host setup](docs/HOST-SETUP.md) | Streamer, HTTPS, local Whisper, clipboard pairing, and optional host routes |
| [Testing](docs/TESTING.md) | Local gates, browser fixtures, private-streamer tests, and headset acceptance |
| [Contributor guide](CLAUDE.md) | Project commands, source entry points, and implementation constraints |
| [Design](DESIGN.md) and [product requirements](PRD.md) | Interaction design, product scope, and planned work |
